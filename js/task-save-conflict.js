/* Three-way task comparison; no SDK, state, clocks or implicit retry. */
(function(host,factory){const api=factory(typeof module==='object'&&module.exports?require('./save-command.js'):host.WMSaveCommand);if(typeof module==='object'&&module.exports)module.exports=api;else host.WMTaskSaveConflict=api;})(globalThis,function(C){
  'use strict';
  const copy=v=>JSON.parse(JSON.stringify(v));
  const dateFields=['start','end','deadline','endRule','unconfirmed','periodLabel'];
  function compare(base,desired,remote){
    const fields=C.editable.filter(k=>!C.equal(base[k],desired[k]));
    const conflicts=[];
    const add=(field,reason)=>conflicts.push({field,reason,base:base[field]??null,local:desired[field]??null,server:remote?.[field]??null});
    if(!remote){add('id','서버에서 업무가 삭제되었습니다.');return {conflicts,fields,merged:null};}
    if(!C.ordinary(remote)||remote.status==='done'||remote.actualComplete)add('status','서버 업무의 완료 또는 연계 상태가 변경되었습니다.');
    for(const k of ['status','actualComplete','completionHistory'])if(!C.equal(base[k],remote[k])&&!conflicts.some(c=>c.field===k))add(k,'보호 기록이 변경되었습니다.');
    for(const k of fields)if(!C.equal(remote[k],base[k])&&!C.equal(remote[k],desired[k]))add(k,'편집 시작 후 같은 필드가 변경되었습니다.');
    if(fields.some(k=>dateFields.includes(k))){
      for(const k of dateFields)if(!fields.includes(k)&&!C.equal(remote[k],base[k]))add(k,'날짜 규칙은 함께 검토해야 합니다.');
    }
    const merged=copy(remote);
    for(const k of fields){if(Object.hasOwn(desired,k))merged[k]=copy(desired[k]);else delete merged[k];}
    return {conflicts,fields,merged,alreadyApplied:!conflicts.length&&fields.every(k=>C.equal(remote[k],desired[k]))};
  }
  function reconcile(current,submitted,server){
    // Preserve any local field edited after submission, including newly added fields.
    for(const k of new Set([...Object.keys(submitted),...Object.keys(server)]))if(C.equal(current[k],submitted[k])){
      if(Object.hasOwn(server,k))current[k]=copy(server[k]);else delete current[k];
    }
  }
  return Object.freeze({compare,reconcile});
});
