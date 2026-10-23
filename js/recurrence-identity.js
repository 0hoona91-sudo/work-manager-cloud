/* Pure recurrence identity and reconciliation plan; no IDs, clock or persistence. */
(function(host,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./date-only.js'):host.WMDateOnly,
    typeof module==='object'&&module.exports?require('./recurrence-rules.js'):host.WMRecurrenceRules);
  if(typeof module==='object'&&module.exports)module.exports=api;else host.WMRecurrenceIdentity=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(D,R){
  'use strict';
  const copy=value=>JSON.parse(JSON.stringify(value));
  function key(scope,origin,scheduled){
    if(typeof scope!=='string'||!scope||typeof origin!=='string'||!origin)throw new Error('반복 업무공간과 원본 ID가 필요합니다.');
    return `wm-recurrence:v1:${encodeURIComponent(scope)}:${encodeURIComponent(origin)}:${D.normalize(scheduled)}`;
  }
  const version=(state,scope,locks=[])=>JSON.stringify([scope,state.tasks,state.templates,state.holidays,state.settings?.suppressedAutoKeys,locks]);
  function plan(state,{scope,today,locks=[]}){
    key(scope,'validation',today);
    const additions=[],mappings=[],reservations=[],conflicts=[],warnings=[],reserved=new Set(state.settings?.suppressedAutoKeys||[]);
    const taskKeys=new Map(),lockKeys=new Map();
    for(const task of state.tasks||[])if(task.generatedKey){
      const list=taskKeys.get(task.generatedKey)||[];list.push(task);taskKeys.set(task.generatedKey,list);
    }
    for(const lock of locks)if(lock.generatedKey){
      const list=lockKeys.get(lock.generatedKey)||[];list.push(lock);lockKeys.set(lock.generatedKey,list);
    }
    const issue=(list,rootId,code,message)=>list.push({rootId,code,message});
    for(const root of state.tasks||[]){
      if(root.projectId||root.repeatGeneratedV181||root.parentAutoRootId||root.link||root.status==='done'||root.actualComplete||!root.dbManualRootTemplateId&&!root.dbSourceTemplateId)continue;
      const template=(state.templates||[]).find(t=>String(t.id)===String(root.dbManualRootTemplateId||root.dbSourceTemplateId));
      if(!template||template.libraryKindV175==='project'||template.linkedSteps?.length)continue;
      try{
        const rule=R.interpret(root,template);for(const warning of rule.warnings)warnings.push({rootId:root.id,...warning});
        if(!rule.kind)continue;
        const anchor=D.normalize(root.repeatAnchorDateV181||root.start),limit=R.until(root);
        const dates=R.plan({rule,anchor,today,until:limit,duration:D.difference(root.start,root.end||root.start),holidays:(state.holidays||[]).map(h=>h.date||h.day)});
        const slots=new Map();let ambiguous=false;
        for(const task of state.tasks||[]){
          if(task.id===root.id)continue;
          const linked=task.repeatOriginV181===root.id;
          const unbound=task.repeatGeneratedV181&&!task.repeatOriginV181&&task.dbManualRootTemplateId===root.dbManualRootTemplateId;
          if(!linked&&!unbound)continue;
          if(!linked||!D.isValid(task.repeatScheduledDateV181)){
            ambiguous=true;issue(conflicts,root.id,'AMBIGUOUS_OCCURRENCE','원래 회차일 또는 원본 연결이 없는 기존 회차를 확인해 주세요.');continue;
          }
          const raw=D.normalize(task.repeatScheduledDateV181),items=slots.get(raw)||[];items.push(task);slots.set(raw,items);
        }
        if(ambiguous)continue; // Never guess identity from a user-editable start date.
        const localMappings=[];
        for(const [raw,items] of slots){
          const expected=key(scope,root.id,raw),task=items[0];
          if(items.length>1){issue(conflicts,root.id,'DUPLICATE_SLOT','동일 원본·회차의 기존 업무가 여러 개입니다. 자동 병합하지 않습니다.');continue;}
          if(task.generatedKey){
            if((taskKeys.get(task.generatedKey)||[]).length>1||(lockKeys.get(task.generatedKey)||[]).some(l=>l.taskId!==task.id)||(taskKeys.get(expected)||[]).some(t=>t.id!==task.id)||(lockKeys.get(expected)||[]).some(l=>l.taskId!==task.id)){
              issue(conflicts,root.id,'KEY_COLLISION','기존 키의 소유권이 충돌합니다. 자동 변경하지 않습니다.');continue;
            }
            if(!reserved.has(expected))reservations.push(expected);
            continue; // Preserve the key; reserve its trusted raw slot as an alias.
          }
          if(reserved.has(expected)||(taskKeys.get(expected)||[]).some(t=>t.id!==task.id)||(lockKeys.get(expected)||[]).some(l=>l.taskId!==task.id)){
            issue(conflicts,root.id,'KEY_COLLISION','기존 생성키 또는 삭제 억제 정보와 충돌하여 호환 매핑을 보류합니다.');continue;
          }
          localMappings.push({taskId:task.id,generatedKey:expected});
        }
        mappings.push(...localMappings);
        for(const occurrence of dates.occurrences){
          if(occurrence.scheduled===anchor||slots.has(occurrence.scheduled))continue;
          const generatedKey=key(scope,root.id,occurrence.scheduled);
          if(taskKeys.has(generatedKey)){
            issue(conflicts,root.id,'KEY_COLLISION','다른 기존 업무가 같은 생성키를 사용합니다. 덮어쓰지 않습니다.');continue;
          }
          if(reserved.has(generatedKey)||lockKeys.has(generatedKey))continue;
          additions.push({rootId:root.id,generatedKey,occurrence,anchor,limit,holidayShift:rule.holidayShift});
        }
      }catch(error){issue(warnings,root.id,error.code||'INVALID_RULE',error.message);}
    }
    return {scope,today,base:version(state,scope,locks),additions,mappings,reservations,conflicts,warnings};
  }
  function apply(state,proposal,{scope,locks=[],id}){
    if(proposal.base!==version(state,scope,locks))throw new Error('반복 계획 이후 상태 또는 업무공간이 변경되었습니다. 다시 계산해 주세요.');
    const fresh=plan(state,{scope,today:proposal.today,locks});
    if(JSON.stringify(fresh)!==JSON.stringify(proposal))throw new Error('검토한 반복 계획과 적용할 계획이 다릅니다.');
    const additions=proposal.additions.map(item=>{
      const task=copy(state.tasks.find(t=>t.id===item.rootId));
      delete task.completionHistory;delete task.holidayAppliedV181;
      Object.assign(task,{id:`occurrence:${item.generatedKey}`,start:item.occurrence.start,end:item.occurrence.end,deadline:item.occurrence.end,
        generatedKey:item.generatedKey,repeatGeneratedV181:true,repeatOriginV181:item.rootId,repeatScheduledDateV181:item.occurrence.scheduled,
        repeatAnchorDateV181:item.anchor,repeatUntilV181:item.limit,status:'planned',actualComplete:null,
        manualOverride:true,scheduleOverride:true,seriesId:null,groupId:null,autoGeneratedV181:true});
      task.checklist=(task.checklist||[]).map(c=>({...c,id:id('check'),done:false}));
      if(item.holidayShift!=='keep')task.holidayAppliedV181=true;
      return task;
    });
    const ids=new Set((state.tasks||[]).map(t=>t.id));
    for(const task of additions){if(ids.has(task.id))throw new Error('새 업무 ID가 중복되었습니다.');ids.add(task.id);}
    // Reserve live and deleted keys in the existing schema11 suppression field.
    // Cloud generatedKeys supplies the durable server-side counterpart.
    const reserved=new Set(state.settings?.suppressedAutoKeys||[]);
    for(const item of [...proposal.mappings,...proposal.additions])reserved.add(item.generatedKey);
    for(const key of proposal.reservations)reserved.add(key);
    for(const item of proposal.mappings)state.tasks.find(t=>t.id===item.taskId).generatedKey=item.generatedKey;
    state.tasks.push(...additions);
    if(additions.length||proposal.mappings.length||proposal.reservations.length){state.settings||={};state.settings.suppressedAutoKeys=[...reserved];}
    return {added:additions.length,mapped:proposal.mappings.length,reserved:proposal.reservations.length};
  }
  return Object.freeze({key,version,plan,apply});
});
