import {authorizeBuildingTasks, getBuildingTasksToken, invalidateBuildingTasksToken, getBuildingUser} from './workspace-profile.js?v=phase6f-rules-v1';
import {GT_FIELD, GT_INTERVAL_MS, cleanDate, googleDue, fromGoogle, fromLocal, fingerprint, isSupportedLocalTask, updateFromRemote, newImportedTask, nextMergeAction, detachTasks} from './google-tasks-model.js?v=20261017-tasks-v15';

// Google Tasks 통신은 선택된 목록에서만 진행합니다. 원격 삭제 API는 의도적으로 사용하지 않습니다.
const API = 'https://tasks.googleapis.com/tasks/v1';
const $ = selector => document.querySelector(selector);
let running = false, pending = false, debounceTimer = 0, interval = 0, started = false;
let lastStatus = '연동하지 않음';
const bridge = () => window.workManagerTasksBridgeV15;
const currentState = () => bridge()?.state;
const settings = () => currentState()?.settings?.googleTasksV15;
const today = () => new Date().toLocaleDateString('sv-SE', {timeZone:'Asia/Seoul'});
function status(message, error = false) {
  lastStatus = message;
  const el = $('#googleTasksStatusV15');
  if (el) { el.textContent = message; el.style.color = error ? '#bb4141' : ''; }
  const refresh=$('#googleTasksReconnectV15'); if(refresh)refresh.hidden=!settings()?.enabled || !!getBuildingTasksToken();
  const cb = $('#googleTasksToggleV15');
  if (cb && !cb.disabled && settings()) cb.checked = !!settings().enabled;
}
function apiError(response, body) {
  const err = new Error(body?.error?.message || `Google Tasks API 오류 (${response.status})`);
  err.status = response.status;
  return err;
}
async function request(path, {method = 'GET', body, query, token} = {}) {
  const access = token || getBuildingTasksToken();
  if (!access) throw new Error('Google Tasks 권한이 만료됐습니다. 권한 다시 승인 버튼을 눌러 주세요.');
  const url = new URL(`${API}${path}`);
  for (const [key,value] of Object.entries(query || {})) if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  let response;
  try {
    response = await fetch(url, {method, headers:{Authorization:`Bearer ${access}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  } catch(error) {throw new Error(`Google Tasks 서버 연결 실패: ${error?.message || '네트워크 오류'}`);}
  let json = null;
  try { json = await response.json(); } catch {}
  if (!response.ok) {
    if (response.status === 401) invalidateBuildingTasksToken();
    throw apiError(response, json);
  }
  return json || {};
}
async function listAll(path, opts = {}) {
  const items = []; let next = '';
  do {
    const data = await request(path, {query:{maxResults:100,...opts,...(next?{pageToken:next}:{})}});
    items.push(...(data.items||[]));
    next = data.nextPageToken || '';
    if (items.length >= 3000 && next) throw new Error('Google Tasks 데이터가 3000건을 초과합니다. 안전을 위해 불러오기를 중단했습니다.');
  } while(next);
  return items;
}
const taskPath = (listId,taskId = '') => `/lists/${encodeURIComponent(listId)}/tasks${taskId?'/'+encodeURIComponent(taskId):''}`;
const isDone = task => task?.status === 'done' || !!task?.actualComplete;
const groupRemote = list => {
  const parents = list.filter(x=>x && !x.deleted && !x.parent && x.id);
  const childrenByParent = new Map();
  for(const item of list) if (item?.parent && !item.deleted) {
    if(!childrenByParent.has(item.parent)) childrenByParent.set(item.parent,[]);
    childrenByParent.get(item.parent).push(item);
  }
  return parents.map(p=>({top:p, children:childrenByParent.get(p.id)||[]}));
};
async function saveSnapshot(reason) {
  if (!bridge()) throw new Error('업무관리시스템을 아직 불러오지 못했습니다.');
  await bridge().save({reason});
  bridge().refresh();
}
function updateFingerprint(task, remote) {
  const link=task[GT_FIELD];
  link.lastLocal = fingerprint(fromLocal(task));
  link.lastRemote = fingerprint(remote);
}
async function sendParent(listId, task, existing = null) {
  const local = fromLocal(task);
  const payload = {title:local.title || '(제목 없는 할 일)',notes:local.notes,status:local.status};
  if (local.due) payload.due = googleDue(local.due);
  // API에서 날짜 제거를 명시적으로 요청할 때만 null을 전달합니다.
  else if (existing?.due) payload.due = null;
  if (existing) return request(taskPath(listId,existing.id),{method:'PATCH',body:payload});
  return request(taskPath(listId),{method:'POST',body:payload});
}
async function sendChildren(listId, task, remoteChildren = []) {
  const byId = new Map(remoteChildren.map(x=>[x.id,x]));
  const alreadyUsed = new Set((task.checklist||[]).map(c=>c.googleTaskId).filter(Boolean));
  for(const entry of task.checklist || []) {
    // 통신이 끊기기 직전에 생성된 하위 할 일이 있으면 제목·상태를 확인해 중복 등록을 줄입니다.
    if (!entry.googleTaskId && task[GT_FIELD]?.pendingExport) {
      const match = remoteChildren.find(c=>!alreadyUsed.has(c.id) && c.title===entry.text && (c.status==='completed')===!!entry.done);
      if(match){entry.googleTaskId=match.id;alreadyUsed.add(match.id);}
    }
    const old = entry.googleTaskId ? byId.get(entry.googleTaskId) : null;
    const payload = {title:String(entry.text||''),status:entry.done?'completed':'needsAction'};
    if (old && (old.title!==payload.title || old.status!==payload.status)) {
      await request(taskPath(listId,entry.googleTaskId),{method:'PATCH',body:payload});
    } else if (!old) {
      const created = await request(taskPath(listId),{method:'POST',query:{parent:task[GT_FIELD].taskId},body:payload});
      if (!created.id) throw new Error('Google 하위 할 일 생성 후 ID를 받지 못했습니다.');
      entry.googleTaskId = created.id;
      // 하위 할 일이 등록된 시점마다 ID를 보관해야 재연결 시 중복 등록 위험이 줄어듭니다.
      if(task[GT_FIELD]?.pendingExport) await saveSnapshot('Google Tasks 하위 할 일 연결 ID 저장');
    }
  }
}
function prepareLocalCompletion(task, remote) {
  const checks=task.checklist || [];
  if(!checks.length) return;
  const previouslyCompleted = remote.children.every(x=>x.status==='completed');
  const completed = checks.every(x=>x.done);
  if (completed && !previouslyCompleted) {task.status='done'; task.actualComplete=task.actualComplete||today();}
  if (!completed && isDone(task)) {task.status='progress'; task.actualComplete=null;}
}
async function pushImported(task, remoteTop, remoteChildren) {
  const link = task[GT_FIELD];
  const remote = fromGoogle(remoteTop,remoteChildren);
  if(link.pendingExport) {
    await sendChildren(link.listId, task, remoteChildren);
    await sendParent(link.listId,task,remoteTop);
    link.pendingExport=false;
    updateFingerprint(task,{...fromLocal(task),parentStatus:task.status==='done'?'completed':'needsAction'});
    return;
  }
  if((task.checklist||[]).filter(c=>c.googleTaskId).length < remoteChildren.length) {
    throw new Error('Google 체크리스트를 로컬에서 삭제한 항목이 있습니다. 원본 보호를 위해 자동 삭제하지 않습니다.');
  }
  prepareLocalCompletion(task,remote);
  // 먼저 하위 항목 완료 상태를 맞춘 뒤 상위 할 일 상태를 반영합니다.
  await sendChildren(link.listId, task, remoteChildren);
  await sendParent(link.listId, task, remoteTop);
  updateFingerprint(task,{...fromLocal(task),parentStatus:task.status==='done'?'completed':'needsAction'});
}
async function exportNewTask(task, listId) {
  task[GT_FIELD] = {origin:'local',listId,taskId:'',dueExplicit:true,importedDefaultDue:cleanDate(task.deadline||task.end),lastLocal:'',lastRemote:''};
  const created = await sendParent(listId,task);
  if (!created.id) {delete task[GT_FIELD]; throw new Error('Google 할 일 생성 응답이 올바르지 않습니다.');}
  task[GT_FIELD].taskId = created.id;
  task[GT_FIELD].pendingExport=true;
  task[GT_FIELD].lastLocal=fingerprint({...fromLocal(task),children:[]});
  task[GT_FIELD].lastRemote=fingerprint(fromGoogle(created,[]));
  await saveSnapshot('Google Tasks 신규 업무 연결 ID 저장');
  await sendChildren(listId,task);
  task[GT_FIELD].pendingExport=false;
  updateFingerprint(task,{...fromLocal(task),parentStatus:task.status==='done'?'completed':'needsAction'});
}
function findLinked(s, listId, remoteId) {
  return (s.tasks||[]).find(t=>t[GT_FIELD]?.listId===listId && t[GT_FIELD]?.taskId===remoteId);
}
async function performSync() {
  const s=currentState(); const pref=settings();
  if(!s || !pref?.enabled || !pref.listId) return;
  if(!getBuildingTasksToken()) {status('Google Tasks 재승인이 필요합니다. 체크박스를 다시 눌러 연결하세요.',true);return;}
  const listId=pref.listId;
  const all = await listAll(taskPath(listId),{showCompleted:true,showHidden:true,showDeleted:true});
  const remoteGroups = groupRemote(all);
  let imported=0,pulled=0,pushed=0,conflicts=0,changed=false;
  for(const {top,children} of remoteGroups) {
    if (!settings()?.enabled || settings().listId !== listId) return;
    let task=findLinked(s,listId,top.id);
    const remote=fromGoogle(top,children);
    if(!task) {
      if(top.status==='completed' && !pref.includeCompleted) continue;
      task=newImportedTask(top,children,{listId,owner:s.owners?.[0]||'',category:s.categories?.[0]||'기타',today:today()});
      // 완료한 Google Tasks 업무도 필요한 경우 가져오되, 과거 완료를 기본으로 대량 수입하지 않습니다.
      updateFingerprint(task,remote);
      if(remote.status === 'completed' && top.status !== 'completed') {
        await request(taskPath(listId,top.id),{method:'PATCH',body:{status:'completed'}});
        task[GT_FIELD].lastRemote=fingerprint({...remote,parentStatus:'completed'});
      }
      s.tasks.push(task); imported++; changed=true; continue;
    }
    const link=task[GT_FIELD];
    if(link.frozen) continue;
    if (!link.lastLocal || !link.lastRemote) {
      updateFingerprint(task,remote); changed=true; continue;
    }
    const lastRemote = (()=>{try{return JSON.parse(link.lastRemote||'null');}catch{return null;}})();
    const explicitlyReopened = lastRemote?.parentStatus === 'completed' && remote.parentStatus === 'needsAction' && remote.children.length && remote.children.every(c=>c.status==='completed');
    const action=link.pendingExport?'push':nextMergeAction(task,remote);
    if(action==='conflict') {conflicts++;continue;}
    if(action==='pull') {
      updateFromRemote(task,top,children,today(),{forceReopen:explicitlyReopened});
      updateFingerprint(task,remote);
      // 구글에서 하위 항목을 해제하면 부모 상태도 해제해야 다른 쪽에서 재완료되지 않습니다.
      if(top.status==='completed' && remote.status!=='completed') {
        await request(taskPath(listId,top.id),{method:'PATCH',body:{status:'needsAction'}});
        link.lastRemote=fingerprint({...remote,parentStatus:'needsAction'});
      } else if (top.status==='needsAction' && remote.status==='completed' && !explicitlyReopened) {
        await request(taskPath(listId,top.id),{method:'PATCH',body:{status:'completed'}});
        link.lastRemote=fingerprint({...remote,parentStatus:'completed'});
      }
      pulled++;changed=true;
    } else if(action==='push') {
      await pushImported(task,top,children);
      pushed++;changed=true;
    }
  }
  // 연결 시작 전에 존재했던 기존 업무는 Google에 일괄 업로드하지 않습니다.
  const known=new Set(pref.knownLocalIds||[]);
  for(const task of s.tasks || []) {
    if(!pref.enabled) return;
    if(task[GT_FIELD] || known.has(task.id)) continue;
    if(!isSupportedLocalTask(task)) {known.add(task.id);continue;}
    await exportNewTask(task,listId); pushed++;changed=true;
    known.add(task.id);
  }
  if(known.size!==(pref.knownLocalIds||[]).length){pref.knownLocalIds=[...known];changed=true;}
  pref.lastSyncedAt=new Date().toISOString();
  if(changed) await saveSnapshot('Google Tasks 양방향 동기화');
  let result=`Google Tasks 동기화 완료 · 가져옴 ${imported} · 구글 변경 반영 ${pulled} · 구글로 전송 ${pushed}`;
  if(conflicts) result+=` · 충돌 ${conflicts}건(자동 덮어쓰기 중단)`;
  status(result,Boolean(conflicts));
}
async function synchronize() {
  if(running){pending=true;return;}
  running=true;
  try { await performSync(); }
  catch(err) {console.warn('Google Tasks 동기화 실패:',err);status(err.message||'Google Tasks 동기화 실패',true);}
  finally {running=false;if(pending){pending=false;setTimeout(synchronize,800);}}
}
function scheduleSync() {
  if(!settings()?.enabled || !getBuildingTasksToken() || running) return;
  clearTimeout(debounceTimer);
  debounceTimer=setTimeout(synchronize,1600);
}
function choiceDialog(tasklists) {
  return new Promise(resolve=>{
    const overlay=document.createElement('div');overlay.className='gt-overlay-v15';
    const el=document.createElement('div');el.className='gt-dialog-v15';
    const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    el.innerHTML=`<h3>Google Tasks 목록 선택</h3><p>업무관리시스템에 연결할 목록을 하나 선택해 주세요. 개인 할 일과 섞이지 않도록 테스트 목록을 권장합니다.</p><label class="gt-label-v15">연결할 목록<select id="gt-list-choice-v15">${tasklists.map((x,i)=>`<option value="${i}">${escape(x.title||'이름 없는 목록')}</option>`).join('')}</select></label><label class="gt-checkline-v15"><input type="checkbox" id="gt-import-completed-v15"> 기존 완료된 할 일까지 가져오기 (기본값: 제외)</label><p class="gt-caution-v15">처음 연결할 때 이미 등록된 업무관리시스템 업무는 구글에 한꺼번에 복사하지 않습니다. 연동 이후 새로 작성하는 일반업무만 양방향 연결됩니다.</p><div class="gt-actions-v15"><button type="button" id="gt-cancel-v15">취소</button><button type="button" id="gt-ok-v15">연결</button></div>`;
    overlay.appendChild(el); document.body.appendChild(overlay);
    const close=value=>{overlay.remove();resolve(value);};
    el.querySelector('#gt-cancel-v15').onclick=()=>close(null);
    el.querySelector('#gt-ok-v15').onclick=()=>close({list:tasklists[Number(el.querySelector('#gt-list-choice-v15').value)],includeCompleted:el.querySelector('#gt-import-completed-v15').checked});
  });
}
async function connect() {
  if(!bridge() || !currentState()) {status('업무 데이터 로딩 후 다시 눌러 주세요.',true);return;}
  const cb=$('#googleTasksToggleV15');if(cb)cb.disabled=true;
  status('Google Tasks 계정 권한을 확인하는 중…');
  try {
    // 사용자 클릭으로 시작하므로 OAuth 팝업을 차단하지 않습니다.
    if(!getBuildingTasksToken()) await authorizeBuildingTasks();
    let pref=settings();
    if(!pref?.listId) {
      const lists=await listAll('/users/@me/lists');
      if(!lists.length) throw new Error('Google Tasks 할 일 목록이 없습니다. Google Tasks에서 목록을 하나 만들어 주세요.');
      const choice=await choiceDialog(lists);
      if(!choice) {status('연동을 취소했습니다.');return;}
      const s=currentState();
      pref={enabled:true,listId:choice.list.id,listTitle:choice.list.title,includeCompleted:choice.includeCompleted,
        knownLocalIds:(s.tasks||[]).map(t=>t.id),lastSyncedAt:''};
      s.settings.googleTasksV15=pref;
    } else {
      pref.enabled=true;
      for (const t of currentState().tasks || []) {
        if(t[GT_FIELD]?.origin==='local' && t[GT_FIELD]?.listId===pref.listId) t[GT_FIELD].frozen=false;
      }
      pref.knownLocalIds=[...new Set([...(pref.knownLocalIds||[]),...(currentState().tasks||[]).filter(t=>!t[GT_FIELD]).map(t=>t.id)])];
    }
    await saveSnapshot('Google Tasks 연동 활성화');
    await synchronize();
  } catch(err) {status(err.message||'Google Tasks 연결 실패',true);} finally {
    if(cb) {cb.disabled=false;cb.checked=Boolean(settings()?.enabled);}
  }
}
async function disconnect() {
  const s=currentState(), pref=settings();
  if(!s || !pref?.enabled) return;
  const unfinished=(s.tasks||[]).filter(t=>t[GT_FIELD]?.origin==='google'&&t[GT_FIELD].listId===pref.listId&&!isDone(t));
  const approved=window.confirm(`Google Tasks 연동을 중단할까요?\n\n· Google 원본 할 일은 삭제되지 않습니다.\n· 시스템으로 불러온 미완료 업무 ${unfinished.length}건은 진행업무에서 제거됩니다.\n· 완료된 업무 기록과 직접 작성한 업무는 보존됩니다.\n\n제거될 업무는 JSON 백업에 별도 보관하시길 권장합니다.`);
  if(!approved) {const cb=$('#googleTasksToggleV15');if(cb)cb.checked=true;return;}
  // 메모리의 원본 상태 백업 — 원격 저장 실패 시 복구.
  const previousTasks=JSON.parse(JSON.stringify(s.tasks));const previousPref=JSON.parse(JSON.stringify(pref));
  const {kept,removed}=detachTasks(s.tasks,pref.listId,isDone);
  s.tasks=kept;
  pref.enabled=false;
  clearTimeout(debounceTimer);
  try {
    await saveSnapshot('Google Tasks 연동 해제 · 미완료 가져온 업무 제거');
    status(`연동 중단 · 미완료 가져온 업무 ${removed.length}건 제거 · 완료 기록 유지`);
  } catch(err) {
    s.tasks=previousTasks; s.settings.googleTasksV15=previousPref;
    status(`연동 해제 저장 실패: ${err.message}`,true);
  }
  // Google API 토큰을 취소하거나 Google Tasks 데이터를 삭제하지 않습니다.
}
function ensureToggle() {
  const btn=$('#newTaskBtn'); if(!btn || !bridge()?.state) return;
  let label=$('#googleTasksToggleLabelV15');
  if(!label){
    label=document.createElement('label');label.id='googleTasksToggleLabelV15';label.className='gt-toggle-v15';
    label.innerHTML='<input id="googleTasksToggleV15" type="checkbox"><span>Google Tasks 불러오기</span>';
    btn.parentNode.insertBefore(label,btn);
    const info=document.createElement('div'); info.className='gt-status-v15';info.id='googleTasksStatusV15';
    const header=btn.closest('.pagehead'); header?.parentNode?.insertBefore(info,header.nextSibling);
    label.querySelector('input').addEventListener('change',e=>{if(e.target.checked)connect();else disconnect();});
  }
  label.querySelector('input').checked=Boolean(settings()?.enabled);
  const info=$('#googleTasksStatusV15');
  if(info && !document.querySelector('#googleTasksReconnectV15')) {
    const reconnect=document.createElement('button'); reconnect.type='button';reconnect.id='googleTasksReconnectV15';reconnect.className='btn small';reconnect.textContent='권한 다시 승인';
    reconnect.style.marginLeft='10px'; info.after(reconnect);
    reconnect.onclick=async()=>{reconnect.disabled=true;try{await authorizeBuildingTasks();await synchronize();}catch(err){status(err.message||'Google 인증 실패',true);}finally{reconnect.disabled=false;}};
  }
  const reconnectBtn=$('#googleTasksReconnectV15'); if(reconnectBtn)reconnectBtn.hidden=!settings()?.enabled || !!getBuildingTasksToken();
  if(info && !info.textContent){
    info.textContent=settings()?.enabled?(getBuildingTasksToken()?`연동 목록: ${settings().listTitle || '선택한 목록'}`:'연동 일시 정지 · 오른쪽 권한 다시 승인 버튼을 눌러 주세요.'):'Google Tasks 자동 동기화 OFF';
  }
}
function boot() {
  if(started)return;
  if(!bridge()?.state || !window.cloudSync) {setTimeout(boot,900);return;}
  started=true;ensureToggle();
  interval=setInterval(()=>{ensureToggle();if(settings()?.enabled)synchronize();},GT_INTERVAL_MS);
  window.addEventListener('focus',()=>{ensureToggle();if(settings()?.enabled)synchronize();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&settings()?.enabled)synchronize();});
  window.addEventListener('wm:tasks-v15-saved',scheduleSync);
  if(settings()?.enabled){if(getBuildingTasksToken()) synchronize();else status('Google Tasks 연동 설정 유지됨 · 권한 다시 승인 버튼을 눌러 주세요.',true);}
}
window.GoogleTasksV15 = {sync:synchronize,ensureToggle, model:{fromGoogle,fromLocal,newImportedTask,updateFromRemote,detachTasks}};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
