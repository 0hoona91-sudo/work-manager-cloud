const assert = require('node:assert/strict');
const { loadModel, loadCloud, loadRecurrence, plain } = require('./helpers.cjs');
const { project, schema11, recurring } = require('./fixtures.cjs');
const { withPage } = require('./browser.test.cjs');
function fixture() {
  const M = loadModel(), p = project();
  p.stages[0].checklist = [{ id: 'completed-check', text: 'Original record', owner: 'fixture-owner', dueDate: '2026-01-01', done: true }];
  p.stages[0].resources = [{ id: 'resource-a', driveFileId: 'synthetic-file', name: 'fixture.pdf', mimeType: 'application/pdf' }];
  M.initializeRelativeDates(p);
  const tasks = p.stages.map((s, i) => M.buildStageTask(p, s, i));
  tasks[0].actualComplete = '2026-01-01'; tasks[0].notes = 'Original performance note';
  return { M, p, tasks, state: { projects: [p], tasks } };
}
module.exports = ({ test, EnvironmentUnavailable }) => {
  test('HIST-01', 'Completed checklist text, date, participants and attachment refs survive stage edits', () => {
    const { M,p,tasks } = fixture(), old = plain(tasks[0]);
    p.stages[0].checklist[0].text = 'Changed'; p.stages[0].resources = []; p.stages[0].start = '2026-09-01';
    assert.deepEqual(plain(M.buildStageTask(p,p.stages[0],0,tasks[0])), old);
  });
  test('HIST-02', 'Whole project edits preserve the completed task and stage without input mutation', () => {
    const { M,p,state } = fixture(), before = plain(state), draft = M.clone(p);
    draft.name = 'New project name'; draft.stages[0].title = 'New stage name'; draft.stages[0].taskId = 'replacement-id';
    const result = M.reconcile(state,M.normalizeProject(draft));
    assert.deepEqual(plain(result.tasks.find(t=>t.id===state.tasks[0].id)),before.tasks[0]);
    assert.deepEqual(plain(result.projects[0].stages[0]),before.projects[0].stages[0]);
    assert.deepEqual(plain(state),before);
  });
  test('HIST-03', 'Completed checklist cannot reopen a task implicitly', () => {
    const { M,tasks } = fixture(), before = plain(tasks[0]);
    assert.equal(M.setCheck(tasks[0],'completed-check',false,'2026-10-23'),false);
    assert.deepEqual(plain(tasks[0]),before);
  });
  test('HIST-04', 'Explicit reopen appends a detached snapshot once, preserving IDs and attachments', () => {
    const { M,tasks } = fixture(), task=tasks[0], before=plain(task);
    assert.equal(M.reopenTask(task,'2026-10-23T03:00:00Z'),true);
    assert.equal(task.status,'progress'); assert.equal(task.actualComplete,null);
    assert.equal(task.id,before.id); assert.equal(task.projectId,before.projectId); assert.equal(task.projectStageId,before.projectStageId);
    assert.deepEqual(plain(task.projectResources),before.projectResources);
    assert.deepEqual(plain(task.completionHistory[0].snapshot),before);
    assert.equal(M.reopenTask(task,'2026-10-23T03:01:00Z'),false); assert.equal(task.completionHistory.length,1);
    task.checklist[0].text='New text'; assert.equal(task.completionHistory[0].snapshot.checklist[0].text,'Original record');
  });
  test('HIST-05', 'Reopened all-checked tasks do not auto-complete during an ordinary project save', () => {
    const { M,p,state,tasks }=fixture(); M.reopenTask(tasks[0]);
    const result=M.reconcile(state,M.normalizeProject(p));
    assert.equal(result.tasks[0].status,'progress'); assert.equal(result.tasks[0].actualComplete,null);
    assert.equal(result.tasks[0].completionHistory.length,1);
  });
  test('HIST-06', 'Active checklist completion works and a second explicit reopen records a separate cycle', () => {
    const { M,tasks }=fixture(), task=tasks[0]; M.reopenTask(task);
    M.setCheck(task,'completed-check',false,'2026-10-23'); M.setCheck(task,'completed-check',true,'2026-10-23');
    assert.equal(task.status,'done'); assert.equal(task.actualComplete,'2026-10-23');
    M.reopenTask(task); assert.equal(task.completionHistory.length,2);
    assert.equal(task.completionHistory[0].snapshot.actualComplete,'2026-01-01');
    assert.equal(task.completionHistory[1].snapshot.actualComplete,'2026-10-23');
    assert.equal('completionHistory' in task.completionHistory[1].snapshot,false);
  });
  test('HIST-07', 'Project deletion is blocked before mutation when any completion record exists', () => {
    const { M,state,p,tasks }=fixture(), before=plain(state);
    assert.throws(()=>M.removeProject(state,p.id),/완료 이력/); assert.deepEqual(plain(state),before);
    M.reopenTask(tasks[0]); assert.throws(()=>M.removeProject(state,p.id),/완료 이력/);
  });
  test('HIST-08', 'Reopened stage history cannot be deleted by a later project edit', () => {
    const { M,state,p,tasks }=fixture(); M.reopenTask(tasks[0]);
    const draft=M.clone(p); M.removeStep(draft,0);
    assert.throws(()=>M.reconcile(state,M.normalizeProject(draft)),/완료 이력/);
    assert.equal(state.tasks.length,2);
  });
  test('HIST-09', 'Repeated completed project edits do not create duplicate history or change IDs', () => {
    const { M,p,state }=fixture(); let next=state;
    for(let i=0;i<3;i++){const draft=M.clone(next.projects[0]);draft.name=`Project ${i}`;next=M.reconcile(next,M.normalizeProject(draft));}
    assert.deepEqual(plain(next.tasks[0]),plain(state.tasks[0]));
    assert.equal(next.tasks[0].completionHistory,undefined);
  });
  test('HIST-10', 'Optional completion snapshots roundtrip through unchanged schema11 serialization', () => {
    const { M,tasks }=fixture(); M.reopenTask(tasks[0]);
    const C=loadCloud(), input=schema11(); input.tasks=tasks;
    const maps=C.serializeState(input), restored=C.deserializeState(maps);
    assert.equal(maps.meta.get('schema').schemaVersion,11);
    assert.deepEqual(plain(restored.tasks[0].completionHistory),plain(tasks[0].completionHistory));
    assert.deepEqual(plain(restored.tasks[0].projectResources),plain(tasks[0].projectResources));
  });
  test('HIST-11', 'Oversized history is rejected before reopening instead of losing the completed record', () => {
    const { M,tasks }=fixture(); tasks[0].notes='x'.repeat(600000); const before=plain(tasks[0]);
    assert.throws(()=>M.reopenTask(tasks[0]),/이력.*용량/); assert.deepEqual(plain(tasks[0]),before);
  });
  test('HIST-12', 'Pending stage removal and automatic completion remain available', () => {
    const { M,p,state }=fixture(); const draft=M.clone(p); M.removeStep(draft,1);
    const result=M.reconcile(state,M.normalizeProject(draft)); assert.deepEqual(plain(result.deletedTaskIds),['task-b']);
    const task={id:'normal',status:'planned',actualComplete:null,checklist:[{id:'a',done:false},{id:'b',done:false}]};
    M.setCheck(task,'a',true,'2026-10-23');assert.equal(task.status,'progress');
    M.setCheck(task,'b',true,'2026-10-23');assert.equal(task.status,'done');assert.equal(task.actualComplete,'2026-10-23');
  });
  test('HIST-13', 'New rolling occurrences do not inherit the source task completion history', () => {
    const state=recurring(), M=loadModel(), root=state.tasks[0];
    root.status='done'; root.actualComplete='2026-10-01'; M.reopenTask(root);
    const history=plain(root.completionHistory);
    assert.equal(loadRecurrence(state).ensureOccurrences(),3);
    assert.deepEqual(plain(root.completionHistory),history);
    assert.ok(state.tasks.slice(1).every(t=>!Object.hasOwn(t,'completionHistory')));
  });
  test('HIST-UI-01', 'Project completion modal locks checks; explicit reopen stores history and rolls back failed save', () =>
    withPage({width:1440,height:1000},EnvironmentUnavailable,async page=>{
      const f=fixture(); await page.evaluate(({p,tasks})=>{state.projects=[p];state.tasks=tasks;state.categories=['fixture-category'];state.owners=['fixture-owner'];
        window.__failCompletionSave=true;saveState=async()=>{if(window.__failCompletionSave)throw Error('Synthetic persistence failure')};openChecklist(tasks[0].id);},{p:plain(f.p),tasks:plain(f.tasks)});
      assert.equal(await page.locator('[data-prj-complete]').first().isDisabled(),true);
      page.on('dialog',d=>d.accept());
      await page.locator('#prjReopenTask').click();
      await page.waitForFunction(()=>!document.querySelector('#prjReopenTask')?.disabled);
      assert.equal(await page.evaluate(()=>state.tasks[0].status),'done');
      assert.equal(await page.evaluate(()=>state.tasks[0].completionHistory?.length||0),0);
      await page.evaluate(()=>{window.__failCompletionSave=false});await page.locator('#prjReopenTask').click();
      await page.waitForFunction(()=>state.tasks[0].status==='progress');
      assert.equal(await page.evaluate(()=>state.tasks[0].completionHistory.length),1);
    }));
  test('HIST-UI-03', 'General status/save guards protect completed records; new clones do not copy history', () =>
    withPage({width:1440,height:1000},EnvironmentUnavailable,async page=>{
      const result=await page.evaluate(async()=>{
        const task={id:'general-history',name:'Fixture',category:state.categories[0],owner:state.owners[0],status:'progress',actualComplete:null,start:'2026-10-01',end:'2026-10-01',deadline:'2026-10-01',checklist:[],notes:'Original note'};
        state.tasks=[task];saveState=async()=>{throw Error('Unexpected persistence')};openTaskForm(task.id);
        task.status='done';task.actualComplete='2026-10-01';const before=JSON.stringify(task);
        document.querySelector('#saveTask').click();applyTaskStatusFieldsV18(task,'progress');
        const guarded=before===JSON.stringify(task),persisted=await persistTaskStatusV18(task,'progress');
        WMProjectModel.reopenTask(task);
        const history=JSON.stringify(task.completionHistory);
        const manual=cloneManualTaskV119(task),occurrence=cloneOccurrenceV2(task,'2026-11-01','fixture-series',2,{holidayShift:'keep'});
        task.repeat={from:'2026-10-01',until:'2027-01-01',cycle:'monthly'};
        const seriesBefore=JSON.stringify(state.tasks);
        const repaired=repairLegacyRepeatsV3();
        const rebuilt=rebuildRepeatSeriesV3(task,task,{from:task.start,until:task.end,cycle:'monthly',weekdays:[],months:[]},false,[]);
        return {guarded,persisted,repaired,manualHistory:!!manual.completionHistory,occurrenceHistory:!!occurrence.completionHistory,historyKept:history===JSON.stringify(task.completionHistory),rebuilt,seriesUnchanged:seriesBefore===JSON.stringify(state.tasks)};
      });
      assert.deepEqual(result,{guarded:true,persisted:false,repaired:0,manualHistory:false,occurrenceHistory:false,historyKept:true,rebuilt:0,seriesUnchanged:true});
    }));
  test('HIST-UI-02', 'General completed-task edit uses a read-only view and explicit reopen retains prior record', () =>
    withPage({width:1440,height:1000},EnvironmentUnavailable,async page=>{
      await page.evaluate(()=>{state.tasks=[{id:'general-done',name:'Completed fixture',status:'done',actualComplete:'2026-01-01',start:'2026-01-01',end:'2026-01-01',checklist:[],notes:'Original note',attachments:[{id:'fixture-file',driveFileId:'synthetic-file',name:'fixture.pdf',mimeType:'application/pdf'}]}];saveState=async()=>{};window.cloudSync={hydrateImages:async()=>{},openDriveFile:async(...args)=>{window.__openedCompletionFile=args}};openTaskForm('general-done');});
      assert.equal(await page.locator('#saveTask').count(),0);
      assert.equal(await page.locator('#duplicateTaskV119').count(),1);
      await page.getByRole('button',{name:'fixture.pdf',exact:true}).click();
      assert.deepEqual(await page.evaluate(()=>window.__openedCompletionFile),['synthetic-file','fixture.pdf','application/pdf']);
      page.on('dialog',d=>d.accept());await page.locator('#prjReopenTask').click();
      await page.waitForFunction(()=>state.tasks[0].status==='progress');
      assert.equal(await page.evaluate(()=>state.tasks[0].completionHistory[0].snapshot.notes),'Original note');
      await page.evaluate(()=>openChecklist('general-done'));
      assert.equal(await page.locator('.completion-history').count(),1);
      await page.locator('.completion-history summary').click();
      await page.locator('.completion-history').getByRole('button',{name:'fixture.pdf',exact:true}).click();
      assert.deepEqual(await page.evaluate(()=>window.__openedCompletionFile),['synthetic-file','fixture.pdf','application/pdf']);
    }));
};
