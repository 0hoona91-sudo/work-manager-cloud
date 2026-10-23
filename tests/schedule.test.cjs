const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {loadModel,loadCloud,plain,root}=require('./helpers.cjs');
const {project,stage,schema11}=require('./fixtures.cjs');
const {withPage}=require('./browser.test.cjs');
function fixture(completed=true){
  const M=loadModel(),p=project();p.stages.push(stage('c','2026-01-05'),stage('d','2026-01-07'));
  p.stages[0].resources=[{id:'schedule-file',driveFileId:'synthetic-schedule-file',name:'fixture.pdf'}];
  M.initializeRelativeDates(p);
  const tasks=p.stages.map((s,i)=>M.buildStageTask(p,s,i));
  if(completed)Object.assign(tasks[0],{status:'done',actualComplete:'2026-01-20',notes:'Original performance',completionHistory:[{
    id:'task-a:completion:1',reopenedAt:'2025-12-31T00:00:00Z',snapshot:{id:'task-a',status:'done',actualComplete:'2025-12-30'}
  }]});
  return {M,p,state:{projects:[p],tasks}};
}
const schedule=result=>plain(result.tasks.map(t=>[t.start,t.end]));
const dates=['2026-01-01','2026-01-03','2026-01-05','2026-01-07'];
module.exports=({test,EnvironmentUnavailable})=>{
  test('SCHED-01','Completed anchor is restored before a four-stage cascade and invalid draft validation',()=>{
    const {M,p,state}=fixture(),before=plain(state),draft=M.clone(p);
    Object.assign(draft.stages[0],{start:'2026-02-30',endDate:'bad',title:'Replaced',checklist:[],resources:[]});
    const normalized=M.normalizeProject(draft,undefined,state),result=M.reconcile(state,normalized);
    assert.deepEqual(schedule(result),dates.map(d=>[d,d]));
    assert.deepEqual(plain(result.tasks[0]),before.tasks[0]);
    assert.deepEqual(plain(result.projects[0].stages[0]),before.projects[0].stages[0]);
    assert.deepEqual(plain(state),before);
  });
  test('SCHED-02','Actual completion date never replaces the persisted planned end',()=>{
    const {M,p,state}=fixture();state.tasks[0].actualComplete='2026-12-31';
    assert.equal(M.stageEnd(p.stages[0],undefined,state.tasks[0]),'2026-01-01');
    assert.equal(M.reconcile(state,p).tasks[1].start,'2026-01-03');
  });
  test('SCHED-03','An active parent edit flows through all active successors',()=>{
    const {M,p,state}=fixture(false),draft=M.clone(p);
    draft.stages[0].start=draft.stages[0].endDate='2026-01-10';
    assert.deepEqual(schedule(M.reconcile(state,draft)),['10','12','14','16'].map(d=>[`2026-01-${d}`,`2026-01-${d}`]));
  });
  test('SCHED-04','A completed middle stage stops upstream changes and anchors its own successor',()=>{
    const {M,p,state}=fixture(false);Object.assign(state.tasks[2],{status:'done',actualComplete:'2026-01-30'});
    const before=plain(state.tasks[2]),draft=M.clone(p);draft.stages[0].start=draft.stages[0].endDate='2026-01-10';
    const result=M.reconcile(state,draft);
    assert.deepEqual(schedule(result),['10','12','05','07'].map(d=>[`2026-01-${d}`,`2026-01-${d}`]));
    assert.deepEqual(plain(result.tasks[2]),before);
  });
  test('SCHED-05','Signed start/end offsets use the same anchor across year boundaries',()=>{
    const {M,p,state}=fixture(),draft=M.clone(p);
    draft.stages[1].relativeStartDays=-2;draft.stages[1].relativeEndDays=1;
    const result=M.reconcile(state,draft);
    assert.deepEqual(schedule(result),[['2026-01-01','2026-01-01'],['2025-12-30','2026-01-02'],['2026-01-04','2026-01-04'],['2026-01-06','2026-01-06']]);
    assert.equal(result.projects[0].stages[1].relativeStartDays,-2);
  });
  test('SCHED-06','Leap month ends, business duration and consecutive holiday shifts keep their rule meanings',()=>{
    const {M,p,state}=fixture(false),draft=M.clone(p),holiday=d=>[0,6].includes(d.getDay())||['2026-10-26','2026-10-27'].includes(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
    draft.stages[0].start=draft.stages[0].endDate='2024-02-28';
    draft.stages[1].relativeStartDays=1;draft.stages[1].relativeEndDays=2;
    assert.deepEqual(schedule(M.reconcile(state,draft))[1],['2024-02-29','2024-03-01']);
    Object.assign(draft.stages[0],{start:'2026-10-23',endType:'after',afterDays:1,includeHolidays:false});
    Object.assign(draft.stages[1],{relativeStartDays:1,relativeEndDays:3,includeHolidays:false,holidayShift:'next'});
    const result=M.reconcile(state,draft,holiday);
    assert.deepEqual(schedule(result),[['2026-10-23','2026-10-28'],['2026-10-29','2026-11-02'],['2026-11-04','2026-11-04'],['2026-11-06','2026-11-06']]);
    assert.equal(result.projects[0].stages[1].includeHolidays,false);
    assert.equal(result.projects[0].stages[1].holidayShift,'next');
    assert.equal(result.projects[0].stages[1].relativeEndDays,3);
  });
  test('SCHED-07','Completed planned end stays fixed even when the holiday calendar later changes',()=>{
    const {M,p,state}=fixture();Object.assign(p.stages[0],{endType:'after',afterDays:1,includeHolidays:false,holidayShift:'next'});
    // Historical computed end is persisted on the task; never run its old rule again.
    assert.equal(M.reconcile(state,p,d=>d.getDay()===4).tasks[1].start,'2026-01-03');
    assert.deepEqual(plain(M.reconcile(state,p).projects[0].stages[0]),plain(p.stages[0]));
  });
  test('SCHED-08','Legacy missing offsets derive from saved stages before editing an active parent',()=>{
    const {M,p,state}=fixture(false);
    for(const s of p.stages){delete s.relativeStartDays;delete s.relativeEndDays;}
    const draft=M.clone(p);draft.stages[0].start=draft.stages[0].endDate='2026-01-10';
    const result=M.reconcile(state,draft);
    assert.equal(result.tasks[1].start,'2026-01-12');assert.equal(result.tasks[3].end,'2026-01-16');
    assert.equal(result.projects[0].stages[1].relativeStartDays,2);
  });
  test('SCHED-09','Moving completed stages and adding a stage preserve existing IDs and locked records',()=>{
    const {M,p,state}=fixture(),draft=M.clone(p),original=plain(state.tasks[0]);
    M.moveStep(draft,0,2);draft.stages.push({...stage('e',''),relativeStartDays:1,relativeEndDays:2});
    const result=M.reconcile(state,draft);
    assert.deepEqual(plain(result.projects[0].stages.map(s=>s.id)),['b','c','a','d','e']);
    assert.deepEqual(schedule(result),[['2026-01-03','2026-01-03'],['2026-01-05','2026-01-05'],['2026-01-01','2026-01-01'],['2026-01-03','2026-01-03'],['2026-01-04','2026-01-05']]);
    assert.deepEqual(plain(result.tasks.find(t=>t.id==='task-a')),original);
    assert.deepEqual(plain(result.deletedTaskIds),[]);
  });
  test('SCHED-10','Repeated calculations are idempotent and schema11 preserves history and attachment IDs',()=>{
    const {M,p,state}=fixture(),draft=M.clone(p);M.applyRelativeDates(draft,undefined,state);
    const once=plain(draft);for(let i=0;i<4;i++)M.applyRelativeDates(draft,undefined,state);
    assert.deepEqual(plain(draft),once);
    const result=M.reconcile(state,draft),data=schema11();data.tasks=plain(result.tasks);data.projects=plain(result.projects);
    const C=loadCloud();assert.deepEqual(plain(C.deserializeState(C.serializeState(data))),data);
    assert.deepEqual(plain(result.tasks[0]),plain(state.tasks[0]));
  });
  test('SCHED-11','A later invalid interval aborts all mutations in apply, normalize and reconcile',()=>{
    const {M,p,state}=fixture(false),draft=M.clone(p);
    draft.stages[0].start=draft.stages[0].endDate='2026-02-01';draft.stages[3].relativeEndDays=-1;
    const before=plain(draft),saved=plain(state);
    assert.throws(()=>M.applyRelativeDates(draft,undefined,state),/종료일/);
    assert.deepEqual(plain(draft),before);
    assert.throws(()=>M.normalizeProject(draft,undefined,state),/종료일/);
    assert.throws(()=>M.reconcile(state,draft),/종료일/);assert.deepEqual(plain(state),saved);
    draft.stages[3].relativeEndDays=2;draft.stages[0].start='2026-02-30';
    assert.throws(()=>M.reconcile(state,draft),/올바른 날짜/);assert.deepEqual(plain(state),saved);
  });
  test('SCHED-12','Missing completed anchors and duplicate task links fail instead of inventing history',()=>{
    for(const corrupt of [f=>{f.state.tasks[0].end='';},f=>{f.p.stages[0].taskId='wrong-id';},f=>{f.state.tasks.push({...f.state.tasks[0],id:'duplicate'});}]){
      const f=fixture();corrupt(f);const before=plain(f.state);
      assert.throws(()=>f.M.reconcile(f.state,f.p),/완료 단계|중복/);assert.deepEqual(plain(f.state),before);
    }
  });
  test('SCHED-13','Explicit reopen permits recalculation while its previous completion snapshot remains intact',()=>{
    const {M,p,state}=fixture();M.reopenTask(state.tasks[0],'2026-10-23T03:00:00Z');
    const history=plain(state.tasks[0].completionHistory),draft=M.clone(p);
    draft.stages[0].start=draft.stages[0].endDate='2026-02-01';
    const result=M.reconcile(state,draft);
    assert.equal(result.tasks[0].status,'progress');assert.equal(result.tasks[1].start,'2026-02-03');
    assert.deepEqual(plain(result.tasks[0].completionHistory),history);
  });
  for(const [i,TZ] of ['UTC','Asia/Seoul','Pacific/Kiritimati'].entries())test(`SCHED-TZ-0${i+1}`,`Locked project cascade is identical in ${TZ}`,()=>{
    const script=`const {fixture}=require('./tests/schedule.test.cjs');const {M,p,state}=fixture();p.stages[1].relativeStartDays=-1;p.stages[1].relativeEndDays=1;process.stdout.write(JSON.stringify(M.reconcile(state,p).tasks.map(t=>[t.start,t.end])));`;
    const actual=JSON.parse(execFileSync(process.execPath,['-e',script],{cwd:root,env:{...process.env,TZ},encoding:'utf8',timeout:5000}));
    assert.deepEqual(actual,[['2026-01-01','2026-01-01'],['2025-12-31','2026-01-02'],['2026-01-04','2026-01-04'],['2026-01-06','2026-01-06']]);
  });
  async function open(page,f){
    await page.evaluate(({state:input})=>{Object.assign(state,input);state.categories=['fixture-category'];state.owners=['fixture-owner'];state.holidays=[];
      window.__scheduleSaves=0;saveState=async()=>{window.__scheduleSaves++;};WMProjectUI.openEditor('fixture-project');},{state:plain(f.state)});
  }
  test('SCHED-UI-01','Completed editor is locked; relative edits display the saved result and cancel writes nothing',()=>withPage({width:1440,height:1000},EnvironmentUnavailable,async page=>{
    const f=fixture();await open(page,f);
    assert.equal(await page.locator('#prj-stageStart').isDisabled(),true);
    await page.locator('[data-step-tab="1"]').click();
    await page.locator('#prj-relative-start-v177').fill('-1');await page.locator('#prj-relative-end-v177').fill('3');
    assert.equal(await page.locator('[data-prj-schedule-result]').textContent(),'계산 결과: 2025-12-31 ~ 2026-01-04');
    await page.locator('#prjSave').click();await page.waitForFunction(()=>!document.querySelector('#prjSave'));
    const saved=await page.evaluate(()=>({tasks:state.tasks,projects:state.projects}));
    assert.deepEqual(saved.tasks[0],plain(f.state.tasks[0]));assert.equal(saved.tasks[1].start,'2025-12-31');assert.equal(saved.tasks[1].end,'2026-01-04');
    await page.evaluate(()=>WMProjectUI.openEditor('fixture-project','b'));
    assert.equal(await page.locator('[data-prj-schedule-result]').textContent(),'계산 결과: 2025-12-31 ~ 2026-01-04');
    await page.locator('#prj-relative-end-v177').fill('5');page.once('dialog',d=>d.accept());await page.locator('#prjCancel').click();
    assert.deepEqual(await page.evaluate(()=>({tasks:state.tasks,projects:state.projects})),saved);
    assert.equal(await page.evaluate(()=>window.__scheduleSaves),1);
  }));
  test('SCHED-UI-02','Start/end edits, add and reorder update previews before saving; invalid dates disable save',()=>withPage({width:1440,height:1000},EnvironmentUnavailable,async page=>{
    await open(page,fixture(false));
    await page.locator('#prj-stageStart').fill('2026-02-28');await page.locator('#prj-stageEnd').fill('2026-02-28');
    await page.locator('[data-step-tab="1"]').click();assert.equal(await page.locator('[data-prj-schedule-result]').textContent(),'계산 결과: 2026-03-02 ~ 2026-03-02');
    await page.locator('#prj-relative-end-v177').fill('-1');assert.equal(await page.locator('#prjSave').isDisabled(),true);
    assert.equal(await page.locator('#prjScheduleError').isVisible(),true);assert.equal(await page.evaluate(()=>window.__scheduleSaves),0);
    await page.locator('#prj-relative-end-v177').fill('3');
    await page.locator('#prj-add-step').click();await page.locator('[data-stage-field="title"]').fill('Added synthetic stage');
    await page.locator('#prj-relative-start-v177').fill('1');await page.locator('#prj-relative-end-v177').fill('2');
    await page.locator('#prj-move-left').click();
    const preview=await page.locator('[data-prj-schedule-result]').textContent();
    const id=await page.locator('[data-stage-id]').getAttribute('data-stage-id');
    await page.locator('#prjSave').click();await page.waitForFunction(()=>!document.querySelector('#prjSave'));
    const task=await page.evaluate(id=>state.tasks.find(t=>t.projectStageId===id),id);
    assert.equal(preview,`계산 결과: ${task.start} ~ ${task.end}`);assert.equal(await page.evaluate(()=>state.tasks.length),5);
  }));
  test('SCHED-UI-03','Library registration retains business-day creation and stored calendar offsets on project edits',()=>withPage({width:1440,height:1000},EnvironmentUnavailable,async page=>{
    const actual=await page.evaluate(()=>{
      state.tasks=[];state.projects=[];state.categories=['fixture-category'];state.owners=['fixture-owner'];state.holidays=[{date:'2026-10-26'},{date:'2026-10-27'}];
      const template={id:'synthetic-library',name:'Library fixture',category:'fixture-category',owner:'fixture-owner',durationDays:1,checklist:[],linkedSteps:[{name:'Library child',startOffset:1,startMode:'business',limitDays:2,limitMode:'business'}]};
      createProjectFromLibraryV175(template,'2026-10-23');
      const before=state.tasks.map(t=>[t.start,t.end]),p=WMProjectModel.clone(state.projects[0]),offsets=[p.stages[1].relativeStartDays,p.stages[1].relativeEndDays];
      p.stages[0].start=p.stages[0].endDate='2026-10-30';
      const next=WMProjectModel.reconcile(state,p);return {before,offsets,after:next.tasks.map(t=>[t.start,t.end])};
    });
    assert.deepEqual(actual,{before:[['2026-10-23','2026-10-23'],['2026-10-28','2026-10-30']],offsets:[5,7],after:[['2026-10-30','2026-10-30'],['2026-11-04','2026-11-06']]});
  }));
};
module.exports.fixture=fixture;
