const assert=require('node:assert/strict');
const {loadModel,plain}=require('./helpers.cjs');
const {harness,mockTransport}=require('./recurrence-cloud-harness.cjs');
const {withEmulator}=require('./recurrence-emulator.cjs');
const M=loadModel();
function initial(){return {tasks:[],projects:[],templates:[],settings:{}};}
function draft(){const p=M.freshProject('2026-10-23');p.name='Synthetic timestamp project';p.category='fixture';p.manager='fixture-owner';p.stages[0].title='First';p.stages[0].participants=['fixture-owner'];return p;}
function reconcile(state,p){const r=M.reconcile(state,M.normalizeProject(p));return {...state,projects:plain(r.projects),tasks:plain(r.tasks)};}
async function save(h,state,id){h.ctx.stateRef=plain(state);return h.api.save(plain(state),{projectSave:true,projectId:id,reason:'Synthetic project contract'});}
module.exports=({test,EnvironmentUnavailable})=>{
  test('CLOUD-PROJECT-MOCK-01','MOCK Firestore map key order is not a project edit but stage values still conflict',async()=>{
    const t=mockTransport(),p=draft(),h=harness(t,initial()),state=reconcile(initial(),p);await save(h,state,p.id);
    const reorder=value=>Array.isArray(value)?value.map(reorder):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).reverse().map(([key,item])=>[key,reorder(item)])):value;
    t.seed(`projects/${p.id}`,reorder(t.records.get(`projects/${p.id}`)));
    const renamed=plain(state);renamed.projects[0].name='Renamed';await save(h,renamed,p.id);
    const remote=plain(t.records.get(`projects/${p.id}`));remote.stages[0].title='Real remote edit';t.seed(`projects/${p.id}`,remote);
    const stale=plain(renamed);stale.projects[0].name='Must not commit';await assert.rejects(save(h,stale,p.id),e=>e.code==='project/conflict');
    assert.equal(t.records.get(`projects/${p.id}`).stages[0].title,'Real remote edit');
  });
  test('CLOUD-PROJECT-EMU-01','REAL SDK UI-model timestamps allow project create edit and delete without false conflicts',()=>withEmulator(EnvironmentUnavailable,async t=>{
    const p=draft(),h=harness(t,initial());let state=reconcile(initial(),p);
    assert.ok(state.projects[0].createdAt);assert.ok(state.projects[0].updatedAt);
    assert.equal((await save(h,state,p.id)).persistence,'server-confirmed');
    const edited=plain(state.projects[0]);edited.name='Updated';const second=M.freshStep();second.title='Manual';second.participants=['fixture-owner'];second.scheduleMode='manual';second.start='2026-11-15';second.endDate='2026-11-20';second.endType='date';edited.stages.push(second);
    state=reconcile(state,edited);assert.equal((await save(h,state,p.id)).persistence,'server-confirmed');
    const server=(await t.list('projects'))[0];assert.equal(server.name,'Updated');assert.equal(server.stages[1].scheduleMode,'manual');assert.equal(server.stages[1].endDate,'2026-11-20');
    const stale=harness(t,plain(state));
    const changed=plain(state);changed.tasks[0].notes='Independent actual edit';await save(h,changed,p.id);
    const collision=plain(state);collision.tasks[0].notes='Must not overwrite';
    await assert.rejects(save(stale,collision,p.id),e=>e.code==='project/conflict');
    assert.equal((await t.list('tasks')).find(x=>x.id===state.tasks[0].id).notes,'Independent actual edit');
    assert.equal((await save(h,initial(),p.id)).persistence,'server-confirmed');
    assert.equal((await t.list('projects')).length,0);assert.equal((await t.list('tasks')).length,0);
  }));
  test('CLOUD-PROJECT-EMU-02','REAL SDK stale project close is blocked after another client reopens a completed stage',()=>withEmulator(EnvironmentUnavailable,async t=>{
    const p=draft(),h=harness(t,initial());let state=reconcile(initial(),p);await save(h,state,p.id);
    state.tasks[0].status='done';state.tasks[0].actualComplete='2026-10-23';await save(h,state,p.id);
    const other=harness(t,plain(state));const reopened=plain(state);M.reopenTask(reopened.tasks[0]);await save(other,reopened,p.id);
    const closed=plain(state);closed.projects[0].workflowClosedAtV174='2026-10-23';
    await assert.rejects(save(h,closed,p.id),e=>e.code==='project/conflict');
    const task=(await t.list('tasks'))[0];assert.equal(task.id,state.tasks[0].id);assert.equal(task.completionHistory.length,1);assert.equal(task.completionHistory[0].snapshot.actualComplete,'2026-10-23');
    assert.equal((await t.list('projects'))[0].workflowClosedAtV174,undefined);
  }));
};
