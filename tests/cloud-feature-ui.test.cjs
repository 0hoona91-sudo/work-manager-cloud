// Real Chromium + production saveState/cloud functions; synthetic transport only.
const assert = require('node:assert/strict');
const {withPage} = require('./browser.test.cjs');
const {harness, mockTransport} = require('./recurrence-cloud-harness.cjs');
const {plain} = require('./helpers.cjs');

async function connect(page) {
  const state = await page.evaluate(() => {seed();return state;});
  const transport = mockTransport(), cloud = harness(transport, state), calls=[];
  for (const [collection,map] of Object.entries(cloud.codec.serializeState(state)))
    for (const [id,value] of map) transport.seed(`${collection}/${id}`, {...plain(value),revision:1});
  let hold=null;
  await page.exposeFunction('__cloudSave', async (snapshot, meta) => {
    calls.push(plain(meta));
    if(hold)await hold;
    cloud.ctx.stateRef=plain(snapshot);
    try {return {result:plain(await cloud.api.save(plain(snapshot),meta))};}
    catch(error){return {error:{message:error.message,code:error.code,definiteFailure:error.definiteFailure,recoveryRequired:error.recoveryRequired}};}
  });
  await page.evaluate(async () => {
    window.cloudSync={mode:'cloud',workspaceKey:'demo-work-manager',workspaceUser:{uid:'synthetic-owner'},user:{uid:'synthetic-owner'},
      recurrenceContext:{scope:'demo-work-manager/synthetic-owner',ready:true,locks:[]},hydrateImages:async()=>{},saveTrashEntry:async entry=>{window.__testTrashEntry=structuredClone(entry);return entry;},
      save:async(snapshot,meta)=>{const reply=await window.__cloudSave(snapshot,meta);if(reply.error)throw Object.assign(new Error(reply.error.message),reply.error);return reply.result;}};
    await WMRecovery.initialize();
  });
  return {transport,cloud,calls,pause(){let release;hold=new Promise(r=>release=r);return ()=>{hold=null;release();};}};
}
async function form(page,name='합성 클라우드 프로젝트') {
  await page.evaluate(()=>WMProjectUI.openEditor());
  await page.locator('#prj-name').fill(name);
  await page.locator('#prj-category').selectOption({index:1});
  await page.locator('[data-stage-field="title"]').fill('첫 단계');
  await page.locator('[data-person]').first().check();
}
async function saveProject(page){await page.locator('#prjSave').click();await page.waitForFunction(()=>!document.querySelector('#prjSave'));}
const expectedErrors={expectedConsoleErrors:[/^프로젝트 저장 실패 Error: /,/^라이브러리 등록 실패 Error: /]};
module.exports=({test,EnvironmentUnavailable})=>{
  test('CLOUD-UI-01','Chromium production cloud save receipt survives recurrence wrapper and project lifecycle',()=>withPage({width:1440,height:1000},EnvironmentUnavailable,async page=>{
    const h=await connect(page),alerts=[];page.on('dialog',async d=>{alerts.push(d.message());await d.accept();});
    await form(page);const release=h.pause();await page.locator('#prjSave').click();
    await page.waitForFunction(()=>document.querySelector('#prjSave')?.disabled);
    assert.equal(h.transport.records.has('projects/'+await page.evaluate(()=>state.projects[0].id)),false);
    assert.equal(await page.locator('#prjSave').count(),1);release();
    await page.waitForFunction(()=>!document.querySelector('#prjSave'));
    const id=await page.evaluate(()=>state.projects[0].id);
    assert.equal(h.transport.records.get(`projects/${id}`).name,'합성 클라우드 프로젝트');assert.deepEqual(alerts,[]);
    await page.evaluate(id=>{showPage('projectPage');WMProjectUI.openEditor(id);},id);
    await page.locator('#prj-add-step').click();await page.locator('[data-stage-field="title"]').fill('직접 단계');await page.locator('[data-person]').first().check();
    await page.locator('#prj-schedule-mode').selectOption('manual');
    await page.locator('#prj-stageStart').fill('2026-11-15');await page.locator('#prj-stageStart').dispatchEvent('change');
    await page.locator('[data-date-for="stageEnd"]').fill('2026-11-20');await page.locator('[data-date-for="stageEnd"]').dispatchEvent('change');
    await saveProject(page);
    const saved=await page.evaluate(()=>structuredClone(state.projects[0]));
    assert.equal(saved.stages[1].endDate,'2026-11-20');assert.equal(h.transport.records.get(`projects/${id}`).stages[1].scheduleMode,'manual');
    await page.evaluate(id=>WMProjectUI.openEditor(id),id);await page.locator('#prj-name').fill('취소할 초안');await page.locator('#prjCancel').click();
    assert.equal(await page.evaluate(()=>state.projects[0].name),'합성 클라우드 프로젝트');
    await page.evaluate(id=>WMProjectUI.openEditor(id),id);await page.locator('#prjDelete').click();await page.waitForFunction(()=>!document.querySelector('#prjDelete'));
    assert.equal(h.transport.records.has(`projects/${id}`),false);assert.equal(await page.evaluate(()=>state.projects.length),0);
    assert.equal(h.calls.filter(c=>c.projectSave).length,3);
  },expectedErrors));
  test('CLOUD-UI-02','Chromium project close uses guarded cloud command and retains completed task records',()=>withPage({width:1440,height:1000},EnvironmentUnavailable,async page=>{
    const h=await connect(page);page.on('dialog',d=>d.accept());await form(page);await saveProject(page);
    // Synthetic completion uses the real guarded persistence boundary, no remote production data.
    await page.evaluate(async()=>{for(const task of state.tasks){task.status='done';task.actualComplete='2026-10-23';}await saveState({projectSave:true,projectId:state.projects[0].id,reason:'Synthetic stage completion'});renderTaskTable();});
    const before=plain([...h.transport.records].filter(([key])=>key.startsWith('tasks/')));
    await page.evaluate(()=>{showPage('taskListPage');state.projects[0].expanded=true;renderTaskTable();});
    await page.locator('[data-workflow-expand]').click();await page.locator('[data-workflow-project-close]').click();
    await page.waitForFunction(()=>document.querySelector('#toast')?.textContent.includes('완료업무로'));
    assert.equal(h.calls.at(-1).projectSave,true,'project close must use server conflict guard');
    assert.equal(h.calls.at(-1).projectId,await page.evaluate(()=>state.projects[0].id));
    assert.deepEqual(plain([...h.transport.records].filter(([key])=>key.startsWith('tasks/'))),before);
    await page.evaluate(()=>WMProjectUI.openEditor(state.projects[0].id));await page.locator('#prjDelete').click();
    assert.equal(await page.evaluate(()=>state.projects.length),1);assert.equal(h.calls.filter(c=>c.projectSave).length,3);
  },expectedErrors));
  test('CLOUD-UI-03','Chromium failed project edit preserves draft and concurrent unrelated changes without retry',()=>withPage({width:1440,height:1000},EnvironmentUnavailable,async page=>{
    const h=await connect(page),alerts=[];page.on('dialog',async d=>{alerts.push(d.message());await d.accept();});await form(page);await saveProject(page);
    const original=await page.evaluate(()=>structuredClone(state.projects[0]));
    await page.evaluate(()=>WMProjectUI.openEditor(state.projects[0].id));await page.locator('#prj-name').fill('보존할 실패 초안');
    const release=h.pause();h.transport.control.failBefore=true;await page.locator('#prjSave').click();
    await page.waitForFunction(()=>document.querySelector('#prjSave').disabled);
    await page.evaluate(()=>state.tasks.push({id:'concurrent-input',name:'저장 도중 다른 입력',status:'planned',start:'2026-10-23',end:'2026-10-23',checklist:[]}));
    release();await page.waitForFunction(()=>!document.querySelector('#prjSave').disabled);
    assert.equal(await page.locator('#prj-name').inputValue(),'보존할 실패 초안');
    assert.equal(await page.evaluate(()=>state.tasks.some(t=>t.id==='concurrent-input')),true);
    assert.equal(await page.evaluate(()=>state.projects[0].name),original.name);
    assert.equal(h.transport.records.get(`projects/${original.id}`).name,original.name);
    assert.equal(h.calls.filter(c=>c.projectSave).length,2);assert.ok(alerts.some(s=>s.includes('저장하지 못')));
    assert.equal(await page.evaluate(()=>WMTaskRecurrenceV181.getStatus().phase),'recovery-required');
    const attempts=h.transport.control.attempts;await page.locator('#prjSave').click();await page.waitForFunction(()=>!document.querySelector('#prjSave').disabled);
    assert.equal(h.transport.control.attempts,attempts,'no automatic/blind retry');
  },expectedErrors));
  test('CLOUD-UI-04','Chromium server response loss never closes project form or silently retries',()=>withPage({width:1440,height:1000},EnvironmentUnavailable,async page=>{
    const h=await connect(page),alerts=[];page.on('dialog',async d=>{alerts.push(d.message());await d.accept();});await form(page);
    h.transport.control.loseResponse=true;await page.locator('#prjSave').click();await page.waitForFunction(()=>!document.querySelector('#prjSave').disabled);
    assert.equal(h.transport.records.size>0,true);assert.equal([...h.transport.records.keys()].filter(k=>k.startsWith('projects/')).length,1);
    assert.equal(await page.locator('#prj-name').inputValue(),'합성 클라우드 프로젝트');assert.ok(alerts.some(s=>s.includes('저장하지 못')));
    assert.equal(h.calls.length,1);assert.equal(await page.evaluate(()=>WMTaskRecurrenceV181.getStatus().phase),'recovery-required');
  },expectedErrors));
  test('CLOUD-UI-05','Chromium single task creates one record and single library entry then edits completes reopens and trashes',()=>withPage({width:390,height:1000},EnvironmentUnavailable,async page=>{
    const h=await connect(page);page.on('dialog',d=>d.accept());
    await page.evaluate(()=>{showPage('taskListPage');openTaskForm();});
    assert.equal(await page.locator('#tfLinkBox,#tfAddStep').count(),0);
    await page.locator('#tfName').fill('클라우드 단일 업무');await page.locator('#saveTask').click();await page.waitForFunction(()=>!document.querySelector('#saveTask'));
    assert.equal(await page.evaluate(()=>state.tasks.length),1);assert.equal(await page.evaluate(()=>state.templates.length),1);
    const task=await page.evaluate(()=>structuredClone(state.tasks[0]));
    assert.equal(await page.locator('#taskTableBody').textContent().then(s=>s.includes('클라우드 단일 업무')),true);
    assert.equal(h.transport.records.get(`tasks/${task.id}`).name,'클라우드 단일 업무');
    assert.deepEqual(plain(h.cloud.codec.deserializeState(h.cloud.ctx.shadowMaps)).templates[0].linkedSteps,[]);
    await page.evaluate(id=>openTaskForm(id),task.id);await page.locator('#tfNotes').fill('수정된 단일 업무 메모');await page.locator('#saveTask').click();
    await page.waitForFunction(()=>!document.querySelector('#saveTask'));
    assert.equal(h.transport.records.get(`tasks/${task.id}`).notes,'수정된 단일 업무 메모');
    await page.evaluate(id=>openChecklist(id),task.id);await page.locator('#completeTask').click();await page.waitForFunction(()=>!document.querySelector('#completeTask'));await page.evaluate(id=>openTaskForm(id),task.id);
    assert.equal(await page.locator('#saveTask').count(),0);
    const completion=await page.evaluate(id=>state.tasks.find(t=>t.id===id).actualComplete,task.id);assert.ok(completion);
    await page.locator('#prjReopenTask').click();await page.waitForFunction(()=>!document.querySelector('#prjReopenTask'));
    const reopened=await page.evaluate(id=>structuredClone(state.tasks.find(t=>t.id===id)),task.id);
    assert.equal(reopened.completionHistory[0].snapshot.actualComplete,completion);assert.equal(reopened.id,task.id);
    assert.equal(h.transport.records.get(`tasks/${task.id}`).completionHistory[0].snapshot.actualComplete,completion);
    // The existing confirmed trash flow must retain the history-bearing snapshot.
    await page.evaluate(id=>openTaskForm(id),task.id);await page.locator('#deleteTask').click();
    await page.waitForFunction(id=>!state.tasks.some(t=>t.id===id),task.id);
    const trash=await page.evaluate(()=>window.__testTrashEntry);assert.ok(JSON.stringify(trash).includes(task.id));assert.ok(JSON.stringify(trash).includes('completionHistory'));assert.ok(JSON.stringify(trash).includes(completion));
    assert.equal(h.transport.records.has(`tasks/${task.id}`),false);
  },expectedErrors));

  test('CLOUD-UI-06','Chromium stage reorder keeps manual dates and IDs through cloud save and reopen',()=>withPage({width:390,height:1000},EnvironmentUnavailable,async page=>{
    const h=await connect(page);page.on('dialog',d=>d.accept());await form(page);
    for(const title of ['Manual','Relative']){await page.locator('#prj-add-step').click();await page.locator('[data-stage-field="title"]').fill(title);await page.locator('[data-person]').first().check();}
    await page.locator('[data-step-tab="1"]').click();await page.locator('#prj-schedule-mode').selectOption('manual');
    for(const [key,value] of [['stageStart','2026-11-15'],['stageEnd','2026-11-20']]){await page.locator('#prj-'+key).fill(value);await page.locator('#prj-'+key).dispatchEvent('change');}
    await saveProject(page);const before=await page.evaluate(()=>structuredClone(state.projects[0]));
    await page.evaluate(({id,stage})=>WMProjectUI.openEditor(id,stage),{id:before.id,stage:before.stages[1].id});
    await page.locator('#prj-move-right').click();await saveProject(page);
    const after=await page.evaluate(()=>structuredClone(state.projects[0]));
    assert.deepEqual(after.stages.map(s=>s.id),[before.stages[0].id,before.stages[2].id,before.stages[1].id]);
    assert.deepEqual(after.stages.map(s=>s.taskId).sort(),before.stages.map(s=>s.taskId).sort());
    assert.equal(after.stages[2].start,'2026-11-15');assert.equal(after.stages[2].endDate,'2026-11-20');assert.equal(after.stages[2].scheduleMode,'manual');
    assert.deepEqual(h.transport.records.get(`projects/${after.id}`).stages.map(s=>s.id),after.stages.map(s=>s.id));
    await page.evaluate(({id,stage})=>WMProjectUI.openEditor(id,stage),{id:after.id,stage:after.stages[2].id});assert.equal(await page.locator('#prj-schedule-mode').inputValue(),'manual');await page.locator('#prjCancel').click();
  },expectedErrors));
  test('CLOUD-UI-07','Chromium stage completion waits for server and uses project conflict guard',()=>withPage({width:1440,height:1000},EnvironmentUnavailable,async page=>{
    const h=await connect(page);page.on('dialog',d=>d.accept());await form(page);await saveProject(page);
    const task=await page.evaluate(()=>structuredClone(state.tasks[0]));await page.evaluate(id=>openChecklist(id),task.id);
    const release=h.pause();await page.locator('#prjManualComplete').click();
    assert.equal(await page.locator('#prjManualComplete').count(),1,'completion modal remains until server confirms');
    assert.equal(await page.locator('#prjManualComplete').isDisabled(),true);
    assert.equal(h.transport.records.get(`tasks/${task.id}`).status,'planned');release();
    await page.waitForFunction(()=>!document.querySelector('#prjManualComplete'));
    assert.equal(h.calls.at(-1).projectSave,true);assert.equal(h.calls.at(-1).projectId,task.projectId);
    assert.equal(h.transport.records.get(`tasks/${task.id}`).status,'done');assert.equal(await page.locator('#prjReopenTask').count(),1);
  },expectedErrors));

  for(const offline of [false,true])test(`CLOUD-LIBRARY-${offline?'OFFLINE':'SAVE'}`,'Chromium library manual dates use guarded cloud save; offline never reports success',()=>withPage({width:1440,height:1000},EnvironmentUnavailable,async page=>{
    const h=await connect(page),alerts=[];page.on('dialog',async d=>{alerts.push(d.message());await d.accept();});
    await page.evaluate(async()=>{state.templates=[{id:'lib-cloud',name:'클라우드 라이브러리',category:state.categories[0],owner:state.owners[0],libraryKindV175:'project',projectRootStepNameV175:'첫 단계',cycle:'none',checklist:[],linkedSteps:[{name:'직접 단계',scheduleMode:'manual',checklist:[]}]}];await saveState({reason:'Synthetic template seed'});selectedDbRefsV10.clear();selectedDbRefsV10.add('root|lib-cloud');openDbRegisterModalV10();});
    await page.locator('[data-manual-start="0|1"]').fill('2026-11-15');await page.locator('[data-manual-end="0|1"]').fill('2026-11-20');
    h.cloud.ctx.navigator.onLine=!offline;await page.locator('#v10RegisterDbTasks').click();
    if(offline){await page.waitForFunction(()=>!document.querySelector('#v10RegisterDbTasks')?.disabled);assert.equal(await page.locator('#v10RegisterDbTasks').count(),1);assert.equal(await page.evaluate(()=>state.projects.length),0);assert.equal([...h.transport.records.keys()].filter(k=>k.startsWith('projects/')).length,0);assert.ok(alerts.some(s=>s.includes('온라인')));}
    else{await page.waitForFunction(()=>!document.querySelector('#v10RegisterDbTasks'));const p=await page.evaluate(()=>state.projects[0]);assert.equal(h.transport.records.get(`projects/${p.id}`).stages[1].scheduleMode,'manual');assert.equal(h.transport.records.get(`projects/${p.id}`).stages[1].start,'2026-11-15');assert.deepEqual(alerts,[]);}
    assert.equal(h.calls.find(c=>c.reason==='라이브러리에서 직접 수행업무/프로젝트 등록')?.projectSave,true);
  },expectedErrors));

};
module.exports.connect=connect;module.exports.form=form;module.exports.saveProject=saveProject;
