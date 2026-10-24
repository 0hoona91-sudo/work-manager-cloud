const assert=require('node:assert/strict');
const {harness,mockTransport}=require('./recurrence-cloud-harness.cjs');
const {schema11,recurring}=require('./fixtures.cjs');
const {plain,loadRecurrence,read}=require('./helpers.cjs');
const I=require('../js/recurrence-identity.js');
const scope='demo-work-manager';
function empty(){const s=schema11();s.tasks=[];s.templates=[];s.projects=[];return s;}
function task(root='root',date='2026-11-01',id){const generatedKey=I.key(scope,root,date);return {id:id||`occurrence:${generatedKey}`,name:'Synthetic recurrence',generatedKey,repeatOriginV181:root,repeatScheduledDateV181:date,repeatGeneratedV181:true,start:date,end:date,status:'planned',actualComplete:null,link:null,checklist:[{id:`check-${id||root}-${date}`,text:'Check',owner:'',dueDate:'',done:false}],attachments:[{id:'synthetic-file',driveFileId:'synthetic-drive'}]};}
function client(t,tasks=[]){const h=harness(t,empty());h.ctx.stateRef.tasks=plain(tasks);return h;}
const save=h=>h.api.save(plain(h.ctx.stateRef));
function contractTests(register,withTransport){
  register('01','Two independent clients create only one task and both reconcile to server winner',()=>withTransport(async t=>{
    const a=client(t,[task('root','2026-11-01','client-a')]),b=client(t,[task('root','2026-11-01','client-b')]);
    const result=await Promise.all([save(a),save(b)]);assert.equal((await t.list('tasks')).length,1);assert.equal((await t.list('generatedKeys')).length,1);
    assert.deepEqual(plain(a.ctx.stateRef.tasks),plain(b.ctx.stateRef.tasks));assert.equal(result.filter(r=>r.recurrenceReconciled).length,1);
  }));
  register('02','Three clients racing on the same key leave one server task',()=>withTransport(async t=>{
    const clients=['a','b','c'].map(id=>client(t,[task('root','2026-11-01',id)]));await Promise.all(clients.map(save));
    assert.equal((await t.list('tasks')).length,1);for(const h of clients)assert.deepEqual(plain(h.ctx.stateRef.tasks),plain(clients[0].ctx.stateRef.tasks));
  }));
  register('03','Different roots on the same date remain separate',()=>withTransport(async t=>{
    await Promise.all([save(client(t,[task('a')])),save(client(t,[task('b')]))]);assert.equal((await t.list('tasks')).length,2);assert.equal((await t.list('generatedKeys')).length,2);
  }));
  register('04','Different raw dates in the same series remain separate',()=>withTransport(async t=>{
    await Promise.all([save(client(t,[task('a','2026-11-01')])),save(client(t,[task('a','2026-12-01')]))]);assert.equal((await t.list('tasks')).length,2);
  }));
  register('05','Existing lock protects completion/history/manual dates/checks/files and replaces only the candidate',()=>withTransport(async t=>{
    const original=task('root','2026-11-01','winner');Object.assign(original,{status:'done',actualComplete:'2026-11-09',start:'2026-11-08',completionHistory:[{id:'history',notes:'Protected'}]});original.checklist[0].done=true;
    await save(client(t,[original]));const h=client(t,[task('root','2026-11-01','loser')]);await save(h);
    const restored=h.ctx.stateRef.tasks[0];assert.equal(restored.id,'winner');assert.equal(restored.start,original.start);assert.equal(restored.actualComplete,original.actualComplete);assert.deepEqual(plain(restored.completionHistory),original.completionHistory);assert.equal(restored.checklist[0].done,true);assert.deepEqual(plain(restored.attachments),original.attachments);
  }));
  register('06','Delayed transactions retry lock reads and do not overwrite the winner',()=>withTransport(async t=>{
    let entered=0;const original=t.sdk.runTransaction;
    t.sdk.runTransaction=(db,fn)=>original(db,async tx=>{entered++;const result=await fn(tx);if(entered<=2)await new Promise(r=>setTimeout(r,30));return result;});
    await Promise.all([save(client(t,[task('root','2026-11-01','a')])),save(client(t,[task('root','2026-11-01','b')]))]);
    assert.ok(entered>=3,'Firestore/optimistic mock must retry at least one conflicting transaction');assert.equal((await t.list('tasks')).length,1);
  }));
  register('07','Offline claim is refused before batch writes; reconnect creates once',()=>withTransport(async t=>{
    const h=client(t,[task()]);const maps=h.ctx.serializeState(h.ctx.stateRef),changes=h.api.diffMaps(h.ctx.shadowMaps,maps);
    await t.offline?.();await assert.rejects(h.api.commitOfflineChunks(changes,maps,{}),e=>e.code==='recurrence/online-required');
    await t.online?.();assert.equal((await t.list('tasks')).length,0);await save(h);assert.equal((await t.list('tasks')).length,1);
  }));
  register('08','Lost acknowledgement then reload/retry with the same operation never duplicates or overwrites',()=>withTransport(async t=>{
    const original=t.sdk.runTransaction;let fail=true;t.sdk.runTransaction=async(db,fn)=>{const value=await original(db,fn);if(fail){fail=false;throw Object.assign(Error('Injected lost acknowledgement'),{code:'unavailable'});}return value;};
    const pending=task(),first=client(t,[pending]);await assert.rejects(save(first));assert.equal(first.ctx.recurrenceRecoveryRequired,true);
    await assert.rejects(save(first),/복구/);const retry=client(t,[pending]);await save(retry);assert.equal(retry.ctx.stateRef.tasks[0].id,pending.id);assert.equal((await t.list('tasks')).length,1);
  }));
  register('09','Task, checklist and key commit together; oversized bundle is rejected before any write',()=>withTransport(async t=>{
    const h=client(t,[task()]),maps=h.ctx.serializeState(h.ctx.stateRef),changes=h.api.diffMaps(h.ctx.shadowMaps,maps);
    assert.throws(()=>h.api.chunkChanges(changes,maps,2),e=>e.code==='recurrence/bundle-too-large');assert.equal((await t.list('tasks')).length,0);
    await save(h);const keys=await t.list('generatedKeys');const tasks=await t.list('tasks');assert.equal(keys[0].taskId,tasks[0].id);assert.equal((await t.list('checklistItems')).length,1);
  }));
  register('10','Chunk boundaries keep every task and lock together',()=>withTransport(async t=>{
    const h=client(t,Array.from({length:108},(_,i)=>task(`root-${i}`)));const maps=h.ctx.serializeState(h.ctx.stateRef),changes=h.api.diffMaps(h.ctx.shadowMaps,maps),chunks=h.api.chunkChanges(changes,maps);
    assert.equal(chunks.length,11);for(const chunk of chunks)for(const c of chunk.filter(c=>c.collection==='tasks'))assert.ok(chunk.some(k=>k.collection==='generatedKeys'&&k.after.taskId===c.id));
    await save(h);assert.equal((await t.list('tasks')).length,108);assert.equal((await t.list('generatedKeys')).length,108);
  }));
  register('11','Deleting a task preserves its key tombstone and rejects resurrection',()=>withTransport(async t=>{
    const existing=task();await save(client(t,[existing]));await t.remove('tasks',existing.id);
    const h=client(t,[task('root','2026-11-01','later')]);const result=await save(h);assert.equal(result.recurrenceReconciled,true);assert.equal(h.ctx.stateRef.tasks.length,0);assert.equal((await t.list('tasks')).length,0);assert.equal((await t.list('generatedKeys')).length,1);
  }));
  register('12','Concurrent edits during collision reconciliation are retained and reported as recovery-required',()=>withTransport(async t=>{
    await save(client(t,[task('root','2026-11-01','winner')]));const h=client(t,[task('root','2026-11-01','loser')]);
    const original=h.ctx.getDocFromServer;h.ctx.getDocFromServer=async ref=>{h.ctx.stateRef.tasks[0].notes='Concurrent local edit';return original(ref);};
    await assert.rejects(save(h),e=>e.code==='recurrence/local-edit-conflict');assert.equal(h.ctx.stateRef.tasks[0].notes,'Concurrent local edit');assert.equal(h.ctx.recurrenceRecoveryRequired,true);assert.equal((await t.list('tasks')).length,1);
  }));
}
module.exports=({test,EnvironmentUnavailable})=>{
  contractTests((id,title,run)=>test(`ATOMIC-MOCK-${id}`,`MOCK ${title}`,run),async run=>{
    const t=mockTransport();t.list=async name=>[...t.records].filter(([p])=>p.startsWith(name+'/')).map(([,v])=>plain(v));t.remove=async(name,id)=>{t.records.delete(`${name}/${id}`);t.versions.set(`${name}/${id}`,(t.versions.get(`${name}/${id}`)||0)+1);};await run(t);
  });
  test('ATOMIC-MOCK-13','MOCK partial chunk failure blocks further saves and never falls back to offline writes',async()=>{
    const t=mockTransport(),h=client(t,Array.from({length:108},(_,i)=>task(`root-${i}`)));t.control.failCommitAt=2;
    await assert.rejects(save(h),e=>e.committedChunks===1&&e.recoveryRequired);const count=t.control.commits.length;await assert.rejects(save(h));assert.equal(t.control.commits.length,count);assert.equal(count,1);
    const tasks=[...t.records].filter(([p])=>p.startsWith('tasks/')),locks=[...t.records].filter(([p])=>p.startsWith('generatedKeys/'));assert.equal(tasks.length,locks.length);
  });
  test('ATOMIC-MOCK-14','MOCK workspace change before persistence blocks old queued work',async()=>{
    const t=mockTransport(),h=client(t,[task()]);h.ctx.ensureImageUploads=async()=>{h.ctx.currentUser={uid:'different-user'};};
    await assert.rejects(save(h),e=>e.code==='recurrence/workspace-changed');assert.equal(t.control.commits.length,0);assert.equal(h.ctx.recurrenceRecoveryRequired,true);
  });
  test('ATOMIC-MOCK-15','MOCK ordinary offline updates remain allowed without new locks',async()=>{
    const t=mockTransport(),s=empty();s.tasks=[{id:'ordinary',name:'Before',checklist:[]}];const h=harness(t,s);t.seed('tasks/ordinary',s.tasks[0]);
    h.ctx.stateRef.tasks[0].name='Offline edit';h.ctx.navigator.onLine=false;await save(h);assert.equal(t.records.get('tasks/ordinary').name,'Offline edit');assert.equal(t.records.size,2);
  });
  test('ATOMIC-MOCK-16','MOCK a local shadow lock cannot bypass the server guard for a new task',async()=>{
    const t=mockTransport(),h=client(t,[task()]),key=h.ctx.stateRef.tasks[0].generatedKey,id=h.api.stableKeyId(key);
    const lock={generatedKey:key,taskId:'deleted'};h.ctx.shadowMaps.generatedKeys.set(id,lock);h.ctx.recordMaps.generatedKeys.set(id,lock);t.seed(`generatedKeys/${id}`,lock);
    await save(h);assert.equal(h.ctx.stateRef.tasks.length,0);assert.equal([...t.records.keys()].filter(p=>p.startsWith('tasks/')).length,0);
  });
  test('ATOMIC-MOCK-17','MOCK offline application keeps plans out of tasks and resumes the same deterministic IDs online',async()=>{
    const s=recurring();let saves=0;const navigator={onLine:false};const h=loadRecurrence(s,{harness:true,navigator,save:async()=>{saves++;},window:{cloudSync:{mode:'cloud',recurrenceContext:{ready:true,scope,locks:[]}}}});
    await h.save();assert.equal(s.tasks.length,1);assert.equal(h.api.getStatus().phase,'pending-online');assert.equal(saves,1);
    navigator.onLine=true;await h.api.supplement();assert.equal(s.tasks.length,4);assert.equal(h.api.getStatus().phase,'saved');
    const copy=recurring();I.apply(copy,I.plan(copy,{scope,today:'2026-10-23'}),{scope,id:prefix=>`${prefix}-retry`});assert.deepEqual(s.tasks.slice(1).map(t=>t.id),copy.tasks.slice(1).map(t=>t.id));
  });
  test('ATOMIC-MOCK-18','MOCK new task ID collision without a lock refuses overwrite',async()=>{
    const t=mockTransport(),pending=task();t.seed(`tasks/${pending.id}`,{...pending,status:'done'});const h=client(t,[pending]);await assert.rejects(save(h),e=>e.code==='recurrence/id-collision');assert.equal(t.records.get(`tasks/${pending.id}`).status,'done');assert.equal(t.control.commits.length,0);
  });
  test('ATOMIC-MOCK-19','MOCK server-deleted keyed update cannot recreate a completed task',async()=>{
    const t=mockTransport(),s=empty();s.tasks=[task()];const h=harness(t,s);h.ctx.stateRef.tasks[0].notes='Stale edit';
    await assert.rejects(save(h),e=>e.code==='recurrence/missing-task');assert.equal(t.control.commits.length,0);
  });
  test('ATOMIC-MOCK-20','MOCK collision reconciliation keeps unrelated local and queued edits',async()=>{
    const t=mockTransport();await save(client(t,[task('root','2026-11-01','winner')]));const h=client(t,[task('root','2026-11-01','loser')]);
    const original=h.ctx.getDocFromServer;h.ctx.getDocFromServer=async ref=>{if(!h.ctx.stateRef.tasks.some(t=>t.id==='unrelated'))h.ctx.stateRef.tasks.push({id:'unrelated',notes:'Unsaved local edit'});return original(ref);};
    await save(h);assert.equal(h.ctx.stateRef.tasks.find(t=>t.id==='unrelated').notes,'Unsaved local edit');assert.ok(h.ctx.stateRef.tasks.some(t=>t.id==='winner'));assert.ok(!h.ctx.stateRef.tasks.some(t=>t.id==='loser'));assert.equal(h.ctx.recurrenceLocalEditsPending,true);
  });
  test('ATOMIC-MOCK-21','MOCK actual saveState rewrites local cache after server collision reconciliation',async()=>{
    const vm=require('node:vm'),{blocks,parse}=require('./helpers.cjs');
    const block=blocks('script').find(b=>b.source.includes('async function saveState(meta='));
    const node=parse(block.source).body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='saveState');const cache=[];
    const ctx={state:{tasks:[{id:'temporary'}]},clone:plain,localSaveTailV33:Promise.resolve(),writeLocalState:async value=>cache.push(plain(value)),window:{cloudSync:{save:async()=>{ctx.state.tasks=[{id:'server-winner'}];return {recurrenceReconciled:true};}}}};
    const run=vm.runInNewContext(block.source.slice(node.start,node.end)+';saveState',ctx);await run();
    assert.deepEqual(cache.map(s=>s.tasks[0].id),['temporary','server-winner']);
  });
  test('ATOMIC-MOCK-22','MOCK deferred realtime application cannot wipe retained unsaved edits',()=>{
    const vm=require('node:vm'),{parse}=require('./helpers.cjs'),source=read('js/cloud-sync.js');
    const node=parse(source,'module').body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='scheduleRemoteApply');
    let callback;const ctx={commandSaveGuard:null,recurrenceRecoveryRequired:false,recurrenceLocalEditsPending:true,remoteApplyTimer:0,clearTimeout:()=>{},setTimeout:fn=>{callback=fn;return 1;}};
    vm.runInNewContext(source.slice(node.start,node.end)+';scheduleRemoteApply()',ctx);assert.doesNotThrow(()=>callback());
  });
  const {withEmulator}=require('./recurrence-emulator.cjs');
  contractTests((id,title,run)=>test(`ATOMIC-EMU-${id}`,`EMULATOR real Firebase SDK: ${title}`,run),run=>withEmulator(EnvironmentUnavailable,run));
  test('ATOMIC-EMU-13','EMULATOR owner-only access, workspace-key scope and immutable locks',()=>withEmulator(EnvironmentUnavailable,async t=>{
    await save(client(t,[task()]));const id=(await t.list('generatedKeys'))[0],lockId=client(t).api.stableKeyId(id.generatedKey);
    await assert.rejects(t.sdk.deleteDoc(t.sdk.doc(t.db,'generatedKeys',lockId)),e=>e.code==='permission-denied');
    await assert.rejects(t.sdk.updateDoc(t.sdk.doc(t.db,'generatedKeys',lockId),{taskId:'hijacked'}),e=>e.code==='permission-denied');
    const other=await t.otherUser();await assert.rejects(other.sdk.getDocFromServer(other.sdk.doc(other.db,'generatedKeys',lockId)),e=>e.code==='permission-denied');
    await assert.rejects(save(client(t,[{...task(),id:'foreign',generatedKey:I.key('another-workspace','root','2026-11-01')}])),e=>e.code==='permission-denied');
  }));
};
module.exports.empty=empty;
