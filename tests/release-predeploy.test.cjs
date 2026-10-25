// Release-only contracts. All records and credentials here are synthetic.
const assert = require('node:assert/strict');
const { withPage } = require('./browser.test.cjs');
const {harness,mockTransport}=require('./recurrence-cloud-harness.cjs');
const {project}=require('./fixtures.cjs');
const {plain}=require('./helpers.cjs');
const {withEmulator}=require('./recurrence-emulator.cjs');
const {read}=require('./helpers.cjs');

function projectState(){return {tasks:[
  {id:'stage-a',projectId:'fixture-project',projectStageId:'a',name:'First',status:'planned',start:'2026-10-22',end:'2026-10-23',completionHistory:[{id:'history'}],attachments:[{id:'file'}],checklist:[{id:'check-a',text:'First check',done:false}]},
  {id:'stage-b',projectId:'fixture-project',projectStageId:'b',name:'Second',status:'planned',start:'2026-10-24',end:'2026-10-25',checklist:[]}
],projects:[project()],templates:[],settings:{}};}
async function projectClients(t){
  const state=projectState(),a=harness(t,plain(state)),b=harness(t,plain(state));
  const batch=t.sdk.writeBatch(t.db);
  for(const [collection,map] of Object.entries(a.codec.serializeState(state)))for(const [id,value] of map)batch.set(t.sdk.doc(t.db,collection,id),{...plain(value),revision:1});
  await batch.commit();return {state,a,b};
}
const projectSave=(h,state)=>h.api.save(plain(state),{projectSave:true,projectId:'fixture-project',reason:'Synthetic project edit'});

module.exports = ({ test, EnvironmentUnavailable }) => {
  test('RELEASE-CACHE-01', 'MOCK mixed old HTML and new cloud module block writes without clearing data', async () => {
    const t=mockTransport(),h=harness(t,projectState());
    h.ctx.document={querySelector:()=>null};
    await assert.rejects(h.api.save(plain(h.ctx.stateRef),{}),e=>e.code==='client/update-required');
    assert.equal(t.control.commits.length,0);
    assert.match(read('index.html'),/<meta name="wm-release" content="predeploy1"/);
    assert.match(read('index.html'),/cloud-sync\.js\?v=phase6f-rules-v1&release=predeploy1/);
    assert.match(read('index.html'),/project-ui\.js\?v=20261023-phase5b2&release=predeploy1/);
  });
  test('RELEASE-PROJECT-01', 'MOCK stale project stage edit is rejected before it overwrites completed work', async () => {
    const state={tasks:[{id:'stage-a',projectId:'fixture-project',stageId:'a',name:'First',status:'done',actualComplete:'2026-10-23',start:'2026-10-22',end:'2026-10-23',completionHistory:[{id:'history'}],attachments:[{id:'file'}],checklist:[{id:'check-a',text:'Done',done:true}]},{id:'stage-b',projectId:'fixture-project',stageId:'b',name:'Second',status:'planned',start:'2026-10-24',end:'2026-10-25',checklist:[]}],projects:[project()],templates:[],settings:{}};
    const t=mockTransport(),a=harness(t,plain(state)),b=harness(t,plain(state));
    for(const [collection,map] of Object.entries(a.codec.serializeState(state)))for(const [id,value] of map)t.seed(`${collection}/${id}`,{...plain(value),revision:1});
    const first=plain(state);first.projects[0].name='Changed on A';
    await a.api.save(first,{projectSave:true,projectId:'fixture-project',reason:'프로젝트 단계/정보 수정'});
    assert.equal((await a.api.save(first,{projectSave:true,projectId:'fixture-project'})).persistence,'no-change');
    const stale=plain(state);stale.projects[0].name='Changed on B';
    await assert.rejects(b.api.save(stale,{projectSave:true,projectId:'fixture-project',reason:'프로젝트 단계/정보 수정'}),error=>error.code==='project/conflict');
    assert.equal(t.records.get('projects/fixture-project').name,'Changed on A');
    assert.deepEqual(t.records.get('tasks/stage-a').completionHistory,[{id:'history'}]);
    b.ctx.saving=true;
    await assert.rejects(b.api.save(stale,{projectSave:true,projectId:'fixture-project'}),error=>error.code==='project/save-busy');
  });
  test('RELEASE-PROJECT-EMU-01', 'REAL SDK independent stage edits coexist and same-stage stale date is rejected', () => withEmulator(EnvironmentUnavailable,async t=>{
    const {state,a,b}=await projectClients(t);
    const first=plain(state);first.tasks[0].notes='Device A';
    const second=plain(state);second.tasks[1].notes='Device B';
    await Promise.all([projectSave(a,first),projectSave(b,second)]);
    const same=plain(state);same.tasks[0].start='2026-10-20';
    await assert.rejects(projectSave(b,same),e=>e.code==='project/conflict');
    const tasks=await t.list('tasks');assert.equal(tasks.find(x=>x.id==='stage-a').notes,'Device A');assert.equal(tasks.find(x=>x.id==='stage-b').notes,'Device B');
    assert.deepEqual(tasks.find(x=>x.id==='stage-a').completionHistory,[{id:'history'}]);
    assert.deepEqual(tasks.find(x=>x.id==='stage-a').attachments,[{id:'file'}]);
  }));
  test('RELEASE-PROJECT-EMU-02', 'REAL SDK checklist and completion changes fence stale project edits', () => withEmulator(EnvironmentUnavailable,async t=>{
    const {state,a,b}=await projectClients(t);
    const checked=plain(state);checked.tasks[0].checklist[0].done=true;
    await projectSave(a,checked);
    const stale=plain(state);stale.tasks[0].notes='Should not save';
    await assert.rejects(projectSave(b,stale),e=>e.code==='project/conflict');
    const row=(await t.list('tasks')).find(x=>x.id==='stage-a');assert.equal(row.notes,undefined);assert.deepEqual(row.completionHistory,[{id:'history'}]);
    const child=(await t.list('checklistItems')).find(x=>x.id==='check-a');assert.equal(child.done,true);
    await t.sdk.updateDoc(t.sdk.doc(t.db,'tasks','stage-a'),{status:'done',actualComplete:'2026-10-24',revision:3});
    const staleProject=plain(state);staleProject.projects[0].name='Stale project';
    await assert.rejects(projectSave(b,staleProject),e=>e.code==='project/conflict');
    assert.equal((await t.list('projects'))[0].name,'Fixture project');
  }));
  test('RELEASE-PROJECT-EMU-03', 'REAL SDK offline project save waits; lost acknowledgement is not silently retried', () => withEmulator(EnvironmentUnavailable,async t=>{
    const {state,a}=await projectClients(t);
    const edited=plain(state);edited.projects[0].name='Acknowledgement lost';
    a.ctx.navigator.onLine=false;
    await assert.rejects(projectSave(a,edited),e=>e.code==='project/online-required');
    a.ctx.navigator.onLine=true;
    const original=a.ctx.runTransaction;
    a.ctx.runTransaction=async(db,fn)=>{const result=await original(db,fn);throw Object.assign(Error('Synthetic response loss'),{code:'unavailable'});};
    await assert.rejects(projectSave(a,edited),e=>e.code==='unavailable');
    assert.equal((await t.list('projects'))[0].name,'Acknowledgement lost');
    a.ctx.runTransaction=original;
    await assert.rejects(projectSave(a,edited),e=>e.code==='project/conflict');
  }));
  test('RELEASE-LIST-01', 'Chromium shows 1k/10k tasks through bounded pages without changing search or saving', () =>
    withPage({ width: 1440, height: 900 }, EnvironmentUnavailable, async page => {
      page.setDefaultTimeout(120000);
      const result = await page.evaluate(() => {
        let writes = 0;
        const oldSave = saveState;
        saveState = () => { writes++; return Promise.resolve(); };
        const measure = count => {
          state.tasks = Array.from({length:count}, (_,i) => ({
            id:`release-${String(i).padStart(5,'0')}`,name:`합성 업무 ${i}`,category:'기타',
            status:'planned',start:'2026-10-23',end:'2026-10-24',checklist:[],attachments:[],
          }));
          state.settings.taskListViewV35='active';
          document.querySelector('#taskSearch').value='';
          document.querySelector('#taskStatusFilter').value='all';
          const start=performance.now();
          showPage('taskListPage');
          const elapsed=Math.round(performance.now()-start);
          const rows=document.querySelectorAll('#taskTableBody tr').length;
          const pages=document.querySelector('#taskListPageSelectRelease')?.options.length||1;
          return {elapsed,rows,pages};
        };
        try{
          const thousand=measure(1000),tenThousand=measure(10000);
          const picker=document.querySelector('#taskListPageSelectRelease');
          picker.value='19';picker.dispatchEvent(new Event('change',{bubbles:true}));
          const lastRows=document.querySelectorAll('#taskTableBody tr').length;
          document.querySelector('#taskSearch').value='합성 업무 9999';
          renderTaskTable();
          const matches=[...document.querySelectorAll('#taskTableBody .task-link')].map(x=>x.textContent);
          return {thousand,tenThousand,lastRows,matches,searchPages:picker.options.length,writes,sourceCount:state.tasks.length};
        }finally{saveState=oldSave;}
      });
      assert.equal(result.thousand.rows,1000);
      assert.equal(result.thousand.pages,1);
      assert.equal(result.tenThousand.rows,500);
      assert.equal(result.tenThousand.pages,20);
      assert.equal(result.lastRows,500);
      assert.deepEqual(result.matches,['합성 업무 9999']);
      assert.equal(result.searchPages,1);
      assert.equal(result.sourceCount,10000);
      assert.equal(result.writes,0);
      console.log(`RELEASE-LIST synthetic measured ms: 1k=${result.thousand.elapsed}, 10k=${result.tenThousand.elapsed}`);
    }));
  test('RELEASE-LIST-02', 'Chromium mobile page change retains selected task and complete data', () =>
    withPage({width:390,height:844},EnvironmentUnavailable,async page=>{
      const result=await page.evaluate(()=>{
        state.tasks=Array.from({length:1200},(_,i)=>({id:`mobile-${i}`,name:`Mobile ${i}`,category:'기타',status:'planned',start:'2026-10-23',end:'2026-10-24',checklist:[]}));
        state.settings.taskListViewV35='active';showPage('taskListPage');
        const box=document.querySelector('#taskTableBody [data-task-select]');box.checked=true;box.dispatchEvent(new Event('change',{bubbles:true}));
        const selected=box.dataset.taskSelect;
        const picker=document.querySelector('#taskListPageSelectRelease');picker.value='2';picker.dispatchEvent(new Event('change',{bubbles:true}));
        return {selected,stillSelected:selectedTaskIdsV2.has(selected),rows:document.querySelectorAll('#taskTableBody tr').length,pages:picker.options.length,total:state.tasks.length};
      });
      assert.equal(result.stillSelected,true);assert.equal(result.rows,200);assert.equal(result.pages,3);assert.equal(result.total,1200);
    }));
};
