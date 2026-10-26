/* Adapter only; latest hotfix UI and shared engines run unchanged outside build boundaries. */
(function(){
'use strict';
const css=document.createElement('style');css.textContent='#localGate{position:fixed;inset:0;z-index:2147483646;background:#eef3fa;overflow:auto;padding:8vh max(20px,15vw);color:#18365d}#localGate button{margin:8px;padding:12px;font:inherit}#localStatus{position:fixed;bottom:0;left:0;right:0;z-index:2147483645;background:#18365d;color:white;padding:9px;font-size:13px}#localStatus[data-phase="recovery-required"]{background:#9f2424}';document.head.append(css);
const gate=document.createElement('section');gate.id='localGate';gate.innerHTML='<h1>업무관리 로컬판 12-B</h1><p>hotfix1 업무 기능 · 실제 PC 폴더 저장 · 로그인/네트워크 없음</p><p>전용 빈 폴더를 선택하거나 기존 로컬판 폴더를 연결하세요. 클라우드 JSON은 연결 후 설정/백업의 미리보기로 가져옵니다. 첨부 원본 연결은 12-C 미구현입니다.</p><button id="localChoose">업무관리 폴더 선택</button><button id="localReconnect" disabled>이전 폴더 재연결</button><pre id="localGateMessage" style="white-space:pre-wrap"></pre><div id="localRecovery"></div>';
document.body.append(gate);document.querySelector('.app')?.setAttribute('inert','');
const bar=document.createElement('div');bar.id='localStatus';bar.textContent='PC 폴더 연결 전 · 저장되지 않음';document.body.append(bar);
let previous=null,connected=false;
function status(value){bar.dataset.phase=value.phase;bar.textContent=value.message+(value.revision?' · 저장판 '+value.revision:'')}
function failure(error){status({phase:'recovery-required',message:'저장 실패/확인 필요: '+error.message+' · 입력을 유지하세요. 자동 재전송하지 않습니다.'});const notice=document.getElementById('localGateMessage');if(!connected)notice.textContent=error.message}
window.addEventListener('unhandledrejection',event=>{if(connected)failure(event.reason||Error('저장 처리 오류'))});
async function handleCache(value){return new Promise((resolve,reject)=>{const r=indexedDB.open('WMLocalDirectoryHandle_v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('handles');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result;try{const tx=db.transaction('handles',value?'readwrite':'readonly'),req=value?tx.objectStore('handles').put(value,'selected'):tx.objectStore('handles').get('selected');let out;req.onsuccess=()=>out=req.result;tx.oncomplete=()=>{db.close();resolve(out)};tx.onerror=()=>{db.close();reject(tx.error)}}catch(error){db.close();reject(error)}}})}
function downloadJSON(value,name){download(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}),name)}
async function finish(opened){connected=true;window.__localResolve(opened);window.addEventListener('wm-data-ready',()=>{gate.remove();document.querySelector('.app')?.removeAttribute('inert');bind();},{once:true})}
async function connect(handle){
 const permission=await handle.requestPermission({mode:'readwrite'});if(permission!=='granted')throw Error('폴더 권한이 없습니다. 폴더를 다시 선택해 주세요.');
 seed();const initial=clone(state);initial.schemaVersion=11;
 window.WMLocalStore=WMLocalFolderStore.create({onStatus:status});
 const opened=await window.WMLocalStore.connect(handle,initial);
 try{await handleCache(handle)}catch{status({phase:'idle',message:'PC 폴더 연결됨. 브라우저 핸들 보관 실패: 다음 실행에는 폴더를 다시 선택하세요.'})}
 if(opened.recovery.length){
  const panel=document.getElementById('localRecovery');panel.replaceChildren();
  document.getElementById('localGateMessage').textContent='미확정 저장 '+opened.recovery.length+'건이 있습니다. 자동 재전송하지 않습니다. 입력을 내려받아 보관한 뒤 기존 확정본을 열고 필요하면 JSON 가져오기 미리보기를 사용하세요.';
  for(const row of opened.recovery){const button=document.createElement('button');button.textContent='미확정 입력 보관: '+row.operationId;button.onclick=()=>downloadJSON(row.next.state,'미확정-'+row.operationId+'.json');panel.append(button)}
  const accept=document.createElement('button');accept.textContent='기존 확정본으로 계속 (journal 원본 보존)';accept.onclick=async()=>{if(!confirm('미확정 입력은 journal에 보존하고 기존 확정본을 사용할까요? 미반영 입력은 자동 적용되지 않습니다.'))return;try{opened.state=await WMLocalStore.acknowledgeRecovery();await finish(opened)}catch(e){failure(e)}};panel.append(accept);
 }else await finish(opened);
}
async function choose(usePrevious){
 document.getElementById('localChoose').disabled=true;document.getElementById('localReconnect').disabled=true;
 try{if(typeof showDirectoryPicker!=='function')throw Error('이 브라우저는 폴더 선택 API를 지원하지 않습니다. Windows Edge/Chrome에서 열어 주세요.');const handle=usePrevious?previous:await showDirectoryPicker({mode:'readwrite'});await connect(handle)}
 catch(error){failure(error);await window.WMLocalStore?.close().catch(()=>{});document.getElementById('localChoose').disabled=false;document.getElementById('localReconnect').disabled=!previous}
}
document.getElementById('localChoose').onclick=()=>choose(false);document.getElementById('localReconnect').onclick=()=>choose(true);
handleCache().then(handle=>{previous=handle;document.getElementById('localReconnect').disabled=!handle}).catch(()=>{});
function bind(){
 if(document.getElementById('historySearch'))document.getElementById('historySearch').oninput=renderHistory;
 if(document.getElementById('refreshHistory'))document.getElementById('refreshHistory').onclick=renderHistory;
 const card=document.getElementById('cloudToolsCard');if(card){card.innerHTML='<h3>PC 폴더 저장</h3><p>data: 검증된 스냅샷 · journal: 저장/복구 기록 · backups: JSON 백업<br>기존 첨부 참조 보존. 첨부 원본 연결은 12-C 미구현입니다.</p><button class="btn" id="localUnconfirmed">미저장 화면 JSON 보관</button><button class="btn" id="localClose">연결 종료</button>';
 document.getElementById('localUnconfirmed').onclick=()=>downloadJSON(state,'현재화면-미확정일수있음.json');
 document.getElementById('localClose').onclick=async()=>{if(confirm('미저장 입력을 보관했는지 확인하세요. 폴더 연결을 종료할까요?')){await WMLocalStore.close();location.reload()}}}
 const holiday=document.getElementById('loadNationalHolidays');if(holiday){holiday.textContent='공휴일 갱신 안내';holiday.onclick=()=>alert('12-B는 기존 2026 Seed와 가져온 휴일만 사용합니다. 공식 공휴일 자료/가져오기 기능은 12-C에서 연결합니다. 미확인 미래 연도는 생성하지 않습니다.')}
 const label=document.getElementById('holidayImportStatus');if(label)label.textContent='공식 자동 갱신 미구현 · 저장된 휴일 사용';
 document.querySelectorAll('.local-beta-badge').forEach(x=>x.textContent='로컬 12-B');document.querySelectorAll('.local-beta-sub').forEach(x=>x.textContent='hotfix1 기반 · PC 폴더 저장 · 원본 첨부 연결은 12-C');
}
window.WMLocalUI={bind,failure};
// Final compatibility wrapper: old recurrence/project wrappers must not run before folder load.
const connectedSaveState=saveState;saveState=function(...args){if(!window.__LOCAL_STATE_READY_V121__)return Promise.resolve({persistence:'not-connected'});return connectedSaveState.apply(this,args)};
const toastBase=toast;toast=function(message,...args){if(connected&&!WMLocalStore.ready&&/저장했|저장되|삭제했|이동했|완료했|복원했/.test(String(message)))return toastBase('폴더 저장 미확정입니다. 아래 상태와 복구 기록을 확인하세요.');return toastBase(message,...args)};
})();
