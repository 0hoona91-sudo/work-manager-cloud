// Execute production functions with injected transport only. No production bootstrap/imports.
const vm=require('node:vm');
const assert=require('node:assert/strict');
const {read,parse,loadCloud,plain}=require('./helpers.cjs');
const names=['recurrenceError','recurrenceWorkspace','assertRecurrenceWorkspace','needsRecurrenceClaim','reconcileRecurrenceCollisions',
  'mapClone','withoutSyncFields','stableKeyId','diffMaps','changedFields','patchFor','changeBundleKey','chunkChanges','commitOnlineChunks','commitOfflineChunks','runRulesAwareTransaction','withChecklistParents','commitTransaction','belongsToSkippedTask','commitOfflineBatch','save','flushQueue','saveTaskCommand'];
function harness(transport,state){
  if(transport.fork)transport={...transport,...transport.fork()};
  const C=loadCloud(),initial=C.serializeState(state);let ctx;
  const copy=plain,events=[];
  ctx=vm.createContext({TextEncoder,btoa,console:{error:()=>{}},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},
    window:{WMSaveCommand:require('../js/save-command.js'),WMTaskSaveConflict:require('../js/task-save-conflict.js'),WMOperationJournal:require('../js/operation-journal.js'),dispatchEvent:event=>events.push(event)},navigator:{onLine:true},db:transport.db,
    stateRef:copy(state),recordMaps:initial,shadowMaps:C.serializeState(state),currentUser:{uid:'synthetic-owner'},buildingUser:{uid:'synthetic-owner'},workspaceProfile:{workspace:{firebaseConfig:{projectId:'demo-work-manager'}}},
    DATA_COLLECTIONS:Object.keys(initial).filter(k=>k!=='changeLogs'),LIVE_COLLECTIONS:Object.keys(initial),
    makeRecordMaps:()=>Object.fromEntries(Object.keys(initial).map(k=>[k,new Map()])),clone:copy,plain:copy,
    serializeState:s=>{C.setShadow(ctx.shadowMaps);return C.serializeState(s);},deserializeState:C.deserializeState,
    attachmentStore:null,commandSaveGuard:null,active:true,localOnly:false,saving:false,queuedState:null,queuedWorkspace:null,queuedVersion:0,queuedResolvers:[],lastSyncAt:null,
    backupImporting:false,backupRecoveryRequired:false,recurrenceRecoveryRequired:false,recurrenceLocalEditsPending:false,
    ensureImageUploads:async()=>{},setSyncStatus:(...args)=>events.push(args),friendlyError:e=>e.message,
    makeLog:()=>({synthetic:true}),...transport.sdk});
  const source=read('js/cloud-sync.js'),nodes=parse(source,'module').body.filter(n=>n.type==='FunctionDeclaration'&&names.includes(n.id.name));
  assert.equal(nodes.length,names.length);vm.runInContext(nodes.map(n=>source.slice(n.start,n.end)).join('\n'),ctx);
  return {ctx,events,codec:C,api:vm.runInContext('({save,saveTaskCommand,commitTransaction,commitOnlineChunks,commitOfflineChunks,commitOfflineBatch,chunkChanges,diffMaps,reconcileRecurrenceCollisions,needsRecurrenceClaim,stableKeyId})',ctx)};
}
function mockTransport(){
  const records=new Map(),versions=new Map();let log=0;
  const control={attempts:0,commits:[],delay:0,failBefore:false,loseResponse:false,failCommitAt:0};
  const ref=(collection,id)=>({collection,id,path:`${collection}/${id}`});
  const snap=r=>{const value=records.has(r.path)?plain(records.get(r.path)):undefined;return {id:r.id,exists:()=>value!==undefined,data:()=>plain(value)};};
  function apply(writes){
    for(const [type,r,value,options] of writes){
      if(type==='delete')records.delete(r.path);
      else {
        const out=type==='update'||options?.merge?{...records.get(r.path)}:{};
        for(const [k,v] of Object.entries(value))if(v?.deleteField)delete out[k];else out[k]=v;
        records.set(r.path,out);
      }
      versions.set(r.path,(versions.get(r.path)||0)+1);
    }
    control.commits.push(writes.map(w=>w[1].path));
  }
  function writer(writes){return {set:(r,v,o)=>writes.push(['set',r,plain(v),o]),update:(r,v)=>writes.push(['update',r,plain(v)]),delete:r=>writes.push(['delete',r])};}
  const sdk={
    doc:(...args)=>args.length===1?ref(args[0].collection,`log-${++log}`):ref(args[1],args[2]),collection:(_db,name)=>({collection:name}),
    where:(field,op,value)=>({field,op,value}),query:(c,...filters)=>({...c,filters}),serverTimestamp:()=> 'SYNTHETIC_TIME',deleteField:()=>({deleteField:true}),increment:n=>n,
    getDocFromServer:async r=>snap(r),
    getDocsFromServer:async q=>({docs:[...records].filter(([path,v])=>path.startsWith(q.collection+'/')&&(q.filters||[]).every(f=>v[f.field]===f.value)).map(([path])=>snap(ref(q.collection,path.slice(q.collection.length+1))))}),
    runTransaction:async(_db,fn)=>{
      for(let attempt=0;attempt<6;attempt++){
        control.attempts++;
        if(control.failBefore||control.failCommitAt===control.commits.length+1)throw Object.assign(Error('Synthetic unavailable before commit'),{code:'unavailable'});
        const reads=new Map(),writes=[];
        const result=await fn({...writer(writes),get:async r=>{assert.equal(writes.length,0,'All transaction reads must precede writes');reads.set(r.path,versions.get(r.path)||0);return snap(r);}});
        await new Promise(resolve=>setTimeout(resolve,control.delay));
        if([...reads].some(([path,version])=>(versions.get(path)||0)!==version))continue;
        apply(writes);
        if(control.loseResponse){control.loseResponse=false;throw Object.assign(Error('Synthetic lost acknowledgement'),{code:'unavailable'});}
        return result;
      }
      throw Error('Synthetic retry limit');
    },
    writeBatch:()=>{const writes=[];return {...writer(writes),commit:async()=>apply(writes)};}
  };
  return {db:{},sdk,records,versions,control,seed:(path,data)=>{records.set(path,plain(data));versions.set(path,(versions.get(path)||0)+1);}};
}
module.exports={harness,mockTransport};
