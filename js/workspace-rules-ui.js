/* Read-only guidance. No authentication, Firestore, clipboard, cache or deployment side effects. */
(function(host,factory){const api=factory(()=>typeof module==='object'&&module.exports?require('./firestore-rules-policy.js'):host.WMFirestoreRulesPolicy);if(typeof module==='object'&&module.exports)module.exports=api;else host.WMWorkspaceRulesUI=api;})(typeof globalThis!=='undefined'?globalThis:this,function(policy){
  function open(options,doc=document){
    doc.getElementById('workspace-rules-guide')?.closeRulesGuide();
    const dialog=doc.createElement('dialog');dialog.id='workspace-rules-guide';dialog.setAttribute('aria-label','업무공간 보안 규칙 안내');
    dialog.style.cssText='width:min(900px,90vw);max-height:85vh;overflow:auto';
    const title=doc.createElement('h2');title.textContent='업무공간 보안 규칙 안내';dialog.append(title);
    const note=doc.createElement('p');note.textContent='생성·표시만 합니다. 기존 규칙 전체와 비교하고 승인된 배포 절차를 따르세요. 구형 브라우저와 미확정 저장 작업을 먼저 확인하세요.';dialog.append(note);
    const extraLabel=doc.createElement('label');extraLabel.textContent='추가 승인 Firebase UID (한 줄에 하나, 저장하지 않음)';
    const extra=doc.createElement('textarea');extra.setAttribute('aria-label','추가 승인 UID');extra.value=(options?.extraUids||[]).join('\n');extraLabel.append(extra);dialog.append(extraLabel);
    const status=doc.createElement('p');status.setAttribute('role','status');dialog.append(status);
    const output=doc.createElement('textarea');output.readOnly=true;output.rows=20;output.style.width='100%';output.setAttribute('aria-label','생성된 Firestore 규칙');dialog.append(output);
    const generate=()=>{output.value='';try{const text=extra.value;const value=policy().guidance({...options,extraUids:text===''?[]:text.split('\n')});output.value=value.rules;status.textContent=`${value.projectId} · ${value.policyVersion} · 승인 UID ${value.allowedUids.length}개. 실제 배포 상태는 확인하지 않았습니다.`;}catch(e){status.textContent=e.message;}};
    const button=doc.createElement('button');button.type='button';button.textContent='안내 다시 생성';button.onclick=generate;dialog.append(button);
    const close=doc.createElement('button');close.type='button';close.textContent='닫기';const dismiss=()=>{doc.defaultView?.removeEventListener('work-manager-credentials-cleared',dismiss);dialog.remove();};
    dialog.closeRulesGuide=dismiss;close.onclick=dismiss;dialog.addEventListener('cancel',dismiss);doc.defaultView?.addEventListener('work-manager-credentials-cleared',dismiss);dialog.append(close);
    doc.body.append(dialog);dialog.showModal();generate();return dialog;
  }
  return {open};
});
