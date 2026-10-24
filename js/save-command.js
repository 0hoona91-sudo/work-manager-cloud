/* Application commands over schema11. No DOM, SDK, clock, random IDs or transport ownership. */
(function(host,factory){const api=factory(typeof module==='object'&&module.exports?require('./date-only.js'):host.WMDateOnly);if(typeof module==='object'&&module.exports)module.exports=api;else host.WMSaveCommand=api;})(typeof globalThis!=='undefined'?globalThis:this,function(D){
  'use strict';
  const copy=value=>JSON.parse(JSON.stringify(value));
  function canonical(value){
    if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
    if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
    return JSON.stringify(value);
  }
  const equal=(a,b)=>canonical(a)===canonical(b);
  const editable=Object.freeze(['name','category','owner','urgent','start','end','deadline','endRule','unconfirmed','checklist','notes','periodLabel','workType']);
  function error(code,message){return Object.assign(new Error(message),{code});}
  function ordinary(task){return !!task&&!['projectId','groupId','link','repeat','seriesId','parentSeriesId','parentAutoRootId','templateId','dbManualRootTemplateId','dbSourceTemplateId','autoSourceTemplateId','generatedKey','repeatOriginV181','dbAuto','dbManual'].some(k=>task[k]);}
  function fields(before={},after={}){return [...new Set([...Object.keys(before),...Object.keys(after)])].sort().filter(k=>!equal(before[k],after[k]));}
  function changeSet(before,after,{operationId,type}){
    const changes=[];
    for(const collection of [...new Set([...Object.keys(before),...Object.keys(after)])].sort()){
      const a=before[collection],b=after[collection];
      if(equal(a,b))continue;
      if(Array.isArray(a)&&Array.isArray(b)&&[...a,...b].every(v=>v&&typeof v.id==='string')){
        const am=new Map(a.map(v=>[v.id,v])),bm=new Map(b.map(v=>[v.id,v]));
        if(am.size!==a.length||bm.size!==b.length)throw error('validation','중복 ID는 변경 비교 전에 해결해야 합니다.');
        for(const id of [...new Set([...am.keys(),...bm.keys()])].sort())if(!equal(am.get(id),bm.get(id)))changes.push({collection,id,action:!am.has(id)?'add':!bm.has(id)?'delete':'update',fields:fields(am.get(id),bm.get(id)),before:am.get(id)||null,after:bm.get(id)||null});
        if(!equal(a.map(v=>v.id),b.map(v=>v.id)))changes.push({collection,action:'order',fields:['order'],before:a.map(v=>v.id),after:b.map(v=>v.id)});
      }else changes.push({collection,action:'update',fields:a&&b&&typeof a==='object'&&typeof b==='object'?fields(a,b):[collection],before:a??null,after:b??null});
    }
    return copy({operationId,type,baseVersion:canonical(before),before,after,changes,taskIds:[...new Set(changes.filter(c=>c.collection==='tasks'&&c.id).map(c=>c.id))]});
  }
  function validateTask(task){
    if(typeof task.id!=='string'||!task.id||typeof task.name!=='string'||!task.name.trim())throw error('validation','업무 ID와 업무명이 필요합니다.');
    for(const field of ['start','end','deadline'])if(task[field]&&!D.isValid(task[field]))throw error('validation','유효한 날짜를 입력하세요.');
    if(task.start&&task.end&&task.end<task.start)throw error('validation','종료일은 시작일보다 빠를 수 없습니다.');
    const ids=new Set();for(const c of task.checklist||[]){if(!c.id||ids.has(c.id))throw error('validation','체크 항목 ID가 없거나 중복됩니다.');ids.add(c.id);}
  }
  function plan(state,command){
    if(!Array.isArray(state.tasks)||new Set(state.tasks.map(t=>t.id)).size!==state.tasks.length)throw error('validation','업무 목록 또는 ID가 올바르지 않습니다.');
    const next=copy(state),index=next.tasks.findIndex(t=>t.id===command.taskId),current=next.tasks[index];
    if(command.type==='task.create'){
      const task=copy(command.task);if(next.tasks.some(t=>t.id===task.id))throw error('conflict','같은 업무 ID가 이미 있습니다.');
      if(!ordinary(task)||task.status==='done'||task.actualComplete||task.completionHistory?.length)throw error('validation','독립적인 미완료 일반 업무만 등록할 수 있습니다.');
      validateTask(task);next.tasks.push(task);
    }else{
      if(!current||!equal(current,command.expected))throw error('conflict','업무가 수정 화면을 연 뒤 변경되었습니다. 입력을 보존하고 다시 확인해 주세요.');
      if(!ordinary(current)||current.status==='done'||current.actualComplete)throw error('validation','이 업무는 기존 전용 저장 경로를 사용해야 합니다.');
      if(command.type==='task.update'){
        if(!command.patch||Object.keys(command.patch).some(k=>!editable.includes(k)))throw error('validation','보호 필드는 일반 수정으로 변경할 수 없습니다.');
        Object.assign(current,copy(command.patch));validateTask(current);
      }else if(command.type==='task.delete'){
        if(current.completionHistory?.length)throw error('validation','완료 이력이 있는 업무는 이 경로에서 삭제할 수 없습니다.');
        next.tasks.splice(index,1);
      }else throw error('validation','지원하지 않는 작업 유형입니다.');
    }
    return changeSet(state,next,command);
  }
  function create({getState,getContext,persist,onStatus=()=>{}}){
    const operations=new Map();let tail=Promise.resolve(),status={phase:'idle'},blocked=false,dirty=false;
    const publish=value=>{status=value;try{onStatus(copy(value));}catch{/* UI observers cannot change persistence outcomes. */}};
    function execute(input){
      const command=copy(input),signature=canonical(command);
      if(!command.operationId||typeof command.operationId!=='string')return Promise.reject(error('validation','operationId가 필요합니다.'));
      const old=operations.get(command.operationId);
      if(old)return old.signature===signature?old.promise:Promise.reject(error('conflict','같은 operationId에 다른 명령을 사용할 수 없습니다.'));
      const context=Object.hasOwn(command,'context')?command.context:getContext();
      const run=async()=>{
        let applied=false,changes;
        try{
          if(blocked)throw error('recovery-required','이전 저장 결과 확인이 필요합니다. 자동 재시도하지 않습니다.');
          publish({phase:'validating',operationId:command.operationId,type:command.type});
          if(!context||context!==getContext())throw error('conflict','계정 또는 업무공간이 변경되었습니다.');
          const state=getState();changes=plan(state,command);
          if(!changes.changes.length){publish({phase:dirty?'pending-sync':'idle',operationId:command.operationId,noChange:true});return {...status,changeSet:changes};}
          // Apply this command's target only. Never roll the whole state back after I/O.
          const targetId=command.type==='task.create'?command.task.id:command.taskId;
          const next=changes.after.tasks.find(t=>t.id===targetId),index=state.tasks.findIndex(t=>t.id===targetId);
          if(index<0)state.tasks.push(copy(next));else if(!next)state.tasks.splice(index,1);else Object.assign(state.tasks[index],copy(next));
          applied=true;dirty=true;publish({phase:'saving',operationId:command.operationId,type:command.type});
          const receipt=await persist({operationId:command.operationId,type:command.type,changeSet:changes,context});
          if(context!==getContext())throw error('recovery-required','저장 중 계정 또는 업무공간이 변경되었습니다. 서버 결과를 확인해 주세요.');
          if(receipt?.phase==='conflict'||receipt?.recurrenceReconciled)throw error('conflict','서버 충돌을 확인해 주세요. 현재 입력은 보존했습니다.');
          const confirmed=receipt?.persistence==='server-confirmed'&&receipt.operationId===command.operationId;
          dirty=!confirmed||!equal(getState(),changes.after);
          publish({phase:confirmed?'saved':'pending-sync',operationId:command.operationId,type:command.type,persistence:confirmed?'server-confirmed':'unconfirmed'});
          return {...status,changeSet:changes};
        }catch(cause){
          const uncertain=cause.recoveryRequired||cause.committedChunks>0;
          const phase=cause.code==='conflict'&&!uncertain?'conflict':applied||uncertain||cause.code==='recovery-required'?'recovery-required':'failed';
          if(applied){blocked=true;dirty=true;}
          publish({phase,operationId:command.operationId,type:command.type,message:cause.message});
          throw cause;
        }
      };
      const promise=tail.then(run);tail=promise.catch(()=>{});operations.set(command.operationId,{signature,promise});return promise;
    }
    return Object.freeze({execute,getStatus:()=>copy(status),get blocksRemoteApply(){return dirty||blocked||status.phase==='saving';}});
  }
  return Object.freeze({canonical,equal,editable,ordinary,changeSet,plan,create});
});
