/* 업무관리시스템 · 프로젝트 단계 모델. UI와 Firebase에 종속되지 않아 로컬 회귀테스트 가능. */
(function (host, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (host) host.WMProjectModel = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
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
  // 프로젝트의 모든 날짜 입력에서 공통 사용. 내부 저장은 YYYY-MM-DD로 유지한다.
  // YYYYMD(202691), YYYYMDD(2026926), YYYYMMDD 및 구분자 입력을 지원한다.
  // 7자리의 10~12월(예: 2026101)은 두 자리 월을 우선한다.
  const date = (input) => {
    const text = String(input ?? '').trim();
    if (!text) return '';
    const separated = text.match(/^(\d{4})[-./]\s*(\d{1,2})[-./]\s*(\d{1,2})$/);
    let candidates=[];
    if (separated) {
      candidates=[[Number(separated[1]),Number(separated[2]),Number(separated[3])]];
    } else if (/^\d{6,8}$/.test(text)) {
      const y=Number(text.slice(0,4)), tail=text.slice(4);
      if(tail.length===2) candidates=[[y,Number(tail[0]),Number(tail[1])]];
      else if(tail.length===4) candidates=[[y,Number(tail.slice(0,2)),Number(tail.slice(2))]];
      else {
        const oneMonth=[y,Number(tail.slice(0,1)),Number(tail.slice(1))];
        const twoMonth=[y,Number(tail.slice(0,2)),Number(tail.slice(2))];
        candidates=(Number(tail.slice(0,2))>=10 && Number(tail.slice(0,2))<=12)
          ? [twoMonth,oneMonth] : [oneMonth,twoMonth];
      }
    } else {
      throw new Error('날짜는 YYYY-MM-DD 또는 YYYYMMDD 형식으로 입력해 주세요.');
    }
    for(const [y,m,d] of candidates){
      if(y<1000||y>9999||m<1||m>12||d<1||d>31)continue;
      const check=new Date(y,m-1,d,12);
      if(check.getFullYear()===y && check.getMonth()+1===m && check.getDate()===d)
        return `${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    }
    throw new Error('올바른 날짜를 입력해 주세요.');
  };
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
    const d = new Date(`${start}T12:00:00`);
    let count = Math.min(9999,Math.max(0,Number(n)||0));
    while(count>0){d.setDate(d.getDate()+1);if(includeHolidays||!holidayCheck||!holidayCheck(d))count--;}
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function stageEnd(step,holidayCheck){
    const start = date(step.start);
    let end = step.endType==='date' ? date(step.endDate) : step.endType==='after' ? dateAfter(start,step.afterDays,step.includeHolidays,holidayCheck) : start;
    if(!end)end=start;
    if (end && step.holidayShift !== 'keep' && typeof holidayCheck==='function') {
      const d=new Date(`${end}T12:00:00`);
      const inc=step.holidayShift==='prev'?-1:1;
      let guard=0;
      while(holidayCheck(d) && guard++<40)d.setDate(d.getDate()+inc);
      end=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }
    return end;
  }
  // Stages 2+ are scheduled relative to the previous stage's END, not fixed dates.
  // Legacy absolute dates are converted once to offsets so the first edit does not shift them.
  function dayDifference(from,to){
    const a=date(from),b=date(to);
    if(!a||!b)return 0;
    return Math.round((Date.parse(b+'T12:00:00Z')-Date.parse(a+'T12:00:00Z'))/86400000);
  }
  function initializeRelativeDates(project,holidayCheck){
    if(!project?.stages)return project;
    for(let i=1;i<project.stages.length;i++){
      const previous=project.stages[i-1],stage=project.stages[i];
      const baseline=stageEnd(previous,holidayCheck)||previous.start||project.start;
      if(!Number.isFinite(Number(stage.relativeStartDays))||stage.relativeStartDays===undefined||stage.relativeStartDays===null)
        stage.relativeStartDays=dayDifference(baseline,stage.start||baseline);
      if(!Number.isFinite(Number(stage.relativeEndDays))||stage.relativeEndDays===undefined||stage.relativeEndDays===null)
        stage.relativeEndDays=dayDifference(baseline,stageEnd(stage,holidayCheck)||stage.start||baseline);
    }
    return project;
  }
  function applyRelativeDates(project,holidayCheck){
    initializeRelativeDates(project,holidayCheck);
    for(let i=1;i<(project.stages||[]).length;i++){
      const previous=project.stages[i-1],stage=project.stages[i];
      const baseline=stageEnd(previous,holidayCheck)||previous.start||project.start;
      stage.start=dateAfter(baseline,Number(stage.relativeStartDays)||0,true,holidayCheck);
      // Offset can be negative in older projects: preserve it rather than silently changing the schedule.
      if(Number(stage.relativeStartDays)<0){
        const d=new Date(baseline+'T12:00:00');d.setDate(d.getDate()+Number(stage.relativeStartDays));
        stage.start=date(d.toISOString().slice(0,10));
      }
      const endOffset=Number(stage.relativeEndDays)||0;
      stage.endType='date';
      if(endOffset>=0)stage.endDate=dateAfter(baseline,endOffset,true,holidayCheck);
      else {const d=new Date(baseline+'T12:00:00');d.setDate(d.getDate()+endOffset);stage.endDate=date(d.toISOString().slice(0,10));}
    }
    return project;
  }
  function sanitizeResources(resources){
    return (resources||[]).map(({data,objectUrl,blobUrl,previewUrl,...item})=>clone(item));
  }
  function normalizeProject(draft,holidayCheck) {
    const p = clone(draft);
    p.name=String(p.name||'').trim();
    if(!p.name)throw new Error('프로젝트명을 입력해 주세요.');
    if(!p.category)throw new Error('구분을 선택해 주세요.');
    if(!p.manager)throw new Error('총괄담당자를 선택해 주세요.');
    p.start=date(p.start);p.end=date(p.end);
    if(!p.start)throw new Error('프로젝트 시작일을 입력해 주세요.');
    if(p.end&&p.end<p.start)throw new Error('프로젝트 종료일은 시작일 이후여야 합니다.');
    if(!p.stages?.length)throw new Error('단계를 추가해 주세요.');
    applyRelativeDates(p,holidayCheck);
    const ids=new Set(), taskIds=new Set();
    p.stages=p.stages.map((step,i)=>{
      const s=clone(step);s.id||=id('stage');s.taskId||=id('project-task');
      if(ids.has(s.id)||taskIds.has(s.taskId))throw new Error('중복된 단계 ID가 발견됐습니다.');
      ids.add(s.id);taskIds.add(s.taskId);
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
    project=clone(project);
    const allTasks=state.tasks||[], oldProjects=state.projects||[];
    const oldProject=oldProjects.find(p=>p.id===project.id);
    const projectTaskSet=new Map(allTasks.filter(t=>t.projectId===project.id).map(t=>[t.projectStageId,t]));
    const proposedIds=new Set(project.stages.map(s=>s.id));
    if(allTasks.some(t=>t.projectId===project.id&&!proposedIds.has(t.projectStageId)&&hasCompletionHistory(t)))throw completionDeletionError();
    // Completed stages are historical records: preserve dates even if the
    // project's overall schedule or a template is edited afterwards.
    const oldStageMap=new Map((oldProject?.stages||[]).map(step=>[step.id,step]));
    for(const step of project.stages){
      const previousTask=projectTaskSet.get(step.id);
      const originalStage=oldStageMap.get(step.id);
      if(!previousTask||!(previousTask.status==='done'||previousTask.actualComplete)||!originalStage)continue;
      for(const key of Object.keys(step))delete step[key];
      Object.assign(step,clone(originalStage));
      step.taskId=previousTask.id;
    }
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
