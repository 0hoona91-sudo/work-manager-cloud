(function(host,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else host.WMBackupFiles=api;})(globalThis,function(){
 'use strict';
 const limits=Object.freeze({file:50*1024*1024,total:200*1024*1024,count:1000});
 const check=(signal,scope,bound)=>{if(signal?.aborted)throw Object.assign(Error('백업 생성을 취소했습니다.'),{code:'cancelled'});if(scope&&scope()!==bound)throw Object.assign(Error('백업 중 계정 또는 업무공간이 변경되었습니다.'),{code:'scope-changed'});};
 async function read(response,maxBytes=limits.file){
  const n=Number(response.headers.get('content-length'));if(n>maxBytes){await response.body?.cancel();throw Error('원본 파일 크기 한도 초과');}
  if(!response.body?.getReader)throw Error('제한된 스트림 읽기를 지원하지 않습니다.');
  const reader=response.body.getReader(),parts=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes)throw Error('원본 파일 크기 한도 초과');parts.push(value);}return new Blob(parts,{type:response.headers.get('content-type')||'application/octet-stream'});}catch(e){try{await reader.cancel();}catch{}throw e;}finally{reader.releaseLock();}
 }
 async function hash(blob){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(x=>x.toString(16).padStart(2,'0')).join('');}
 function validateEntries(entries){
  if(entries.length>limits.count)throw Error('ZIP 파일 수 한도: 1000');let size=22;const names=new Set();
  for(const e of entries){const name=String(e.name).normalize('NFC'),bytes=new TextEncoder().encode(name).length;
   if(!name||name.includes('\\')||name.startsWith('/')||/^[A-Za-z]:/.test(name)||name.split('/').some(p=>!p||p==='.'||p==='..')||/[\u0000-\u001f]/.test(name)||bytes>65535||names.has(name.toLowerCase()))throw Error('ZIP 경로 충돌 또는 잘못된 파일명');
   names.add(name.toLowerCase());if(!Number.isSafeInteger(e.blob?.size)||e.blob.size>limits.file)throw Error('ZIP 단일 파일 한도: 50MB');size+=e.blob.size+76+bytes*2;if(size>limits.total)throw Error('ZIP 총량 한도: 200MB');
  }return size;
 }
 function refs(state){const found=[];function walk(x,path){if(!x||typeof x!=='object')return;if(x.driveFileId||x.localFileId)found.push({path,driveFileId:x.driveFileId||null,localFileId:x.localFileId||null,name:x.name||'',size:x.size??null,mimeType:x.mimeType||'',included:false,reason:'JSON은 외부 첨부 원본을 포함하지 않음'});for(const[k,v]of Object.entries(x))walk(v,path+'/'+k);}walk(state,'');return found;}
 function jsonSnapshot(state){const result=JSON.parse(JSON.stringify(state));result.backupMeta={...result.backupMeta,schemaVersion:11,format:'json-data',localFilesIncluded:false,externalOriginalsIncluded:false,attachments:refs(state),note:'데이터·기존 파일 ID 백업입니다. 외부 원본 파일은 포함하지 않습니다. 기존 인라인 이미지는 그대로 유지합니다.'};return result;}
 async function prepare(items,resolve,{signal,scope=()=>'',nameFor,progress=()=>{}}={}){
  const bound=scope(),entries=[],manifest={version:1,format:'handover-zip',complete:true,files:[],limits},resolvedById=new Map();let total=0;
  if(items.length>limits.count-3)throw Error('백업 첨부 참조 수 한도 초과');
  for(let i=0;i<items.length;i++){
   check(signal,scope,bound);const item=items[i],id=item.sourceDriveFileId?'drive:'+item.sourceDriveFileId:item.sourceLocalFileId?'local:'+item.sourceLocalFileId:null;
   progress(`첨부자료 확인 중 · ${i+1}/${items.length}`);let record=id&&resolvedById.get(id);
   if(!record){record={id,name:item.name||'첨부파일',path:null,size:null,mimeType:item.mimeType||'',sha256:null,included:false};
    try{
     if(total>=limits.total-limits.file)throw Error('메모리 총량 한도에 도달하여 읽기를 보류함');
     if(Number(item.size)>limits.file)throw Error('단일 원본 50MB 한도 초과');
     const resolved=await resolve(item);check(signal,scope,bound);
     if(!resolved?.blob)throw Error('원본을 찾을 수 없거나 접근 권한이 없음');
     const blob=resolved.blob;if(blob.size>limits.file)throw Error('단일 원본 50MB 한도 초과');
     record.sha256=await hash(blob);check(signal,scope,bound);record.size=blob.size;record.mimeType=blob.type||resolved.mimeType||'';
     record.path='첨부자료/'+nameFor(resolved.name,record.mimeType,entries.length+1);record.included=true;entries.push({name:record.path,blob});total+=blob.size;
    }catch(e){if(e.code==='cancelled'||e.code==='scope-changed')throw e;record.reason=e.message;manifest.complete=false;}
    if(id)resolvedById.set(id,record);
   }
   manifest.files.push({...record,reference:i});item.archivePath=record.path||'';item.originalMissing=!record.included;item.originalMissingReason=record.reason||'';if(record.included&&item.embeddedImage)item.embeddedImage='';
  }
  check(signal,scope,bound);validateEntries(entries);return {entries,manifest,total};
 }
 return {limits,read,hash,validateEntries,refs,jsonSnapshot,prepare};
});
