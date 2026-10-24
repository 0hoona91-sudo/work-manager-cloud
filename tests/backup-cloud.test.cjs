// Actual import/transaction functions, with in-memory Firebase SDK and cache ports.
// No SDK imports, Google account, real credentials or network calls execute.
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {read,parse,loadCloud,loadModel,plain}=require('./helpers.cjs');
const {schema11}=require('./fixtures.cjs');
const B=require('../js/backup-safety.js');
function fixture(){const s=schema11();s.projects=[];return s;}
function incoming(current){const s=plain(current),t=plain(s.tasks[0]);Object.assign(t,{id:'new-task',name:'Synthetic new',status:'planned',actualComplete:null,generatedKey:'new-key'});delete t.completionHistory;s.tasks.push(t);return s;}
function harness(current=fixture()){
  const C=loadCloud(),maps=C.serializeState(current),backend=Object.fromEntries(Object.entries(maps).map(([k,v])=>[k,new Map([...v].map(([id,r])=>[id,plain(r)]))]));
  const events=[],control={failAt:0,transactions:0,cache:null,fallback:0,log:0};
  const clone=v=>JSON.parse(JSON.stringify(v));
  const ctx=vm.createContext({window:{WMBackupSafety:B,WMBackupUI:{writeImportedCache:async next=>{events.push('cache');control.cache=plain(next)}}},
    stateRef:plain(current),recordMaps:C.serializeState(current),shadowMaps:C.serializeState(current),currentUser:{uid:'fixture-user'},buildingUser:{uid:'fixture-google'},workspaceProfile:{workspace:{firebaseConfig:{projectId:'fixture-project'}}},
    DATA_COLLECTIONS:Object.keys(maps).filter(k=>k!=='changeLogs'),LIVE_COLLECTIONS:Object.keys(maps),commandSaveGuard:null,active:true,localOnly:false,saving:false,queuedState:null,backupImporting:false,backupRecoveryRequired:false,
    TextEncoder,btoa,navigator:{onLine:true},serializeState:C.serializeState,deserializeState:C.deserializeState,clone,plain:clone,makeRecordMaps:()=>Object.fromEntries(Object.keys(maps).map(k=>[k,new Map()])),
    setSyncStatus:(...args)=>events.push(['status',...args]),renderRemote:()=>events.push('render'),db:{},
    doc:(...args)=>args.length===1?{collection:args[0].collection,id:`log-${++control.log}`}:{collection:args[1],id:args[2]},collection:(_db,name)=>({collection:name}),
    serverTimestamp:()=> 'SYNTHETIC_TIMESTAMP',deleteField:()=>({syntheticDelete:true}),makeLog:()=>({synthetic:true}),
    chunkChanges:changes=>changes.map(c=>[c]),commitOfflineChunks:async()=>{control.fallback++},
    runTransaction:async(_db,run)=>{
      control.transactions++;if(control.failAt===control.transactions){const error=Error('Synthetic transaction failure');error.code='unavailable';throw error;}
      const staged=[];
      await run({get:async ref=>{const record=backend[ref.collection].get(ref.id);return {exists:()=>record!==undefined,data:()=>clone(record)}},
        set:(ref,value,options)=>staged.push(['set',ref,clone(value),options]),update:(ref,value)=>staged.push(['update',ref,value]),delete:ref=>staged.push(['delete',ref])});
      for(const [type,ref,value,options] of staged){events.push(['write',ref.collection,ref.id]);if(type==='delete'){backend[ref.collection].delete(ref.id);continue;}
        const next=type==='update'||options?.merge?{...backend[ref.collection].get(ref.id)}:{};
        for(const [k,v] of Object.entries(value))if(v?.syntheticDelete)delete next[k];else next[k]=v;backend[ref.collection].set(ref.id,next);
      }
    },
  });
  const names=new Set(['recurrenceError','recurrenceWorkspace','assertRecurrenceWorkspace','stableKeyId','mapClone','recordMapsEqual','replaceState','withoutSyncFields','backupContextVersion','assertBackupReady','previewImport','importState','checkedImportMaps','diffMaps','changedFields','commitOnlineChunks','withChecklistParents','changeBundleKey','chunkChanges','needsRecurrenceClaim','commitTransaction','belongsToSkippedTask','patchFor']);
  const source=read('js/cloud-sync.js'),nodes=parse(source,'module').body.filter(n=>n.type==='FunctionDeclaration'&&names.has(n.id.name));
  assert.equal(nodes.length,names.size,'Import extraction contract changed');vm.runInContext(nodes.map(n=>source.slice(n.start,n.end)).join('\n'),ctx);
  const api=vm.runInContext('({previewImport,importState,commitTransaction,saveBlocked:()=>backupRecoveryRequired})',ctx);
  return {api,ctx,backend,events,control};
}
module.exports=({test})=>{
  test('BACKUP-CLOUD-01','MOCK cloud preview is read-only; approval saves exact result and preserves history',async()=>{
    const current=fixture();loadModel().reopenTask(current.tasks[0]);const h=harness(plain(current)),data=incoming(current),before=plain(h.ctx.stateRef);
    const review=h.api.previewImport(data);assert.deepEqual(plain(review.errors),[]);assert.deepEqual(h.ctx.stateRef,before);assert.equal(h.events.length,0);
    await assert.rejects(()=>h.api.importState(data),/미리보기/);assert.equal(h.events.length,0);
    let recovery;await h.api.importState(data,{review,confirmed:true,persistRecovery:async r=>{h.events.push('snapshot');recovery=plain(r)}});
    assert.equal(h.events[0],'snapshot');assert.deepEqual(h.ctx.stateRef,review.next);assert.deepEqual(h.control.cache,review.next);assert.deepEqual(recovery.before,before);assert.deepEqual(plain(h.backend.tasks.get('fixture-task').completionHistory),plain(current.tasks[0].completionHistory));
  });
  test('BACKUP-CLOUD-02','MOCK queued remote edits and account changes invalidate the reviewed baseline',async()=>{
    for(const account of [false,true]){const h=harness(),data=incoming(fixture()),review=h.api.previewImport(data);let snapshots=0;
      if(account)h.ctx.currentUser={uid:'different-fixture'};else h.ctx.recordMaps.tasks.set('fixture-task',{...h.ctx.recordMaps.tasks.get('fixture-task'),notes:'Remote edit'});
      await assert.rejects(()=>h.api.importState(data,{review,confirmed:true,persistRecovery:async()=>{snapshots++}}),/변경/);assert.equal(snapshots,0);assert.equal(h.control.transactions,0);
    }
  });
  test('BACKUP-CLOUD-03','MOCK codec field loss is surfaced as validation errors before any snapshot or write',async()=>{
    const current=fixture();current.tasks[0].checklist[0].unknownFixture={keep:true};const h=harness(current),data=incoming(current),review=h.api.previewImport(data);
    assert.ok(review.errors.some(e=>/필드 손실/.test(e)));await assert.rejects(()=>h.api.importState(data,{review,confirmed:true,persistRecovery:async()=>assert.fail('No snapshot on invalid input')}),/필드 손실/);assert.equal(h.control.transactions,0);
  });
  test('BACKUP-CLOUD-04','MOCK partial cloud commit has no offline fallback, no publish and blocks further saves',async()=>{
    const h=harness(),data=incoming(fixture()),review=h.api.previewImport(data),before=plain(h.ctx.stateRef);h.control.failAt=2;let recovery;
    await assert.rejects(()=>h.api.importState(data,{review,confirmed:true,persistRecovery:async r=>{recovery=plain(r)}}),e=>e.recoveryRequired===true&&e.committedChunks===1);
    assert.deepEqual(h.ctx.stateRef,before);assert.deepEqual(recovery.before,before);assert.equal(h.api.saveBlocked(),true);assert.equal(h.control.fallback,0);assert.equal(h.control.cache,null);assert.ok(!h.events.includes('render'));assert.ok(h.events.some(e=>Array.isArray(e)&&e[0]==='write'));
  });
  test('BACKUP-CLOUD-05','MOCK import transactions compare remote create, update, delete and key-lock baselines before writes',async()=>{
    for(const type of ['create','update','delete','lock']){
      const h=harness(),collection=type==='lock'?'generatedKeys':'tasks',id=type==='lock'?'new-lock':type==='create'?'new-task':'fixture-task';
      const old=h.backend[collection].get(id)||null;
      const change={collection,id,type:type==='lock'?'create':type,before:old,after:{id,status:'planned'},fields:['status']};
      h.backend[collection].set(id,type==='create'||type==='lock'?{generatedKey:'occupied',taskId:'remote-other'}:{...old,status:'done',actualComplete:'2026-10-23',notes:'New remote completion'});
      await assert.rejects(()=>h.api.commitTransaction([change],null,{backupImport:true}),/원격 데이터가 변경/);assert.ok(!h.events.some(e=>Array.isArray(e)&&e[0]==='write'));
    }
  });
  test('BACKUP-CLOUD-06','MOCK durable generated-key locks and fresh plan verification prevent recurring-task resurrection',async()=>{
    const h=harness(),data=incoming(fixture());const lock={generatedKey:'new-key',taskId:'deleted-synthetic-task'};
    h.ctx.recordMaps.generatedKeys.set('synthetic-lock',lock);h.ctx.shadowMaps.generatedKeys.set('synthetic-lock',lock);
    const review=h.api.previewImport(data);assert.ok(!review.next.tasks.some(t=>t.id==='new-task'));assert.ok(review.referenceConflicts.some(c=>c.kind==='generatedKey'));assert.equal(h.control.transactions,0);
  });
  test('BACKUP-CLOUD-07','MOCK checklist-only import checks the parent task for a new remote completion',async()=>{
    const current=fixture();current.tasks[0].status='progress';current.tasks[0].actualComplete=null;current.tasks[0].checklist[0].done=false;
    const h=harness(current),data=plain(current);data.tasks[0].checklist[0].text='Backup edit';
    const review=h.api.previewImport(data,{choices:{'tasks/fixture-task':'backup'}});
    const original=h.ctx.runTransaction;h.ctx.runTransaction=async(db,run)=>{
      const task=h.backend.tasks.get('fixture-task');h.backend.tasks.set('fixture-task',{...task,status:'done',actualComplete:'2026-10-23'});
      return original(db,run);
    };
    await assert.rejects(()=>h.api.importState(data,{review,confirmed:true,persistRecovery:async()=>{}}),e=>e.recoveryRequired===true&&e.code==='backup/remote-conflict');
    assert.ok(!h.events.some(e=>Array.isArray(e)&&e[0]==='write'));assert.equal(h.ctx.stateRef.tasks[0].checklist[0].text,current.tasks[0].checklist[0].text);
  });
  test('BACKUP-CLOUD-08','MOCK late unrelated remote changes are kept and reported as recovery-required',async()=>{
    const h=harness(),data=incoming(fixture()),review=h.api.previewImport(data),before=plain(h.ctx.stateRef);
    const original=h.ctx.runTransaction;h.ctx.runTransaction=async(db,run)=>{await original(db,run);h.ctx.recordMaps.tasks.set('remote-added',{id:'remote-added',status:'done'});};
    await assert.rejects(()=>h.api.importState(data,{review,confirmed:true,persistRecovery:async()=>{}}),e=>e.recoveryRequired===true);
    assert.ok(h.ctx.recordMaps.tasks.has('remote-added'));assert.deepEqual(h.ctx.stateRef,before);assert.equal(h.control.cache,null);
  });
};
