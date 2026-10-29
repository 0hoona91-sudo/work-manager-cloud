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
function isProjectClosedV174(p){
  if(!p?.workflowClosedAtV174)return false;
  const stages=projectStages(p);
  return stages.length>0 && stages.every(({t})=>t&&done(t));
}
function canCloseProjectV174(p){
  const stages=projectStages(p);
  return stages.length>0 && stages.every(({t})=>t&&done(t));
}


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
// v1.7.4: render both views from the same six-column source table.
// The legacy renderer rebuilds a TEN-column header on every update, and late
// layout code sometimes rebuilds it AGAIN. Keep the six/seven-column header
// and all row cells in step; avoid the phantom columns seen after the page paints.
let boardSortV174=null;
const boardColumnDefsV174=(completed)=>[
  ['all',''],['urgent','긴급'],['category','구분'],['name','업무명'],
  ['dates','시작일 / 마감일'],...(completed?[['completed','실제 완료일']]:[]),['notes','비고']
];
function taskIdForBoardV174(row){
  return row.querySelector('[data-task]')?.dataset.task || row.querySelector('[data-task-select]')?.dataset.taskSelect||'';
}
function redrawBoardHeaderV174(completed){
  const row=get('#taskListPage .datatable thead tr');if(!row)return;
  const defs=boardColumnDefsV174(completed);
  const signature=defs.map(([,name])=>name).join('|');
  if(row.dataset.workflowSignatureV174===signature && row.cells.length===defs.length)return;
  row.replaceChildren();
  defs.forEach(([key,label])=>{
    const cell=document.createElement('th');cell.scope='col';
    if(key==='all'){
      const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.id='selectAllTasks';checkbox.title='현재 표시된 단일 업무만 전체 선택';cell.appendChild(checkbox);
    }else{
      const button=document.createElement('button');button.type='button';button.className='workflow-sort-button-v174';button.dataset.workflowSort=key;
      button.textContent=label;
      button.title='클릭하여 오름차순/내림차순, 더블클릭으로 기본 순서';
      if(boardSortV174?.key===key){cell.setAttribute('aria-sort',boardSortV174.dir==='asc'?'ascending':'descending');button.textContent+=boardSortV174.dir==='asc'?' ↑':' ↓';}
      button.onclick=()=>{
        if(window.localDevTableSortV1)window.localDevTableSortV1.task=null;
        boardSortV174=boardSortV174?.key===key&&boardSortV174.dir==='asc'?{key,dir:'desc'}:{key,dir:'asc'};
        renderTaskTable();
      };
      button.ondblclick=(e)=>{e.preventDefault();boardSortV174=null;if(window.localDevTableSortV1)window.localDevTableSortV1.task=null;renderTaskTable()};
      cell.appendChild(button);
    }
    row.appendChild(cell);
  });
  row.dataset.workflowSignatureV174=signature;
}
function applyBoardSortV174(){
  if(!boardSortV174)return;
  const body=get('#taskTableBody');if(!body)return;
  const key=boardSortV174.key,dir=boardSortV174.dir==='asc'?1:-1;
  const field=(t)=>{
    if(key==='urgent')return t.urgent?1:0;
    if(key==='category')return t.category||'';
    if(key==='name')return t.name||'';
    if(key==='dates')return t.start||'';
    if(key==='completed')return t.actualComplete||'';
    if(key==='notes')return t.notes||'';
    return '';
  };
  const collator=new Intl.Collator('ko',{numeric:true,sensitivity:'base'});
  [...body.rows].filter(row=>taskIdForBoardV174(row)).map((row,index)=>({row,index,task:state.tasks.find(t=>t.id===taskIdForBoardV174(row))})).sort((a,b)=>{
    const x=field(a.task||{}),y=field(b.task||{});
    return (typeof x==='number'&&typeof y==='number'?x-y:collator.compare(String(x),String(y)))*dir||a.index-b.index;
  }).forEach(({row})=>body.appendChild(row));
}
function compactTaskBoardV172(){
  const page=get('#taskListPage'),table=get('#taskListPage .datatable'),body=get('#taskTableBody');
  if(!page||!table||!body)return;
  const completed=(typeof currentTaskViewV35==='function'&&currentTaskViewV35()==='completed');
  table.classList.add('workflow-board-v172');
  table.classList.toggle('workflow-board-completed-v174',completed);
  body.querySelectorAll('tr').forEach(tr=>{
    const cells=[...tr.cells];
    if(cells.length===1&&cells[0].hasAttribute('colspan')){cells[0].colSpan=completed?7:6;return;}
    if(cells.length!==10)return; // already compact, never reinterpret another layout as 10 columns
    const id=taskIdForBoardV174(tr),task=id&&state.tasks.find(t=>t.id===id);
    if(!task)return;
    const date=document.createElement('td');date.className='workflow-range-cell-v172';
    const range=document.createElement('span');range.className='workflow-date-range-v172';
    range.textContent=`${boardDateV172(task.start)} ~ ${boardDateV172(task.deadline||task.end||task.start)}`;
    range.title='목록에서는 날짜를 수정할 수 없습니다';date.appendChild(range);
    const endDate=document.createElement('td');endDate.className='workflow-actual-complete-v174';
    if(completed){endDate.textContent=boardDateV172(task.actualComplete);}
    for(const cell of [cells[0],cells[1],cells[2],cells[3],cells[9]]){
      cell.classList.remove('mobile-field-v17','mobile-card-title-v17','mobile-empty-field-v17');cell.removeAttribute('data-mobile-label');
    }
    tr.replaceChildren(cells[0],cells[1],cells[2],cells[3],date,...(completed?[endDate]:[]),cells[9]);
    tr.classList.add('workflow-board-row-v172');
  });
  redrawBoardHeaderV174(completed);
  applyBoardSortV174();
  bindVisibleSelectAllV173();
}
// Some inherited navigation/sorting code updates the header after the initial paint.
// Repair only that header without unnecessarily re-rendering the task dataset.
let boardRepairQueuedV174=false;
function observeBoardHeaderV174(){
  const head=get('#taskListPage .datatable thead');if(!head)return;
  new MutationObserver(()=>{
    if(boardRepairQueuedV174)return;
    const completed=typeof currentTaskViewV35==='function'&&currentTaskViewV35()==='completed';
    const defs=boardColumnDefsV174(completed);
    const row=head.rows?.[0];
    if(row&&row.cells.length===defs.length&&row.dataset.workflowSignatureV174===defs.map(([,v])=>v).join('|'))return;
    boardRepairQueuedV174=true;
    queueMicrotask(()=>{boardRepairQueuedV174=false;redrawBoardHeaderV174(completed);bindVisibleSelectAllV173()});
  }).observe(head,{childList:true,subtree:true});
}
observeBoardHeaderV174();
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
    return completed?isProjectClosedV174(p):!isProjectClosedV174(p);
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
    const status=completed?'완료':fullyDone?'종료 대기':'진행 중';
    const lastFinished=finishedSteps[finishedSteps.length-1];
    const latestDate=finishedSteps.map(({t})=>t?.actualComplete||'').filter(Boolean).sort().pop()||'';
    const highlight=completed
      ?(fullyDone?`완료일 · ${latestDate||'미기록'}`:`완료 단계 · ${lastFinished?.i+1||'-'}단계 ${lastFinished?.s.title||lastFinished?.t?.name||''}`)
      :(active?`${active.i+1}단계 · ${active.s.title||active.t?.name||'업무명 미정'}`:'진행 중인 단계 없음');
    // On the completed screen show only finished stages, never duplicate the
    // same project's stages in the right-hand general-work table.
    const shownSteps=steps;
    return `<article class="workflow-project-card-v17 ${completed?'workflow-project-completed-v173':''}${completed&&!fullyDone?' workflow-project-partial-v173':''}">
      <div class="workflow-project-top-v171"><span class="workflow-project-category-v171">${html(p.category||'미분류')}</span><span class="workflow-project-status-v171">${status}</span></div>
      <button type="button" class="workflow-project-title-v17" data-workflow-expand="${html(p.id)}" aria-expanded="${expand}">
        <span class="workflow-project-mark-v17" aria-hidden="true">▤</span>
        <span class="workflow-project-copy-v17"><b>${html(p.name||'프로젝트명 미정')}</b><small>${html(schedule)}</small></span>
        <span class="workflow-project-chevron-v171" aria-hidden="true">${expand?'▴':'▾'}</span>
      </button>
      <div class="workflow-project-info-v171"><span>총괄 ${html(manager)}</span><span>${finished}/${steps.length}단계 완료</span></div>
      <div class="workflow-project-progress-v171" role="progressbar" aria-label="프로젝트 진행률" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100"><span style="width:${percent}%"></span></div>
      <div class="workflow-project-next-v171"><span class="workflow-project-next-label-v171">${completed?'프로젝트 종료':'다음 단계'}</span><strong>${html(completed?`종료일 · ${p.workflowClosedAtV174||'-'}`:highlight)}</strong></div>
      <div class="workflow-project-steps-v17" ${expand?'':'hidden'}>${shownSteps.map(stageMarkup).join('')}<div class="workflow-project-actions-v174">${completed?'':`<button type="button" class="workflow-project-close-v174" data-workflow-project-close="${html(p.id)}">프로젝트 완료(종료)</button>`}<button type="button" class="workflow-project-edit-v17" data-workflow-project-edit="${html(p.id)}">프로젝트 수정</button></div></div>
    </article>`;
  }).join(''):`<p class="workflow-empty-v17">${completed?'종료 처리된 프로젝트가 없습니다.':'표시할 진행 프로젝트가 없습니다.'}</p>`;
}
async function closeProjectV174(id,button){
  if(button?.disabled)return;
  const p=state.projects.find(item=>item.id===id);if(!p)return;
  if(!canCloseProjectV174(p)){
    alert('프로젝트의 모든 단계가 완료된 후에 종료할 수 있습니다. 미완료 체크리스트나 단계 상태를 먼저 확인해 주세요.');return;
  }
  if(!confirm(`'${p.name}' 프로젝트를 완료(종료)하고 완료업무 목록으로 이동할까요?`))return;
  const previous=p.workflowClosedAtV174||null;
  p.workflowClosedAtV174=new Date().toISOString().slice(0,10);
  button.disabled=true;
  try{
    const saved=await saveState({reason:`프로젝트 종료 · ${p.name}`,projectSave:true,projectId:id});
    if(window.cloudSync?.mode==='cloud'&&!['server-confirmed','no-change'].includes(saved?.persistence))throw new Error('프로젝트 종료의 서버 확정을 확인하지 못했습니다.');
    reopenedProjects.delete(p.id);
    renderTaskTable();renderHome();
    if(typeof toast==='function')toast('프로젝트를 완료업무로 이동했습니다.');
  }catch(error){
    if(!error.serverConfirmed)p.workflowClosedAtV174=previous;
    alert(error.serverConfirmed?'서버 종료는 확인됐으나 로컬 캐시 저장에 실패했습니다. 서버 내용을 다시 확인해 주세요.':`프로젝트 종료를 저장하지 못했습니다. 입력과 서버 상태를 확인해 주세요.\n${error.message||error}`);
    renderTaskTable();
  }finally{if(button.isConnected)button.disabled=false;}
}
// When a finished project's checked item is re-opened, ask FIRST. The original
// project-ui handler is retained to update the exact checklist and persist it.
function completedProjectCheckGuardV174(event){
  const input=event.target?.closest?.('[data-prj-complete]');
  const manual=event.target?.closest?.('#prjManualComplete');
  if(!input&&!manual)return;
  let task;
  if(input){
    const checkId=input.dataset.prjComplete;
    task=state.tasks.find(item=>item.projectId&&item.checklist?.some(c=>c.id===checkId));
    const existing=task?.checklist?.find(c=>c.id===checkId);
    if(!existing?.done||input.checked!==false)return;
  }else{
    // For a stage with no checklist the manual-completion button may reopen it.
    const modal=get('#modalRoot .prj-task-modal');
    const title=modal?.querySelector('.modal-head h3')?.textContent;
    task=state.tasks.find(item=>item.projectId&&item.name===title);
    if(!task||!done(task))return;
  }
  const project=state.projects.find(p=>p.id===task?.projectId);
  if(!project?.workflowClosedAtV174)return;
  const accepted=confirm(`'${project.name}' 프로젝트의 완료 상태가 해제됩니다.\n진행(예정)업무로 되돌릴까요?`);
  if(!accepted){
    event.preventDefault();event.stopImmediatePropagation();
    if(input)input.checked=true;
    return;
  }
  project.workflowClosedAtV174=null;
  // The existing project-ui onchange handler will persist this change with the
  // checklist state. Keep the project displayed as active immediately.
  reopenedProjects.add(project.id);
}
document.addEventListener('click',completedProjectCheckGuardV174,true);
// Also protect changes coming from template editing or another local action:
// reopening a stage can never silently re-complete an already closed project.
const projectSaveBaseV174=saveState;
saveState=async function(...args){
  for(const p of state.projects||[]){
    if(p.workflowClosedAtV174&&!canCloseProjectV174(p))p.workflowClosedAtV174=null;
  }
  return projectSaveBaseV174.apply(this,args);
};

function ensureSplit(){
  const page=get('#taskListPage');if(!page)return;
  const table=page.querySelector(':scope > .tablewrap');
  if(!get('#workflowSplitV17')){
    const split=document.createElement('div');split.id='workflowSplitV17';split.className='workflow-split-v17';
    split.innerHTML=`<section class="workflow-column-v17" aria-label="프로젝트 목록"><header><h3 id="workflowProjectsHeadingV173">프로젝트 목록</h3><span id="workflowProjectsSubheadingV173">프로젝트별 단계 관리</span></header><div id="workflowProjectListV17"></div></section><section class="workflow-column-v17 workflow-general-v17" aria-label="단일 업무 목록"><header><h3 id="workflowGeneralHeadingV173">단일 업무 목록</h3><span id="workflowGeneralSubheadingV173">직접 등록 · 라이브러리 등록 업무</span></header><div id="workflowGeneralMountV17"></div></section>`;
    table?.insertAdjacentElement('beforebegin',split);
    get('#workflowGeneralMountV17',split)?.appendChild(table);
    get('#workflowProjectListV17',split)?.addEventListener('click',e=>{
      const expand=e.target.closest('[data-workflow-expand]');
      if(expand){const id=expand.dataset.workflowExpand;reopenedProjects.has(id)?reopenedProjects.delete(id):reopenedProjects.add(id);renderProjectCards(currentTaskViewV35?.()==='completed');return;}
      const close=e.target.closest('[data-workflow-project-close]');
      if(close){void closeProjectV174(close.dataset.workflowProjectClose,close);return;}
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
  const filteredIds=window.__wmTaskListFilteredIdsRelease instanceof Set?window.__wmTaskListFilteredIdsRelease:visibleIds;
  const projects=new Set((state.projects||[]).map(project=>project.id));
  const taskIds=new Set((state.tasks||[]).map(task=>task.id));
  const projectTaskIds=new Set((state.tasks||[]).filter(task=>task.projectId&&projects.has(task.projectId)).map(task=>task.id));
  if(typeof selectedTaskIdsV2!=='undefined'&&selectedTaskIdsV2 instanceof Set){
    for(const id of [...selectedTaskIdsV2]){
      if(!filteredIds.has(id)||!taskIds.has(id)||projectTaskIds.has(id))selectedTaskIdsV2.delete(id);
    }
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
  get('#workflowProjectsSubheadingV173').textContent=completed?'종료 버튼으로 확정한 프로젝트':'프로젝트별 단계 관리';
  get('#workflowGeneralHeadingV173').textContent=completed?'완료된 단일 업무':'단일 업무 목록';
  get('#workflowGeneralSubheadingV173').textContent=completed?'완료 처리된 단일 업무 기록':'직접 등록 · 라이브러리 등록 업무';
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
  menu.innerHTML='<button type="button" data-workflow-create="project" role="menuitem">▤ 프로젝트 등록</button><button type="button" data-workflow-create="normal" role="menuitem">＋ 단일 업무 등록</button>';
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
// v1.7.6: a library template is one object. Categorize it without splitting a
// multi-stage project into ordinary task records. This filter participates in
// the original table's selection logic (rather than merely hiding table rows).
let libraryTypeFilterV176='all';
const isProjectLibraryV176=t=>Boolean(t&&(t.libraryKindV175==='project'||(t.linkedSteps||[]).length>0));
const visibleDbRowsV176Base=dbVisibleRowsV10;
dbVisibleRowsV10=function(...args){
  const rows=visibleDbRowsV176Base.apply(this,args);
  return rows.filter(row=>{
    const project=isProjectLibraryV176(row.root);
    if(project&&row.kind!=='root')return false;
    return libraryTypeFilterV176==='all'||(libraryTypeFilterV176==='project'?project:!project);
  });
};
function ensureLibraryTypeFilterV176(){
  const page=get('#dbPage');if(!page)return;
  const toolbar=get('.toolbar',page),table=get('.tablewrap',page);
  if(!toolbar||!table)return;
  let holder=get('#libraryTypeFilterV176',page);
  if(!holder){
    holder=document.createElement('div');holder.id='libraryTypeFilterV176';
    holder.className='library-type-filter-v176';
    holder.setAttribute('role','group');holder.setAttribute('aria-label','업무 라이브러리 종류');
    toolbar.insertAdjacentElement('afterend',holder);
  }
  const projects=(state.templates||[]).filter(isProjectLibraryV176).length;
  const general=(state.templates||[]).length-projects;
  const counts={all:projects+general,general,project:projects};
  holder.innerHTML=[['all','전체'],['general','단일 업무'],['project','프로젝트']].map(([key,label])=>
    `<button type="button" data-library-type-v176="${key}" class="${key===libraryTypeFilterV176?'active':''}" aria-pressed="${key===libraryTypeFilterV176}">${label} <span class="library-type-count-v176">${counts[key]}</span></button>`
  ).join('');
  getAll('[data-library-type-v176]',holder).forEach(button=>button.onclick=()=>{
    libraryTypeFilterV176=button.dataset.libraryTypeV176;
    renderDbTable();
  });
}
function decorateLibraryTypesV176(){
  const body=get('#dbTableBody');if(!body)return;
  getAll('tr',body).forEach(row=>{
    const ref=get('[data-dbref]',row)?.dataset.dbref;
    if(!ref)return;
    const rootId=String(ref).split('|')[1];
    const template=(state.templates||[]).find(t=>String(t.id)===rootId);
    if(!template)return;
    const project=isProjectLibraryV176(template);
    const kind=project?'project':'general';
    const label=project?'프로젝트':'단일 업무';
    row.classList.add('library-row-type-v176',`library-row-${kind}-v176`);
    const title=row.cells[3];
    if(title&&!get('.library-type-chip-v176',title)){
      title.insertAdjacentHTML('beforeend',`<span class="library-type-chip-v176 ${kind}">${label}</span>`);
    }
    // An obsolete auto-registration status must never be mistaken for a type.
    if(row.cells[6])row.cells[6].innerHTML=`<span class="library-type-chip-v176 ${kind}">${label}</span>`;
    if(project&&row.cells[5])row.cells[5].textContent='—';
    if(!project&&row.cells[7])row.cells[7].textContent='—';
  });
  const headings=getAll('#dbPage .datatable thead th');
  if(headings[6])headings[6].textContent='유형';
  if(headings[7])headings[7].textContent='단계 구성';
}
// v1.7.7: One library project, with every stage shown in a handover-style detail.
function libraryProjectDetailV177(template){
  const steps=[{title:template.name||template.title||'1단계',checklist:template.checklist||[],method:template.method||'',methodBlocks:template.methodBlocks||[]},...(template.linkedSteps||[])];
  const stageText=steps.map((step,index)=>{
    const start=index===0?'프로젝트 기준일':('상위 업무 후 '+String(step.startOffsetDays??step.startOffset??step.startAfterDays??step.afterDays??0)+'일');
    const end=index===0?'단계 종료일':('상위 업무 후 '+String(step.endOffsetDays??step.endOffset??step.endAfterDays??step.deadlineOffset??0)+'일');
    const checks=(step.checklist||[]).map(c=>'<li>'+html(typeof c==='string'?c:c.text||c.title||'')+'</li>').join('');
    return '<section class="library-project-step-v177"><h4>'+html(index+1)+'단계 · '+html(step.title||step.name||step.taskName||'업무명 미정')+'</h4><p>'+html(start)+' ~ '+html(end)+'</p>'+ (checks?'<ul>'+checks+'</ul>':'')+'</section>';
  }).join('');
  const blocks=(template.methodBlocks||[]).map(b=>typeof b==='string'?b:(b.text||b.content||b.value||'')).filter(Boolean);
  const methods=[template.method||'',...blocks].filter(Boolean).join('\n\n');
  return '<div class="library-project-detail-v177"><div class="library-project-steps-v177">'+stageText+'</div><section class="library-project-method-v177"><h3>업무 수행방법</h3><div style="white-space:pre-wrap">'+html(methods||'등록된 업무 수행방법이 없습니다.')+'</div></section></div>';
}
function enhanceLibraryProjectDetailV177(){
  const dlg=get('#modalRoot .modal');if(!dlg)return;
  const body=get('.modal-body',dlg);if(!body||get('#libraryProjectDetailV177',dlg))return;
  const activeId=window.__libraryProjectDetailIdV177;
  const template=(state.templates||[]).find(t=>String(t.id)===String(activeId));
  if(!isProjectLibraryV176(template))return;
  const section=document.createElement('section');section.id='libraryProjectDetailV177';
  section.innerHTML=libraryProjectDetailV177(template);
  body.prepend(section);
}
if(typeof openDbDetailV6==='function'){
  const originalLibraryDetailV177=openDbDetailV6;
  openDbDetailV6=function(ref,...args){
    const parts=String(ref||'').split('|');
    const root=parts[0]==='root'?(state.templates||[]).find(t=>String(t.id)===parts[1]):null;
    window.__libraryProjectDetailIdV177=isProjectLibraryV176(root)?root.id:null;
    const result=originalLibraryDetailV177.call(this,ref,...args);
    if(root)enhanceLibraryProjectDetailV177();
    return result;
  };
}
const renderDbTableV176Base=renderDbTable;
renderDbTable=function(...args){
  const result=renderDbTableV176Base.apply(this,args);
  ensureLibraryTypeFilterV176();
  decorateLibraryTypesV176();
  return result;
};
ensureLibraryTypeFilterV176();
if(get('#dbPage.active'))renderDbTable();

window.WorkManagerReformV17={isLibrarySchedule,lookupLibraryRef,updateSplit,renameVisible,compactTaskBoardV172,stableLibraryLabelV172};
requestAnimationFrame(()=>{renameVisible();stableLibraryLabelV172();ensureCreateMenu();if(get('#taskListPage.active'))renderTaskTable();if(get('#dbPage.active'))renderDbTable()});
})();
