/* Review and explicit approval for the existing JSON file picker. */
(function(){
  'use strict';
  const B=window.WMBackupSafety;
  let busy=false;
  const recoveryKey=()=>`backupRecovery:${window.__workspaceLocalStateKey||window.cloudSync?.workspaceKey||'local'}:${window.cloudSync?.user?.uid||'local'}`;
  async function persistRecovery(snapshot){
    const key=recoveryKey();await localSaveTailV33;
    if(key!==recoveryKey())throw new Error('복구본 준비 중 연결 계정이 변경되었습니다. 새 미리보기를 확인해 주세요.');
    await writeLocalMeta(key,snapshot);
  }
  function publish(next){for(const key of Object.keys(state))delete state[key];Object.assign(state,next);}
  function prepare(incoming,options={}){
    if(window.__backupRecoveryRequired)throw new Error('이전 가져오기의 복구 확인이 필요합니다. 복구본을 보존하고 새로고침해 주세요.');
    if(window.cloudSync?.mode==='cloud')return window.cloudSync.previewImport(incoming,options);
    return B.prepare(state,incoming,options);
  }
  async function commitLocal(incoming,options={}){
    if(!options.review||!B.equal(incoming,options.review.incoming))throw new Error('백업 미리보기와 사용자 확인이 필요합니다.');
    return B.execute(options.review,{getCurrent:()=>state,getVersion:()=>'',persistRecovery:options.persistRecovery||persistRecovery,write:next=>writeLocalState(next),publish},options);
  }
  function show(incoming,mode='merge',choices={}){
    let review;
    try{review=prepare(incoming,{mode,choices});}catch(error){alert(error.message||'미리보기를 준비하지 못했습니다.');return;}
    const count=review.counts.tasks||{added:0,identical:0,conflict:0,removed:0};
    const conflictHtml=review.conflicts.map((c,i)=>`<details><summary>${esc(c.key)} ${c.protected?'· 현재 기록 보호':''}</summary>
      ${c.protected?'<p>완료 이력 또는 참조 충돌은 현재 데이터를 보존합니다.</p>':`<label>적용할 내용 <select data-backup-choice="${i}"><option value="current">현재 데이터 보존</option><option value="backup" ${choices[c.key]==='backup'?'selected':''}>백업 내용 적용 (없는 기존 필드는 보존)</option></select></label>`}
      <table><thead><tr><th>변경 필드</th><th>현재</th><th>백업</th></tr></thead><tbody>${c.differences.map(d=>`<tr><td>${esc(d.path)}</td><td><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(JSON.stringify(d.current,null,2))}</pre></td><td><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(JSON.stringify(d.backup,null,2))}</pre></td></tr>`).join('')}</tbody></table></details>`).join('');
    const body=`<div id="backupPreview"><label>가져오기 방식 <select id="backupMode"><option value="merge">병합 · 현재 데이터에 추가</option><option value="replace" ${mode==='replace'?'selected':''}>전체 복원 · 백업에 없는 일반 항목 삭제</option></select></label>
      <p>업무: 추가 ${count.added} · 동일 ${count.identical} · 충돌 ${count.conflict} · 삭제 ${count.removed}</p>
      <p>완료 이력 충돌: ${review.protectedConflicts.length} · 프로젝트 충돌: ${review.conflicts.filter(c=>c.key.startsWith('projects/')).length} · 생성키/첨부 참조 충돌: ${review.referenceConflicts.length}</p>
      <p>프로젝트/템플릿/휴일: ${esc(JSON.stringify(review.counts))}</p>
      ${mode==='replace'?'<p role="alert">전체 복원은 백업에 없는 미완료 업무·프로젝트·템플릿·휴일을 삭제할 수 있습니다. 완료 이력이 있는 업무와 프로젝트는 보존합니다.</p><label><input type="checkbox" id="backupReplaceAck">삭제 가능성을 확인하고 전체 복원에 동의합니다.</label>':''}
      <p>확인 전에는 업무 데이터와 원격 저장소를 변경하지 않습니다. 저장 전에 현재 상태의 복구본을 이 브라우저에 보관합니다.</p>
      <h4>검증 오류 및 누락 데이터 (${review.errors.length})</h4><ul>${review.errors.map(e=>`<li>${esc(e)}</li>`).join('')}</ul>
      <ul>${review.warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul>
      <h4>충돌 차이</h4>${conflictHtml||'<p>동일 ID 내용 충돌 없음</p>'}
      ${review.referenceConflicts.length?`<h4>참조 충돌 · 현재 참조 보존</h4><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(JSON.stringify(review.referenceConflicts,null,2))}</pre>`:''}
      <p id="backupResult" role="status"></p></div>`;
    modal('백업 가져오기 미리보기',body,'<button type="button" class="btn" id="backupCancel">취소</button><button type="button" class="btn primary" id="backupConfirm">미리보기대로 적용</button>');
    const button=document.querySelector('#backupConfirm');button.disabled=review.errors.length>0;
    document.querySelector('#backupCancel').onclick=()=>{if(!busy)closeModal();};
    document.querySelector('#backupMode').onchange=e=>show(incoming,e.target.value,choices);
    document.querySelectorAll('[data-backup-choice]').forEach(el=>el.onchange=()=>show(incoming,mode,{...choices,[review.conflicts[Number(el.dataset.backupChoice)].key]:el.value}));
    button.onclick=async()=>{
      if(busy)return;
      const replaceConfirmed=mode==='replace'&&document.querySelector('#backupReplaceAck')?.checked;
      if(mode==='replace'&&!replaceConfirmed){document.querySelector('#backupResult').textContent='전체 복원의 삭제 경고에 동의해야 합니다.';return;}
      busy=true;button.disabled=true;
      document.querySelectorAll('#backupPreview select,#backupReplaceAck').forEach(el=>el.disabled=true);
      try{
        const options={review,confirmed:true,replaceConfirmed,persistRecovery};
        if(window.cloudSync?.mode==='cloud')await window.cloudSync.importState(incoming,options);
        else await commitLocal(incoming,options);
        closeModal();initSelectors();renderHome();renderTaskTable();renderDbTable();renderHolidays();renderHistory();
        toast(mode==='replace'?'백업 전체 복원을 저장했습니다.':'백업 병합을 저장했습니다.');
      }catch(error){
        // Keep the review and its recovery download available. No success toast.
        if(error.recoveryRequired)window.__backupRecoveryRequired=true;
        const result=document.querySelector('#backupResult');
        const message=error.recoveryRequired?'저장 완료를 확인하지 못했습니다. 복구 확인 필요: 일부 저장이 반영되었을 수 있습니다. 다른 편집을 중단하고 복구본을 내려받은 뒤 새로고침하여 서버 상태를 확인해 주세요.':'가져오기를 중단했습니다. '+(error.message||'저장 오류');
        if(result)result.textContent=message;else alert(message);
        if(!error.recoveryRequired)return;
        const download=document.createElement('button');download.type='button';download.className='btn';download.textContent='가져오기 전 복구본 다운로드';download.onclick=()=>void downloadRecovery();result?.appendChild(download);
      }finally{busy=false;}
    };
  }
  async function openFile(event){
    const input=event.target,file=input.files?.[0];if(!file)return;
    try{if(busy)throw new Error('기존 가져오기 저장이 진행 중입니다.');if(file.size>20*1024*1024)throw new Error('백업 JSON은 20MB 이하만 지원합니다.');show(B.parse(await file.text()));}
    catch(error){alert(error.message||'백업 JSON을 읽지 못했습니다.');}
    finally{input.value='';}
  }
  async function downloadRecovery(){
    const key=recoveryKey(),record=await readLocalMeta(key,null);
    if(key!==recoveryKey()){alert('계정이 변경되어 복구본 다운로드를 중단했습니다.');return;}
    if(!record?.before){alert('이 계정의 가져오기 전 복구본이 없습니다.');return;}
    const blob=new Blob([JSON.stringify(record.before,null,2)],{type:'application/json'});
    download(blob,`업무관리_가져오기전_복구본_${record.createdAt.slice(0,10)}.json`);
  }
  const exportButton=document.querySelector('#exportBackup');
  if(exportButton){const button=document.createElement('button');button.type='button';button.className='btn';button.textContent='가져오기 전 복구본 다운로드';button.onclick=()=>void downloadRecovery();exportButton.parentNode.appendChild(button);}
  window.WMBackupUI={openFile,show,commitLocal,downloadRecovery,writeImportedCache:next=>writeLocalState(next),get isSaving(){return busy;}};
})();
