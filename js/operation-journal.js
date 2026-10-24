/* IndexedDB operation intent journal. No credentials, full-state snapshots or automatic replay. */
(function(host,factory){const api=factory(typeof module==='object'&&module.exports?require('./save-command.js'):host.WMSaveCommand);if(typeof module==='object'&&module.exports)module.exports=api;else host.WMOperationJournal=api;})(globalThis,function(C){
  'use strict';
  const prefix='operation-journal:v1:', copy=v=>JSON.parse(JSON.stringify(v));
  const phases=['prepared','saving','pending-sync','saved','conflict','recovery-required','failed'];
  const fail=message=>Object.assign(new Error(message),{code:'journal',definiteFailure:true});
  const secret=/^(?:password|passwd|apiKey|accessToken|refreshToken|idToken|credential|credentials|firebaseConfig|authorization|oauthToken)$/i;
  function safe(value){if(Array.isArray(value))return value.map(safe);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!secret.test(k)).map(([k,v])=>[k,safe(v)]));return value;}
  async function digest(value){const bytes=new TextEncoder().encode(C.canonical(value??null));return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');}
  function scope(context){const match=/^cloud:([^:]+):([^:]+)(?::([^:]+))?$/.exec(context||'');if(!match)throw fail('인증된 업무공간과 UID가 필요합니다.');return {context,workspace:match[1],uid:match[2],googleUid:match[3]||match[2]};}
  const keyPrefix=context=>prefix+encodeURIComponent(scope(context).context)+':';
  const key=(context,id)=>keyPrefix(context)+encodeURIComponent(id);
  async function seal(row){const value=copy(row);delete value.integrity;value.integrity=await digest(value);return value;}
  async function valid(row,context){
    try{const s=scope(context);if(!row||row.version!==1||row.context!==s.context||row.workspace!==s.workspace||row.uid!==s.uid||row.googleUid!==s.googleUid||!phases.includes(row.phase)||row.type!=='task.update'||typeof row.operationId!=='string'||!row.operationId||row.taskId!==row.base?.id||!row.patch||!row.historyHash||!row.createdAt||!row.updatedAt)return false;
      const {integrity,...body}=row;if(integrity!==await digest(body)||!C.equal(safe(row),row))return false;
      if(Object.keys(row.base).some(k=>![...C.editable,'id','status','actualComplete'].includes(k)))return false;
      C.plan({tasks:[row.base]},{operationId:row.operationId,type:row.type,taskId:row.taskId,expected:row.base,patch:row.patch});return true;
    }catch{return false;}
  }
  async function pack(request,now){
    scope(request.context);const change=request.changeSet.changes.find(c=>c.collection==='tasks'&&c.action==='update');
    if(request.type!=='task.update'||!change||request.changeSet.taskIds.length!==1)throw fail('일반 업무 수정만 복구 기록을 지원합니다.');
    const base=Object.fromEntries([...C.editable,'id','status','actualComplete'].filter(k=>Object.hasOwn(change.before,k)).map(k=>[k,safe(change.before[k])]));
    // Unknown task properties, attachments, profile/settings and completion snapshots are never copied.
    const patch=Object.fromEntries(C.editable.filter(k=>!C.equal(change.before[k],change.after[k])).map(k=>[k,safe(change.after[k])]));
    if(!C.equal(base,Object.fromEntries(Object.keys(base).map(k=>[k,change.before[k]])))||Object.keys(patch).some(k=>!C.equal(patch[k],change.after[k])))throw fail('인증정보 형태의 필드는 복구 기록에 저장할 수 없습니다. 입력을 별도로 보관하세요.');
    return seal({version:1,...scope(request.context),operationId:request.operationId,type:request.type,taskId:change.id,base,patch,historyHash:await digest(change.before.completionHistory),phase:'prepared',createdAt:now,updatedAt:now,mayHaveSent:false,lastResult:null});
  }
  function requestFor(row){const command={operationId:row.operationId,type:row.type,taskId:row.taskId,expected:row.base,patch:row.patch};return {operationId:row.operationId,type:row.type,context:row.context,journalHistoryHash:row.historyHash,changeSet:C.plan({tasks:[copy(row.base)]},command)};}
  function indexedStore(openDb){
    async function transaction(mode,work){const db=await openDb();return new Promise((resolve,reject)=>{let result,tx;try{tx=db.transaction('data',mode);}catch(error){db.close();reject(error);return;}const store=tx.objectStore('data');tx.oncomplete=()=>{db.close();resolve(result);};tx.onerror=tx.onabort=()=>{db.close();reject(tx.error||fail('복구 기록 저장이 중단되었습니다.'));};try{work(store,v=>result=v,tx);}catch(e){tx.abort();reject(e);}});}
    return {
      list:context=>transaction('readonly',(store,done)=>{const rows=[],p=keyPrefix(context);const r=store.openCursor(IDBKeyRange.bound(p,p+'\uffff'));r.onsuccess=()=>{const c=r.result;if(c){rows.push({key:c.key,value:c.value});c.continue();}else done(rows);};}),
      put:(row,expected=null)=>transaction('readwrite',(store,done,tx)=>{const k=key(row.context,row.operationId),r=store.get(k);r.onsuccess=()=>{if((r.result?.integrity||null)!==expected){tx.abort();return;}store.put(copy(row),k);done(row);};}),
      remove:row=>transaction('readwrite',(store,done,tx)=>{const k=key(row.context,row.operationId),r=store.get(k);r.onsuccess=()=>{if(r.result?.integrity!==row.integrity||row.phase!=='saved'||!row.lastResult?.confirmed){tx.abort();return;}store.delete(k);done(true);};})
    };
  }
  function create({store,getContext,send,now,onChange=()=>{}}){
    let context=null,rows=[],loadError=null,loading=null,busy=false,scanning=false;
    const notify=()=>onChange();
    async function initialize(next=getContext()){
      scope(next);if(next===context&&loading)return loading;
      context=next;rows=[];loadError=null;scanning=true;
      loading=(async()=>{try{const entries=await store.list(next),found=[];for(const entry of entries){const ok=entry.key===key(next,entry.value?.operationId)&&await valid(entry.value,next);if(ok&&entry.value.phase==='saved'&&entry.value.lastResult?.confirmed){await store.remove(entry.value);continue;}found.push(ok?entry.value:{corrupt:true,key:entry.key,phase:'recovery-required'});}if(context===next)rows=found;}catch(e){if(context===next)loadError='복구 기록을 읽을 수 없습니다. 저장을 보류합니다.';}finally{if(context===next)scanning=false;notify();}})();await loading;return list();
    }
    const list=()=>copy(rows);
    function assertContext(expected){if(expected!==getContext()||expected!==context)throw fail('계정 또는 업무공간이 변경되었습니다. 이전 복구 기록은 실행하지 않습니다.');}
    async function update(row,values){const next=await seal({...row,...safe(values),updatedAt:now()});await store.put(next,row.integrity);if(context===next.context)rows=rows.map(r=>r.context===next.context&&r.operationId===row.operationId?next:r);notify();return next;}
    async function prepare(request){await initialize(request.context);assertContext(request.context);if(loadError||rows.length||busy)throw fail(loadError||'미확정 복구 기록을 먼저 확인하세요.');const row=await pack(request,now());await store.put(row);if(context===row.context)rows.push(row);notify();assertContext(request.context);return row;}
    async function transmit(request,mode){
      await initialize(request.context);assertContext(request.context);if(loadError||busy)throw fail(loadError||'복구 확인 중입니다.');
      let row=rows.find(r=>r.operationId===request.operationId);if(!row||row.corrupt||!await valid(row,context))throw fail('복구 기록이 손상되었거나 없습니다. 자동 저장하지 않습니다.');
      const incoming=request.changeSet.changes.find(c=>c.collection==='tasks'&&c.action==='update'),stored=requestFor(row).changeSet.changes[0];
      if(!incoming||incoming.id!==row.taskId||[...C.editable,'id','status','actualComplete'].some(k=>!C.equal(incoming.before[k],stored.before[k])||!C.equal(incoming.after[k],stored.after[k]))||(request.journalHistoryHash||await digest(incoming.before.completionHistory))!==row.historyHash)throw fail('기록된 명령과 전송 내용이 다릅니다.');
      busy=true;notify();const uncertain=row.mayHaveSent&&!row.lastResult?.safeToResume;
      try{
        row=await update(row,{phase:'saving',mayHaveSent:mode==='verify'?uncertain:true,lastResult:row.lastResult?{...row.lastResult,safeToResume:false}:null});
        assertContext(row.context);
        const receipt=await send(requestFor(row),mode,{uncertain});assertContext(row.context);
        const confirmed=receipt?.operationId===row.operationId&&receipt.persistence==='server-confirmed';
        const phase=confirmed?'saved':receipt?.recoveryRequired?'recovery-required':'pending-sync';
        row=await update(row,{phase,mayHaveSent:confirmed||!!receipt?.recoveryRequired,lastResult:{confirmed,safeToResume:!confirmed&&!receipt?.recoveryRequired,checkedAt:now(),server:receipt?.serverTask?safe(Object.fromEntries([...C.editable,'id','status','actualComplete'].filter(k=>Object.hasOwn(receipt.serverTask,k)).map(k=>[k,receipt.serverTask[k]]))):null}});
        if(confirmed){await store.remove(row);rows=rows.filter(r=>r.context!==row.context||r.operationId!==row.operationId);notify();}
        return receipt;
      }catch(error){
        try{row=await update(row,{phase:error.code==='conflict'&&!error.recoveryRequired?'conflict':error.definiteFailure&&!uncertain?'failed':'recovery-required',mayHaveSent:uncertain||!error.definiteFailure,lastResult:{confirmed:false,safeToResume:!uncertain&&!!error.definiteFailure&&error.code!=='conflict',message:error.code==='conflict'?'서버 충돌 · 입력 보존':'저장 또는 확인 실패 · 입력 보존',conflicts:safe((error.conflicts||[]).map(c=>c.field==='completionHistory'?{field:c.field,reason:c.reason}:c))}});}catch{if(context===row.context)loadError='복구 기록 상태 갱신 실패: 원본 기록을 유지하고 서버 확인이 필요합니다.';error.recoveryRequired=true;}
        throw error;
      }finally{busy=false;notify();}
    }
    async function recover(id,{retry=false}={}){const row=rows.find(r=>r.operationId===id);if(!row||row.corrupt)throw fail('검증할 수 없는 기록은 수동 복구가 필요합니다.');assertContext(row.context);if(retry&&(!row.lastResult?.safeToResume||row.phase!=='pending-sync'))throw fail('서버 확인 후 재제출 가능한 기록만 승인하여 저장할 수 있습니다.');return transmit(requestFor(row),retry?'resume':'verify');}
    return {initialize,prepare,transmit,recover,list,suspend(){context=null;rows=[];loadError='로그인 후 복구 기록 확인이 필요합니다.';loading=null;notify();},get error(){return loadError;},get blocksWrites(){return scanning||!!loadError||busy||rows.length>0;},get busy(){return busy;},get context(){return context;}};
  }
  return Object.freeze({prefix,digest,scope,key,seal,valid,pack,requestFor,indexedStore,create,safe});
});
