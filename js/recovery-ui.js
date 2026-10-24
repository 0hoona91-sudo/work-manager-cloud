/* Recovery notice is separate from editable forms; no automatic replay or form replacement. */
(function(){
  'use strict';
  window.WMRecoveryUI={render(service){
    let root=document.querySelector('[data-recovery-journal]');
    const rows=service.list();
    if(!rows.length&&!service.error){root?.remove();return;}
    if(!root){root=document.createElement('details');root.dataset.recoveryJournal='';root.style.cssText='position:fixed;right:12px;bottom:12px;z-index:25000;max-width:min(650px,95vw);max-height:65vh;overflow:auto;background:var(--card,#fff);color:var(--text,#222);border:2px solid #a76514;border-radius:8px;padding:12px;box-shadow:0 3px 15px #0003';document.body.append(root);}
    root.replaceChildren();const summary=document.createElement('summary');summary.textContent=`미확정 저장 복구 ${rows.length}건${service.error?' · 저장소 확인 필요':''}`;root.append(summary);
    const note=document.createElement('p');note.textContent=service.error||'자동 재전송하지 않습니다. 입력을 별도로 보관하고 서버 반영 여부를 확인하세요. 브라우저 저장소를 삭제하면 복구할 수 없습니다.';root.append(note);
    for(const row of rows){const section=document.createElement('section'),title=document.createElement('h4');title.textContent=row.corrupt?'손상된 기록 · 수동 복구 필요':`${row.base.name} · ${row.createdAt} · ${row.phase}`;section.append(title);
      if(row.corrupt){const p=document.createElement('p');p.textContent='검증할 수 없는 기록은 실행하거나 삭제하지 않습니다. 브라우저 데이터를 보존한 채 수동 복구가 필요합니다.';section.append(p);root.append(section);continue;}
      const values=document.createElement('pre');values.style.whiteSpace='pre-wrap';values.textContent=JSON.stringify({기준:row.base,보관한입력:row.patch,마지막서버확인:row.lastResult},null,2);section.append(values);
      const button=(text,run)=>{const b=document.createElement('button');b.type='button';b.className='btn small';b.textContent=text;b.disabled=service.busy;b.onclick=async()=>{b.disabled=true;try{await run();}catch{const p=document.createElement('p');p.textContent='확인 또는 저장을 완료하지 못했습니다. 보관한 입력은 유지됩니다.';section.append(p);}finally{if(b.isConnected)b.disabled=false;}};section.append(b);};
      button('서버 확인 (재전송 없음)',()=>service.recover(row.operationId));
      if(row.phase==='pending-sync'&&row.lastResult?.safeToResume)button('보관한 입력 재제출',()=>{if(confirm('같은 계정과 서버 기준을 다시 검사한 뒤 보관한 입력을 저장할까요? 충돌 시 덮어쓰지 않습니다.'))return service.recover(row.operationId,{retry:true});});
      button('입력 JSON 별도 보관',()=>{const blob=new Blob([JSON.stringify(row,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='업무-복구-입력.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
      root.append(section);
    }
  }};
})();
