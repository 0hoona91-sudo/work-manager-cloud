/* 업무관리시스템 · 프로젝트 화면. 기존 수행업무/Cloud 동기화 함수 재사용. */
(function () {
'use strict';
const M = window.WMProjectModel;
if(!M)throw new Error('프로젝트 모델을 불러오지 못했습니다.');
const $p = (selector,root=document)=>root.querySelector(selector);
const $$p = (selector,root=document)=>[...root.querySelectorAll(selector)];
const escp = value => String(value??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtp = value => String(value||'');
const valp = value => value?String(value):'';
const projectUid = M.id;
let editor=null, activeStage=0, dirty=false, saving=false, scheduleError='';
let filterTerm='',filterCategory='all';
let pendingFiles=new Map();
const editorRoot=()=>document.querySelector('#modalRoot .project-editor-modal');
const holidayCheck=d=>{
  const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  return d.getDay()===0||d.getDay()===6||(state.holidays||[]).some(h=>h.date===ds);
};
function selectable(items,selected,{placeholder='선택',blank=true}={}) {
  const list=Array.isArray(items)?items:[];
  return `${blank?`<option value="">${escp(placeholder)}</option>`:''}${list.map(v=>`<option value="${escp(v)}" ${String(v)===String(selected)?'selected':''}>${escp(v)}</option>`).join('')}`;
}
function projectList(){return Array.isArray(state.projects)?state.projects:[];}
function projectById(id){return projectList().find(p=>p.id===id);}
function projectStageTask(projectId,stageId){return (state.tasks||[]).find(t=>t.projectId===projectId&&t.projectStageId===stageId);}
function doneCount(project){return project.stages.filter(s=>effectiveStatus(projectStageTask(project.id,s.id)||{})==='done').length;}
function projectCard(project){
  const done=doneCount(project),total=project.stages.length;
  return `<article class="prj-card" data-prj-card="${escp(project.id)}">
    <button type="button" class="prj-card-open" data-edit-project="${escp(project.id)}" aria-label="${escp(project.name)} 수정">
      <span class="prj-overline">${escp(project.category)} · ${escp(project.manager)}</span>
      <strong>${escp(project.name)}</strong>
      <small>${escp(project.start||'-')} ~ ${escp(project.end||'미정')}</small>
      <span class="prj-progress-line"><i style="width:${total?Math.round(done/total*100):0}%"></i></span>
      <span class="prj-progress-text">${done}/${total}단계 완료</span>
    </button>
    <div class="prj-stage-preview">${project.stages.map((s,i)=>{
      const task=projectStageTask(project.id,s.id),isDone=task&&effectiveStatus(task)==='done';
      return `<button type="button" class="prj-step-chip ${isDone?'done':''}" data-project-step="${escp(s.taskId)}"><span>${i+1}단계</span><b>${escp(s.title)}</b><span aria-hidden="true">${isDone?'✓':'→'}</span></button>`;
    }).join('')}</div>
  </article>`;
}
function ensurePage(){
  if(!document.querySelector('#projectPage')){
    const page=document.createElement('section');page.id='projectPage';page.className='sectionpage prj-page';
    page.innerHTML=`<header class="prj-page-heading"><div><span class="prj-eyebrow">PROJECT MANAGEMENT</span><h2>프로젝트</h2><p>단계별 업무를 관리하고 수행업무와 연결합니다.</p></div><button type="button" class="btn primary" id="prjNew">＋ 프로젝트 등록</button></header>
      <div class="prj-filters"><div class="prj-field"><label for="prjCategoryFilter">대분류</label><select id="prjCategoryFilter"><option value="all">전체 대분류</option></select></div><div class="prj-field prj-query"><label for="prjSearch">검색 범위 · 제목 / 구분 / 업무명</label><input id="prjSearch" autocomplete="off" placeholder="프로젝트명 / 단계 업무명 / 담당자 검색"></div></div>
      <div class="prj-grid" id="prjGrid"></div>`;
    document.querySelector('#dbPage').insertAdjacentElement('beforebegin',page);
    page.querySelector('#prjNew').onclick=()=>openEditor();
    page.querySelector('#prjCategoryFilter').onchange=e=>{filterCategory=e.target.value;renderProjectPage();};
    page.querySelector('#prjSearch').oninput=e=>{filterTerm=e.target.value.toLowerCase().trim();renderProjectCards();};
    page.querySelector('#prjGrid').addEventListener('click',e=>{
      const stage=e.target.closest('[data-project-step]');
      if(stage){openChecklist(stage.dataset.projectStep);return;}
      const edit=e.target.closest('[data-edit-project]');if(edit)openEditor(edit.dataset.editProject);
    });
  }
  const side=document.querySelector('.side'),existing=side?.querySelector('.navbtn[data-page="projectPage"]');
  if(side&&!existing){
    const button=document.createElement('button');button.className='navbtn prj-navbtn';button.type='button';button.dataset.page='projectPage';
    button.innerHTML=`<span class="nav-icon" aria-hidden="true">▤</span><span>프로젝트</span>`;
    const db=side.querySelector('.navbtn[data-page="dbPage"]');(db||side.querySelector('.navbtn[data-page="settingsPage"]'))?.before(button);
    button.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();showPage('projectPage');});
  }
  if(typeof NAV_ITEMS_V33==='object'&&NAV_ITEMS_V33)NAV_ITEMS_V33.projectPage='프로젝트';
  if(typeof NAV_ITEMS_LOCAL_V12==='object'&&NAV_ITEMS_LOCAL_V12)NAV_ITEMS_LOCAL_V12.projectPage='프로젝트';
  ensureProjectVisibilityDefault();
  try{ensureLayoutDefaultsV33();ensureNavVisibilityLocalV12();}catch{}
  applyProjectThemeIcon();
  syncProjectVisibility();
}
function renderProjectCards(){
  const root=$p('#prjGrid');if(!root)return;
  const projects=projectList().filter(p=>(filterCategory==='all'||p.category===filterCategory) && (!filterTerm || [p.name,p.category,p.manager,...p.stages.map(s=>s.title)].join(' ').toLowerCase().includes(filterTerm)))
     .sort((a,b)=>String(b.updatedAt||b.createdAt||'').localeCompare(String(a.updatedAt||a.createdAt||'')));
  root.innerHTML=projects.length
    ?projects.map(projectCard).join('')+'<button type="button" class="prj-add-tile" id="prjGridAdd" aria-label="새 프로젝트 추가"><span>＋</span><b>새 프로젝트</b></button>'
    :`<div class="prj-empty"><div class="prj-empty-symbol" aria-hidden="true">▤</div><strong>등록된 프로젝트가 없습니다.</strong><span>새 프로젝트를 등록하여 단계별 진행 현황을 관리해 보세요.</span><button type="button" class="btn primary" id="prjEmptyNew">＋ 프로젝트 등록</button></div>`;
  const newButton=$p('#prjEmptyNew')||$p('#prjGridAdd');if(newButton)newButton.onclick=()=>openEditor();
}
function renderProjectPage(){
  ensurePage();
  const category=$p('#prjCategoryFilter');if(category){
    if(filterCategory!=='all'&&!state.categories.includes(filterCategory))filterCategory='all';
    category.innerHTML='<option value="all">전체 대분류</option>'+state.categories.map(c=>`<option value="${escp(c)}">${escp(c)}</option>`).join('');
    category.value=filterCategory;
  }
  const search=$p('#prjSearch');if(search&&search.value!==filterTerm)search.value=filterTerm;
  renderProjectCards();
  syncProjectVisibility();
}
function ensureProjectVisibilityDefault(){
  state.settings ||= {};
  state.settings.navVisibilityLocalV12 ||= {};
  state.settings.navVisibilityV33 ||= {};
  // v1.3은 메뉴가 별도 선택 없이 켜지던 버전: v1.3.1 첫 실행에서는 한 번 꺼 두고 명시적 선택을 기다린다.
  if(state.settings.projectVisibilityOptInV131!==true){
    state.settings.navVisibilityLocalV12.projectPage=false;
    state.settings.navVisibilityV33.projectPage=false;
    state.settings.projectVisibilityOptInV131=true;
  }
  if(typeof state.settings.navVisibilityLocalV12.projectPage!=='boolean')
    state.settings.navVisibilityLocalV12.projectPage=false;
  // 로컬 메뉴의 값이 우선이며 구버전 V33과 일치시켜 표시 판정을 하나로 만든다.
  state.settings.navVisibilityV33.projectPage=state.settings.navVisibilityLocalV12.projectPage;
  return state.settings.navVisibilityLocalV12.projectPage;
}
function syncProjectVisibility(){
  const enabled=ensureProjectVisibilityDefault();
  const nav=document.querySelector('.side .prj-navbtn');if(!nav)return;
  const hidden=!enabled;
  nav.classList.toggle('v33-nav-hidden',hidden);
  nav.classList.toggle('local-v12-nav-hidden',hidden);
  nav.hidden=hidden;nav.setAttribute('aria-hidden',String(hidden));
  if(hidden)nav.style.setProperty('display','none','important');
  else nav.style.removeProperty('display');
  const active=$p('#projectPage')?.classList.contains('active');nav.classList.toggle('active',Boolean(active));
  // 모바일 하단 메뉴는 실제 표시되는 버튼 수에 맞춰 폭을 다시 나눈다.
  const side=document.querySelector('.side');
  if(side){
    const visible=[...side.querySelectorAll('.navbtn')].filter(b=>!b.hidden && b.style.display!=='none' && !b.classList.contains('local-v12-nav-hidden') && !b.classList.contains('v33-nav-hidden'));
    side.style.setProperty('--v33-visible-nav-count',String(Math.max(2,visible.length)));
  }
}
function ensureSettingsControl(){
  // 기존 운영판 설정/백업은 v1.2 독립 메뉴 표시 목록을 사용한다.
  if(typeof NAV_ITEMS_LOCAL_V12==='object'&&NAV_ITEMS_LOCAL_V12){
    NAV_ITEMS_LOCAL_V12.projectPage='프로젝트';
    ensureProjectVisibilityDefault();
    if(typeof ensureNavVisibilityLocalV12==='function')ensureNavVisibilityLocalV12();
    if(typeof ensureLayoutSettingsCardLocalV12==='function')ensureLayoutSettingsCardLocalV12();
    return;
  }
  const card=$p('#localLayoutSettingsV33 .v33-config-list');
  if(!card||card.querySelector('[data-nav-toggle-v33="projectPage"]'))return;
  const row=document.createElement('label');row.className='v33-config-item';row.innerHTML='<input type="checkbox" data-nav-toggle-v33="projectPage"><span>프로젝트</span>';
  card.appendChild(row);const input=row.querySelector('input');
  input.checked=ensureProjectVisibilityDefault();
  row.classList.toggle('is-off',!input.checked);
  input.onchange=()=>{state.settings.navVisibilityLocalV12.projectPage=input.checked;state.settings.navVisibilityV33.projectPage=input.checked;row.classList.toggle('is-off',!input.checked);syncProjectVisibility();void saveState({reason:'프로젝트 메뉴 표시 변경'});};
}
function applyProjectThemeIcon(){
  const icon=$p('.prj-navbtn .nav-icon');if(!icon)return;
  const theme=document.body.dataset.v7Theme||document.documentElement.dataset.v7Theme;
  const src=theme==='hellokitty'?'./assets/kitty-project.png':theme==='shinchan'?'./assets/shinchan-project.png':'';
  icon.style.setProperty('background-image',src?`url("${src}")`:'none','important');
  icon.style.setProperty('background-position','center','important');
  icon.style.setProperty('background-repeat','no-repeat','important');
  icon.style.setProperty('background-size','contain','important');
  icon.textContent=src?'':'▤';
}
function dateField(key,label,value,{required=false}={}){
  // 기존 업무 등록 폼과 같은 날짜 버튼/기본 HTML 달력을 사용한다.
  const formatted=/^\d{4}-\d{2}-\d{2}$/.test(String(value||''))?value:'';
  return `<div class="prj-field prj-date-field"><label for="prj-${escp(key)}">${escp(label)}${required?' *':''}</label><div class="prj-date-wrap date-entry-v20"><input class="date-text-v20" type="text" id="prj-${escp(key)}" data-prj-field="${escp(key)}" inputmode="numeric" autocomplete="off" maxlength="10" placeholder="YYYY-MM-DD" value="${escp(fmtp(value))}"><input type="date" class="date-picker-v20" data-date-proxy-v20="true" data-date-for="${escp(key)}" value="${escp(formatted)}" tabindex="-1" aria-label="${escp(label||'체크리스트 마감일')} 달력에서 선택"><button type="button" class="date-picker-button-v34 prj-calendar-button" aria-label="${escp(label||'체크리스트 마감일')} 달력 열기" title="달력 열기">📅</button></div></div>`;
}
function editorHeader(){
  return `<div class="prj-main-fields"><div class="prj-field prj-full"><label>프로젝트명 *</label><input id="prj-name" data-project-root="name" value="${escp(editor.name)}" placeholder="프로젝트명을 입력해 주세요."></div>
    <div class="prj-field"><label>구분 *</label><select data-project-root="category" id="prj-category">${selectable(state.categories,editor.category,{placeholder:'대분류 선택'})}</select></div>
    <div class="prj-field"><label>총괄담당자 *</label><select data-project-root="manager" id="prj-manager">${selectable(state.owners,editor.manager,{placeholder:'총괄담당자 선택'})}</select></div>
    ${dateField('projectStart','프로젝트 시작일',editor.start,{required:true})}${dateField('projectEnd','프로젝트 마감(예정)일',editor.end)}
  </div>`;
}
function stageTabs(){
  return `<div class="prj-stage-tabs" role="tablist" aria-label="프로젝트 단계 순서">${editor.stages.map((step,i)=>`
  <button type="button" draggable="true" role="tab" aria-selected="${activeStage===i}" class="prj-stage-tab ${activeStage===i?'active':''}" data-step-tab="${i}" title="드래그하여 단계 순서 변경"><span class="prj-grip" aria-hidden="true">⠿</span>${i+1}단계</button>`).join('')}<button type="button" id="prj-add-step" class="prj-add-step" aria-label="단계 추가"><span class="prj-plus-mark" aria-hidden="true"></span><span>단계 추가</span></button></div>`;
}
function checkRows(step){
  return (step.checklist||[]).map((c,i)=>`<div class="prj-check-row" data-prj-check-row="${escp(c.id)}">
      <div class="prj-check-order">${i+1}</div><input aria-label="체크할 내용 ${i+1}" placeholder="체크할 내용" data-check-field="text" value="${escp(c.text)}">
      <select aria-label="담당자 ${i+1}" data-check-field="owner" ${step.participants.length<=1?'disabled':''}>${selectable(step.participants,step.participants.length===1?step.participants[0]:c.owner,{placeholder:step.participants.length?'담당자 선택':'참여자 먼저 선택'})}</select>
      ${dateField(`check_${i}`,'',c.dueDate)}<button type="button" data-remove-check="${escp(c.id)}" class="prj-x" title="이 체크항목만 삭제" aria-label="${i+1}번 체크항목 삭제">×</button>
    </div>`).join('');
}
function resourceRows(step){
  return (step.resources||[]).map(item=>`<div class="prj-resource" data-resource="${escp(item.id)}"><span class="prj-resource-icon">${item.type==='image'?'▧':'▤'}</span><span>${escp(item.name||'파일')}</span>${item.pending?'<small>저장 시 업로드</small>':'<small>저장됨</small>'}
     ${!item.pending?`<button type="button" class="prj-resource-open" data-prj-open-resource="${escp(item.id)}">열기</button>`:''}<button type="button" data-remove-resource="${escp(item.id)}" class="prj-x" title="이 자료 연결만 제거">×</button></div>`).join('') || '<div class="prj-empty-attach">등록된 진행자료가 없습니다.</div>';
}
function stageEditor(){
  const s=editor.stages[activeStage];if(!s)return '';
  return `<div class="prj-stage-inner" data-stage-id="${escp(s.id)}">
    <div class="prj-stage-tools"><div><b>${activeStage+1}단계 설정</b><small>단계를 끌어서 순서를 바꾸거나 화살표로 이동할 수 있습니다.</small></div><div class="prj-stage-actions"><button type="button" class="prj-move" id="prj-move-left" ${activeStage===0?'disabled':''}>← 앞 단계</button><button type="button" class="prj-move" id="prj-move-right" ${activeStage===editor.stages.length-1?'disabled':''}>뒤 단계 →</button><button type="button" class="prj-delete-step" id="prj-remove-stage">이 단계 삭제</button></div></div>
    <div class="prj-field prj-full"><label>세부 업무명 *</label><input data-stage-field="title" value="${escp(s.title)}" placeholder="단계에서 수행할 업무명을 입력하세요"></div>
    <div class="prj-field prj-full"><label>참여자 <span class="prj-hint">여러 명 선택 가능</span></label><div class="prj-people">${state.owners.map(owner=>`<label><input type="checkbox" data-person="${escp(owner)}" ${s.participants.includes(owner)?'checked':''}><span>${escp(owner)}</span></label>`).join('')||'<p>먼저 설정에서 담당자를 등록해 주세요.</p>'}</div></div>
    ${activeStage>0?`<div class="prj-schedule"><h4>일정 · 상위 업무 기준</h4><div class="prj-relative-date-v177"><p>이전 단계 종료일을 기준으로 자동 계산합니다.</p><label>시작일: 상위 업무 후 <input type="number" id="prj-relative-start-v177" step="1" value="${Number(s.relativeStartDays)||0}">일</label><label>종료일: 상위 업무 후 <input type="number" id="prj-relative-end-v177" step="1" value="${Number(s.relativeEndDays)||0}">일</label><p data-prj-schedule-result>${scheduleText(s)}</p></div></div>`:`<div class="prj-schedule"><h4>일정</h4><div class="prj-date-row">${dateField('stageStart','시작일',s.start||editor.start,{required:true})}<div class="prj-field"><label>종료일 방식</label><div class="prj-end-options">${[['same','당일 마무리'],['date','날짜 지정'],['after','며칠 후']].map(([v,label])=>`<label><input type="radio" name="prjEndMode" value="${v}" ${s.endType===v?'checked':''}> ${label}</label>`).join('')}</div></div></div>
      <div class="prj-end-details">${s.endType==='date'?dateField('stageEnd','종료일',s.endDate):s.endType==='after'?`<div class="prj-field"><label>시작일 이후</label><div class="prj-inline"><input type="number" id="prj-after-days" min="0" max="9999" value="${Number(s.afterDays)||0}"><span>일 후</span></div></div><label class="prj-small-check"><input type="checkbox" id="prj-count-holidays" ${s.includeHolidays?'checked':''}> 주말·휴일 포함</label>`:''}
       ${s.endType!=='same'?`<div class="prj-field"><label>종료일이 휴일이면</label><select id="prj-holiday-shift">${[['keep','그대로'],['prev','이전 근무일'],['next','다음 근무일']].map(([v,label])=>`<option value="${v}" ${s.holidayShift===v?'selected':''}>${label}</option>`).join('')}</select></div>`:''}
      </div><p data-prj-schedule-result>${scheduleText(s)}</p>
    </div>`}
    <div class="prj-block"><div class="prj-block-header"><h4>체크리스트</h4><span>체크항목별 담당자와 마감일을 지정합니다.</span></div><div class="prj-check-head"><span></span><span>체크할 내용</span><span>담당자</span><span>마감일</span><span></span></div><div id="prj-check-list">${checkRows(s)}</div><button type="button" id="prj-add-check" class="prj-soft-btn">＋ 체크항목</button></div>
    <div class="prj-block"><div class="prj-block-header"><h4>진행자료</h4><span>사진·문서 원본은 기존 Google Drive 연결을 사용합니다.</span></div><div id="prj-resources">${resourceRows(s)}</div><button type="button" id="prj-add-resource" class="prj-soft-btn">＋ 자료 추가</button><input hidden id="prj-file-picker" type="file" multiple></div>
  </div>`;
}
function setDirty(){dirty=true;}
function scheduleText(step){
  try{return `계산 결과: ${escp(step.start||'-')} ~ ${escp(M.stageEnd(step,holidayCheck,projectStageTask(editor.id,step.id))||'-')}`;}
  catch{return '계산 오류: 날짜 입력을 확인해 주세요.';}
}
function showScheduleStatus(){
  const error=$p('#prjScheduleError');if(error){error.textContent=scheduleError;error.hidden=!scheduleError;}
  const save=$p('#prjSave');if(save)save.disabled=Boolean(scheduleError)||saving;
  const summary=$p('[data-prj-schedule-result]');
  if(summary)summary.innerHTML=scheduleError?'계산 보류: 날짜 입력을 확인해 주세요.':scheduleText(editor.stages[activeStage]);
}
function recalculateEditor(){
  try{M.applyRelativeDates(editor,holidayCheck,state);scheduleError='';}
  catch(error){scheduleError=error.message||'프로젝트 일정을 계산하지 못했습니다.';}
  showScheduleStatus();
  return !scheduleError;
}
function renderTabs(){const tabs=$p('#prjTabs');if(tabs){tabs.innerHTML=stageTabs();bindTabs(tabs);}}
function renderStage(){const target=$p('#prjStagePane');if(!target)return;const step=editor?.stages[activeStage];if(step&&!M.isCompleted(projectStageTask(editor.id,step.id)))normalizeCheckAssignments(step);target.innerHTML=stageEditor();bindStageControls(target);showScheduleStatus();}
function showEditor(){
  modal(editor?.updatedAt?'프로젝트 수정':'프로젝트 등록',`<div class="prj-editor">
     <p id="prjScheduleError" role="alert" hidden></p><div id="prjHeader">${editorHeader()}</div><div id="prjTabs">${stageTabs()}</div><div id="prjStagePane">${stageEditor()}</div>
     <p class="prj-editor-tip">각 단계는 저장 시 진행(예정) 업무에 독립적으로 등록됩니다. 체크리스트를 모두 체크하면 그 단계만 완료 처리됩니다.</p>
  </div>`,`<button type="button" class="btn" id="prjCancel">취소</button>${projectById(editor.id)?'<button type="button" class="btn danger" id="prjDelete">프로젝트 폐기</button>':''}<button type="button" class="btn primary" id="prjSave">프로젝트 저장</button>`,'project-editor-modal');
  const root=editorRoot();if(!root)return;
  bindEditorHeader(root);bindTabs($p('#prjTabs',root));bindStageControls($p('#prjStagePane',root));
  $p('#prjSave',root).onclick=()=>void saveEditor();
  showScheduleStatus();
  $p('#prjCancel',root).onclick=cancelEditor;
  $$p('[data-close]',root).forEach(btn=>btn.onclick=cancelEditor);
  const remove=$p('#prjDelete',root);if(remove)remove.onclick=()=>void deleteProject();
}
function openEditor(id=null,stageId=null){
  const existing=id?projectById(id):null;
  editor=existing?M.clone(existing):M.freshProject(todayISO());
  // 실제 담당자 목록에 혼자만 등록되어 있는 환경에서는 모든 단계와 체크항목 담당자 자동 고정.
  if(state.owners.length===1 && !editor.manager)editor.manager=state.owners[0];
  recalculateEditor();
  editor.stages.forEach(s=>{
    if(M.isCompleted(projectStageTask(editor.id,s.id)))return;
    s.checklist=M.checksForEdit(s,projectStageTask(editor.id,s.id));s.resources||=[];s.participants||=[];s.endType||='same';
    if(state.owners.length===1 && !s.participants.length)s.participants=[state.owners[0]];
    normalizeCheckAssignments(s);
  });
  activeStage=Math.max(0,stageId?editor.stages.findIndex(s=>s.id===stageId):0);
  dirty=false;pendingFiles=new Map();showEditor();
}
function cancelEditor(){if(saving)return;if(dirty&&!confirm('저장하지 않은 프로젝트 변경사항을 버릴까요?'))return;closeModal();editor=null;pendingFiles.clear();}
function normalizeCheckAssignments(step){
  const allowed=step.participants||[];
  (step.checklist||[]).forEach(item=>{
    if(allowed.length===1)item.owner=allowed[0];
    else if(!allowed.includes(item.owner))item.owner='';
  });
}
function refreshCheckOwners(root,step){
  normalizeCheckAssignments(step);
  $$p('[data-prj-check-row]',root).forEach(row=>{
    const check=step.checklist.find(c=>c.id===row.dataset.prjCheckRow);
    const select=$p('[data-check-field="owner"]',row);
    if(!check||!select)return;
    select.innerHTML=selectable(step.participants,check.owner,{placeholder:step.participants.length?'담당자 선택':'참여자 먼저 선택'});
    select.disabled=step.participants.length<=1;
    select.value=check.owner;
  });
}
function updateDateField(key,value){
  const map={projectStart:()=>{editor.start=value;},projectEnd:()=>{editor.end=value;},stageStart:()=>{editor.stages[activeStage].start=value;},stageEnd:()=>{editor.stages[activeStage].endDate=value;}};
  if(map[key])map[key]();
  if(map[key])recalculateEditor();
  else if(key.startsWith('check_')){
    const i=Number(key.split('_')[1]);const item=editor.stages[activeStage].checklist?.[i];if(item)item.dueDate=value;
  }
  setDirty();
}
function bindDateControls(root){
  $$p('[data-prj-field]',root).forEach(input=>{
    input.addEventListener('input',()=>{
      input.setCustomValidity('');input.classList.remove('is-invalid-v20');
      updateDateField(input.dataset.prjField,input.value);
    });
    const normalize=()=>{
      try{
        const formatted=M.date(input.value);
        input.value=fmtp(formatted);input.setCustomValidity('');input.classList.remove('is-invalid-v20');
        updateDateField(input.dataset.prjField,formatted);
        const picker=input.closest('.prj-date-wrap')?.querySelector('input[type="date"]');
        if(picker)picker.value=formatted;
      }catch(error){
        input.classList.add('is-invalid-v20');input.setCustomValidity(error.message);input.reportValidity();
      }
    };
    input.addEventListener('blur',normalize);
    input.addEventListener('change',normalize);
  });
  $$p('[data-date-for]',root).forEach(date=>{
    const text=date.closest('.prj-date-wrap')?.querySelector('[data-prj-field]');
    const btn=date.parentElement?.querySelector('button');
    if(btn)btn.onclick=event=>{
      event.preventDefault();event.stopPropagation();
      if(text){try{date.value=M.date(text.value);}catch{}}
      try{if(typeof date.showPicker==='function'){date.showPicker();return;}}catch{}
      try{date.focus({preventScroll:true});date.click();}catch{}
    };
    date.onchange=()=>{
      if(text){text.value=fmtp(date.value);text.setCustomValidity('');text.classList.remove('is-invalid-v20');}
      updateDateField(date.dataset.dateFor,date.value);
    };
  });
}
function bindEditorHeader(root){
  $$p('[data-project-root]',root).forEach(field=>field.addEventListener('input',()=>{
    editor[field.dataset.projectRoot]=field.value;
    if(field.dataset.projectRoot==='manager' && state.owners.length===1){
      recalculateEditor();
      editor.stages.forEach(s=>{if(M.isCompleted(projectStageTask(editor.id,s.id)))return;if(!s.participants.length)s.participants=[field.value];normalizeCheckAssignments(s);});
      renderStage();
    }
    setDirty();
  }));
  bindDateControls($p('#prjHeader',root));
}
function bindTabs(root){
  $$p('[data-step-tab]',root).forEach(button=>{
    const i=Number(button.dataset.stepTab);
    button.onclick=()=>{activeStage=i;recalculateEditor();renderTabs();renderStage();};
    button.ondragstart=e=>{e.dataTransfer.setData('text/plain',String(i));e.dataTransfer.effectAllowed='move';};
    button.ondragover=e=>{e.preventDefault();e.dataTransfer.dropEffect='move';};
    button.ondrop=e=>{e.preventDefault();const from=Number(e.dataTransfer.getData('text/plain'));if(M.moveStep(editor,from,i)){activeStage=i;recalculateEditor();setDirty();renderTabs();renderStage();}};
  });
  const add=$p('#prj-add-step',root);if(add)add.onclick=()=>{
    activeStage=M.addStep(editor);
    if(state.owners.length===1)editor.stages[activeStage].participants=[state.owners[0]];
    recalculateEditor();
    setDirty();renderTabs();renderStage();
  };
}
function bindStageControls(root){
  const s=editor.stages[activeStage];if(!s)return;
  for(const [id,key] of [['prj-relative-start-v177','relativeStartDays'],['prj-relative-end-v177','relativeEndDays']]){
    const input=$p('#'+id,root);
    if(input)input.oninput=()=>{s[key]=Number(input.value);recalculateEditor();setDirty();};
  }
  $$p('[data-stage-field]',root).forEach(input=>input.oninput=()=>{s[input.dataset.stageField]=input.value;setDirty();});
  $$p('[data-person]',root).forEach(input=>input.onchange=()=>{
    s.participants=state.owners.filter(o=>$$p('[data-person]:checked',root).some(x=>x.dataset.person===o));
    refreshCheckOwners(root,s);setDirty();
  });
  bindDateControls(root);
  $$p('input[name="prjEndMode"]',root).forEach(input=>input.onchange=()=>{if(input.checked){s.endType=input.value;recalculateEditor();setDirty();renderStage();}});
  const after=$p('#prj-after-days',root);if(after)after.oninput=()=>{s.afterDays=Number(after.value);recalculateEditor();setDirty();};
  const holidays=$p('#prj-count-holidays',root);if(holidays)holidays.onchange=()=>{s.includeHolidays=holidays.checked;recalculateEditor();setDirty();};
  const shift=$p('#prj-holiday-shift',root);if(shift)shift.onchange=()=>{s.holidayShift=shift.value;recalculateEditor();setDirty();};
  const addCheck=$p('#prj-add-check',root);if(addCheck)addCheck.onclick=()=>{
    s.checklist.push({id:projectUid('check'),text:'',owner:s.participants.length===1?s.participants[0]:'',dueDate:'',done:false});
    setDirty();renderStage();
  };
  $$p('[data-prj-check-row]',root).forEach(row=>{
    const check=s.checklist.find(c=>c.id===row.dataset.prjCheckRow);if(!check)return;
    $$p('[data-check-field]',row).forEach(input=>input.oninput=()=>{check[input.dataset.checkField]=input.value;setDirty();});
    const remove=$p('[data-remove-check]',row);if(remove)remove.onclick=()=>{s.checklist=s.checklist.filter(c=>c.id!==check.id);setDirty();renderStage();};
  });
  const file=$p('#prj-file-picker',root),addFile=$p('#prj-add-resource',root);
  if(file){file.onchange=e=>{for(const blob of Array.from(e.target.files||[])){
      const ref={id:projectUid('resource'),type:blob.type.startsWith('image/')?'image':'file',name:blob.name,size:blob.size,mimeType:blob.type||'application/octet-stream',pending:true};
      pendingFiles.set(ref.id,blob);s.resources.push(ref);setDirty();
    }renderStage();};}
  if(addFile&&file)addFile.onclick=()=>file.click();
  $$p('[data-remove-resource]',root).forEach(btn=>btn.onclick=()=>{const rid=btn.dataset.removeResource;pendingFiles.delete(rid);s.resources=s.resources.filter(r=>r.id!==rid);setDirty();renderStage();});
  $$p('[data-prj-open-resource]',root).forEach(btn=>btn.onclick=()=>{
    const ref=s.resources.find(r=>r.id===btn.dataset.prjOpenResource);if(ref)void openResource(ref);
  });
  $p('#prj-move-left',root).onclick=()=>moveActive(activeStage-1);
  $p('#prj-move-right',root).onclick=()=>moveActive(activeStage+1);
  $p('#prj-remove-stage',root).onclick=()=>{
    if(M.hasCompletionHistory(projectStageTask(editor.id,s.id))){alert('완료 이력이 있는 단계는 삭제할 수 없습니다. 원본 단계를 유지해 주세요.');return;}
    if(editor.stages.length<=1){alert('프로젝트에는 최소 1개 단계가 필요합니다.');return;}
    if(!confirm(`'${s.title||`${activeStage+1}단계`}'를 정말 삭제할까요?\n해당 단계의 수행업무와 체크리스트도 삭제되고 뒤의 단계가 앞으로 당겨집니다.`))return;
    s.resources.forEach(item=>pendingFiles.delete(item.id));
    M.removeStep(editor,activeStage,state.tasks);activeStage=Math.min(activeStage,editor.stages.length-1);recalculateEditor();setDirty();renderTabs();renderStage();
  };
  if(M.isCompleted(projectStageTask(editor.id,s.id))){
    const note=document.createElement('p');note.textContent='완료 단계의 수행 기록은 보호됩니다. 내용을 변경하려면 단계 상세에서 명시적으로 재개해 주세요.';root.prepend(note);
    $$p('input,select,textarea,button',root).filter(el=>!el.matches('[data-prj-open-resource],#prj-move-left,#prj-move-right')).forEach(el=>el.disabled=true);
  }
}
function moveActive(to){if(M.moveStep(editor,activeStage,to)){activeStage=to;recalculateEditor();setDirty();renderTabs();renderStage();}}
async function openResource(ref){
  try{
    if(ref.driveFileId){await window.cloudSync?.openDriveFile(ref.driveFileId,ref.name,ref.mimeType);}
    else if(ref.localFileId){await openOrDownloadLocalFile(ref.localFileId,ref.name,ref.mimeType);}
    else throw new Error('저장된 원본 자료 연결이 없습니다.');
  }catch(error){alert(error?.message||'진행자료를 열지 못했습니다.');}
}
async function uploadPendingResources(){
  for(const step of editor.stages){
    for(let i=0;i<step.resources.length;i++){
      const ref=step.resources[i];if(!ref.pending)continue;
      const file=pendingFiles.get(ref.id);if(!file)throw new Error(`${ref.name}의 파일을 다시 선택해 주세요.`);
      const cloud=window.cloudSync?.mode==='cloud';
      let saved;
      if(cloud){
        if(ref.type==='image'&&window.cloudSync.createImageBlock)saved=await window.cloudSync.createImageBlock(file,ref.id);
        else saved=await window.cloudSync.createFileBlock(file,ref.id);
      } else {
        const stored=await storeLocalFile(file,ref.id);
        saved={id:ref.id,type:ref.type,name:stored.name,mimeType:stored.mimeType,size:stored.size,localFileId:stored.id};
      }
      // 원본 File/Blob URL은 state/Firestore에 저장하지 않는다.
      const {data,objectUrl,...metadata}=saved;
      step.resources[i]=metadata;
      pendingFiles.delete(ref.id);
    }
  }
}
async function saveEditor(){
  if(saving||!editor)return;
  const button=$p('#prjSave');if(button){button.disabled=true;button.textContent='저장 중…';}
  saving=true;
  let before=null;
  try{
    // 정확하지 않은 날짜나 빈 단계명으로 원본 업로드를 시작하지 않는다.
    M.applyRelativeDates(editor,holidayCheck,state);
    M.reconcile(state,M.normalizeProject(editor,holidayCheck,state),holidayCheck);
    await uploadPendingResources();
    const project=M.normalizeProject(editor,holidayCheck,state);
    before={projects:M.clone(projectList()),tasks:M.clone(state.tasks)};
    const result=M.reconcile(state,project,holidayCheck);
    state.projects=result.projects;state.tasks=result.tasks;
    await saveState({reason:result.isNew?'프로젝트 생성':'프로젝트 단계/정보 수정'});
    dirty=false;editor=null;pendingFiles.clear();closeModal();
    renderProjectPage();renderTaskTable();renderHome();toast('프로젝트와 단계별 수행업무를 저장했습니다.');
  }catch(error){
    if(before){state.projects=before.projects;state.tasks=before.tasks;}
    console.error('프로젝트 저장 실패',error);
    alert(`프로젝트를 저장하지 못했습니다.\n${error?.message||error}`);
  }finally{saving=false;if(button&&button.isConnected){button.disabled=false;button.textContent='프로젝트 저장';}}
}
async function deleteProject(){
  if(saving||!editor)return;
  if(state.tasks.some(t=>t.projectId===editor.id&&M.hasCompletionHistory(t))){alert('완료 이력이 있는 프로젝트는 폐기할 수 없습니다. 원본 프로젝트를 유지해 주세요.');return;}
  if(!confirm(`'${editor.name}' 프로젝트와 연결된 모든 단계 업무를 삭제할까요?\n이 작업은 되돌릴 수 없습니다.`))return;
  const prior={projects:M.clone(projectList()),tasks:M.clone(state.tasks)};
  saving=true;
  try{
    const result=M.removeProject(state,editor.id);
    state.projects=result.projects;state.tasks=result.tasks;
    await saveState({reason:'프로젝트 폐기'});editor=null;dirty=false;closeModal();renderProjectPage();renderTaskTable();renderHome();toast('프로젝트를 삭제했습니다.');
  }catch(error){state.projects=prior.projects;state.tasks=prior.tasks;alert(`프로젝트 삭제 실패: ${error?.message||error}`);}
  finally{saving=false;}
}
function completionHistoryHtml(task){
  return (task.completionHistory||[]).map(record=>`<details class="completion-history"><summary>이전 완료일: ${escp(record.snapshot.actualComplete||'미기록')} · 재개: ${escp(record.reopenedAt)}</summary>${completionRecordHtml(record.snapshot)}</details>`).join('');
}
function completionRecordHtml(task){
  return `<p><b>${escp(task.name)}</b> · 담당자: ${escp(task.owner||'미정')}</p><p>일정: ${escp(task.start)} ~ ${escp(task.end)} · 완료일: ${escp(task.actualComplete||'미기록')}</p>
    <ul>${(task.checklist||[]).map(c=>`<li>${c.done?'☑':'☐'} ${escp(c.text)} · ${escp(c.owner||'')} · ${escp(c.dueDate||'')}</li>`).join('')}</ul>
    <p>관련 공문: ${escp(task.relatedDocumentTitle||'없음')}</p><p style="white-space:pre-wrap">${escp(task.notes||'')}</p><p style="white-space:pre-wrap">${escp((task.methodBlocks||[]).filter(b=>b.type==='text').map(b=>b.text||'').join('\n')||task.method||'')}</p>`;
}
function bindCompletionResources(record,container){
  if(!container)return;
  const refs=[...(record.projectResources||[]),...(record.attachments||[]),...(record.methodBlocks||[]).filter(b=>b.type!=='text')];
  for(const ref of refs){
    const button=document.createElement('button');button.type='button';button.className='btn';button.textContent=ref.name||ref.caption||'첨부자료';
    button.onclick=()=>void openResource(ref);container.appendChild(button);
  }
}
function bindHistoryResources(task){
  const body=$p('#modalRoot .modal-body');if(!body)return;
  for(const [i,record] of (task.completionHistory||[]).entries())bindCompletionResources(record.snapshot,$$p('.completion-history',body)[i]);
}
async function reopenTaskWithHistory(task,button=null){
  if(!M.isCompleted(task)||button?.disabled)return false;
  if(!confirm('이전 완료 기록을 보존하고 이 업무를 진행 상태로 재개할까요?\n체크리스트와 첨부자료는 유지됩니다.'))return false;
  const before=M.clone(task),project=projectById(task.projectId),projectBefore=project?M.clone(project):null;
  const view=state.settings?.taskListViewV35;
  if(button)button.disabled=true;
  try{
    M.reopenTask(task);
    if(project)project.workflowClosedAtV174=null;
    state.settings||={};state.settings.taskListViewV35='active';
    recalcLinks();
    await saveState({reason:'완료 이력 보존 · 명시적 업무 재개'});
    closeModal();
    if(typeof syncTaskViewUiV35==='function')syncTaskViewUiV35();
    renderTaskTable();renderHome();renderProjectPage();
    if(typeof applySidebarVisibilityV33==='function')applySidebarVisibilityV33();
    toast('이전 완료 기록을 보존하고 업무를 재개했습니다.');
    return true;
  }catch(error){
    for(const key of Object.keys(task))delete task[key];Object.assign(task,before);
    if(project){for(const key of Object.keys(project))delete project[key];Object.assign(project,projectBefore);}
    state.settings||={};if(view===undefined)delete state.settings.taskListViewV35;else state.settings.taskListViewV35=view;
    recalcLinks();toast(error?.message||'재개 내용을 저장하지 못했습니다.');return false;
  }finally{if(button?.isConnected)button.disabled=false;}
}
function completedTaskModal(task){
  modal(escp(task.name),`<p>완료 기록은 읽기 전용입니다. 수정하려면 먼저 명시적으로 재개해 주세요.</p>${completionRecordHtml(task)}${completionHistoryHtml(task)}`,
    '<button type="button" class="btn" id="duplicateTaskV119">업무 복제</button><button type="button" class="btn" id="prjReopenTask">이력 보존 후 재개</button><button class="btn" data-close>닫기</button>','small');
  bindCompletionResources(task,$p('#modalRoot .modal-body'));
  $p('#duplicateTaskV119').onclick=()=>void duplicateTaskV119(task.id);
  $p('#prjReopenTask').onclick=event=>void reopenTaskWithHistory(task,event.currentTarget);
  bindHistoryResources(task);
}
function projectTaskModal(task){
  const project=projectById(task.projectId),i=project?.stages.findIndex(s=>s.id===task.projectStageId)??-1;
  const stage=i>=0?project.stages[i]:null;
  if(!stage)return false;
  const checks=task.checklist||[];
  const completed=M.isCompleted(task);
  const body=`<div class="prj-task-view"><p><b>${escp(project.name)}</b> · ${i+1}단계 · ${escp(task.start)} ~ ${escp(task.end||'')}</p>
    <div id="prj-task-status" class="prj-task-status">${checks.length?`${checks.filter(c=>c.done).length}/${checks.length}개 완료`:'체크리스트 없음'}</div>
    ${checks.length?`<div class="prj-task-checks">${checks.map(c=>`<label class="prj-task-check ${c.done?'checked':''}"><input type="checkbox" data-prj-complete="${escp(c.id)}" ${c.done?'checked':''}><span><b>${escp(c.text)}</b><small>담당자: ${escp(c.owner||'미정')} · 마감일: ${escp(c.dueDate||'미정')}</small></span></label>`).join('')}</div>`:'<p class="muted">체크리스트를 추가하면 모두 완료 시 이 단계만 자동 완료됩니다. 체크항목이 없는 단계는 수동으로 완료할 수 있습니다.</p>'}
    <h4>진행자료</h4><div class="prj-task-resources">${(stage.resources||[]).map(r=>`<button type="button" class="prj-soft-btn" data-task-resource="${escp(r.id)}">${escp(r.name)}</button>`).join('')||'<small>등록된 진행자료 없음</small>'}</div>
    <label class="prj-soft-btn prj-stage-add-resource-v175">＋ 관련 자료 추가<input type="file" id="prjTaskAddResourceV175" multiple hidden></label>
    <small class="prj-resource-hint-v175">현재 단계에만 파일이 추가되며 다른 단계에는 영향을 주지 않습니다.</small>
    </div>`;
  const footer=`<button type="button" class="btn" id="prjEditFromTask">프로젝트 수정</button>${completed?'<button type="button" class="btn" id="prjReopenTask">이력 보존 후 재개</button>':!checks.length?'<button type="button" class="btn primary" id="prjManualComplete">이 단계 완료</button>':''}<button type="button" class="btn" data-close>닫기</button>`;
  modal(escp(task.name),body+completionHistoryHtml(task),footer,'small prj-task-modal');
  bindHistoryResources(task);
  const reopen=$p('#prjReopenTask');if(reopen)reopen.onclick=event=>void reopenTaskWithHistory(task,event.currentTarget);
  if(completed){
    $$p('[data-prj-complete],#prjTaskAddResourceV175').forEach(el=>el.disabled=true);
    const note=document.createElement('p');note.textContent='완료 단계는 읽기 전용입니다. 체크리스트·자료를 변경하려면 이력 보존 후 재개하세요.';$p('#modalRoot .modal-body').prepend(note);
  }
  $p('#prjEditFromTask').onclick=()=>openEditor(project.id,stage.id);
  $$p('[data-task-resource]').forEach(b=>b.onclick=()=>{const ref=stage.resources.find(r=>r.id===b.dataset.taskResource);if(ref)void openResource(ref);});
  const addResource=$p('#prjTaskAddResourceV175');if(addResource)addResource.onchange=async event=>{
    if(M.isCompleted(task))return;
    const files=[...(event.target.files||[])];if(!files.length)return;
    addResource.disabled=true;
    const savedBefore=M.clone(stage.resources||[]);
    const oldTaskFiles=M.clone(task.projectResources||[]);
    try{
      for(const file of files){
        if(Number(file.size||0)<=0||Number(file.size)>50*1024*1024)throw new Error('파일은 1바이트 이상, 50MB 이하만 추가할 수 있습니다.');
        const rid=projectUid('resource');const type=file.type?.startsWith('image/')?'image':'file';
        let stored;
        if(window.cloudSync?.mode==='cloud'){
          stored=type==='image'&&window.cloudSync.createImageBlock
            ?await window.cloudSync.createImageBlock(file,rid)
            :await window.cloudSync.createFileBlock(file,rid);
        }else{
          const local=await storeLocalFile(file,rid);
          stored={id:rid,type,name:local.name,mimeType:local.mimeType,size:local.size,localFileId:local.id};
        }
        const {data,objectUrl,previewUrl,...meta}=stored;
        stage.resources||=[];stage.resources.push({...meta,id:rid,type,name:file.name});
      }
      task.projectResources=M.clone(stage.resources);
      await saveState({reason:'프로젝트 단계 진행자료 추가'});
      renderTaskTable();renderProjectPage();projectTaskModal(task);
      toast(`${files.length}개 자료를 현재 단계에 추가했습니다.`);
    }catch(error){
      stage.resources=savedBefore;task.projectResources=oldTaskFiles;
      console.error('프로젝트 단계 파일 업로드 실패',error);
      alert(`진행자료를 저장하지 못했습니다.\n${error?.message||error}`);
    }finally{addResource.disabled=false;}
  };
  $$p('[data-prj-complete]').forEach(input=>input.onchange=()=>{
    if(!M.setCheck(task,input.dataset.prjComplete,input.checked,todayISO())){input.checked=Boolean(task.checklist.find(c=>c.id===input.dataset.prjComplete)?.done);return;}
    input.closest('.prj-task-check')?.classList.toggle('checked',input.checked);
    const status=$p('#prj-task-status');if(status)status.textContent=`${task.checklist.filter(c=>c.done).length}/${task.checklist.length}개 완료 · ${effectiveStatus(task)==='done'?'단계 완료':'진행 중'}`;
    // 모달/체크 입력은 재생성하지 않아 빠른 다중 체크가 누락되지 않는다.
    void saveState({reason:'프로젝트 단계 체크리스트 변경'}).catch(error=>{console.error(error);toast('체크리스트 저장 실패 · 다시 확인해 주세요.');});
    renderTaskTable();renderHome();renderProjectPage();
  });
  const manual=$p('#prjManualComplete');if(manual)manual.onclick=()=>{
    if(M.isCompleted(task))return;
    task.status='done';task.actualComplete=todayISO();
    void saveState({reason:'프로젝트 단계 수동 완료 변경'}).catch(error=>{console.error(error);toast('단계 상태 저장 실패');});
    renderTaskTable();renderHome();renderProjectPage();projectTaskModal(task);
  };
  return true;
}
// 기존 페이지의 모듈과 연결: 프로젝트 업무만 전용 모달을 사용하고 나머지는 그대로 유지.
const baseOpenChecklist=openChecklist;
openChecklist=function(id){
  const task=state.tasks.find(t=>t.id===id);
  if(task?.projectId){projectTaskModal(task);return;}
  if(M.isCompleted(task)){completedTaskModal(task);return;}
  const result=baseOpenChecklist(id);
  if(task?.completionHistory?.length){$p('#modalRoot .modal-body')?.insertAdjacentHTML('beforeend',completionHistoryHtml(task));bindHistoryResources(task);}
  return result;
};
const baseOpenTaskForm=openTaskForm;
openTaskForm=function(id=null){
  const task=id?state.tasks.find(t=>t.id===id):null;
  if(task?.projectId){openEditor(task.projectId,task.projectStageId);return;}
  if(M.isCompleted(task)){completedTaskModal(task);return;}
  const result=baseOpenTaskForm(id);
  const save=$p('#saveTask'),original=save?.onclick;
  if(save)save.onclick=function(...args){
    if(M.isCompleted(state.tasks.find(t=>t.id===id))){toast('완료 기록은 보호됩니다. 이력 보존 후 재개해 주세요.');return;}
    return original?.apply(this,args);
  };
  return result;
};
const baseShowPage=showPage;
showPage=function(id){
  if(id==='projectPage')ensurePage();
  const result=baseShowPage(id);
  if(id==='projectPage'){renderProjectPage();$$p('.side .navbtn').forEach(b=>b.classList.toggle('active',b.dataset.page==='projectPage'));}
  else syncProjectVisibility();
  return result;
};
const baseRenderTaskTable=renderTaskTable;
renderTaskTable=function(){const out=baseRenderTaskTable();if($p('#projectPage.active'))renderProjectPage();return out;};
const baseRenderSettings=renderSettings;
renderSettings=function(){const result=baseRenderSettings();ensureSettingsControl();return result;};
// 원격 업데이트 때도 프로젝트 화면은 최신 단계 상태를 반영한다.
if(typeof NAV_ITEMS_V33==='object')NAV_ITEMS_V33.projectPage='프로젝트';
if(typeof NAV_ITEMS_LOCAL_V12==='object')NAV_ITEMS_LOCAL_V12.projectPage='프로젝트';
// 기존 화면/설정의 메뉴 개수 계산이 나중에 다시 실행돼도 신규 탭이 사라지지 않게 한다.
if(typeof applyNavButtonsLocalV12==='function'){
  const baseProjectSidebar=applyNavButtonsLocalV12;
  applyNavButtonsLocalV12=function(...args){const result=baseProjectSidebar.apply(this,args);syncProjectVisibility();return result;};
}
ensurePage();
ensureSettingsControl();
// theme 버튼은 이미지를 별도 요소로 겹치지 않고 nav-icon의 background만 사용한다.
const observer=new MutationObserver(()=>applyProjectThemeIcon());
observer.observe(document.body,{attributes:true,attributeFilter:['data-v7-theme']});

// v1.8.1: Project/library UI improvements. Kept within project-ui.js so only the
// changed file needs to be uploaded on the existing GitHub Pages deployment.
function installLibraryAndProjectEnhancementsV181(){
  const html=escp;
  const safeDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))?String(s):'';
  const templateById=id=>(state.templates||[]).find(t=>String(t.id)===String(id));
  const isProjectTemplate=t=>Boolean(t&&(t.libraryKindV175==='project'||(t.linkedSteps||[]).length));
  const isHoliday=s=>{
    const date=safeDate(s);if(!date)return false;
    const d=new Date(date+'T12:00:00');
    return d.getDay()===0||d.getDay()===6||(state.holidays||[]).some(h=>h.date===date||h.day===date);
  };
  const shiftDate=(iso,shift)=>{
    if(!safeDate(iso)||!['prev','next'].includes(shift))return iso;
    let d=new Date(iso+'T12:00:00'),count=0;
    while(isHoliday(d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'))&&count++<370){
      d.setDate(d.getDate()+(shift==='prev'?-1:1));
    }
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  };
  function openSource(ref){
    if(ref?.driveFileId && window.cloudSync?.openDriveFile)
      return void window.cloudSync.openDriveFile(ref.driveFileId,ref.name||'자료',ref.mimeType||'');
    if(ref?.localFileId && typeof openOrDownloadLocalFile==='function')
      return void openOrDownloadLocalFile(ref.localFileId,ref.name||'자료',ref.mimeType||'');
    if(ref?.data && /^data:image\//.test(ref.data)){
      const w=window.open();if(w)w.document.write('<img alt="첨부 이미지" style="max-width:100%" src="'+html(ref.data)+'">');
      return;
    }
    alert('연결된 파일 원본이 없거나 접근할 수 없습니다.');
  }
  function resourceButtons(list,stage){
    return (list||[]).map((ref,index)=>'<button type="button" class="prj-soft-btn" data-library-resource-v181="'+html(stage+':'+index)+'">'+html(ref.name||ref.title||'첨부자료 '+(index+1))+'</button>').join('');
  }
  function methodMarkup(template){
    const blocks=template.methodBlocks?.length?template.methodBlocks:template.method?[{type:'text',text:template.method}]:[];
    const all=blocks.map((b,i)=>{
      if(b.type==='image'){
        const src=b.data&&/^data:image\//.test(b.data)?b.data: b.previewUrl&&/^https:\/\//.test(b.previewUrl)?b.previewUrl:'';
        return '<div class="library-method-block-v181">'+(src?'<img class="library-method-image-v181" src="'+html(src)+'" alt="'+html(b.name||'업무 사진')+'">':'')+
          '<button class="prj-soft-btn" type="button" data-library-method-v181="'+i+'">사진'+(b.name?' · '+html(b.name):'')+' 열기</button></div>';
      }
      return '<div class="library-method-block-v181" style="white-space:pre-wrap">'+html(b.text||b.content||b.value||'')+'</div>';
    }).join('');
    return all||'<p class="muted">등록된 업무 수행방법이 없습니다.</p>';
  }
  function showProjectLibraryV181(template,{methodOnly=false}={}){
    if(!template)return alert('연결된 프로젝트 라이브러리를 찾지 못했습니다.');
    const steps=[template,...(template.linkedSteps||[])];
    const cards=steps.map((s,i)=>{
      const checklist=(s.checklist||[]).map(c=>'<label class="library-check-static-v181"><input type="checkbox" disabled> '+html(typeof c==='string'?c:c.text||'')+'</label>').join('');
      const rule=i?'<span>상위 업무 기준 · '+html(s.startOffset??s.startOffsetDays??s.startAfterDays??s.afterDays??'설정값 확인')+'일 후</span>':
        '<span>프로젝트 첫 단계</span>';
      return '<article class="library-stage-card-v181"><div class="library-stage-head-v181"><span class="library-stage-label-v181">'+(i+1)+'단계 · 예정</span><b>'+html(s.title||s.name||s.taskName||(i===0?template.name:'단계 '+(i+1)))+'</b></div><div class="library-stage-fields-v181">'+
        '<div><small>담당자 / 참여자</small><strong>'+html((s.participants||[]).join(', ')||s.owner||template.owner||template.manager||'-')+'</strong></div>'+
        '<div><small>예정 일정 규칙</small><strong>'+rule+'</strong></div></div>'+
        (checklist?'<h5>체크리스트</h5>'+checklist:'')+
        ((s.attachments||s.resources||[]).length?'<h5>관련 양식 / 자료</h5>'+resourceButtons(s.attachments||s.resources,i):'')+'</article>';
    }).join('');
    const body='<div class="library-project-full-v181" id="libraryProjectDetailV177">'+
      (methodOnly?'':'<section><h3>단계별 수행내용</h3><div class="library-stage-grid-v181">'+cards+'</div></section>')+
      '<section class="library-project-method-v181"><h3>업무 수행방법</h3>'+methodMarkup(template)+'</section>'+
      '<section class="library-project-attachments-v181"><h3>첨부자료 (양식)</h3>'+
      (template.attachments?.length?resourceButtons(template.attachments,'root'):'<p class="muted">등록된 첨부자료가 없습니다.</p>')+'</section></div>';
    const footer='<button type="button" class="btn" id="libraryProjectCloseV181">닫기</button>'+
      (methodOnly?'':'<button type="button" class="btn" id="libraryProjectEditV181">라이브러리 수정</button><button type="button" class="btn primary" id="libraryProjectRegisterV181">진행업무 등록 화면</button>');
    modal(methodOnly?'업무수행방법 · '+html(template.name||'프로젝트'):html(template.name||'프로젝트 상세'),body,footer,'library-project-view-v181');
    $p('#libraryProjectCloseV181').onclick=()=>closeModal();
    const edit=$p('#libraryProjectEditV181');if(edit)edit.onclick=()=>openDbForm(template.id);
    const reg=$p('#libraryProjectRegisterV181');if(reg)reg.onclick=()=>{
      // Preserve the original registration workflow; no task creation is invented here.
      if(typeof originalLibraryDetailV181==='function')originalLibraryDetailV181('root|'+template.id);
    };
    $$p('[data-library-resource-v181]').forEach(btn=>btn.onclick=()=>{
      const [slot,idx]=btn.dataset.libraryResourceV181.split(':');const stage=slot==='root'?null:steps[Number(slot)];
      const refs=slot==='root'?template.attachments:(stage?.attachments||stage?.resources||[]);
      openSource(refs?.[Number(idx)]);
    });
    $$p('[data-library-method-v181]').forEach(btn=>btn.onclick=()=>openSource(template.methodBlocks?.[Number(btn.dataset.libraryMethodV181)]));
  }
  // Retain the legacy renderer as an escape hatch for registering a project.
  const originalLibraryDetailV181=typeof openDbDetailV6==='function'?openDbDetailV6:null;
  if(originalLibraryDetailV181){
    openDbDetailV6=function(ref,...args){
      const parts=String(ref||'').split('|'),root=parts[0]==='root'?templateById(parts[1]):null;
      if(isProjectTemplate(root)){showProjectLibraryV181(root);return;}
      return originalLibraryDetailV181.call(this,ref,...args);
    };
  }
  // The project list is re-rendered by workflow-reform-v17.js. Patch its newly
  // inserted footer in place; original close/edit handlers remain delegated.
  function decorateProjectActions(){
    $$p('#workflowProjectListV17 .workflow-project-card-v17').forEach(card=>{
      const actions=$p('.workflow-project-actions-v174',card);
      if(!actions||actions.dataset.projectActionsV181)return;
      const title=$p('[data-workflow-expand]',card);
      const id=title?.dataset.workflowExpand,project=projectById(id);
      if(!project)return;
      actions.dataset.projectActionsV181='1';
      const btn=document.createElement('button');btn.type='button';btn.className='workflow-project-method-v181';
      btn.textContent='업무수행방법';btn.onclick=event=>{
        event.stopPropagation();const current=projectById(id),tpl=templateById(current?.libraryTemplateIdV175);
        if(tpl)showProjectLibraryV181(tpl,{methodOnly:true});
        else alert('이 프로젝트에 연결된 라이브러리 수행방법이 없습니다.');
      };
      const edit=$p('[data-workflow-project-edit]',actions),close=$p('[data-workflow-project-close]',actions);
      actions.replaceChildren(btn,...[edit,close].filter(Boolean));
      if(edit)edit.textContent='프로젝트 수정';
      if(close)close.textContent='프로젝트 완료(종료)';
    });
  }
  // Editor buttons are limited to Save / Cancel / Delete. Do not delete inputs
  // or the original save handler, which retains versioning and upload behavior.
  function tidyLibraryForm(){
    const dlg=$p('#modalRoot .db-form-modal');if(!dlg)return;
    const footer=$p('.modal-foot',dlg);if(footer){
      $$p('button',footer).forEach(b=>{
        const t=(b.textContent||'').trim();
        if(!/^(저장|취소|삭제)$/.test(t)&&!b.hasAttribute('data-close'))b.remove();
      });
    }
    // Make checklist text fields fill their available grid/flex space.
    $$p('fieldset',dlg).forEach(fs=>{
      const legend=$p('legend',fs);if(!legend||!legend.textContent.includes('체크리스트'))return;
      $$p('input[type="text"]',fs).forEach(input=>{
        input.style.minWidth='0';input.style.width='100%';input.style.maxWidth='none';
        input.style.boxSizing='border-box';
        const parent=input.parentElement;
        if(parent && parent.children.length===1){parent.style.flex='1 1 auto';parent.style.minWidth='0';}
      });
    });
  }
  // Add the missing holiday handling option to ordinary library schedules.
  function installHolidayShiftField(templateId){
    const dlg=$p('#modalRoot .db-form-modal');if(!dlg||$p('#libraryHolidayShiftV181',dlg))return;
    const all=[...dlg.querySelectorAll('fieldset')];
    const schedule=all.find(fs=>/수행 주기|수행주기|반복 주기/.test(fs.querySelector('legend')?.textContent||''));
    const anchor=schedule||dlg.querySelector('#dfAutoSchedule')?.closest('fieldset');
    const field=document.createElement('div');field.id='libraryHolidayShiftV181';field.className='library-holiday-shift-v181';
    field.innerHTML='<label for="libraryHolidaySelectV181"><b>업무 종료일이 공휴일·주말인 경우</b></label><select id="libraryHolidaySelectV181"><option value="keep">그대로 진행</option><option value="prev">이전 근무일</option><option value="next">다음 근무일</option></select><p class="muted">1일 업무는 시작일과 종료일을 함께 이동합니다. 진행업무 등록 시 적용됩니다.</p>';
    if(anchor)anchor.insertAdjacentElement('afterend',field);else dlg.querySelector('.modal-body')?.appendChild(field);
    const existing=templateById(templateId);const select=$p('#libraryHolidaySelectV181',field);
    select.value=existing?.holidayShiftV181||'keep';
    const button=$p('#saveDb',dlg);if(!button||button.dataset.holidaySaveV181)return;
    button.dataset.holidaySaveV181='1';
    const base=button.onclick;
    if(typeof base==='function')button.onclick=async function(event){
      const value=select.value,oldIds=new Set((state.templates||[]).map(t=>t.id));
      const result=await base.call(this,event);
      const saved=templateById(templateId)||(state.templates||[]).find(t=>!oldIds.has(t.id));
      if(saved&&!isProjectTemplate(saved)&&saved.holidayShiftV181!==value){
        saved.holidayShiftV181=value;
        await saveState({reason:'라이브러리 휴일 처리 규칙 저장'});
      }
      return result;
    };
  }
  const baseLibraryEditorV181=typeof openDbForm==='function'?openDbForm:null;
  if(baseLibraryEditorV181){
    openDbForm=function(...args){
      const result=baseLibraryEditorV181.apply(this,args);
      tidyLibraryForm();installHolidayShiftField(args[0]);return result;
    };
  }
  const style=document.createElement('style');style.id='projectLibraryStyleV181';
  style.textContent=`
    .workflow-project-actions-v174{display:flex;flex-wrap:wrap;gap:8px}
    .workflow-project-method-v181{background:#e7effa;border:1px solid #d1e0f5;color:#254875;border-radius:8px;padding:9px 12px;font-weight:650;cursor:pointer}
    .library-project-full-v181{padding:4px 0 10px;color:var(--text,#263b56)}
    .library-project-full-v181 section{margin:0 0 22px}
    .library-project-full-v181 h3{margin:8px 0 14px;font-size:1rem}
    .library-stage-grid-v181{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
    .library-stage-card-v181{border:1px solid #d2dfef;border-radius:17px;padding:16px;min-width:0;background:var(--surface,#fff)}
    .library-stage-head-v181{display:flex;align-items:flex-start;flex-direction:column;gap:7px;margin-bottom:14px}
    .library-stage-label-v181{border-radius:14px;background:#edf1f5;padding:4px 9px;font-size:.77rem;font-weight:650}
    .library-stage-head-v181 b{font-size:.94rem;overflow-wrap:anywhere}
    .library-stage-fields-v181{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}
    .library-stage-fields-v181>div{border:1px solid #d8e2ed;border-radius:10px;padding:11px;display:flex;flex-direction:column;gap:4px;min-width:0}
    .library-stage-fields-v181 small{color:#738299;font-size:.72rem}
    .library-stage-fields-v181 strong{overflow-wrap:anywhere;font-size:.82rem}
    .library-stage-card-v181 h5{margin:16px 0 7px;font-size:.85rem}
    .library-check-static-v181{display:block;padding:8px 10px;border-radius:9px;background:#f4f6f9;margin-bottom:4px}
    .library-project-method-v181,.library-project-attachments-v181{border-top:1px solid #dae3ed;padding-top:15px}
    .library-method-block-v181{margin:8px 0;line-height:1.6;overflow-wrap:anywhere}
    .library-method-image-v181{display:block;max-width:100%;max-height:480px;object-fit:contain;border-radius:10px;margin:5px 0}
    .library-holiday-shift-v181{padding:13px;border:1px solid #d8e2ed;border-radius:13px;margin:12px 0}
    .library-holiday-shift-v181 select{display:block;width:min(100%,340px);margin:8px 0;padding:9px;border:1px solid #cbd8e8;border-radius:8px}
    #modalRoot .db-form-modal fieldset input[type="text"]{box-sizing:border-box;max-width:100%}
    @media(max-width:720px){.library-stage-grid-v181,.library-stage-fields-v181{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);
  const projectRoot=$p('#taskListPage')||document.body;
  let pending=false;
  const observer=new MutationObserver(()=>{
    if(pending)return;pending=true;
    queueMicrotask(()=>{pending=false;decorateProjectActions();tidyLibraryForm();});
  });
  observer.observe(projectRoot,{childList:true,subtree:true});
  const modalRoot=$p('#modalRoot');if(modalRoot&&modalRoot!==projectRoot)observer.observe(modalRoot,{childList:true,subtree:true});
  decorateProjectActions();tidyLibraryForm();
  window.WMProjectEnhancementsV181={showProjectLibrary:showProjectLibraryV181,shiftDate,decorateProjectActions};
}
installLibraryAndProjectEnhancementsV181();


// v1.8.1: Conservative rolling scheduler for *manually registered* library
// general tasks and the end-date override of an existing repeated occurrence.
// It does not re-schedule completed work or legacy linked/project task chains.
function installRollingRecurrencesV181(){
  const rules=window.WMRecurrenceRules,dates=window.WMDateOnly;
  if(!rules||!dates)throw new Error('반복 날짜 계산 모듈을 불러오지 못했습니다.');
  const parseDate=s=>dates.isValid(s)?dates.normalize(s):'';
  const isoDate=d=>d.toISOString().slice(0,10);
  const {freqFrom,scheduleKind,configuredWeekDay,configuredMonths,addMonths}=rules;
  const dueShift=(s,policy)=>dates.shiftBusinessDay(s,policy||'keep',{
    holidays:(state.holidays||[]).map(h=>h.date||h.day)
  },{maxIterations:365});
  let diagnostics=[];
  const reported=new Set();
  function report(root,issue){
    diagnostics.push({rootId:root.id,code:issue.code||'INVALID_RULE',message:issue.message});
    const key=`${root.id}:${issue.code}:${issue.message}`;
    if(!reported.has(key)){
      reported.add(key);
      console.warn('반복 일정 설정 확인:',issue.code||'INVALID_RULE',issue.message);
    }
  }
  const templateFor=task=>(state.templates||[]).find(t=>String(t.id)===String(task.dbManualRootTemplateId||task.dbSourceTemplateId||task.autoSourceTemplateId||task.templateId));
  const completed=task=>task.status==='done'||Boolean(task.actualComplete);
  const sourceRoot=task=>task.repeatOriginV181||task.id;
  const seriesRoot=task=>{
    const origin=sourceRoot(task);
    return (state.tasks||[]).find(t=>t.id===origin)||task;
  };
  let pendingEnd=null;
  let registrationSnapshotV181=null;
  document.addEventListener('click',event=>{
    const button=event.target?.closest?.('button');
    if(!button)return;
    const text=(button.textContent||'').replace(/\s+/g,'');
    const source=button.closest('#dbPage,#modalRoot');
    if(source && /(진행업무|업무).*등록|등록.*(진행업무|업무)/.test(text)){
      registrationSnapshotV181=new Set((state.tasks||[]).map(t=>t.id));
    }
  },true);
  // Select whether a recurring task has an end date, while keeping existing
  // native task-form fields intact. Applies to newly created and edited tasks.
  function attachRecurrenceEndChoice(id){
    const dlg=document.querySelector('#modalRoot .modal');
    if(!dlg||dlg.classList.contains('project-editor-modal')||dlg.querySelector('#taskRepeatChoiceV181'))return;
    const task=id?(state.tasks||[]).find(t=>t.id===id):null;
    if(task?.projectId)return;
    const schedules=[...dlg.querySelectorAll('label,legend')].filter(x=>/반복|주기/.test(x.textContent||''));
    if(!schedules.length && !task?.repeat && !task?.repeatOriginV181 && !task?.seriesId)return;
    const root=task?seriesRoot(task):null;
    const existing=root?.repeatUntilV181||'';
    const box=document.createElement('div');box.id='taskRepeatChoiceV181';box.className='library-holiday-shift-v181';
    box.innerHTML='<label><input type="checkbox" id="taskRepeatHasEndV181" '+(existing?'checked':'')+'> 반복 종료일 설정</label>'+
      '<input type="date" id="taskRepeatEndDateV181" value="'+existing+'" '+(existing?'':'disabled')+' style="margin:9px 8px;padding:8px;border:1px solid #cad6e5;border-radius:8px">'+
      '<p class="muted">종료일을 지정하지 않으면 3개월 앞까지 일정이 생성되며, 이후에도 필요할 때 연장됩니다.</p>';
    const foot=dlg.querySelector('.modal-foot');if(foot)foot.insertAdjacentElement('beforebegin',box);
    else dlg.querySelector('.modal-body')?.appendChild(box);
    const enabled=box.querySelector('#taskRepeatHasEndV181'),end=box.querySelector('#taskRepeatEndDateV181');
    enabled.onchange=()=>{end.disabled=!enabled.checked;};
    // The application's original Save handler calls saveState; only that actual
    // save will apply this choice. Closing/cancelling does not mutate state.
    dlg.addEventListener('click',event=>{
      const b=event.target.closest('button');if(!b||!(b.id==='saveTask'||b.id==='saveTaskBtn'||/^(저장|수정 저장)$/.test((b.textContent||'').trim())))return;
      if(enabled.checked&&!parseDate(end.value)){
        event.preventDefault();event.stopImmediatePropagation();alert('반복 종료일을 선택해 주세요.');return;
      }
      pendingEnd={taskId:id||'',until:enabled.checked?end.value:null};
    },true);
  }
  const baseTaskFormV181=typeof openTaskForm==='function'?openTaskForm:null;
  if(baseTaskFormV181){
    openTaskForm=function(id=null,...args){
      const result=baseTaskFormV181.call(this,id,...args);
      attachRecurrenceEndChoice(id);return result;
    };
  }
  function applyEndChoice(){
    if(!pendingEnd)return false;
    const {taskId,until}=pendingEnd;pendingEnd=null;
    let target=(state.tasks||[]).find(t=>t.id===taskId);
    if(!target && !taskId){
      const list=(state.tasks||[]).filter(t=>!t.projectId&&(t.repeat||t.repeatOriginV181)).slice(-1);
      target=list[0];
    }
    if(!target)return false;
    const root=seriesRoot(target);root.repeatUntilV181=until||'';
    let dirty=true;
    // An explicit end choice governs future additions only. Existing occurrences,
    // including manually moved/reopened ones, are never pruned or rewritten here.
    return dirty;
  }
  function adjustHolidayIfNeeded(task,template){
    const policy=template?.holidayShiftV181||'keep';
    if(task.holidayAppliedV181||!['prev','next'].includes(policy)||!parseDate(task.end||task.start)||M.hasCompletionHistory(task))return false;
    const oldEnd=task.end||task.start,newEnd=dueShift(oldEnd,policy);
    task.holidayAppliedV181=true;
    if(newEnd===oldEnd)return true;
    if(task.start===oldEnd)task.start=newEnd;
    if(task.end)task.end=newEnd;
    if(task.deadline===oldEnd)task.deadline=newEnd;
    return true;
  }
  const identity=window.WMRecurrenceIdentity;
  if(!identity)throw new Error('반복 생성키 모듈을 불러오지 못했습니다.');
  function recurrenceContext(){
    const cloud=window.cloudSync;
    if(cloud?.mode==='cloud'){
      const context=cloud.recurrenceContext;
      if(!context?.ready||!context.scope)throw new Error('초기 동기화가 완료될 때까지 반복 보충을 기다립니다.');
      return context;
    }
    return {scope:`local:${window.__workspaceLocalStateKey||'default'}`,locks:[],ready:true};
  }
  function planOccurrences(){
    const context=recurrenceContext();
    const proposal=identity.plan(state,{...context,today:isoDate(new Date())});
    diagnostics=[];
    for(const issue of [...proposal.warnings,...proposal.conflicts])report({id:issue.rootId},issue);
    return proposal;
  }
  function applyOccurrences(proposal){return identity.apply(state,proposal,{...recurrenceContext(),id:projectUid});}
  function ensureOccurrences(){return applyOccurrences(planOccurrences()).added;}
  const baseSaveV181=saveState;
  let running=null,status={phase:'idle',added:0,mapped:0},recoveryRequired=false;
  function execute(args,command){
    if(recoveryRequired)return Promise.reject(new Error('반복 저장 결과 확인이 필요합니다. 다시 동기화한 뒤 진행해 주세요.'));
    if(running)return command?running.then(()=>execute(args,true)):running;
    const job=(async()=>{
      const context=recurrenceContext(),before=M.clone(state);
      let applied,after;
      try{
        if(command){
          applyEndChoice();
          if(registrationSnapshotV181){
            for(const task of state.tasks||[]){
              if(registrationSnapshotV181.has(task.id)||task.projectId||task.parentAutoRootId||task.link||completed(task))continue;
              const tpl=templateFor(task);
              if(tpl&&tpl.libraryKindV175!=='project'&&!tpl.linkedSteps?.length)adjustHolidayIfNeeded(task,tpl);
            }
            registrationSnapshotV181=null;
          }
        }
        const proposal=planOccurrences();
        const offline=window.cloudSync?.mode==='cloud'&&typeof navigator!=='undefined'&&!navigator.onLine;
        status={phase:'planned',planned:proposal.additions.length};
        applied=offline?{added:0,mapped:0,reserved:0}:applyOccurrences(proposal);
        after=JSON.stringify(state);
        status={phase:'saving',...applied};
        let saved;
        if(command||applied.added||applied.mapped||applied.reserved)saved=await baseSaveV181(...args);
        if(recurrenceContext().scope!==context.scope)throw new Error('저장 중 업무공간이 변경되었습니다. 결과를 확인해 주세요.');
        status={phase:offline?'pending-online':saved?.recurrenceReconciled?'conflict-resolved':'saved',...applied};
        return {...status};
      }catch(error){
        // Preserve concurrent user edits. A failed remote write may still have
        // partially committed, so do not silently retry this command.
        let sameWorkspace=false;try{sameWorkspace=recurrenceContext().scope===context.scope;}catch{}
        if(sameWorkspace&&(!after||JSON.stringify(state)===after)){
          for(const key of Object.keys(state))delete state[key];Object.assign(state,before);
        }
        recoveryRequired=true;status={phase:'recovery-required',message:error.message,...applied};
        throw error;
      }
    })();
    running=job;
    job.finally(()=>{if(running===job)running=null;}).catch(()=>{});
    return job;
  }
  saveState=function(...args){
    if(window.cloudSync?.mode==='cloud'&&!window.cloudSync.recurrenceContext?.ready)return baseSaveV181(...args);
    return execute(args,true);
  };
  const supplement=()=>execute([{reason:'반복업무 독립 일정 보충'}],false);
  function requestSupplement(){
    if(!window.__RECURRENCE_DATA_READY__)return;
    void supplement().then(result=>{
      if(result.added){renderTaskTable();if(typeof renderHome==='function')renderHome();}
    }).catch(()=>{if(typeof toast==='function')toast('반복 일정 저장 결과 확인이 필요합니다. 동기화 상태를 확인해 주세요.');});
  }
  window.addEventListener?.('wm-data-ready',requestSupplement);
  window.addEventListener?.('online',requestSupplement);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')requestSupplement();});
  // Rolling extension is an independent post-sync/hourly procedure, never a renderer.
  if(typeof window.setInterval==='function')window.setInterval(requestSupplement,60*60*1000);
  if(window.__RECURRENCE_DATA_READY__)queueMicrotask(requestSupplement);
  window.WMTaskRecurrenceV181={freqFrom,scheduleKind,addMonths,configuredWeekDay,configuredMonths,ensureOccurrences,dueShift,
    planOccurrences,applyOccurrences,supplement,getStatus:()=>M.clone(status),getDiagnostics:()=>M.clone(diagnostics)};

}
installRollingRecurrencesV181();


function installNavAndHomeHolidayEnhancementsV182(){
  // v1.8.2 HOTFIX: never observe and rewrite the entire document on every style change.
  // That previously produced an endless MutationObserver -> style -> observer cycle.
  const iconMap={
    home:'home.png',
    inprogress:'in-progress.png',
    completed:'completed.png',
    library:'library.png',
    holiday:'holiday-db.png',
    settings:'settings-backup.png'
  };
  const assetBase=(()=>{
    const script=Array.from(document.scripts||[]).find(s=>/\/project-ui\.js(?:\?|$)/.test(s.src||''));
    try{return script?.src?new URL('../assets/nav-icons/',script.src).href:'assets/nav-icons/';}
    catch{return 'assets/nav-icons/';}
  })();
  const navType=button=>{
    // Only use the menu label, not the icon's text, so repainting cannot change its identity.
    const raw=(button?.textContent||'').replace(/\s+/g,'').toLowerCase();
    if(raw.includes('홈'))return 'home';
    if(raw.includes('진행업무'))return 'inprogress';
    if(raw.includes('완료업무'))return 'completed';
    if(raw.includes('라이브러리')||raw.includes('업무db'))return 'library';
    if(raw.includes('휴일db')||raw.includes('휴일'))return 'holiday';
    if(raw.includes('설정및백업')||raw.includes('설정'))return 'settings';
    return '';
  };
  const applyNavIcons=()=>{
    document.querySelectorAll('.side .navbtn').forEach(button=>{
      const kind=navType(button);
      if(!kind||!iconMap[kind])return;
      let icon=button.querySelector('.nav-icon');
      if(!icon){
        icon=document.createElement('span');
        icon.className='nav-icon';
        button.insertAdjacentElement('afterbegin',icon);
      }
      const url=assetBase+iconMap[kind];
      // Only write when something actually changed; avoids unrelated DOM churn.
      if(button.dataset.navIconV182!==kind||icon.dataset.navIconSrcV182!==url){
        icon.style.setProperty('background-image',`url("${url}")`,'important');
        icon.style.setProperty('background-position','center','important');
        icon.style.setProperty('background-repeat','no-repeat','important');
        icon.style.setProperty('background-size','contain','important');
        icon.style.setProperty('display','inline-block','important');
        icon.style.setProperty('width','1.65em','important');
        icon.style.setProperty('height','1.65em','important');
        icon.style.setProperty('min-width','1.65em','important');
        icon.style.setProperty('vertical-align','middle','important');
        icon.dataset.navIconSrcV182=url;
        button.dataset.navIconV182=kind;
      }
      if(icon.textContent)icon.textContent='';
    });
    // The standalone project tab has a separate icon/theme implementation.
  };
  const isoFromAny=text=>{
    const m=String(text||'').match(/(20\d{2})[.\/-](\d{1,2})[.\/-](\d{1,2})/);
    if(!m)return '';
    const yy=Number(m[1]),mm=Number(m[2]),dd=Number(m[3]);
    const d=new Date(yy,mm-1,dd,12);
    if(d.getFullYear()!==yy||d.getMonth()+1!==mm||d.getDate()!==dd)return '';
    return `${m[1]}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
  };
  const holidayName=iso=>{
    const h=(state.holidays||[]).find(item=>(item.date||item.day)===iso);
    return String(h?.name||h?.title||h?.label||h?.holidayName||h?.summary||'').trim();
  };
  const isWeekend=iso=>{
    if(!isoFromAny(iso))return false;
    const day=new Date(iso+'T12:00:00').getDay();
    return day===0||day===6;
  };
  const dateForLabel=node=>{
    let el=node.parentElement;
    // Never scan a whole calendar/container's textContent; date must belong to this day.
    for(let depth=0;el&&depth<6;depth++,el=el.parentElement){
      const attrs=['data-date','data-day','data-iso','data-full-date','data-home-date','datetime','title','aria-label'];
      for(const attr of attrs){
        const iso=isoFromAny(el.getAttribute(attr));
        if(iso)return iso;
      }
      const text=(el.childElementCount<=2?el.textContent||'':'').trim();
      if(text.length<=80){
        const iso=isoFromAny(text);
        if(iso)return iso;
      }
      if(el.id==='homePage')break;
    }
    return '';
  };
  const decorateHomeHolidayLabels=()=>{
    const home=document.querySelector('#homePage');
    if(!home)return;
    // Visiting text nodes once avoids repeated O(n^2) textContent reads from ancestors.
    const walker=document.createTreeWalker(home,NodeFilter.SHOW_TEXT);
    const matches=[];
    let node;
    while((node=walker.nextNode())){
      const label=(node.nodeValue||'').trim();
      if(label==='휴일'||label==='대체휴일')matches.push(node);
    }
    for(const textNode of matches){
      const iso=dateForLabel(textNode);
      if(!iso)continue;
      const name=holidayName(iso);
      if(name)textNode.nodeValue=name;
      else if(isWeekend(iso))textNode.nodeValue='';
    }
  };
  if(typeof renderHome==='function' && !renderHome.__homeHolidayPatchedV182){
    const base=renderHome;
    const wrapped=function(...args){
      const result=base.apply(this,args);
      setTimeout(()=>{applyNavIcons();decorateHomeHolidayLabels();},0);
      return result;
    };
    wrapped.__homeHolidayPatchedV182=true;
    renderHome=wrapped;
  }
  if(typeof showPage==='function' && !showPage.__navIconsPatchedV182){
    const base=showPage;
    const wrapped=function(...args){
      const result=base.apply(this,args);
      setTimeout(()=>{applyNavIcons();if(args[0]==='homePage')decorateHomeHolidayLabels();},0);
      return result;
    };
    wrapped.__navIconsPatchedV182=true;
    showPage=wrapped;
  }
  // No document-wide MutationObserver. Click and render hooks are sufficient.
  document.addEventListener('click',event=>{
    if(event.target?.closest?.('.side .navbtn'))setTimeout(applyNavIcons,0);
  },true);
  applyNavIcons();
  setTimeout(()=>{applyNavIcons();decorateHomeHolidayLabels();},0);
  window.WMHolidayInfoV182={
    isWeekend,holidayName,
    recognizes(value){
      const iso=isoFromAny(value);
      return Boolean(iso&&(isWeekend(iso)||(state.holidays||[]).some(h=>(h.date||h.day)===iso)));
    }
  };
}
installNavAndHomeHolidayEnhancementsV182();

window.WMProjectUI={renderProjectPage,openEditor,projectTaskModal,syncProjectVisibility,reopenTaskWithHistory};
})();
