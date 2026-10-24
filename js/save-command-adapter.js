/* Composition only: existing state and saveState persistence, no extra storage queue. */
(function(){
  'use strict';
  const C=window.WMSaveCommand;
  const context=()=>{
    const cloud=window.cloudSync;
    if(cloud?.mode==='cloud')return cloud.workspaceKey&&cloud.workspaceUser?.uid?`cloud:${cloud.workspaceKey}:${cloud.workspaceUser.uid}`:null;
    return `local:${window.__workspaceLocalStateKey||'default'}`;
  };
  const application=C.create({getState:()=>state,getContext:context,
    persist:request=>persistStateV6A({reason:'일반 업무 수정',operationId:request.operationId,operationType:request.type}),
    onStatus:value=>window.dispatchEvent(new CustomEvent('wm-save-command-status',{detail:value}))});
  window.WMSaveCommands={execute:application.execute,getStatus:application.getStatus,get blocksRemoteApply(){return application.blocksRemoteApply;},
    beginEdit(task){return C.ordinary(task)&&task.status!=='done'&&!task.actualComplete?{operationId:uid('operation'),context:context(),expected:clone(task)}:null;},
    async edit(session,base,button){
      if(session.promise)return session.promise;
      const patch=Object.fromEntries(C.editable.filter(k=>Object.hasOwn(base,k)).map(k=>[k,base[k]]));
      button.disabled=true;
      session.promise=application.execute({operationId:session.operationId,context:session.context,type:'task.update',taskId:session.expected.id,expected:session.expected,patch});
      try{return await session.promise;}finally{button.disabled=false;}
    }
  };
})();
