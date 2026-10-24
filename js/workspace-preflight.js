/* Read-only audit of explicitly supplied raw Firestore records. Never fetches or repairs data. */
(function(host,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else host.WMWorkspacePreflight=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const required=['tasks','generatedKeys','checklistItems','templates','linkedRules'];
  function lockId(key){let binary='';for(const b of new TextEncoder().encode(key))binary+=String.fromCharCode(b);return 'auto-'+btoa(binary).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');}
  function inspect({projectId,records,context={}}={}){
    const issues=[],maps={};
    const add=(code,severity,collection,id)=>issues.push({code,severity,collection,id});
    if(typeof projectId!=='string'||!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId))add('INVALID_PROJECT','error','context','projectId');
    for(const name of required){maps[name]=new Map();if(!Array.isArray(records?.[name])){add('INCOMPLETE_RECORDS','error',name,'');continue;}
      for(const row of records[name]){if(!row||typeof row.id!=='string'||!row.id||!row.data||typeof row.data!=='object'||Array.isArray(row.data)){add('MALFORMED_RECORD','error',name,'');continue;}
        if(maps[name].has(row.id))add('DUPLICATE_DOCUMENT','error',name,row.id);maps[name].set(row.id,row.data);}
    }
    const keys=new Map();
    for(const [id,t] of maps.tasks){if(t.generatedKey){if(typeof t.generatedKey!=='string'){add('INVALID_KEY','error','tasks',id);continue;}
      if(keys.has(t.generatedKey))add('DUPLICATE_KEY','error','tasks',id);keys.set(t.generatedKey,id);
      const lock=maps.generatedKeys.get(lockId(t.generatedKey));
      if(!lock)add('MISSING_LOCK','error','tasks',id);else if(lock.generatedKey!==t.generatedKey||lock.taskId!==id)add('LOCK_OWNER_MISMATCH','error','tasks',id);
      if(t.generatedKey.startsWith('wm-recurrence:')&&!t.generatedKey.startsWith('wm-recurrence:v1:'+projectId+':'))add('FOREIGN_KEY_SCOPE','error','tasks',id);
    }else if(t.repeatGeneratedV181)add('UNIDENTIFIED_OCCURRENCE','review','tasks',id);}
    for(const [id,lock] of maps.generatedKeys){if(typeof lock.generatedKey!=='string'||!lock.generatedKey||typeof lock.taskId!=='string'||!lock.taskId){add('INVALID_LOCK','error','generatedKeys',id);continue;}
      if(id!==lockId(lock.generatedKey))add('NONCANONICAL_LOCK','error','generatedKeys',id);
      const task=maps.tasks.get(lock.taskId);
      if(!task){add(keys.has(lock.generatedKey)?'TOMBSTONE_CONFLICT':'RETAIN_TOMBSTONE',keys.has(lock.generatedKey)?'error':'info','generatedKeys',id);}
      else if(task.generatedKey!==lock.generatedKey)add('LOCK_KEY_MISMATCH','error','generatedKeys',id);
    }
    for(const name of ['tasks','templates','linkedRules'])for(const [id,row] of maps[name]){
      if(!Object.hasOwn(row,'revision'))add('LEGACY_REVISION_MISSING','review',name,id);
      else if(!Number.isSafeInteger(row.revision)||row.revision<1)add('INVALID_REVISION','error',name,id);
    }
    for(const [id,item] of maps.checklistItems){const parent={task:'tasks',template:'templates',linkedRule:'linkedRules'}[item.parentType];if(!parent||!maps[parent].has(item.parentId))add('ORPHAN_CHECKLIST','error','checklistItems',id);}
    if(context.complete!==true)add('SNAPSHOT_COMPLETENESS_UNVERIFIED','review','context','snapshot');
    if(context.clientPolicyVersion!=='phase6f-rules-v1')add('CLIENT_CACHE_REVIEW','review','context','client');
    if(context.hasPendingWrites!==false)add('OFFLINE_WRITES_REVIEW','review','context','pendingWrites');
    if(context.unresolvedJournal!==0)add('JOURNAL_REVIEW','review','context','journal');
    if(context.backupConflicts!==0)add('BACKUP_REVIEW','review','context','backup');
    return {scope:'provided-records-only',readOnly:true,ready:!issues.some(i=>i.severity!=='info'),issues};
  }
  return {inspect,lockId};
});
