const assert=require('node:assert/strict');
const C=require('../js/save-command.js');
const {plain}=require('./helpers.cjs');
const {schema11}=require('./fixtures.cjs');
const {withPage}=require('./browser.test.cjs');
const {harness,mockTransport}=require('./recurrence-cloud-harness.cjs');
const task=id=>({id,name:'Synthetic task',status:'planned',start:'2026-10-23',end:'2026-10-23',deadline:'2026-10-23',actualComplete:null,notes:'Before',checklist:[{id:'check-'+id,text:'Check',done:false}],attachments:[{id:'file',driveFileId:'synthetic'}]});
function fixture(){const state=schema11();state.projects=[];state.templates=[];state.tasks=[task('a'),task('b')];return state;}
function setup(persist){const state=fixture(),events=[],writes=[];let context='workspace:owner';const app=C.create({getState:()=>state,getContext:()=>context,onStatus:s=>events.push(s.phase),persist:async req=>{writes.push(req);return persist?persist(req,state):{persistence:'server-confirmed',operationId:req.operationId};}});return {state,events,writes,app,switch:()=>{context='other:owner';}};}
const edit=(h,id='a',notes='Edited',operationId='op')=>({operationId,type:'task.update',taskId:id,expected:plain(h.state.tasks.find(t=>t.id===id)),patch:{notes}});
module.exports=({test,EnvironmentUnavailable})=>{
  test('CMD-01','Create, update and delete ordinary tasks through explicit commands',async()=>{
    const h=setup();await h.app.execute({operationId:'create',type:'task.create',task:task('new')});await h.app.execute(edit(h,'new','New notes','update'));
    await h.app.execute({operationId:'delete',type:'task.delete',taskId:'new',expected:plain(h.state.tasks.find(t=>t.id==='new'))});assert.equal(h.state.tasks.length,2);assert.equal(h.writes.length,3);assert.equal(h.app.getStatus().phase,'saved');
  });
  test('CMD-02','Same operation shares one Promise and remains idempotent after success',async()=>{
    const h=setup(),command=edit(h),a=h.app.execute(command),b=h.app.execute(command);assert.strictEqual(a,b);await a;assert.strictEqual(h.app.execute(command),a);assert.equal(h.writes.length,1);
  });
  test('CMD-03','Reusing an operation ID with a different payload is a conflict',async()=>{
    const h=setup(),command=edit(h);await h.app.execute(command);await assert.rejects(h.app.execute({...command,patch:{notes:'Other'}}),e=>e.code==='conflict');assert.equal(h.writes.length,1);
  });
  test('CMD-04','Commands serialize execution without racing persistence',async()=>{
    let release;const h=setup(req=>req.operationId==='one'?new Promise(r=>{release=()=>r({persistence:'server-confirmed',operationId:'one'});}):{persistence:'server-confirmed',operationId:req.operationId});
    const one=h.app.execute(edit(h,'a','A','one')),two=h.app.execute(edit(h,'b','B','two'));await new Promise(setImmediate);assert.equal(h.writes.length,1);assert.equal(h.state.tasks[1].notes,'Before');release();await Promise.all([one,two]);assert.deepEqual(h.writes.map(w=>w.operationId),['one','two']);
  });
  test('CMD-05','ChangeSet identifies adds, deletes, fields, IDs, base version and unknown data',()=>{
    const before=fixture(),after=plain(before);after.tasks[0].notes='Changed';after.tasks.splice(1,1);after.tasks.push(task('c'));const change=C.changeSet(before,after,{operationId:'op',type:'synthetic'});
    assert.deepEqual(change.changes.filter(c=>c.id).map(c=>[c.id,c.action]),[['a','update'],['b','delete'],['c','add']]);assert.deepEqual(change.changes[0].fields,['notes']);assert.deepEqual(change.taskIds,['a','b','c']);assert.equal(change.baseVersion,C.canonical(before));assert.deepEqual(change.before,before);assert.deepEqual(change.after,after);
  });
  test('CMD-06','Unchanged content and object-key order produce no persistence request',async()=>{
    const h=setup();const result=await h.app.execute(edit(h,'a','Before'));assert.equal(result.noChange,true);assert.equal(h.writes.length,0);assert.equal(h.app.getStatus().phase,'idle');assert.equal(C.changeSet({x:{a:1,b:2}},{x:{b:2,a:1}},{operationId:'same',type:'x'}).changes.length,0);
  });
  test('CMD-07','Concurrent user edits survive a successful save and block whole-state remote replacement',async()=>{
    let release;const h=setup(req=>new Promise(r=>{release=()=>r({persistence:'server-confirmed',operationId:req.operationId});}));const promise=h.app.execute(edit(h));await new Promise(setImmediate);h.state.tasks[1].notes='Typed during save';release();await promise;assert.equal(h.state.tasks[1].notes,'Typed during save');assert.equal(h.app.blocksRemoteApply,true);
  });
  test('CMD-08','Unknown or partial failure preserves submitted and newer data and prevents automatic retry',async()=>{
    const h=setup(async(_req,state)=>{state.tasks[1].notes='Newer edit';throw Error('Synthetic uncertain write');});const command=edit(h);await assert.rejects(h.app.execute(command));assert.equal(h.state.tasks[0].notes,'Edited');assert.equal(h.state.tasks[1].notes,'Newer edit');assert.equal(h.app.getStatus().phase,'recovery-required');await assert.rejects(h.app.execute(edit(h,'b','Retry','new-op')));assert.equal(h.writes.length,1);
  });
  test('CMD-09','Stale expected task reports conflict without applying or saving',async()=>{
    const h=setup(),command=edit(h);h.state.tasks[0].notes='Remote change';await assert.rejects(h.app.execute(command),e=>e.code==='conflict');assert.equal(h.app.getStatus().phase,'conflict');assert.equal(h.writes.length,0);assert.equal(h.state.tasks[0].notes,'Remote change');
  });
  test('CMD-10','Server conflict preserves input and reports conflict without retry',async()=>{
    const h=setup(()=>({phase:'conflict'}));await assert.rejects(h.app.execute(edit(h)));assert.equal(h.app.getStatus().phase,'conflict');assert.equal(h.state.tasks[0].notes,'Edited');assert.equal(h.app.blocksRemoteApply,true);
  });
  test('CMD-11','Local, missing, offline and wrong-operation receipts cannot imply server confirmation',async()=>{
    for(const receipt of [undefined,{persistence:'local'},{persistence:'pending-sync'},{persistence:'server-confirmed',operationId:'other'}]){const h=setup(()=>receipt);await h.app.execute(edit(h));assert.equal(h.app.getStatus().phase,'pending-sync');assert.equal(h.app.blocksRemoteApply,true);}
  });
  test('CMD-12','Account switch before execution refuses the old command',async()=>{
    const h=setup(),promise=h.app.execute(edit(h));h.switch();await assert.rejects(promise);assert.equal(h.writes.length,0);assert.equal(h.state.tasks[0].notes,'Before');
  });
  test('CMD-13','Account switch during saving is recovery-required and keeps user data',async()=>{
    const h=setup(req=>{h.switch();return {persistence:'server-confirmed',operationId:req.operationId};});await assert.rejects(h.app.execute(edit(h)));assert.equal(h.app.getStatus().phase,'recovery-required');assert.equal(h.state.tasks[0].notes,'Edited');
  });
  test('CMD-14','Completed tasks and protected fields cannot be changed; schema11 history/keys/refs survive ordinary edits',async()=>{
    const h=setup();h.state.tasks[0].completionHistory=[{id:'history',actualComplete:'2026-09-01'}];h.state.tasks[1].generatedKey='old-key';h.state.settings.suppressedAutoKeys=['old-key'];const before=plain(h.state);await h.app.execute(edit(h));
    assert.deepEqual(h.state.tasks[0].completionHistory,before.tasks[0].completionHistory);assert.deepEqual(h.state.tasks[0].checklist,before.tasks[0].checklist);assert.deepEqual(h.state.tasks[0].attachments,before.tasks[0].attachments);assert.deepEqual(h.state.tasks[1],before.tasks[1]);assert.deepEqual(h.state.settings,before.settings);
    await assert.rejects(h.app.execute({...edit(h,'a','x','protected'),patch:{actualComplete:'2026-10-24'}}));
    h.state.tasks[0].status='done';await assert.rejects(h.app.execute(edit(h,'a','x','completed')));assert.equal(h.writes.length,1);
  });
  test('CMD-15','Validation errors are failed before mutation; operation types and dates are checked',async()=>{
    for(const patch of [{name:''},{start:'2026-02-30'},{id:'replacement'},{checklist:[{id:'same'},{id:'same'}]}]){const h=setup(),before=plain(h.state);await assert.rejects(h.app.execute({...edit(h),patch}));assert.equal(h.app.getStatus().phase,'failed');assert.deepEqual(h.state,before);assert.equal(h.writes.length,0);}
  });
  test('CMD-16','MOCK actual cloud receipt distinguishes transaction confirmation from offline writes',async()=>{
    for(const online of [true,false]){const transport=mockTransport(),state=fixture(),h=harness(transport,state);transport.seed('tasks/a',state.tasks[0]);h.ctx.navigator.onLine=online;h.ctx.stateRef.tasks[0].notes='Changed';const receipt=await h.api.save(plain(h.ctx.stateRef),{operationId:'operation'});assert.equal(receipt.operationId,'operation');assert.equal(receipt.persistence,online?'server-confirmed':'pending-sync');}
  });
  test('CMD-17','MOCK coalesced old queue requests do not receive a false exact-operation confirmation',async()=>{
    const transport=mockTransport(),state=fixture(),h=harness(transport,state);transport.seed('tasks/a',state.tasks[0]);transport.control.delay=25;
    h.ctx.stateRef.tasks[0].notes='One';const one=h.api.save(plain(h.ctx.stateRef),{operationId:'one'});
    h.ctx.stateRef.tasks[0].notes='Two';const two=h.api.save(plain(h.ctx.stateRef),{operationId:'two'});
    h.ctx.stateRef.tasks[0].notes='Three';const three=h.api.save(plain(h.ctx.stateRef),{operationId:'three'});
    const receipts=await Promise.all([one,two,three]);assert.deepEqual(receipts.map(r=>r.persistence),['server-confirmed','pending-sync','server-confirmed']);assert.deepEqual(receipts.map(r=>r.operationId),['one','two','three']);
  });
  test('CMD-18','MOCK online-to-offline fallback is never labeled server-confirmed',async()=>{
    const transport=mockTransport(),state=fixture(),h=harness(transport,state);transport.seed('tasks/a',state.tasks[0]);transport.control.failBefore=true;h.ctx.stateRef.tasks[0].notes='Changed';const receipt=await h.api.save(plain(h.ctx.stateRef),{operationId:'op'});assert.equal(receipt.persistence,'pending-sync');assert.ok(h.events.some(e=>Array.isArray(e)&&e[1]==='동기화 확인 대기'));
  });
  test('CMD-19','An explicitly unauthenticated form context cannot adopt a later account',async()=>{
    const h=setup();await assert.rejects(h.app.execute({...edit(h),context:null}),e=>e.code==='conflict');assert.equal(h.writes.length,0);
  });
  test('CMD-20','Partial-commit conflict is recovery-required and no-op cannot clear pending sync',async()=>{
    const h=setup(()=>{throw Object.assign(Error('Partial conflict'),{code:'conflict',committedChunks:1});});await assert.rejects(h.app.execute(edit(h)));assert.equal(h.app.getStatus().phase,'recovery-required');
    const pending=setup(()=>undefined);await pending.app.execute(edit(pending));const unchanged=await pending.app.execute(edit(pending,'a','Edited','unchanged'));assert.equal(unchanged.phase,'pending-sync');assert.equal(pending.writes.length,1);
  });
  async function prepare(page){await page.evaluate(input=>{
    Object.assign(state,{tasks:input.tasks,templates:input.templates,projects:input.projects});window.commandWrites=[];window.commandCache=[];
    writeLocalState=async snapshot=>{window.commandCache.push(clone(snapshot));};
    window.cloudSync={hydrateImages:async()=>{},mode:'cloud',workspaceKey:'synthetic',workspaceUser:{uid:'synthetic-user'},save:async(snapshot,meta)=>{window.commandWrites.push({snapshot,meta});if(window.commandGate)await window.commandGate;return {persistence:'server-confirmed',operationId:meta.operationId};}};
    openTaskForm('a');
  },fixture());}
  test('CMD-UI-01','Browser actual ordinary edit uses the command port once despite double submission',()=>withPage({width:1440,height:1000},EnvironmentUnavailable,async page=>{
    await prepare(page);await page.locator('#tfNotes').fill('Changed through UI');
    await page.evaluate(()=>{window.commandGate=new Promise(r=>window.releaseCommand=r);const button=document.querySelector('#saveTask');button.onclick();button.onclick();});
    await page.waitForFunction(()=>window.commandWrites.length===1);assert.equal(await page.locator('#saveTask').isDisabled(),true);await page.evaluate(()=>window.releaseCommand());await page.waitForFunction(()=>!document.querySelector('#tfNotes'));
    const result=await page.evaluate(()=>({writes:commandWrites.length,notes:state.tasks.find(t=>t.id==='a').notes,phase:WMSaveCommands.getStatus().phase,operationId:commandWrites[0].meta.operationId}));assert.equal(result.writes,1);assert.equal(result.notes,'Changed through UI');assert.equal(result.phase,'saved');assert.ok(result.operationId.startsWith('operation'));
  }));
  test('CMD-UI-02','Browser preserves additional typing in the form while the command is saving',()=>withPage({width:1440,height:1000},EnvironmentUnavailable,async page=>{
    await prepare(page);await page.locator('#tfNotes').fill('Submitted');await page.evaluate(()=>{window.commandGate=new Promise(r=>window.releaseCommand=r);document.querySelector('#saveTask').onclick();});await page.waitForFunction(()=>commandWrites.length===1);await page.locator('#tfNotes').fill('Typed while saving');await page.evaluate(()=>window.releaseCommand());await page.waitForFunction(()=>WMSaveCommands.getStatus().phase==='saved');assert.equal(await page.locator('#tfNotes').inputValue(),'Typed while saving');assert.equal(await page.evaluate(()=>state.tasks.find(t=>t.id==='a').notes),'Submitted');
  }));
};
