/* schema11 backup review: no DOM, SDK, uploads, migrations or state mutation. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.WMBackupSafety=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const clone=value=>JSON.parse(JSON.stringify(value));
  const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  const collections=['tasks','projects','templates','holidays'];
  const lists=['categories','owners','selectedCategories'];
  const protectedTask=t=>Boolean(t&&(t.status==='done'||t.actualComplete||t.completionHistory?.length));
  function version(value){
    if(Array.isArray(value))return '['+value.map(version).join(',')+']';
    if(object(value))return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+version(value[key])).join(',')+'}';
    return JSON.stringify(value);
  }
  const equal=(a,b)=>version(a)===version(b);
  function parse(text){
    if(typeof text!=='string'||new TextEncoder().encode(text).length>20*1024*1024)throw new Error('백업 JSON은 20MB 이하의 문자열이어야 합니다.');
    try{return JSON.parse(text);}catch{throw new Error('백업 JSON 구문이 올바르지 않습니다.');}
  }
  function validDate(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;}
  function validate(data){
    const errors=[],warnings=[];
    const fail=(path,message)=>errors.push(`${path}: ${message}`);
    if(!object(data))return {errors:['백업 최상위 객체가 없습니다.'],warnings};
    function inspect(value,path,depth=0){
      if(depth>60){fail(path,'중첩이 너무 깊습니다.');return;}
      if(!value||typeof value!=='object')return;
      for(const [key,child] of Object.entries(value)){
        if(['resources','projectResources','attachments','methodBlocks','photos'].includes(key)){
          if(!Array.isArray(child))fail(`${path}.${key}`,'파일/자료 배열 형식이 잘못되었습니다.');
          else if(child.some(ref=>!object(ref)))fail(`${path}.${key}`,'자료 항목은 메타데이터 객체여야 합니다.');
          else if(key==='methodBlocks'&&child.some(ref=>!['text','image','file'].includes(ref.type)))fail(`${path}.${key}`,'수행방법 항목 형식이 잘못되었습니다.');
        }
        if(['__proto__','constructor','prototype'].includes(key))fail(path,'허용되지 않는 객체 키입니다.');
        if(typeof child==='string'&&/^(?:data:|blob:)/i.test(child)&&/\.(attachments|resources|projectResources|methodBlocks|photos)(?:\[|\.)/.test(path))fail(path,'파일 본문/임시 URL 대신 원본 참조가 필요합니다.');
        if(['data','objectUrl','blobUrl','previewUrl'].includes(key)&&child&&typeof child==='string'&&/\.(attachments|resources|projectResources|methodBlocks|photos)\[/.test(path))fail(path,'인라인 파일/임시 URL은 가져올 수 없습니다. 원본 참조가 필요합니다.');
        inspect(child,Array.isArray(value)?`${path}[${key}]`:`${path}.${key}`,depth+1);
      }
    }
    inspect(data,'backup');
    for(const key of [...collections,...lists,'changeLogs'])if(!Array.isArray(data[key]))fail(key,'필수 배열이 누락되었거나 형식이 잘못되었습니다.');
    for(const {path,ref} of attachments(data)){
      if(typeof ref.id!=='string'||!ref.id)fail(path,'첨부 ID가 없습니다.');
      for(const key of ['driveFileId','localFileId','fileId','name','mimeType'])if(ref[key]!==undefined&&typeof ref[key]!=='string')fail(path,'첨부 참조/메타데이터 형식이 잘못되었습니다.');
      if(ref.size!==undefined&&(typeof ref.size!=='number'||!Number.isFinite(ref.size)||ref.size<0))fail(path,'첨부 크기가 잘못되었습니다.');
      if(!ref.driveFileId&&!ref.localFileId&&!ref.fileId)warnings.push(`${path}: 첨부 원본 연결이 누락되었습니다. 원본 업로드/조회는 하지 않습니다.`);
    }
    if(!object(data.settings))fail('settings','필수 설정 객체가 없습니다.');
    if(data.backupMeta!==undefined&&!object(data.backupMeta))fail('backupMeta','백업 메타데이터 객체가 필요합니다.');
    const declared=data.backupMeta?.schemaVersion??data.schemaVersion;
    if(declared!==undefined&&declared!==11)fail('schemaVersion','schema11 백업만 지원합니다. 자동 변환하지 않습니다.');
    if(declared===undefined)warnings.push('스키마 표기가 없습니다. 필수 schema11 구조로 검증합니다.');
    const checkId=(value,path)=>{if(typeof value!=='string'||!value.trim()||value.includes('/')||value.length>1000)fail(path,'유효한 ID가 필요합니다.');};
    function checks(items,path,strings=false){
      if(!Array.isArray(items)){fail(path,'체크리스트 배열이 필요합니다.');return;}
      const ids=new Set();
      for(const [i,c] of items.entries()){
        if(strings){if(typeof c!=='string')fail(`${path}[${i}]`,'템플릿 체크리스트는 문자열이어야 합니다.');continue;}
        if(!object(c)){fail(path,'체크 항목 객체가 필요합니다.');continue;}
        checkId(c.id,path);if(ids.has(c.id))fail(path,'체크 항목 ID 중복입니다.');ids.add(c.id);
        if(typeof c.text!=='string'||typeof c.done!=='boolean')fail(path,'체크 문구/완료 여부 형식이 잘못되었습니다.');
        if(c.dueDate&&!validDate(c.dueDate))fail(path,'체크 마감일이 잘못되었습니다.');
      }
    }
    function task(t,path,snapshot=false){
      if(typeof t.name!=='string'||!t.name.trim())fail(path,'업무명이 필요합니다.');
      if(!['planned','prep','progress','done','hold','overdue'].includes(t.status))fail(path,'업무 상태가 잘못되었습니다.');
      if(!validDate(t.start)||!validDate(t.end))fail(path,'업무 시작일/종료일이 잘못되었습니다.');
      for(const key of ['deadline','actualComplete'])if(t[key]!==undefined&&t[key]!==null&&t[key]!==''&&!validDate(t[key]))fail(path,key+' 날짜가 잘못되었습니다.');
      checks(t.checklist,path+'.checklist');
      if(snapshot&&Object.hasOwn(t,'completionHistory'))fail(path,'이력 스냅샷을 재귀 저장할 수 없습니다.');
      if(t.completionHistory!==undefined){
        if(!Array.isArray(t.completionHistory)){fail(path,'completionHistory 배열이 필요합니다.');return;}
        const ids=new Set();
        for(const h of t.completionHistory){
          if(!object(h)){fail(path,'이력 객체가 필요합니다.');continue;}
          checkId(h.id,path);if(ids.has(h.id))fail(path,'완료 이력 ID 중복입니다.');ids.add(h.id);
          if(typeof h.reopenedAt!=='string'||Number.isNaN(Date.parse(h.reopenedAt)))fail(path,'재개 시각이 잘못되었습니다.');
          if(!object(h.snapshot)||h.snapshot.id!==t.id||!(h.snapshot.status==='done'||h.snapshot.actualComplete))fail(path,'완료 이력 원본이 잘못되었습니다.');
          else task(h.snapshot,path+'.snapshot',true);
        }
      }
    }
    for(const key of collections){
      const ids=new Set();
      for(const item of Array.isArray(data[key])?data[key]:[]){
        if(!object(item)){fail(key,'항목 객체가 필요합니다.');continue;}
        checkId(item.id,key);if(ids.has(item.id))fail(key,'동일 ID가 중복되었습니다.');ids.add(item.id);
        if(key==='tasks')task(item,`tasks/${item.id}`);
        if(key==='projects'){
          if(typeof item.name!=='string'||!Array.isArray(item.stages)||!item.stages.length){fail(key,'프로젝트명/단계가 필요합니다.');continue;}
          if(!validDate(item.start)||(item.end&&!validDate(item.end)))fail(key,'프로젝트 날짜가 잘못되었습니다.');
          const stages=new Set(),tasks=new Set();
          for(const stage of item.stages){
            if(!object(stage)){fail(key,'단계 객체가 필요합니다.');continue;}
            checkId(stage.id,key);checkId(stage.taskId,key);
            if(stages.has(stage.id)||tasks.has(stage.taskId))fail(key,'단계/업무 ID 중복입니다.');stages.add(stage.id);tasks.add(stage.taskId);
            if(!validDate(stage.start)||!['same','after','date'].includes(stage.endType)||(stage.endType==='date'&&!validDate(stage.endDate)))fail(key,'단계 일정 형식이 잘못되었습니다.');
            if(typeof stage.title!=='string'||!Array.isArray(stage.participants)||stage.participants.some(v=>typeof v!=='string'))fail(key,'단계명/참여자 형식이 잘못되었습니다.');
            checks(stage.checklist,key+'.checklist');
          }
        }
        if(key==='templates'){
          if(typeof item.name!=='string'||!item.name.trim())fail(key,'템플릿명이 필요합니다.');
          checks(item.checklist,key+'.checklist',true);
          if(item.linkedSteps!==undefined&&!Array.isArray(item.linkedSteps))fail(key,'하위 단계 배열이 필요합니다.');
          for(const step of Array.isArray(item.linkedSteps)?item.linkedSteps:[])if(!object(step))fail(key,'하위 단계 객체가 필요합니다.');else checks(step.checklist,key+'.linkedSteps.checklist',true);
        }
        if(key==='holidays'&&!validDate(item.date))fail(key,'휴일 날짜가 잘못되었습니다.');
      }
    }
    for(const key of lists)if(Array.isArray(data[key])&&data[key].some(v=>typeof v!=='string'))fail(key,'문자열 배열이 필요합니다.');
    return {errors,warnings};
  }
  function attachments(value,path='',out=[],depth=0){
    if(!value||typeof value!=='object'||depth>60)return out;
    for(const [key,child] of Object.entries(value)){
      if(['resources','projectResources','attachments','methodBlocks','photos'].includes(key)&&Array.isArray(child)){
        for(const [i,ref] of child.entries())if(object(ref)&&ref.type!=='text')out.push({path:`${path}.${key}[${i}]`,ref});
      }
      if(child&&typeof child==='object')attachments(child,`${path}.${key}`,out,depth+1);
    }
    return out;
  }
  function referenceErrors(data){
    const errors=[],tasks=new Map(data.tasks.map(t=>[t.id,t])),projects=new Map(data.projects.map(p=>[p.id,p]));
    const keys=new Map(),files=new Map();
    for(const t of data.tasks){
      if(t.projectId){const stage=projects.get(t.projectId)?.stages.find(s=>s.id===t.projectStageId);if(!stage||stage.taskId!==t.id)errors.push(`tasks/${t.id}: 프로젝트/단계 참조가 일치하지 않습니다.`);}
      if(t.link?.parentId&&!tasks.has(t.link.parentId))errors.push(`tasks/${t.id}: 상위 업무 참조가 없습니다.`);
      if(t.generatedKey){if(typeof t.generatedKey!=='string'||(keys.has(t.generatedKey)&&keys.get(t.generatedKey)!==t.id))errors.push(`tasks/${t.id}: generatedKey가 중복되거나 잘못되었습니다.`);keys.set(t.generatedKey,t.id);}
    }
    for(const p of data.projects)for(const s of p.stages){const t=tasks.get(s.taskId);if(!t||t.projectId!==p.id||t.projectStageId!==s.id)errors.push(`projects/${p.id}/${s.id}: 연결 업무 참조가 없습니다.`);}
    for(const {path,ref} of attachments(data)){
      if(typeof ref.id!=='string'||!ref.id)errors.push(`${path}: 첨부 ID가 없습니다.`);
      const identity={};for(const key of ['driveFileId','localFileId','fileId','name','mimeType','size'])if(ref[key]!==undefined)identity[key]=ref[key];
      if(files.has(ref.id)&&!equal(files.get(ref.id),identity))errors.push(`${path}: 첨부 ID/메타데이터 참조 충돌입니다.`);files.set(ref.id,identity);
      for(const key of ['driveFileId','localFileId','fileId'])if(ref[key]!==undefined&&typeof ref[key]!=='string')errors.push(`${path}: 첨부 참조 형식이 잘못되었습니다.`);
    }
    return errors;
  }
  // Keep absent current fields, including unknown extensions. Array removals are
  // only available for explicitly selected, non-historical records.
  function overlay(current,incoming){
    if(object(current)&&object(incoming)){
      const out=clone(current);for(const [key,value] of Object.entries(incoming))out[key]=Object.hasOwn(current,key)?overlay(current[key],value):clone(value);return out;
    }
    if(Array.isArray(current)&&Array.isArray(incoming))return incoming.map((value,i)=>{
      const old=object(value)&&value.id?current.find(c=>c?.id===value.id):current[i];return old===undefined?clone(value):overlay(old,value);
    });
    return clone(incoming);
  }
  function differences(current,backup,path=''){
    if(equal(current,backup))return [];
    if(object(current)&&object(backup))return [...new Set([...Object.keys(current),...Object.keys(backup)])].flatMap(key=>differences(current[key],backup[key],path?`${path}.${key}`:key));
    return [{path:path||'(전체)',current:current===undefined?'(없음)':clone(current),backup:backup===undefined?'(없음)':clone(backup)}];
  }
  function prepare(current,incoming,{mode='merge',choices={},locks=[],contextVersion=''}={}){
    const checked=validate(incoming),existing=validate(current);
    const plan={mode,choices:clone(choices),locks:clone(locks),contextVersion,baseVersion:version(current),incoming:clone(incoming??null),errors:[...checked.errors,...existing.errors.map(e=>'현재 데이터: '+e)],warnings:[...checked.warnings],conflicts:[],referenceConflicts:[],protectedConflicts:[],counts:{},next:null};
    if(!['merge','replace'].includes(mode))plan.errors.push('가져오기 방식이 잘못되었습니다.');
    if(plan.errors.length)return plan;
    // Input references may point to records that already exist in the current workspace.
    const next=clone(current),protectedProjects=new Set(current.tasks.filter(protectedTask).map(t=>t.projectId).filter(Boolean));
    const protectedTemplates=new Set(current.tasks.filter(t=>protectedTask(t)||protectedProjects.has(t.projectId)).flatMap(t=>[t,...(t.completionHistory||[]).map(h=>h.snapshot)]).flatMap(t=>['templateId','autoSourceTemplateId','dbManualRootTemplateId','dbSourceTemplateId','sourceTemplateId'].map(k=>t[k])).filter(Boolean));
    const recordProtected=(key,item)=>(key==='tasks'&&(protectedTask(item)||protectedProjects.has(item?.projectId)))||(key==='projects'&&protectedProjects.has(item?.id))||(key==='templates'&&protectedTemplates.has(item?.id));
    const keys=new Map(current.tasks.filter(t=>t.generatedKey).map(t=>[t.generatedKey,t.id]));
    for(const lock of locks)if(lock.generatedKey&&!keys.has(lock.generatedKey))keys.set(lock.generatedKey,lock.taskId);
    const files=new Map();
    for(const {ref} of attachments(current))files.set(ref.id,ref);
    function refCollision(item,old){
      const collisions=[];
      if(item.generatedKey&&keys.has(item.generatedKey)&&(!old||keys.get(item.generatedKey)!==item.id))collisions.push({kind:'generatedKey',path:'generatedKey',current:keys.get(item.generatedKey),backup:item.generatedKey});
      for(const {path,ref} of attachments(item))if(files.has(ref.id)){
        const original=files.get(ref.id),fields=['driveFileId','localFileId','fileId','name','mimeType','size'];
        if(fields.some(k=>!equal(original[k],ref[k])))collisions.push({kind:'attachment',path,current:clone(original),backup:clone(ref)});
      }
      return collisions;
    }
    for(const key of collections){
      const old=new Map(current[key].map(item=>[item.id,item])),seen=new Set(),result=[];
      const count=plan.counts[key]={added:0,identical:0,conflict:0,removed:0,retained:0};
      for(const item of incoming[key]){
        seen.add(item.id);const prior=old.get(item.id),path=`${key}/${item.id}`;
        const protectedRecord=recordProtected(key,prior);
        const refs=refCollision(item,prior);plan.referenceConflicts.push(...refs.map(r=>({...r,entity:path})));
        if(prior&&equal(prior,item)){result.push(clone(prior));count.identical++;continue;}
        if(prior||refs.length){
          count.conflict++;const conflict={key:path,protected:protectedRecord||refs.length>0,current:prior?clone(prior):null,backup:clone(item),differences:differences(prior,item)};
          plan.conflicts.push(conflict);if(protectedRecord)plan.protectedConflicts.push(conflict);
          if(prior)result.push(choices[path]==='backup'&&!conflict.protected?overlay(prior,item):clone(prior));
        }else{result.push(clone(item));count.added++;}
      }
      for(const prior of current[key])if(!seen.has(prior.id)){
        const protectedRecord=recordProtected(key,prior);
        if(mode==='merge'||protectedRecord){result.push(clone(prior));if(mode==='replace'){count.retained++;plan.warnings.push(`${key}/${prior.id}: 백업에 없어도 완료 이력을 보존합니다.`);}}
        else count.removed++;
      }
      // Current order stays stable; new records follow in incoming order.
      const order=new Map(current[key].map((item,i)=>[item.id,i]));result.sort((a,b)=>(order.get(a.id)??Infinity)-(order.get(b.id)??Infinity));next[key]=result;
    }
    for(const key of lists)next[key]=[...new Set([...current[key],...incoming[key]])];
    if(!equal(current.settings,incoming.settings)){
      const key='settings/main';plan.conflicts.push({key,protected:false,current:clone(current.settings),backup:clone(incoming.settings),differences:differences(current.settings,incoming.settings)});
      if(choices[key]==='backup')next.settings=overlay(current.settings,incoming.settings);
    }
    // Never import audit records or overwrite an existing local-only API setting.
    next.settings.holidayApiKey=current.settings.holidayApiKey||'';
    next.changeLogs=clone(current.changeLogs);
    plan.warnings.push('기존 변경이력·알 수 없는 최상위 필드·구분/담당자 목록은 보존합니다. 첨부 원본은 JSON에 포함되지 않습니다.');
    // Also refuse broken references in the source, even when a protected current
    // record would otherwise hide that malformed incoming record.
    const sourceProjects=new Map(mergeById(incoming.projects,current.projects).map(p=>[p.id,p]));
    const sourceTasks=new Map(mergeById(incoming.tasks,current.tasks).map(t=>[t.id,t]));
    for(const t of incoming.tasks){
      if(t.projectId){const stage=sourceProjects.get(t.projectId)?.stages.find(s=>s.id===t.projectStageId);if(!stage||stage.taskId!==t.id)plan.errors.push(`tasks/${t.id}: 백업 프로젝트/단계 참조가 없습니다.`);}
      if(t.link?.parentId&&!sourceTasks.has(t.link.parentId))plan.errors.push(`tasks/${t.id}: 백업 상위 업무 참조가 없습니다.`);
    }
    for(const p of incoming.projects)for(const s of p.stages){const t=sourceTasks.get(s.taskId);if(!t||t.projectId!==p.id||t.projectStageId!==s.id)plan.errors.push(`projects/${p.id}/${s.id}: 백업 연결 업무 참조가 없습니다.`);}
    plan.errors.push(...referenceErrors(next));
    plan.next=next;return plan;
  }
  // Detect fields a legacy cloud codec would silently drop. Refuse the import
  // rather than extending or migrating that codec in this phase.
  function missingFields(source,stored,path=''){
    if(Array.isArray(source))return source.flatMap((item,i)=>missingFields(item,Array.isArray(stored)?stored[i]:undefined,`${path}[${i}]`));
    if(object(source))return Object.entries(source).flatMap(([key,value])=>!object(stored)||!Object.hasOwn(stored,key)?[`${path}.${key}`]:missingFields(value,stored[key],`${path}.${key}`));
    return equal(source,stored)?[]:[path];
  }
  function stale(){const error=new Error('미리보기 이후 현재 데이터 또는 연결 계정이 변경되었습니다. 취소 후 새 미리보기를 확인해 주세요.');error.code='backup/stale';return error;}
  async function execute(review,ports,{confirmed=false,replaceConfirmed=false}={}){
    if(!confirmed)throw new Error('가져오기 확인이 필요합니다.');
    if(review.mode==='replace'&&!replaceConfirmed)throw new Error('전체 복원의 삭제 경고에 명시적으로 확인해야 합니다.');
    const assertFresh=()=>{if(version(ports.getCurrent())!==review.baseVersion||(ports.getVersion?.()||'')!==review.contextVersion)throw stale();};
    assertFresh();
    const verified=prepare(ports.getCurrent(),review.incoming,review);
    if(review.errors.length||verified.errors.length)throw new Error('백업 검증 오류: '+[...review.errors,...verified.errors].join('\n'));
    if(!equal(verified.next,review.next))throw new Error('미리보기 결과가 변경되었습니다. 다시 확인해 주세요.');
    const recovery={schemaVersion:11,createdAt:new Date().toISOString(),mode:review.mode,before:clone(ports.getCurrent()),after:clone(verified.next)};
    await ports.persistRecovery(recovery);
    assertFresh();
    try{
      await ports.write(clone(verified.next),review);
      // Do not publish over an edit made while persistence was awaiting I/O.
      if(version(ports.getCurrent())!==review.baseVersion)throw stale();
      ports.publish(clone(verified.next));
      return {status:'saved',next:clone(verified.next)};
    }catch(error){
      error.recoveryRequired=true;
      error.recovery=recovery;
      throw error;
    }
  }
  function mergeById(current,incoming){
    const out=current.map(clone),seen=new Set(current.map(item=>item.id));
    for(const item of incoming)if(!seen.has(item.id)){out.push(clone(item));seen.add(item.id);}
    return out;
  }
  return {parse,validate,version,equal,protectedTask,prepare,execute,mergeById,missingFields};
});
