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
let editor=null, activeStage=0, dirty=false, saving=false;
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
function projectList(){state.projects||=[];return state.projects;}
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
    <div class="prj-schedule"><h4>일정</h4><div class="prj-date-row">${dateField('stageStart','시작일',s.start||editor.start,{required:true})}<div class="prj-field"><label>종료일 방식</label><div class="prj-end-options">${[['same','당일 마무리'],['date','날짜 지정'],['after','며칠 후']].map(([v,label])=>`<label><input type="radio" name="prjEndMode" value="${v}" ${s.endType===v?'checked':''}> ${label}</label>`).join('')}</div></div></div>
      <div class="prj-end-details">${s.endType==='date'?dateField('stageEnd','종료일',s.endDate):s.endType==='after'?`<div class="prj-field"><label>시작일 이후</label><div class="prj-inline"><input type="number" id="prj-after-days" min="0" max="9999" value="${Number(s.afterDays)||0}"><span>일 후</span></div></div><label class="prj-small-check"><input type="checkbox" id="prj-count-holidays" ${s.includeHolidays?'checked':''}> 주말·휴일 포함</label>`:''}
       ${s.endType!=='same'?`<div class="prj-field"><label>종료일이 휴일이면</label><select id="prj-holiday-shift">${[['keep','그대로'],['prev','이전 근무일'],['next','다음 근무일']].map(([v,label])=>`<option value="${v}" ${s.holidayShift===v?'selected':''}>${label}</option>`).join('')}</select></div>`:''}
      </div>
    </div>
    <div class="prj-block"><div class="prj-block-header"><h4>체크리스트</h4><span>체크항목별 담당자와 마감일을 지정합니다.</span></div><div class="prj-check-head"><span></span><span>체크할 내용</span><span>담당자</span><span>마감일</span><span></span></div><div id="prj-check-list">${checkRows(s)}</div><button type="button" id="prj-add-check" class="prj-soft-btn">＋ 체크항목</button></div>
    <div class="prj-block"><div class="prj-block-header"><h4>진행자료</h4><span>사진·문서 원본은 기존 Google Drive 연결을 사용합니다.</span></div><div id="prj-resources">${resourceRows(s)}</div><button type="button" id="prj-add-resource" class="prj-soft-btn">＋ 자료 추가</button><input hidden id="prj-file-picker" type="file" multiple></div>
  </div>`;
}
function setDirty(){dirty=true;}
function renderTabs(){const tabs=$p('#prjTabs');if(tabs){tabs.innerHTML=stageTabs();bindTabs(tabs);}}
function renderStage(){const target=$p('#prjStagePane');if(!target)return;const step=editor?.stages[activeStage];if(step)normalizeCheckAssignments(step);target.innerHTML=stageEditor();bindStageControls(target);}
function showEditor(){
  modal(editor?.updatedAt?'프로젝트 수정':'프로젝트 등록',`<div class="prj-editor">
     <div id="prjHeader">${editorHeader()}</div><div id="prjTabs">${stageTabs()}</div><div id="prjStagePane">${stageEditor()}</div>
     <p class="prj-editor-tip">각 단계는 저장 시 진행(예정) 업무에 독립적으로 등록됩니다. 체크리스트를 모두 체크하면 그 단계만 완료 처리됩니다.</p>
  </div>`,`<button type="button" class="btn" id="prjCancel">취소</button>${projectById(editor.id)?'<button type="button" class="btn danger" id="prjDelete">프로젝트 폐기</button>':''}<button type="button" class="btn primary" id="prjSave">프로젝트 저장</button>`,'project-editor-modal');
  const root=editorRoot();if(!root)return;
  bindEditorHeader(root);bindTabs($p('#prjTabs',root));bindStageControls($p('#prjStagePane',root));
  $p('#prjSave',root).onclick=()=>void saveEditor();
  $p('#prjCancel',root).onclick=cancelEditor;
  $$p('[data-close]',root).forEach(btn=>btn.onclick=cancelEditor);
  const remove=$p('#prjDelete',root);if(remove)remove.onclick=()=>void deleteProject();
}
function openEditor(id=null,stageId=null){
  const existing=id?projectById(id):null;
  editor=existing?M.clone(existing):M.freshProject(todayISO());
  // 실제 담당자 목록에 혼자만 등록되어 있는 환경에서는 모든 단계와 체크항목 담당자 자동 고정.
  if(state.owners.length===1 && !editor.manager)editor.manager=state.owners[0];
  editor.stages.forEach(s=>{
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
      editor.stages.forEach(s=>{if(!s.participants.length)s.participants=[field.value];normalizeCheckAssignments(s);});
      renderStage();
    }
    setDirty();
  }));
  bindDateControls($p('#prjHeader',root));
}
function bindTabs(root){
  $$p('[data-step-tab]',root).forEach(button=>{
    const i=Number(button.dataset.stepTab);
    button.onclick=()=>{activeStage=i;renderTabs();renderStage();};
    button.ondragstart=e=>{e.dataTransfer.setData('text/plain',String(i));e.dataTransfer.effectAllowed='move';};
    button.ondragover=e=>{e.preventDefault();e.dataTransfer.dropEffect='move';};
    button.ondrop=e=>{e.preventDefault();const from=Number(e.dataTransfer.getData('text/plain'));if(M.moveStep(editor,from,i)){activeStage=i;setDirty();renderTabs();renderStage();}};
  });
  const add=$p('#prj-add-step',root);if(add)add.onclick=()=>{
    activeStage=M.addStep(editor);
    if(state.owners.length===1)editor.stages[activeStage].participants=[state.owners[0]];
    setDirty();renderTabs();renderStage();
  };
}
function bindStageControls(root){
  const s=editor.stages[activeStage];if(!s)return;
  $$p('[data-stage-field]',root).forEach(input=>input.oninput=()=>{s[input.dataset.stageField]=input.value;setDirty();});
  $$p('[data-person]',root).forEach(input=>input.onchange=()=>{
    s.participants=state.owners.filter(o=>$$p('[data-person]:checked',root).some(x=>x.dataset.person===o));
    refreshCheckOwners(root,s);setDirty();
  });
  bindDateControls(root);
  $$p('input[name="prjEndMode"]',root).forEach(input=>input.onchange=()=>{if(input.checked){s.endType=input.value;setDirty();renderStage();}});
  const after=$p('#prj-after-days',root);if(after)after.oninput=()=>{s.afterDays=Number(after.value)||0;setDirty();};
  const holidays=$p('#prj-count-holidays',root);if(holidays)holidays.onchange=()=>{s.includeHolidays=holidays.checked;setDirty();};
  const shift=$p('#prj-holiday-shift',root);if(shift)shift.onchange=()=>{s.holidayShift=shift.value;setDirty();};
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
    if(editor.stages.length<=1){alert('프로젝트에는 최소 1개 단계가 필요합니다.');return;}
    if(!confirm(`'${s.title||`${activeStage+1}단계`}'를 정말 삭제할까요?\n해당 단계의 수행업무와 체크리스트도 삭제되고 뒤의 단계가 앞으로 당겨집니다.`))return;
    s.resources.forEach(item=>pendingFiles.delete(item.id));
    M.removeStep(editor,activeStage);activeStage=Math.min(activeStage,editor.stages.length-1);setDirty();renderTabs();renderStage();
  };
}
function moveActive(to){if(M.moveStep(editor,activeStage,to)){activeStage=to;setDirty();renderTabs();renderStage();}}
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
    M.normalizeProject(editor,holidayCheck);
    await uploadPendingResources();
    const project=M.normalizeProject(editor,holidayCheck);
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
function projectTaskModal(task){
  const project=projectById(task.projectId),i=project?.stages.findIndex(s=>s.id===task.projectStageId)??-1;
  const stage=i>=0?project.stages[i]:null;
  if(!stage)return false;
  const checks=task.checklist||[];
  const body=`<div class="prj-task-view"><p><b>${escp(project.name)}</b> · ${i+1}단계 · ${escp(task.start)} ~ ${escp(task.end||'')}</p>
    <div id="prj-task-status" class="prj-task-status">${checks.length?`${checks.filter(c=>c.done).length}/${checks.length}개 완료`:'체크리스트 없음'}</div>
    ${checks.length?`<div class="prj-task-checks">${checks.map(c=>`<label class="prj-task-check ${c.done?'checked':''}"><input type="checkbox" data-prj-complete="${escp(c.id)}" ${c.done?'checked':''}><span><b>${escp(c.text)}</b><small>담당자: ${escp(c.owner||'미정')} · 마감일: ${escp(c.dueDate||'미정')}</small></span></label>`).join('')}</div>`:'<p class="muted">체크리스트를 추가하면 모두 완료 시 이 단계만 자동 완료됩니다. 체크항목이 없는 단계는 수동으로 완료할 수 있습니다.</p>'}
    <h4>진행자료</h4><div class="prj-task-resources">${(stage.resources||[]).map(r=>`<button type="button" class="prj-soft-btn" data-task-resource="${escp(r.id)}">${escp(r.name)}</button>`).join('')||'<small>등록된 진행자료 없음</small>'}</div></div>`;
  const footer=`<button type="button" class="btn" id="prjEditFromTask">프로젝트 수정</button>${!checks.length?`<button type="button" class="btn primary" id="prjManualComplete">${effectiveStatus(task)==='done'?'진행업무로 되돌리기':'이 단계 완료'}</button>`:''}<button type="button" class="btn" data-close>닫기</button>`;
  modal(escp(task.name),body,footer,'small prj-task-modal');
  $p('#prjEditFromTask').onclick=()=>openEditor(project.id,stage.id);
  $$p('[data-task-resource]').forEach(b=>b.onclick=()=>{const ref=stage.resources.find(r=>r.id===b.dataset.taskResource);if(ref)void openResource(ref);});
  $$p('[data-prj-complete]').forEach(input=>input.onchange=()=>{
    M.setCheck(task,input.dataset.prjComplete,input.checked,todayISO());
    input.closest('.prj-task-check')?.classList.toggle('checked',input.checked);
    const status=$p('#prj-task-status');if(status)status.textContent=`${task.checklist.filter(c=>c.done).length}/${task.checklist.length}개 완료 · ${effectiveStatus(task)==='done'?'단계 완료':'진행 중'}`;
    // 모달/체크 입력은 재생성하지 않아 빠른 다중 체크가 누락되지 않는다.
    void saveState({reason:'프로젝트 단계 체크리스트 변경'}).catch(error=>{console.error(error);toast('체크리스트 저장 실패 · 다시 확인해 주세요.');});
    renderTaskTable();renderHome();renderProjectPage();
  });
  const manual=$p('#prjManualComplete');if(manual)manual.onclick=()=>{
    task.status=effectiveStatus(task)==='done'?'progress':'done';task.actualComplete=task.status==='done'?todayISO():null;
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
  return baseOpenChecklist(id);
};
const baseOpenTaskForm=openTaskForm;
openTaskForm=function(id=null){
  const task=id?state.tasks.find(t=>t.id===id):null;
  if(task?.projectId){openEditor(task.projectId,task.projectStageId);return;}
  return baseOpenTaskForm(id);
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
window.WMProjectUI={renderProjectPage,openEditor,projectTaskModal,syncProjectVisibility};
})();
