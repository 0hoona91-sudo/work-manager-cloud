/* Work Manager 1.7: library-first scheduling and unified projects / tasks.
 * Does not mutate historical tasks, templates, or project IDs.
 */
(function(){
'use strict';
const get=(s,root=document)=>root.querySelector(s);
const getAll=(s,root=document)=>Array.from(root.querySelectorAll(s));
const html=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clean=v=>String(v||'').trim().toLowerCase();
const done=t=>effectiveStatus(t)==='done';
const isFromLibrary=t=>Boolean(t && (t.dbAuto||t.dbManual||t.autoSourceTemplateId||t.dbManualRootTemplateId||t.dbSourceTemplateId||t.templateId));
const isLibrarySchedule=t=>Boolean(t && (t.dbAuto||t.dbManual||t.autoSourceTemplateId||t.dbManualRootTemplateId));
const lookupLibraryRef=t=>{
  if(!t)return null;
  if(t.dbManualRootTemplateId){const i=Number(t.dbManualSourceStage||0);return i?`step|${t.dbManualRootTemplateId}|${i-1}`:`root|${t.dbManualRootTemplateId}`;}
  if(t.autoSourceTemplateId){const i=Number(t.step||1);return i>1?`step|${t.autoSourceTemplateId}|${i-2}`:`root|${t.autoSourceTemplateId}`;}
  const id=t.dbSourceTemplateId||t.templateId;
  return id?`root|${id}`:null;
};
const libraryRootId=t=>t?.dbManualRootTemplateId||t?.autoSourceTemplateId||t?.dbSourceTemplateId||t?.templateId||'';
const libraryRoot=t=>state.templates.find(x=>x.id===libraryRootId(t));
const reopenedProjects=new Set();

// No newly generated occurrences are permitted before explicit registration from the library.
// Keep stored cycle metadata and all existing historical occurrences unchanged.
if(typeof ensureAutoSchedulesV5==='function')ensureAutoSchedulesV5=function(){return 0};
if(typeof syncTemplateScheduleV5==='function')syncTemplateScheduleV5=function(){return 0};
if(typeof syncTemplateHistoricalLocalV14==='function')syncTemplateHistoricalLocalV14=function(){return 0};
if(typeof backfillAllHistoricalLocalV14==='function')backfillAllHistoricalLocalV14=async function(){return 0};
if(typeof pruneRollingOverflowLocalV16==='function')pruneRollingOverflowLocalV16=function(){return{tasksRemoved:0,protectedRoots:0}};

function renameVisible(){
  const nav=get('.navbtn[data-page="dbPage"]');
  if(nav){const text=nav.querySelector('span:last-child');if(text)text.textContent='업무 라이브러리';else nav.textContent='업무 라이브러리';nav.setAttribute('aria-label','업무 라이브러리');}
  const dbTitle=get('#dbPage .pagehead h2');if(dbTitle)dbTitle.textContent='업무 라이브러리';
  const add=get('#newDbBtn');if(add)add.textContent='＋ 라이브러리 등록';
  const search=get('#dbSearch');if(search&&search.placeholder.includes('DB'))search.placeholder=search.placeholder.replaceAll('업무DB','라이브러리');
  const taskHeading=get('#taskListPage .pagehead h2');if(taskHeading)taskHeading.textContent=currentTaskViewV35?.()==='completed'?'완료 업무':'진행(예정) 업무';
  const b=get('#taskListPage .datatable thead');
  if(b){getAll('th',b).forEach(th=>{
    // Keep sort buttons and icons intact.
    const walker=document.createTreeWalker(th,NodeFilter.SHOW_TEXT);
    let node;while((node=walker.nextNode()))if(node.nodeValue.includes('반복'))node.nodeValue=node.nodeValue.replaceAll('반복','일정');
  });}
  const dbHeaders=get('#dbPage .datatable thead');
  if(dbHeaders)getAll('th',dbHeaders).forEach(th=>{if(th.textContent.trim()==='자동등록')th.textContent='보관 상태'});
  const settingsLabel=get('#cloudTemplateCount')?.parentElement?.querySelector('.muted');if(settingsLabel)settingsLabel.textContent='업무 라이브러리';
  const reg=get('#dbRegisterSelected');if(reg)reg.textContent='선택한 업무를 진행업무에 등록';
  const repeat=get('#tfRepeat');if(repeat){const label=repeat.closest('label');if(label){const walker=document.createTreeWalker(label,NodeFilter.SHOW_TEXT);let node;while((node=walker.nextNode()))if(node.nodeValue.includes('반복업무'))node.nodeValue=node.nodeValue.replaceAll('반복업무','일정');}}
  const modalHead=get('#modalRoot .modal-head h3');
  if(modalHead)modalHead.textContent=modalHead.textContent.replaceAll('반복/표준 업무','업무 라이브러리').replaceAll('표준업무','라이브러리 업무').replaceAll('업무 DB','업무 라이브러리');
  const navProject=get('.side .navbtn[data-page="projectPage"]');
  if(navProject){
    navProject.setAttribute('aria-hidden','true');
    navProject.setAttribute('tabindex','-1');
    navProject.hidden=true;
    navProject.style.setProperty('display','none','important');
  }
  // The old project's Settings toggle is no longer relevant: editing remains
  // available inside the Progress page, not through a separate project tab.
  getAll('[data-nav-toggle-v33="projectPage"],[data-nav-toggle-local-v12="projectPage"]').forEach(input=>{
    const row=input.closest('label,.v33-config-item,.local-v12-nav-item');
    if(row)row.hidden=true;
    input.disabled=true;
  });
  const auto=get('#dbAutomationSettings');if(auto)auto.hidden=true;
  for(const id of ['#repairRepeatsSetting','#syncDbSchedules']){const el=get(id);if(el)el.hidden=true;}
}

// The legacy/mobile sidebar reconstructs its labels after page renders.
// Keep the public name in sync even after those late redraws.
let libraryNavRefreshPendingV172=false;
function stableLibraryLabelV172(){
  const nav=get('.side .navbtn[data-page="dbPage"]');
  const label=nav?.querySelector('span:last-child');
  if(label && label.textContent.trim()!=='업무 라이브러리')label.textContent='업무 라이브러리';
  if(nav?.getAttribute('aria-label')!=='업무 라이브러리')nav?.setAttribute('aria-label','업무 라이브러리');
  const head=get('#dbPage .pagehead h2');
  if(head&&head.textContent.trim()!=='업무 라이브러리')head.textContent='업무 라이브러리';
}
const sidebarV172=get('.side');
if(sidebarV172){
  new MutationObserver(()=>{
    if(libraryNavRefreshPendingV172)return;
    libraryNavRefreshPendingV172=true;
    queueMicrotask(()=>{libraryNavRefreshPendingV172=false;stableLibraryLabelV172()});
  }).observe(sidebarV172,{subtree:true,childList:true,characterData:true});
}

// The task body is generated by the legacy renderer with in-row editing,
// status controls and ten columns. Preserve its already-bound task/select
// buttons while replacing the layout with a genuine compact bulletin board.
function boardDateV172(value){
  const normalized=String(value||'').trim();
  const match=normalized.match(/^(\d{4})[-/.]?(\d{2})[-/.]?(\d{2})$/);
  return match ? `${match[1]}/${match[2]}/${match[3]}` : '-';
}
function compactTaskBoardV172(){
  const page=get('#taskListPage'),table=get('#taskListPage .datatable'),body=get('#taskTableBody');
  if(!page||!table||!body)return;
  table.classList.add('workflow-board-v172');
  const row=table.tHead?.rows?.[0];
  if(row&&row.cells.length>=10){
    const original=[...row.cells];
    // Keep the original select-all control and existing sort behavior.
    const date=original[6];
    date.textContent='시작일 / 마감일';
    date.title='시작일과 마감일 (목록에서 수정 불가)';
    row.replaceChildren(original[0],original[1],original[2],original[3],date,original[9]);
  }
  body.querySelectorAll('tr').forEach(tr=>{
    const cells=[...tr.cells];
    if(cells.length<10){if(cells.length===1&&cells[0].hasAttribute('colspan'))cells[0].colSpan=6;return;} // empty state
    const id=tr.querySelector('[data-task]')?.dataset.task
       ||tr.querySelector('[data-task-select]')?.dataset.taskSelect;
    const task=id && state.tasks.find(t=>t.id===id);
    if(!task)return;
    const date=document.createElement('td');
    date.className='workflow-range-cell-v172';
    const dateDisplay=document.createElement('span');
    dateDisplay.className='workflow-date-range-v172';
    dateDisplay.textContent=`${boardDateV172(task.start)} ~ ${boardDateV172(task.deadline||task.end||task.start)}`;
    dateDisplay.title='일정은 상세 화면이나 업무 라이브러리의 규칙에서 확인·변경하세요';
    date.appendChild(dateDisplay);
    // Keep title click, checkbox selection, urgent indicator and note text.
    // Removed input date/status controls are never presented in the board.
    cells[3].querySelectorAll('.db-auto-badge,.mobile-urgent-badge-v17,.mobile-compact-schedule-v26').forEach(el=>el.remove());
    for(const cell of [cells[0],cells[1],cells[2],cells[3],cells[9]]){
      cell.classList.remove('mobile-field-v17','mobile-card-title-v17','mobile-empty-field-v17');
      cell.removeAttribute('data-mobile-label');
    }
    tr.replaceChildren(cells[0],cells[1],cells[2],cells[3],date,cells[9]);
    tr.classList.add('workflow-board-row-v172');
  });
}
function markLibraryRows(){
  const root=get('#dbTableBody');if(!root)return;
  getAll('.db-auto-badge',root).forEach(b=>{if(/자동|연계/.test(b.textContent||'')){b.textContent='라이브러리 보관';b.title='직접 등록하기 전에는 새 업무가 생성되지 않습니다.';}});
  const rows=getAll('tr',root);
  rows.forEach(tr=>{if(/자동등록/.test(tr.textContent||''))getAll('td',tr).forEach(td=>{if(td.textContent.trim()==='자동등록')td.textContent='보관 중';});});
  if(!get('#workflowLibraryHintV17')){
    const note=document.createElement('div');note.id='workflowLibraryHintV17';note.className='workflow-hint-v17';
    note.textContent='업무 수행방법·관련 양식·주기를 보관합니다. 여기에서 저장만 하면 진행업무가 생성되지 않습니다. 필요한 시점에 항목을 선택하여 진행업무에 등록하세요.';
    get('#dbPage .pagehead')?.insertAdjacentElement('afterend',note);
  }
}
function decorateLibraryEditor(id=null){
  const dlg=get('#modalRoot .db-form-modal');if(!dlg)return;
  if(!get('#workflowEditorNoteV17',dlg)){
    const note=document.createElement('p');note.id='workflowEditorNoteV17';note.className='workflow-hint-v17';
    note.textContent='이 화면에서 주기·방법·자료를 수정해도 새 진행업무가 자동 생성되지 않습니다. 진행업무 등록은 라이브러리 목록에서 별도로 진행합니다.';
    get('.modal-body',dlg)?.prepend(note);
  }
  const checkbox=get('#dfAutoSchedule',dlg);
  if(checkbox){const row=checkbox.closest('label,.field,.checks');if(row)row.classList.add('workflow-auto-hidden-v17');}
  const btn=get('#saveDb',dlg);if(btn&&!btn.dataset.workflowGuardV17){
    btn.dataset.workflowGuardV17='1';
    const originalSave=btn.onclick;
    if(typeof originalSave==='function'&&id){
      btn.onclick=async function(event){
        const before=state.templates.find(t=>t.id===id);
        const previousDuration=Number(before?.durationDays||1);
        const previousDeadlineOffset=Number(before?.deadlineOffset||0);
        const result=await originalSave.call(this,event);
        const latest=state.templates.find(t=>t.id===id);
        if(!latest)return result;
        // Only the manually initiated, unfinished root occurrences respond to
        // edits of their original template. Their chosen start date remains fixed.
        const duration=Math.max(1,Number(latest.durationDays||1));
        const offset=Number(latest.deadlineOffset||0);
        if(duration===previousDuration&&offset===previousDeadlineOffset)return result;
        let updated=0;
        for(const task of state.tasks){
          if(!isLibrarySchedule(task)||task.parentAutoRootId||task.link||
             libraryRootId(task)!==id||done(task)||task.manualOverride||task.scheduleOverride||!task.start)continue;
          const end=addDays(task.start,duration-1);
          const deadline=offset>0?addDays(task.start,offset):end;
          if(task.end===end&&task.deadline===deadline)continue;
          task.end=end;task.deadline=deadline;updated++;
        }
        if(updated){
          recalcLinks();
          await saveState({reason:`업무 라이브러리 템플릿 일정 반영 · ${updated}개 회차`});
          renderTaskTable();renderHome();
        }
        return result;
      };
    }
  }
  renameVisible();
}

function projectStages(p){return(p.stages||[]).map((s,i)=>({s,i,t:state.tasks.find(t=>t.projectId===p.id&&t.projectStageId===s.id)}));}
function projectMatches(p,q,cat,scope){
  if(cat!=='all'&&p.category!==cat)return false;
  if(!q)return true;
  const basic=[p.name,p.category,p.manager].join(' ').toLowerCase();
  if(basic.includes(q))return true;
  // A completed stage must remain discoverable by its own name, even when
  // the sidebar search is in the "title only" mode.
  return projectStages(p).some(({s,t})=>
    [s.title,t?.name,...(scope==='all'?[t?.notes]:[])].join(' ').toLowerCase().includes(q));
}
function stageMarkup({s,i,t}){
  const label=done(t)?'완료':t?'진행':'미등록';
  return `<button type="button" class="workflow-stage-v17" data-workflow-step="${html(t?.id||'')}" ${!t?'disabled':''}><span>${i+1}단계 · ${html(s.title||t?.name||'업무명 미정')}</span><small>${html(t?.start||s.start||'-')} ~ ${html(t?.end||'-')} · ${label}</small></button>`;
}
function visibleProjectListV173(completed){
  const q=clean(get('#taskSearch')?.value);
  const pref=window.__LOCAL_SEARCH_PREF_V15__?.task||{};
  const cat=pref.category||'all',scope=pref.scope||'title';
  return (state.projects||[]).filter(p=>{
    if(!projectMatches(p,q,cat,scope))return false;
    const steps=projectStages(p);
    return completed?steps.some(({t})=>done(t)):steps.some(({t})=>t&&!done(t));
  });
}
function renderProjectCards(completed=false){
  const root=get('#workflowProjectListV17');if(!root)return;
  const projects=visibleProjectListV173(completed);
  root.innerHTML=projects.length?projects.map(p=>{
    const steps=projectStages(p),finishedSteps=steps.filter(({t})=>done(t));
    const finished=finishedSteps.length;
    const pending=steps.filter(({t})=>t&&!done(t));
    const active=pending[0];
    const percent=steps.length?Math.round(finished/steps.length*100):0;
    const fullyDone=steps.length>0&&steps.every(({t})=>done(t));
    const expand=reopenedProjects.has(p.id);
    const schedule=[p.start||'',p.end||''].filter(Boolean).join(' ~ ')||'일정 미정';
    const manager=p.manager||'담당자 미지정';
    const status=completed?(fullyDone?'완료':'일부 완료'):'진행 중';
    const lastFinished=finishedSteps[finishedSteps.length-1];
    const latestDate=finishedSteps.map(({t})=>t?.actualComplete||'').filter(Boolean).sort().pop()||'';
    const highlight=completed
      ?(fullyDone?`완료일 · ${latestDate||'미기록'}`:`완료 단계 · ${lastFinished?.i+1||'-'}단계 ${lastFinished?.s.title||lastFinished?.t?.name||''}`)
      :(active?`${active.i+1}단계 · ${active.s.title||active.t?.name||'업무명 미정'}`:'진행 중인 단계 없음');
    // On the completed screen show only finished stages, never duplicate the
    // same project's stages in the right-hand general-work table.
    const shownSteps=completed?finishedSteps:steps;
    return `<article class="workflow-project-card-v17 ${completed?'workflow-project-completed-v173':''}${completed&&!fullyDone?' workflow-project-partial-v173':''}">
      <div class="workflow-project-top-v171"><span class="workflow-project-category-v171">${html(p.category||'미분류')}</span><span class="workflow-project-status-v171">${status}</span></div>
      <button type="button" class="workflow-project-title-v17" data-workflow-expand="${html(p.id)}" aria-expanded="${expand}">
        <span class="workflow-project-mark-v17" aria-hidden="true">▤</span>
        <span class="workflow-project-copy-v17"><b>${html(p.name||'프로젝트명 미정')}</b><small>${html(schedule)}</small></span>
        <span class="workflow-project-chevron-v171" aria-hidden="true">${expand?'▴':'▾'}</span>
      </button>
      <div class="workflow-project-info-v171"><span>총괄 ${html(manager)}</span><span>${finished}/${steps.length}단계 완료</span></div>
      <div class="workflow-project-progress-v171" role="progressbar" aria-label="프로젝트 진행률" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100"><span style="width:${percent}%"></span></div>
      <div class="workflow-project-next-v171"><span class="workflow-project-next-label-v171">${completed?(fullyDone?'프로젝트 완료':'완료된 단계'):'다음 단계'}</span><strong>${html(highlight)}</strong></div>
      <div class="workflow-project-steps-v17" ${expand?'':'hidden'}>${shownSteps.map(stageMarkup).join('')}<button type="button" class="workflow-project-edit-v17" data-workflow-project-edit="${html(p.id)}">프로젝트 수정</button></div>
    </article>`;
  }).join(''):`<p class="workflow-empty-v17">${completed?'완료된 프로젝트 단계가 없습니다.':'표시할 진행 프로젝트가 없습니다.'}</p>`;
}
function ensureSplit(){
  const page=get('#taskListPage');if(!page)return;
  const table=page.querySelector(':scope > .tablewrap');
  if(!get('#workflowSplitV17')){
    const split=document.createElement('div');split.id='workflowSplitV17';split.className='workflow-split-v17';
    split.innerHTML=`<section class="workflow-column-v17" aria-label="프로젝트 목록"><header><h3 id="workflowProjectsHeadingV173">프로젝트 목록</h3><span id="workflowProjectsSubheadingV173">프로젝트별 단계 관리</span></header><div id="workflowProjectListV17"></div></section><section class="workflow-column-v17 workflow-general-v17" aria-label="일반업무 목록"><header><h3 id="workflowGeneralHeadingV173">일반업무 목록</h3><span id="workflowGeneralSubheadingV173">직접 등록 · 라이브러리 등록 업무</span></header><div id="workflowGeneralMountV17"></div></section>`;
    table?.insertAdjacentElement('beforebegin',split);
    get('#workflowGeneralMountV17',split)?.appendChild(table);
    get('#workflowProjectListV17',split)?.addEventListener('click',e=>{
      const expand=e.target.closest('[data-workflow-expand]');
      if(expand){const id=expand.dataset.workflowExpand;reopenedProjects.has(id)?reopenedProjects.delete(id):reopenedProjects.add(id);renderProjectCards(currentTaskViewV35?.()==='completed');return;}
      const edit=e.target.closest('[data-workflow-project-edit]');if(edit){window.WMProjectUI?.openEditor(edit.dataset.workflowProjectEdit);return;}
      const step=e.target.closest('[data-workflow-step]');if(step&&step.dataset.workflowStep){openChecklist(step.dataset.workflowStep);}
    });
  }
  return get('#workflowSplitV17');
}
function bindVisibleSelectAllV173(){
  // The legacy handler selects from *all* filtered tasks, including project
  // stages which are no longer part of the right-hand table. That can cause
  // "delete selected" to delete invisible project stages. Replace its handler.
  const selectAll=get('#selectAllTasks'),body=get('#taskTableBody');
  if(!selectAll||!body)return;
  const visible=getAll('input[data-task-select]',body);
  const visibleIds=new Set(visible.map(input=>input.dataset.taskSelect));
  if(typeof selectedTaskIdsV2!=='undefined'&&selectedTaskIdsV2 instanceof Set){
    for(const id of [...selectedTaskIdsV2])if(!visibleIds.has(id))selectedTaskIdsV2.delete(id);
  }
  selectAll.checked=visible.length>0&&visible.every(input=>input.checked);
  selectAll.onchange=()=>{
    for(const input of getAll('input[data-task-select]',body)){
      input.checked=selectAll.checked;
      if(typeof selectedTaskIdsV2!=='undefined'&&selectedTaskIdsV2 instanceof Set){
        if(selectAll.checked)selectedTaskIdsV2.add(input.dataset.taskSelect);
        else selectedTaskIdsV2.delete(input.dataset.taskSelect);
      }
    }
    if(typeof updateBulkV2==='function')updateBulkV2();
  };
  if(typeof updateBulkV2==='function')updateBulkV2();
}
function updateSplit(){
  const page=get('#taskListPage');if(!page)return;
  const split=ensureSplit();if(!split)return;
  const completed=(typeof currentTaskViewV35==='function'&&currentTaskViewV35()==='completed');
  const generalMount=get('#workflowGeneralMountV17');
  const table=page.querySelector(':scope > .tablewrap');
  if(table)generalMount?.appendChild(table);
  page.classList.add('workflow-split-enabled-v17');
  page.classList.toggle('workflow-completed-split-v173',completed);
  split.hidden=false;
  get('#workflowProjectsHeadingV173').textContent=completed?'완료된 프로젝트':'프로젝트 목록';
  get('#workflowProjectsSubheadingV173').textContent=completed?'완료 또는 일부 완료된 단계':'프로젝트별 단계 관리';
  get('#workflowGeneralHeadingV173').textContent=completed?'완료된 일반업무':'일반업무 목록';
  get('#workflowGeneralSubheadingV173').textContent=completed?'완료 처리된 일반업무 기록':'직접 등록 · 라이브러리 등록 업무';
  // Retain an orphaned stage in the general table instead of making it
  // disappear if its project definition was removed independently.
  const registeredProjects=new Set((state.projects||[]).map(p=>p.id));
  const body=get('#taskTableBody');
  getAll('tr',body||document).forEach(tr=>{
    const id=tr.querySelector('[data-task]')?.dataset.task
      ||tr.querySelector('[data-task-select]')?.dataset.taskSelect;
    const task=id&&state.tasks.find(t=>t.id===id);
    if(task?.projectId&&registeredProjects.has(task.projectId))tr.remove();
  });
  renderProjectCards(completed);
  bindVisibleSelectAllV173();
}

function ensureCreateMenu(){
  const trigger=get('#newTaskBtn');if(!trigger||trigger.dataset.workflowMenuV17)return;
  trigger.dataset.workflowMenuV17='1';
  trigger.textContent='＋ 업무 작성 ▾';
  trigger.setAttribute('aria-haspopup','menu');
  trigger.setAttribute('aria-expanded','false');
  const menu=document.createElement('div');
  menu.id='workflowCreateMenuV17';menu.className='workflow-create-menu-v17';
  menu.setAttribute('role','menu');menu.hidden=true;
  menu.innerHTML='<button type="button" data-workflow-create="project" role="menuitem">▤ 프로젝트 등록</button><button type="button" data-workflow-create="normal" role="menuitem">＋ 일반 업무 등록</button>';
  // A body-level fixed menu avoids clipping by search toolbar, sticky table headers
  // and the stacking context used by #taskListPage on desktop and mobile.
  document.body.appendChild(menu);
  const previous=trigger.onclick;
  function closeMenu(){
    menu.hidden=true;
    trigger.setAttribute('aria-expanded','false');
  }
  function reposition(){
    if(menu.hidden)return;
    const rect=trigger.getBoundingClientRect();
    const viewportWidth=document.documentElement.clientWidth;
    const viewportHeight=window.visualViewport?.height||window.innerHeight;
    const width=Math.min(258,Math.max(188,viewportWidth-16));
    const menuHeight=menu.getBoundingClientRect().height||102;
    const below=rect.bottom+7;
    const top=below+menuHeight>viewportHeight-8&&rect.top>menuHeight+12
      ? rect.top-menuHeight-7 : Math.min(below,viewportHeight-menuHeight-8);
    menu.style.width=`${width}px`;
    menu.style.left=`${Math.max(8,Math.min(viewportWidth-width-8,rect.right-width))}px`;
    menu.style.top=`${Math.max(8,top)}px`;
  }
  trigger.addEventListener('click',e=>{
    e.preventDefault();e.stopImmediatePropagation();
    if(!menu.hidden){closeMenu();return;}
    menu.hidden=false;
    trigger.setAttribute('aria-expanded','true');
    reposition();
  },true);
  menu.addEventListener('click',e=>{
    const button=e.target.closest('[data-workflow-create]');if(!button)return;
    e.preventDefault();e.stopPropagation();
    closeMenu();
    if(button.dataset.workflowCreate==='project')window.WMProjectUI?.openEditor();
    else if(typeof previous==='function')previous.call(trigger,new MouseEvent('click'));
    else openTaskForm();
  });
  document.addEventListener('click',e=>{if(!menu.contains(e.target)&&!trigger.contains(e.target))closeMenu();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMenu();});
  window.addEventListener('resize',reposition,{passive:true});
  window.addEventListener('scroll',reposition,{passive:true,capture:true});
}
function lockScheduleDates(task){
  const modal=get('#modalRoot .modal');if(!task||!modal)return;
  const completed=done(task),template=isLibrarySchedule(task);
  if(!completed&&!template)return;
  const note=document.createElement('p');note.className='workflow-lock-note-v17';
  note.textContent=completed?'완료업무의 수행 일정은 변경할 수 없습니다. 체크리스트 등 다른 내용은 수정할 수 있습니다.':'라이브러리에서 등록한 업무의 일정은 여기서 수정할 수 없습니다. 업무 라이브러리의 템플릿에서 일정 규칙을 수정하세요.';
  get('.modal-body',modal)?.prepend(note);
  const selectors=['#tfStart','#tfEndDate','#tfEndType','#tfDeadline','#tfUnconfirmed','#tfAfterDays','#tfAfter','#tfRepeat','#tfRepeatCycle','input[name="tfEndModeV32"]','input[name="taskEndType"]'];
  const fields=selectors.flatMap(s=>getAll(s,modal));
  for(const el of fields){el.disabled=true;el.setAttribute('aria-disabled','true');el.title='일정 변경은 제한됩니다';el.classList.add('workflow-locked-date-v17');}
  const ref=lookupLibraryRef(task);
  if(template&&ref&&state.templates.some(x=>x.id===libraryRootId(task))){
    const button=document.createElement('button');button.type='button';button.className='btn';button.id='workflowEditTemplateV17';button.textContent='수정 템플릿 열기';
    button.onclick=()=>{const root=libraryRoot(task);if(root)openDbForm(root.id)};
    get('.modal-foot',modal)?.prepend(button);
  }
  const save=get('#saveTask',modal);
  if(save){
    // The legacy save handler reads values even from disabled controls. Enforce the original dates before it runs.
    save.addEventListener('click',()=>{
      const current=state.tasks.find(t=>t.id===task.id);if(!current)return;
      const inputs=[['#tfStart',current.start],['#tfEndDate',current.end||current.start],['#tfDeadline',current.deadline||current.end||current.start]];
      inputs.forEach(([selector,value])=>{const input=get(selector,modal);if(input&&value)input.value=value});
      const type=get('#tfEndType',modal);if(type)type.value=current.end===current.start?'same':'date';
      const un=get('#tfUnconfirmed',modal);if(un)un.checked=!!current.unconfirmed;
    },true);
  }
}
function enhanceWorkModal(id){
  const task=id&&state.tasks.find(t=>t.id===id);if(!task)return;
  const modal=get('#modalRoot .modal');if(!modal)return;
  if(isFromLibrary(task)){
    const ref=lookupLibraryRef(task);
    if(ref&&libraryRoot(task)){
      const foot=get('.modal-foot',modal);
      if(foot&&!get('#workflowLibraryViewV17',foot)){
        const button=document.createElement('button');button.type='button';button.className='btn';button.id='workflowLibraryViewV17';button.textContent='업무 방법 · 관련 자료';button.onclick=()=>openDbDetailV6(ref);foot.prepend(button);
      }
    }
  }
  lockScheduleDates(task);
}

const originalRenderTasks=renderTaskTable;
renderTaskTable=function(...args){const result=originalRenderTasks.apply(this,args);ensureCreateMenu();renameVisible();updateSplit();compactTaskBoardV172();stableLibraryLabelV172();return result};
const originalDbRender=renderDbTable;
renderDbTable=function(...args){const result=originalDbRender.apply(this,args);renameVisible();markLibraryRows();return result};
const originalShowPage=showPage;
showPage=function(id,...args){const result=originalShowPage.call(this,id,...args);renameVisible();if(id==='taskListPage'){ensureCreateMenu();updateSplit();}if(id==='dbPage')markLibraryRows();return result};
const originalOpenTaskForm=openTaskForm;
openTaskForm=function(id=null,...args){const result=originalOpenTaskForm.call(this,id,...args);enhanceWorkModal(id);renameVisible();return result};
const originalOpenChecklist=openChecklist;
openChecklist=function(id,...args){const result=originalOpenChecklist.call(this,id,...args);const task=state.tasks.find(t=>t.id===id);if(task&&!task.projectId&&isFromLibrary(task)){
    const foot=get('#modalRoot .modal-foot'),ref=lookupLibraryRef(task);
    if(foot&&ref&&libraryRoot(task)&&!get('#workflowLibraryViewV17',foot)){
      const button=document.createElement('button');button.type='button';button.className='btn';button.id='workflowLibraryViewV17';button.textContent='업무 방법 · 관련 자료';button.onclick=()=>openDbDetailV6(ref);foot.prepend(button);
    }
  }
  return result};
const originalOpenDbForm=openDbForm;
openDbForm=function(...args){const result=originalOpenDbForm.apply(this,args);decorateLibraryEditor(args[0]);return result};
const originalSettings=renderSettings;
renderSettings=function(...args){const result=originalSettings.apply(this,args);renameVisible();return result};
const originalHome=renderHome;
renderHome=function(...args){const result=originalHome.apply(this,args);renameVisible();return result};

// A completed project stage is immutable as to its schedule when its editor is visible.
const modalRoot=get('#modalRoot');
if(modalRoot){
  const observer=new MutationObserver(()=>{
    const project=get('.project-editor-modal',modalRoot),pane=get('.prj-stage-inner',project||modalRoot);
    if(!project||!pane)return;
    const stageId=pane.dataset.stageId;
    const task=state.tasks.find(t=>t.projectStageId===stageId);
    if(!task||!done(task))return;
    for(const selector of ['[data-prj-field="stageStart"]','[data-prj-field="stageEnd"]','[data-date-for="stageStart"]','[data-date-for="stageEnd"]','input[name="prjEndMode"]','#prj-after-days','#prj-count-holidays','#prj-holiday-shift']){
      getAll(selector,pane).forEach(el=>{if(!el.disabled){el.disabled=true;el.classList.add('workflow-locked-date-v17');el.title='완료된 단계의 일정은 변경할 수 없습니다';}});
    }
    if(!get('.workflow-project-lock-v17',pane)){
      const banner=document.createElement('p');banner.className='workflow-lock-note-v17 workflow-project-lock-v17';banner.textContent='완료한 단계의 일정은 변경할 수 없습니다.';pane.prepend(banner);
    }
  });
  observer.observe(modalRoot,{childList:true,subtree:true});
}
window.WorkManagerReformV17={isLibrarySchedule,lookupLibraryRef,updateSplit,renameVisible,compactTaskBoardV172,stableLibraryLabelV172};
requestAnimationFrame(()=>{renameVisible();stableLibraryLabelV172();ensureCreateMenu();if(get('#taskListPage.active'))renderTaskTable();if(get('#dbPage.active'))renderDbTable()});
})();
