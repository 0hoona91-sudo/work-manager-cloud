/* Composition only: existing state and saveState persistence, no extra storage queue. */
(function(){
  'use strict';
  const C=window.WMSaveCommand;
  const context=()=>{
    const cloud=window.cloudSync;
    if(cloud?.mode==='cloud')return cloud.workspaceKey&&cloud.workspaceUser?.uid?`cloud:${cloud.workspaceKey}:${cloud.workspaceUser.uid}:${cloud.user?.uid||cloud.workspaceUser.uid}`:null;
    return `local:${window.__workspaceLocalStateKey||'default'}`;
  };
  const J=window.WMOperationJournal;
  const journalContext=context;
  const journalize=request=>request;
  let recoveryExtraEdits=false;
  const rawPersist=(request,reviewMode,journalUncertain=false)=>persistStateV6A({reason:'단일 업무 수정',operationId:request.operationId,operationType:request.type,taskCommand:request,reviewMode,journalUncertain});
  const journal=J.create({store:J.indexedStore(openDb),getContext:journalContext,now:()=>new Date().toISOString(),
    send:async(request,mode,{uncertain})=>{const receipt=await rawPersist({...request,context:request.context.split(':').slice(0,3).join(':')},mode,uncertain);if(receipt?.serverTask)recoveryExtraEdits=!C.equal(state.tasks.find(t=>t.id===receipt.serverTask.id),receipt.serverTask);return receipt;},
    onChange:()=>{if(journalContext()===journal.context)window.WMRecoveryUI.render(recoveryView());}});
  function recoveryView(){return {list:journal.list,error:journal.error,busy:journal.busy,recover:recoverJournal};}
  async function recoverJournal(id,options){
    const result=application.getStatus().operationId===id?await application.review(options):await journal.recover(id,options);
    if(result.phase==='saved'||result.persistence==='server-confirmed'){
      for(const dialog of document.querySelectorAll('.modal'))if(dialog.commandOperationId===id&&dialog.onCommandConfirmed){dialog.onCommandConfirmed();window.WMSaveCommands.showReview(dialog);}
    }
    return result;
  }
  const isJournalRequest=request=>request.context?.startsWith('cloud:')&&request.type==='task.update';
  const application=C.create({getState:()=>state,getContext:context,
    beforeApply:request=>isJournalRequest(request)?journal.prepare(journalize(request)):undefined,
    persist:request=>{const {reviewMode,...taskCommand}=request;return isJournalRequest(request)?journal.transmit(journalize(taskCommand),reviewMode):rawPersist(taskCommand,reviewMode);},
    onStatus:value=>window.dispatchEvent(new CustomEvent('wm-save-command-status',{detail:value}))});
  window.WMRecovery={initialize:value=>journal.initialize(value),show:()=>{if(journalContext()===journal.context)window.WMRecoveryUI.render(recoveryView());},suspend(){recoveryExtraEdits=false;journal.suspend();document.querySelector('[data-recovery-journal]')?.remove();},
    get blocksWrites(){return journal.blocksWrites;},get blocksRemoteApply(){return journal.blocksWrites||recoveryExtraEdits;},
    list:journal.list,recover:recoverJournal,get error(){return journal.error;}};
  window.WMSaveCommands={execute:application.execute,getStatus:application.getStatus,get blocksRemoteApply(){return application.blocksRemoteApply;},
    showReview(dialog,onSaved){
      if(onSaved)dialog.onCommandConfirmed=onSaved;
      let panel=dialog.querySelector('[data-save-review]');
      if(!panel){panel=document.createElement('section');panel.dataset.saveReview='';panel.setAttribute('role','status');dialog.append(panel);}
      panel.replaceChildren();
      const value=application.getStatus(),text=document.createElement('pre');text.style.whiteSpace='pre-wrap';
      text.textContent=`저장 상태: ${value.phase}\n${value.message||'서버 확정 여부를 확인해 주세요.'}\n입력 내용은 유지됩니다. 충돌을 해결하려면 내용을 보관한 뒤 서버 자료와 비교하세요.\n`+(value.conflicts?.length?JSON.stringify(value.conflicts,null,2):value.serverTask?'마지막으로 확인한 서버 내용:\n'+JSON.stringify(value.serverTask,null,2):'');panel.append(text);
      const action=(label,retry)=>{const button=document.createElement('button');button.type='button';button.textContent=label;button.onclick=async()=>{if(retry&&!confirm('서버 기준을 다시 검사한 뒤 보관한 입력을 저장할까요? 충돌 시 저장하지 않습니다.'))return;button.disabled=true;try{const result=await application.review({retry});if(result.phase==='saved')dialog.onCommandConfirmed?.();}catch{}finally{window.WMSaveCommands.showReview(dialog);}};panel.append(button);};
      if(value.phase!=='saving'&&value.phase!=='saved'){action('서버 반영 다시 확인 (읽기 전용)',false);if(value.phase==='pending-sync')action('서버 검사 후 보관한 입력 저장',true);}
    },
    beginEdit(task,formBase){return C.ordinary(task)&&task.status!=='done'&&!task.actualComplete?{operationId:uid('operation'),context:context(),expected:clone(task),formBase:clone(formBase||task)}:null;},
    async edit(session,base,button){
      if(session.promise)return session.promise;
      const patch=Object.fromEntries(C.editable.filter(k=>Object.hasOwn(base,k)&&!C.equal(base[k],session.formBase[k])).map(k=>[k,base[k]]));
      button.disabled=true;
      session.promise=application.execute({operationId:session.operationId,context:session.context,type:'task.update',taskId:session.expected.id,expected:session.expected,patch});
      try{return await session.promise;}finally{button.disabled=false;}
    }
  };
  window.__resolveWMRecovery?.(window.WMRecovery);
})();
