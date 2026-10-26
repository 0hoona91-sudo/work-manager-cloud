/* 업무관리시스템 · 프로젝트 단계 모델. UI와 Firebase에 종속되지 않아 로컬 회귀테스트 가능. */
(function (host, factory) {
  const dates = typeof module === 'object' && module.exports ? require('./date-only.js') : host?.WMDateOnly;
  const api = factory(dates);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (host) host.WMProjectModel = api;
})(typeof window !== 'undefined' ? window : null, function (dates) {
  'use strict';
  if (!dates) throw new Error('공통 날짜 엔진을 불러오지 못했습니다.');
  const id = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,11)}`;
  const clone = (item) => JSON.parse(JSON.stringify(item));
  const isCompleted = task => Boolean(task && (task.status==='done'||task.actualComplete));
  const hasCompletionHistory = task => isCompleted(task)||Boolean(task?.completionHistory?.length);
  function completionDeletionError(){return new Error('완료 이력이 있는 단계 또는 프로젝트는 삭제할 수 없습니다. 이력 보관 정책이 마련될 때까지 원본을 유지해 주세요.');}
  function reopenTask(task,reopenedAt=new Date().toISOString()){
    if(!isCompleted(task))return false;
    if(task.completionHistory!==undefined&&!Array.isArray(task.completionHistory))throw new Error('완료 이력 형식을 확인해 주세요.');
    const {completionHistory=[],...snapshot}=clone(task);
    const history=[...completionHistory,{id:`${task.id}:completion:${completionHistory.length+1}`,reopenedAt,snapshot}];
    // Do not risk dropping a record to fit Firestore's document limit. No truncation.
    if(new TextEncoder().encode(JSON.stringify({...task,completionHistory:history})).length>512*1024)
      throw new Error('완료 이력 용량이 큽니다. 별도 보관 방식을 마련하기 전에는 재개할 수 없습니다.');
    task.completionHistory=history;
    task.status='progress';task.actualComplete=null;
    return true;
  }
  // Keep optional blank dates in the legacy facade; arithmetic requires a real date.
  const date = input => String(input ?? '').trim() ? dates.normalize(input) : '';
  // Existing UI callbacks accept a local Date. Only this compatibility boundary
  // constructs one; the engine itself receives canonical DateOnly strings.
  const calendar = holidayCheck => ({weekendDays:[], isHoliday:value=>holidayCheck(new Date(`${value}T12:00:00`))});
  function freshStep() {
    return { id:id('stage'),taskId:id('project-task'),title:'',participants:[],start:'',endType:'same',endDate:'',afterDays:0,includeHolidays:true,holidayShift:'keep',checklist:[],resources:[] };
  }
  function freshProject(now='') {
    return {id:id('project'), name:'', category:'',manager:'',start:now,end:'',stages:[freshStep()],createdAt:new Date().toISOString(),updatedAt:''};
  }
  function addStep(project){ project.stages.push(freshStep()); return project.stages.length-1; }
  function removeStep(project,index,tasks=[]){
    if (project.stages.length<=1) throw new Error('프로젝트에는 단계가 최소 1개 필요합니다.');
    if(index<0 || index>=project.stages.length) throw new Error('삭제할 단계가 없습니다.');
    if(tasks.some(t=>t.projectId===project.id&&t.projectStageId===project.stages[index].id&&hasCompletionHistory(t)))throw completionDeletionError();
    return project.stages.splice(index,1)[0];
  }
  function moveStep(project,from,to) {
    if(from<0||to<0||from>=project.stages.length||to>=project.stages.length) return false;
    if(from===to)return false;
    project.stages.splice(to,0,project.stages.splice(from,1)[0]);
    return true;
  }
  function dateAfter(start,n,includeHolidays,holidayCheck) {
    if(!start) return '';
    const offset = Number(n ?? 0);
    return includeHolidays || !holidayCheck ? dates.addDays(start,offset)
      : dates.addBusinessDays(start,offset,calendar(holidayCheck));
  }

  function stageEnd(step,holidayCheck,task){
    if(isCompleted(task)){
      const end=date(task.end);
      if(!end)throw new Error('완료 단계의 저장된 예정 종료일이 없습니다. 원본 기록을 확인해 주세요.');
      return end;
    }
    if(step.scheduleMode==='manual'){const start=date(step.start),end=date(step.endDate);if(!start||!end||end<start)throw new Error('직접 지정한 시작일과 종료일을 확인해 주세요.');return end;}
    const start = date(step.start);
    let end = step.endType==='date' ? date(step.endDate) : step.endType==='after' ? dateAfter(start,step.afterDays,step.includeHolidays,holidayCheck) : start;
    if(!end)end=start;
    if (end && step.holidayShift !== 'keep' && typeof holidayCheck==='function') {
      end=dates.shiftBusinessDay(end,step.holidayShift==='prev'?'prev':'next',calendar(holidayCheck),{maxIterations:40});
    }
    return end;
  }
  // Stages 2+ are scheduled relative to the previous stage's END, not fixed dates.
  // Legacy absolute dates are converted once to offsets so the first edit does not shift them.
  function dayDifference(from,to){
    const a=date(from),b=date(to);
    if(!a||!b)return 0;
    return dates.difference(a,b);
  }
  // State is an explicit read-only input. Completed anchors never come from a draft.
  function scheduleRecords(project,state){
    const original=(state?.projects||[]).find(p=>p.id===project.id);
    const tasks=new Map(), locked=new Map(), ids=new Set();
    for(const step of project.stages||[]){
      if(ids.has(step.id))throw new Error('중복된 단계 ID가 발견됐습니다.');
      ids.add(step.id);
    }
    for(const task of (state?.tasks||[]).filter(t=>t.projectId===project.id)){
      if(tasks.has(task.projectStageId))throw new Error('단계에 연결된 업무가 중복되었습니다. 원본 연결을 확인해 주세요.');
      tasks.set(task.projectStageId,task);
      if(!ids.has(task.projectStageId)&&hasCompletionHistory(task))throw completionDeletionError();
      if(!isCompleted(task))continue;
      const step=original?.stages.find(s=>s.id===task.projectStageId);
      if(!step||step.taskId!==task.id)throw new Error('완료 단계의 원본 연결을 확인할 수 없습니다. 저장을 중단합니다.');
      stageEnd(step,null,task); // Validate the persisted planned end, never actualComplete.
      locked.set(step.id,step);
    }
    return {original,tasks,locked};
  }
  function missingOffset(value){return value===undefined||value===null||value==='';}
  function initializeOffsets(project,holidayCheck,records){
    for(let i=1;i<project.stages.length;i++){
      const stage=project.stages[i];
      if(records.locked.has(stage.id)||stage.scheduleMode==='manual')continue;
      const oldIndex=records.original?.stages.findIndex(s=>s.id===stage.id)??-1;
      // Derive legacy offsets from the saved pair before a draft edit/reorder.
      const source=oldIndex>0?records.original.stages[oldIndex]:stage;
      const previous=oldIndex>0?records.original.stages[oldIndex-1]:project.stages[i-1];
      const baseline=stageEnd(previous,holidayCheck,records.tasks.get(previous.id))||previous.start||project.start;
      for(const [key,value] of [['relativeStartDays',source.start||baseline],
        ['relativeEndDays',stageEnd(source,holidayCheck)||source.start||baseline]]){
        if(missingOffset(stage[key]))stage[key]=!missingOffset(source[key])?Number(source[key]):dayDifference(baseline,value);
        if(!Number.isSafeInteger(Number(stage[key])))throw new Error('상대일수는 유한한 정수여야 합니다.');
      }
    }
  }
  function calculateSchedule(project,holidayCheck,state,apply){
    const working=clone(project),records=scheduleRecords(working,state);
    working.stages=working.stages.map(s=>records.locked.has(s.id)?clone(records.locked.get(s.id)):s);
    initializeOffsets(working,holidayCheck,records);
    if(apply)for(let i=0;i<working.stages.length;i++){
      const stage=working.stages[i];
      if(records.locked.has(stage.id))continue;
      if(stage.scheduleMode==='manual'){if(!date(stage.start)||!date(stage.endDate))throw new Error('직접 지정한 시작일과 종료일을 입력해 주세요.');stage.endType='date';}
      else if(i===0){stage.start=stage.start||working.start;}
      else{
        const previous=working.stages[i-1];
        const baseline=stageEnd(previous,holidayCheck,records.tasks.get(previous.id))||previous.start||working.start;
        // Relative offsets are calendar days from the previous effective planned end.
        // includeHolidays governs an 'after' duration, not the stored relative offsets.
        stage.start=dateAfter(baseline,Number(stage.relativeStartDays),true,holidayCheck);
        stage.endType='date';
        stage.endDate=dateAfter(baseline,Number(stage.relativeEndDays),true,holidayCheck);
      }
      const start=date(stage.start),end=stageEnd(stage,holidayCheck);
      if(start&&end&&end<start)throw new Error(`${i+1}단계의 종료일을 확인해 주세요.`);
    }
    return {working,records};
  }
  function commitSchedule(project,working,records){
    // Publish only after the entire calculation succeeds. Keep editable checklist
    // and resource references so existing UI event handlers remain attached.
    working.stages.forEach((step,i)=>{
      const target=project.stages[i];
      if(records.locked.has(step.id)){
        for(const key of Object.keys(target))delete target[key];
        Object.assign(target,step);
      }else for(const key of ['start','endType','endDate','relativeStartDays','relativeEndDays']){
        if(Object.hasOwn(step,key))target[key]=step[key];
      }
    });
    return project;
  }
  function initializeRelativeDates(project,holidayCheck,state){
    if(!project?.stages)return project;
    const {working,records}=calculateSchedule(project,holidayCheck,state,false);
    return commitSchedule(project,working,records);
  }
  function applyRelativeDates(project,holidayCheck,state){
    if(!project?.stages)return project;
    const {working,records}=calculateSchedule(project,holidayCheck,state,true);
    return commitSchedule(project,working,records);
  }
  function sanitizeResources(resources){
    return (resources||[]).map(({data,objectUrl,blobUrl,previewUrl,...item})=>clone(item));
  }
  function normalizeProject(draft,holidayCheck,state) {
    const p = clone(draft);
    p.name=String(p.name||'').trim();
    if(!p.name)throw new Error('프로젝트명을 입력해 주세요.');
    if(!p.category)throw new Error('구분을 선택해 주세요.');
    if(!p.manager)throw new Error('총괄담당자를 선택해 주세요.');
    p.start=date(p.start);p.end=date(p.end);
    if(!p.start)throw new Error('프로젝트 시작일을 입력해 주세요.');
    if(p.end&&p.end<p.start)throw new Error('프로젝트 종료일은 시작일 이후여야 합니다.');
    if(!p.stages?.length)throw new Error('단계를 추가해 주세요.');
    applyRelativeDates(p,holidayCheck,state);
    const {locked}=scheduleRecords(p,state);
    const ids=new Set(), taskIds=new Set();
    p.stages=p.stages.map((step,i)=>{
      const s=clone(step);s.id||=id('stage');s.taskId||=id('project-task');
      if(ids.has(s.id)||taskIds.has(s.taskId))throw new Error('중복된 단계 ID가 발견됐습니다.');
      ids.add(s.id);taskIds.add(s.taskId);
      if(locked.has(s.id))return s;
      s.title=String(s.title||'').trim();if(!s.title)throw new Error(`${i+1}단계의 세부 업무명을 입력해 주세요.`);
      s.participants=[...new Set((s.participants||[]).filter(Boolean))];
      s.start=date(s.start||p.start);
      if(s.endType==='date')s.endDate=date(s.endDate);
      const end=stageEnd(s,holidayCheck);
      if(!end||end<s.start)throw new Error(`${i+1}단계의 종료일을 확인해 주세요.`);
      s.checklist=(s.checklist||[]).filter(item=>String(item.text||'').trim()).map(item=>({
        id:item.id||id('check'),text:String(item.text).trim(),
        owner:s.participants.length===1 ? s.participants[0] : (s.participants.includes(item.owner)?item.owner:''),
        dueDate:date(item.dueDate),done:Boolean(item.done)
      }));
      s.resources=sanitizeResources(s.resources);
      return s;
    });
    p.updatedAt=new Date().toISOString();
    return p;
  }
  function visibleStage(project, stage, index){return `${project.name}-${index+1}단계[${stage.title}]`;}
  function existingCheckMap(task){return new Map((task?.checklist||[]).map(c=>[c.id,c]));}
  function checksForEdit(step,task){
    const lookup=existingCheckMap(task);
    return (step.checklist||[]).map(c=>({...c,done:lookup.has(c.id)?Boolean(lookup.get(c.id).done):Boolean(c.done)}));
  }
  function buildStageTask(project,step,index,previous,holidayCheck){
    if(isCompleted(previous))return clone(previous);
    const old=previous||{};
    const oldChecks=existingCheckMap(previous);
    const checks=(step.checklist||[]).map(c=>({
      id:c.id,text:c.text,owner:c.owner||'',dueDate:c.dueDate||'',done:oldChecks.has(c.id)?Boolean(oldChecks.get(c.id).done):Boolean(c.done)
    }));
    const end=stageEnd(step,holidayCheck);
    const isDone=checks.length>0&&checks.every(c=>c.done);
    let status=old.status||'planned',actualComplete=old.actualComplete||null;
    if(checks.length){
      // Reopening is explicit. A later project save must not undo that command.
      if(isDone&&!old.completionHistory?.length){status='done';actualComplete=actualComplete||new Date().toISOString().slice(0,10);}
    }
    return {...old,
      id:step.taskId,projectId:project.id,projectStageId:step.id,projectStageOrder:index+1,
      name:visibleStage(project,step,index),category:project.category,owner:step.participants[0]||project.manager,
      projectParticipants:[...step.participants],projectManager:project.manager,
      start:step.start,end,deadline:end,periodLabel:'프로젝트',
      projectResources:sanitizeResources(step.resources),checklist:checks,status,actualComplete,
      manualOverride:true,repeat:null,link:null,groupId:null,seriesId:null,templateId:null,dbAuto:false
    };
  }
  function reconcile(state, project, holidayCheck){
    project=normalizeProject(project,holidayCheck,state);
    const allTasks=state.tasks||[], oldProjects=state.projects||[];
    const oldProject=oldProjects.find(p=>p.id===project.id);
    const projectTaskSet=new Map(allTasks.filter(t=>t.projectId===project.id).map(t=>[t.projectStageId,t]));
    const proposedIds=new Set(project.stages.map(s=>s.id));
    if(allTasks.some(t=>t.projectId===project.id&&!proposedIds.has(t.projectStageId)&&hasCompletionHistory(t)))throw completionDeletionError();
    const stageIds=new Set(project.stages.map(s=>s.id));
    const deleted=allTasks.filter(t=>t.projectId===project.id&&!stageIds.has(t.projectStageId));
    const updated=project.stages.map((step,index)=>buildStageTask(project,step,index,projectTaskSet.get(step.id),holidayCheck));
    const result={
      projects:[...oldProjects.filter(p=>p.id!==project.id),project],
      tasks:[...allTasks.filter(t=>t.projectId!==project.id),...updated],
      deletedTaskIds:deleted.map(t=>t.id),isNew:!oldProject
    };
    return result;
  }
  function setCheck(task,checkId,done,completedDate){
    if(isCompleted(task))return false;
    const check=(task?.checklist||[]).find(c=>c.id===checkId);
    if(!check)return false;
    check.done=Boolean(done);
    if(task.checklist.length&&task.checklist.every(c=>c.done)){
      task.status='done';task.actualComplete=task.actualComplete||completedDate||new Date().toISOString().slice(0,10);
    }else{task.status='progress';task.actualComplete=null;}
    return true;
  }
  function removeProject(state,projectId){
    if((state.tasks||[]).some(t=>t.projectId===projectId&&hasCompletionHistory(t)))throw completionDeletionError();
    return {
    projects:(state.projects||[]).filter(p=>p.id!==projectId),
    tasks:(state.tasks||[]).filter(t=>t.projectId!==projectId)
  };}
  return {id,clone,date,isCompleted,hasCompletionHistory,reopenTask,freshStep,freshProject,addStep,removeStep,moveStep,stageEnd,initializeRelativeDates,applyRelativeDates,normalizeProject,visibleStage,checksForEdit,buildStageTask,reconcile,setCheck,removeProject};
});
