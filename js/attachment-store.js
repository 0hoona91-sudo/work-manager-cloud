(function(host,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else host.WMAttachmentStore=api;})(globalThis,function(){
 const copy=x=>JSON.parse(JSON.stringify(x));
 async function digest(blob){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(x=>x.toString(16).padStart(2,'0')).join('');}
 function indexed(open){return {async run(mode,fn){const db=await open();try{return await new Promise((resolve,reject)=>{const tx=db.transaction('data',mode),req=fn(tx.objectStore('data'));let value;req.onsuccess=()=>value=req.result;tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Attachment journal aborted'));});}finally{db.close();}},get(k){return this.run('readonly',s=>s.get(k));},put(k,v){return this.run('readwrite',s=>s.put(copy(v),k));},async list(scope){return (await this.run('readonly',s=>s.getAll())).filter(r=>r?.attachmentJournal===1&&r.scope===scope);}};}
 function create({store,scope,allocate,upload,verify}){
  const pending=new Map();
  async function send(file,{signal}={}){
   const bound=scope();if(!bound)throw Error('업무공간이 없습니다.');
   if(file.size>50*1024*1024||file.size<=0)throw Error('첨부파일은 0B 초과 50MB 이하만 허용합니다.');
   const hash=await digest(file),key='attachment:'+bound+':'+hash;
   if(scope()!==bound)throw Error('업무공간이 변경되었습니다.');
   if(pending.has(key))return pending.get(key);
   const work=(async()=>{let row=await store.get(key)||{attachmentJournal:1,key,scope:bound,hash,name:file.name||'첨부파일',size:file.size,mimeType:file.type||'application/octet-stream',phase:'prepared'};
    const check=()=>{if(scope()!==bound)throw Object.assign(Error('업무공간 변경: 기존 파일 기록을 보관합니다.'),{code:'scope-changed'});if(signal?.aborted)throw Object.assign(Error('사용자가 전송을 취소했습니다. 결과 확인이 필요할 수 있습니다.'),{code:'cancelled'});};
    const save=async()=>{await store.put(key,row);};
    try{check();await save();if(!row.fileId){row.fileId=await allocate();check();await save();}
     if(row.phase==='uploaded'||row.phase==='linked'){check();return copy(row);}
     // All uncertain retries first inspect the same allocated ID. Never allocate a replacement.
     if(row.phase==='sending'||row.phase==='recovery-required'||row.phase==='cancelled'){
      const found=await verify(row.fileId,row);check();if(found){row.phase='uploaded';await save();return copy(row);}
     }
     check();row.phase='sending';await save();check();await upload(row.fileId,file,row);check();
     if(!await verify(row.fileId,row))throw Error('업로드 원본 크기를 확인하지 못했습니다.');check();row.phase='uploaded';await save();return copy(row);
    }catch(e){row.phase=e.code==='cancelled'?'cancelled':'recovery-required';try{await save();}catch{}throw Object.assign(e,{attachmentOperation:key,driveFileId:row.fileId||null});}
   })();pending.set(key,work);try{return await work;}finally{pending.delete(key);}
  }
  function refs(value,out=new Set()){if(value&&typeof value==='object'){if(typeof value.driveFileId==='string')out.add(value.driveFileId);for(const v of Object.values(value))refs(v,out);}return out;}
  return {send,async diagnose(state){const used=refs(state);return (await store.list(scope())).map(r=>({...r,referenced:used.has(r.fileId),needsReview:r.phase!=='linked'||!used.has(r.fileId)}));},async confirm(state){const bound=scope(),used=refs(state);for(const row of await store.list(bound)){if(scope()!==bound)throw Error('업무공간 변경');if(row.phase==='uploaded'&&used.has(row.fileId)){row.phase='linked';await store.put(row.key,row);}}}};
 }
 return {create,indexed,digest};
});
