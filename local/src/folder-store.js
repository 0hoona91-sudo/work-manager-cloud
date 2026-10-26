/* PC folder store. FSA is injected for contract tests; no network or cloud SDK. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.WMLocalFolderStore=factory()})(globalThis,function(){
'use strict';
const copy=x=>JSON.parse(JSON.stringify(x));
const FORMAT='wm-local-folder-v1',MAX=24*1024*1024;
const stringify=x=>JSON.stringify(x);
async function hash(text){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('')}
function validate(state){
 if(!state||typeof state!=='object'||Array.isArray(state))throw Error('업무 데이터 객체가 필요합니다.');
 if(state.schemaVersion!==undefined&&state.schemaVersion!==11||state.backupMeta?.schemaVersion!==undefined&&state.backupMeta.schemaVersion!==11)throw Error('schema11만 지원합니다. 자동 변환하지 않습니다.');
 for(const name of ['tasks','projects','templates','holidays','categories','owners','selectedCategories','changeLogs'])if(!Array.isArray(state[name]))throw Error('필수 배열 누락: '+name);
 if(!state.settings||typeof state.settings!=='object'||Array.isArray(state.settings))throw Error('설정 객체가 필요합니다.');
 for(const name of ['tasks','projects','templates','holidays']){const ids=new Set();for(const item of state[name]){if(!item||typeof item.id!=='string'||!item.id||ids.has(item.id))throw Error('유효하지 않거나 중복된 ID: '+name);ids.add(item.id)}}
 const text=stringify(state);if(new TextEncoder().encode(text).length>MAX)throw Error('데이터 24MB 한도를 넘었습니다. 저장하지 않았습니다.');
 JSON.parse(text,(key,value)=>{if(['__proto__','prototype','constructor'].includes(key))throw Error('허용하지 않는 데이터 필드');return value});return copy(state);
}
async function directory(root,name){return root.getDirectoryHandle(name,{create:true})}
async function read(dir,name,optional=false){try{const file=await (await dir.getFileHandle(name)).getFile();if(file.size>MAX*2)throw Error('파일 크기 한도 초과');return await file.text()}catch(e){if(optional&&e.name==='NotFoundError')return null;throw e}}
async function write(dir,name,text,{fresh=false}={}){
 if(fresh&&await read(dir,name,true)!==null)throw Error('기존 파일 충돌: '+name);
 const handle=await dir.getFileHandle(name,{create:true}),writer=await handle.createWritable({keepExistingData:false});
 try{await writer.write(text);await writer.close()}catch(e){try{await writer.abort()}catch{}throw e}
 if(await read(dir,name)!==text)throw Error('저장 후 원본 읽기 대조 실패: '+name);
}
function parse(text){try{return JSON.parse(text)}catch{throw Error('파일 JSON 손상: 덮어쓰지 않습니다.')}}
function create({id=()=>crypto.randomUUID(),now=()=>new Date().toISOString(),onStatus=()=>{}}={}){
 let dirs,root,lock,head=null,headText=null,payload=null,blocked=false,tail=Promise.resolve(),opened=false;
 const status=(phase,message)=>onStatus({phase,message,revision:head?.revision||0});
 const permission=async()=>{if(await root.queryPermission({mode:'readwrite'})!=='granted')throw Error('폴더 권한이 없습니다. 재연결해 주세요.')};
 async function load(){
  const text=await read(dirs.data,'HEAD.json',true);
  if(text===null)return {head:null,text:null,payload:null};
  const value=parse(text);
  if(value.format!==FORMAT||!Number.isSafeInteger(value.revision)||value.revision<1||!/^snapshot-[a-zA-Z0-9-]+\.json$/.test(value.file)||typeof value.hash!=='string')throw Error('폴더 HEAD 형식 불일치');
  const body=await read(dirs.data,value.file);if(await hash(body)!==value.hash)throw Error('스냅샷 SHA-256 불일치. 원본을 보존합니다.');
  const snapshot=parse(body);if(snapshot.format!==FORMAT||snapshot.schemaVersion!==11||snapshot.revision!==value.revision||snapshot.operationId!==value.operationId||snapshot.workspaceId!==value.workspaceId)throw Error('스냅샷 구조 불일치');
  validate(snapshot.state);if(!snapshot.meta||typeof snapshot.meta!=='object'||Array.isArray(snapshot.meta))throw Error('보조 기록 형식 불일치');
  return {head:value,text,payload:snapshot};
 }
 async function pending(){const rows=[];for await(const [name] of dirs.journal.entries())if(name.endsWith('.intent.json')){
   const intent=parse(await read(dirs.journal,name));if(intent.format!==FORMAT||!intent.operationId||!intent.next)throw Error('복구 기록 손상: '+name);
   const receipt=(await read(dirs.journal,intent.operationId+'.review.json',true))||(await read(dirs.journal,intent.operationId+'.receipt.json',true));
   if(receipt){const r=parse(receipt);if(r.operationId!==intent.operationId||!['saved','kept-current'].includes(r.status))throw Error('복구 확인 기록 손상');continue}
   rows.push({...intent,confirmed:head?.operationId===intent.operationId&&head?.hash===intent.nextHash});
  }return rows}
 const enqueue=fn=>{const job=tail.then(fn);tail=job.catch(()=>{});return job};
 async function commit(state,meta,reason,operationId){
  if(!opened||blocked)throw Error('폴더 연결 또는 미확정 저장 확인이 필요합니다.');
  const nextState=validate(state);await permission();
  if(await read(dirs.data,'HEAD.json',true)!==headText){blocked=true;throw Error('폴더 자료가 다른 창 또는 프로그램에서 변경됐습니다. 입력을 보관하고 다시 연결하세요.')}
  const op=operationId||id();if(!/^[a-zA-Z0-9-]+$/.test(op))throw Error('저장 명령 ID 형식 오류');
  const next={format:FORMAT,schemaVersion:11,workspaceId:head?.workspaceId||id(),revision:(head?.revision||0)+1,operationId:op,previous:head,state:nextState,meta:copy(meta),savedAt:now(),reason};
  const body=stringify(next),digest=await hash(body),file='snapshot-'+op+'.json';
  try{
   status('saving','PC 폴더에 저장 중');
   await write(dirs.journal,op+'.intent.json',stringify({format:FORMAT,operationId:op,createdAt:now(),nextHash:digest,next}),{fresh:true});
   await permission();await write(dirs.data,file,body,{fresh:true});
   if(await read(dirs.data,'HEAD.json',true)!==headText)throw Error('저장 중 다른 변경 감지');
   const newHead={format:FORMAT,workspaceId:next.workspaceId,revision:next.revision,operationId:op,file,hash:digest};
   await permission();await write(dirs.data,'HEAD.json',stringify(newHead));
   head=newHead;headText=stringify(newHead);payload=next;
   await write(dirs.journal,op+'.receipt.json',stringify({operationId:op,status:'saved',at:now()}),{fresh:true});
   status('saved','PC 파일 쓰기·재읽기 확인 완료');return {persistence:'folder-confirmed',revision:head.revision,operationId};
  }catch(error){blocked=true;status('recovery-required','저장 미확정: '+error.message);error.recoveryRequired=true;error.folderConfirmed=head?.operationId===op&&head?.hash===digest;throw error}
 }
 return {
  async connect(handle,initial){
   if(opened)throw Error('현재 폴더 연결을 먼저 닫아 주세요.');root=handle;await permission();
   dirs={};for(const name of ['data','attachments','holidays','backups','journal'])dirs[name]=await directory(root,name);
   const lockFile=await dirs.data.getFileHandle('.writer-lock',{create:true});
   try{
    lock=await lockFile.createWritable({mode:'exclusive',keepExistingData:true});
    // Detect browsers silently ignoring the exclusive option; never claim a lock in that case.
    let second;try{second=await lockFile.createWritable({mode:'exclusive',keepExistingData:true})}catch(e){if(e.name!=='NoModificationAllowedError')throw e}
    if(second){await second.abort();throw Error('이 브라우저는 폴더 배타 쓰기 잠금을 지원하지 않습니다. 읽기·쓰기 작업을 보류합니다.')}
    const loaded=await load();head=loaded.head;headText=loaded.text;payload=loaded.payload;opened=true;
    const recovery=await pending();
    if(!head){let orphan=false;for await(const [name] of dirs.data.entries())if(name.startsWith('snapshot-'))orphan=true;
     if(recovery.length||orphan)throw Error('미확정 최초 저장이 있습니다. journal 원본을 보관하고 수동 복구가 필요합니다.');
     await commit(initial,{},'최초 빈 업무공간 생성');
    }
    blocked=recovery.length>0;status(blocked?'recovery-required':'idle',blocked?'미확정 저장 기록 확인 필요':'PC 폴더 연결됨');
    return {state:copy(payload.state),workspaceId:head.workspaceId,recovery};
   }catch(e){opened=false;if(lock){await lock.abort().catch(()=>{});lock=null}throw e}
  },
  save(state,info={}){const snapshot=validate(state);return enqueue(()=>commit(snapshot,payload.meta,info.reason||'업무 저장'))},
  getMeta(key,fallback=null){return copy(payload?.meta?.[key]??fallback)},
  setMeta(key,value){const snapshot=copy(value);return enqueue(()=>commit(payload.state,{...payload.meta,[key]:snapshot},'보조 기록 저장'))},
  recovery:()=>pending(),
  acknowledgeRecovery(){return enqueue(async()=>{await permission();if(await read(dirs.data,'HEAD.json',true)!==headText)throw Error('기준 파일이 변경됐습니다. 다시 연결하세요.');for(const row of await pending())await write(dirs.journal,row.operationId+'.review.json',stringify({operationId:row.operationId,status:row.confirmed?'saved':'kept-current',at:now()}),{fresh:true});blocked=false;status('idle','기존 확정본 사용. 미확정 입력 원본은 journal에 보존됩니다.');return copy(payload.state)})},
  backup(state){const snapshot=validate(state);return enqueue(async()=>{await permission();const name='backup-'+id()+'.json';await write(dirs.backups,name,JSON.stringify({...snapshot,backupMeta:{...snapshot.backupMeta,schemaVersion:11,format:'json-data',localFilesIncluded:false,externalOriginalsIncluded:false}},null,2),{fresh:true});return name})},
  get ready(){return opened&&!blocked},get workspaceId(){return head?.workspaceId||''},get snapshot(){return copy(payload?.state||null)},
  async close(){await tail;if(lock)await lock.abort();lock=null;opened=false;status('idle','연결 종료')}
 };
}
return {create,validate,hash,FORMAT};
});
