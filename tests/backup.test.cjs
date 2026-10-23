const assert=require('node:assert/strict');
const {schema11,project}=require('./fixtures.cjs');
const {plain,loadModel}=require('./helpers.cjs');
const {withPage}=require('./browser.test.cjs');
const B=()=>require('../js/backup-safety.js');
function fixture(){const s=schema11();s.projects=[];return s;}
function fresh(id='new-task'){const t=plain(fixture().tasks[0]);Object.assign(t,{id,status:'planned',actualComplete:null,generatedKey:`key:${id}`});return t;}
module.exports=({test,EnvironmentUnavailable})=>{
  test('BACKUP-01','Completed current task defeats an older planned backup even with incoming choice',()=>{
    const b=B(),current=fixture(),incoming=plain(current);Object.assign(incoming.tasks[0],{status:'planned',actualComplete:null});
    const before=plain(current),p=b.prepare(current,incoming,{choices:{'tasks/fixture-task':'backup'}});
    assert.equal(p.errors.length,0);assert.equal(p.counts.tasks.conflict,1);assert.equal(p.protectedConflicts.length,1);
    assert.deepEqual(p.next.tasks,plain(current.tasks));assert.deepEqual(current,before);
  });
  test('BACKUP-02','Completion history cannot be removed, edited or duplicated by merge or restore',()=>{
    const b=B(),current=fixture();current.tasks[0].templateId='fixture-template';loadModel().reopenTask(current.tasks[0]);current.tasks[0].templateId=null;const incoming=plain(current);incoming.templates=[];
    incoming.tasks[0].completionHistory[0].snapshot.notes='tampered';
    for(const mode of ['merge','replace']){const p=b.prepare(current,incoming,{mode,choices:{'tasks/fixture-task':'backup'}});assert.deepEqual(p.next.tasks,plain(current.tasks));assert.deepEqual(p.next.templates,current.templates);}
    const p=b.prepare(current,plain(current));assert.deepEqual(p.next.tasks,plain(current.tasks));assert.equal(p.counts.tasks.identical,1);
  });
  test('BACKUP-03','Same ID equal content ignores key order; new tasks are added once',()=>{
    const b=B(),current=fixture(),incoming=plain(current);incoming.tasks[0]=Object.fromEntries(Object.entries(incoming.tasks[0]).reverse());incoming.tasks.push(fresh());
    const p=b.prepare(current,incoming);assert.equal(p.errors.length,0);assert.equal(p.counts.tasks.identical,1);assert.equal(p.counts.tasks.added,1);assert.equal(p.next.tasks.length,2);
    assert.equal(b.prepare(p.next,incoming).counts.tasks.added,0);
  });
  test('BACKUP-04','Different content is a conflict; selected ordinary edits retain unknown fields',()=>{
    const b=B(),current=fixture();current.tasks=[fresh('ordinary')];current.tasks[0].extension={retained:42};const incoming=plain(current);delete incoming.tasks[0].extension;incoming.tasks[0].name='Edited';
    let p=b.prepare(current,incoming);assert.equal(p.counts.tasks.conflict,1);assert.equal(p.next.tasks[0].name,current.tasks[0].name);
    p=b.prepare(current,incoming,{choices:{'tasks/ordinary':'backup'}});assert.equal(p.next.tasks[0].name,'Edited');assert.deepEqual(p.next.tasks[0].extension,{retained:42});
  });
  test('BACKUP-05','Project stages, protected task IDs and attachment refs remain linked on conflict',()=>{
    const b=B(),M=loadModel(),current=fixture(),p=project();M.initializeRelativeDates(p);current.projects=[p];current.tasks=p.stages.map((s,i)=>M.buildStageTask(p,s,i));
    Object.assign(current.tasks[0],{status:'done',actualComplete:'2026-01-01'});p.stages[0].resources=[{id:'resource',driveFileId:'synthetic-file',name:'fixture.pdf',mimeType:'application/pdf'}];current.tasks[0].projectResources=plain(p.stages[0].resources);
    const incoming=plain(current);incoming.projects[0].stages.shift();incoming.tasks.shift();
    const review=b.prepare(current,incoming,{mode:'replace',choices:{'projects/fixture-project':'backup'}});
    assert.equal(review.errors.length,0);assert.deepEqual(review.next.projects,current.projects);assert.deepEqual(review.next.tasks[0],plain(current.tasks[0]));
    const empty=fixture();empty.projects=[];empty.tasks=[];current.tasks[0].templateId='fixture-template';empty.templates=[];
    const restored=b.prepare(current,empty,{mode:'replace'});assert.equal(restored.errors.length,0);assert.deepEqual(restored.next.tasks,plain(current.tasks));assert.deepEqual(restored.next.projects,current.projects);assert.deepEqual(restored.next.templates,current.templates);
  });
  test('BACKUP-06','Generated keys cannot add a second task ID or resurrect a durable lock',()=>{
    const b=B(),current=fixture(),incoming=plain(current),copy=fresh();copy.generatedKey=current.tasks[0].generatedKey;incoming.tasks.push(copy);
    let p=b.prepare(current,incoming);assert.equal(p.next.tasks.length,1);assert.ok(p.referenceConflicts.some(c=>c.kind==='generatedKey'));
    incoming.tasks=[fresh()];p=b.prepare(current,incoming,{locks:[{generatedKey:incoming.tasks[0].generatedKey,taskId:'deleted-fixture'}]});assert.ok(!p.next.tasks.some(t=>t.id==='new-task'));
  });
  test('BACKUP-07','Attachment ID metadata conflicts cannot replace current file refs',()=>{
    const b=B(),current=fixture();current.tasks[0].attachments=[{id:'attachment',driveFileId:'original',name:'fixture.pdf',mimeType:'application/pdf'}];
    const incoming=plain(current);incoming.tasks.push(fresh());incoming.tasks[1].attachments=[{id:'attachment',driveFileId:'different',name:'fixture.pdf',mimeType:'application/pdf'}];
    const p=b.prepare(current,incoming);assert.ok(p.referenceConflicts.some(c=>c.kind==='attachment'));assert.equal(p.next.tasks.length,1);assert.deepEqual(p.next.tasks[0].attachments,current.tasks[0].attachments);
  });
  test('BACKUP-08','Malformed JSON, missing collections, invalid schema, dates, IDs and history are refused',()=>{
    const b=B();assert.throws(()=>b.parse('{bad'),/JSON/);
    const inputs=[{}, {...fixture(),tasks:{}}, {...fixture(),backupMeta:{schemaVersion:12}}, {...fixture(),projects:null}];
    const duplicate=fixture();duplicate.tasks.push(plain(duplicate.tasks[0]));inputs.push(duplicate);
    const files=fixture();files.templates[0].attachments={};inputs.push(files);
    const blocks=fixture();blocks.templates[0].methodBlocks=[null];inputs.push(blocks);
    const invalid=fixture();invalid.tasks[0].start='2026-02-30';inputs.push(invalid);
    const history=fixture();history.tasks[0].completionHistory=[{id:'h',reopenedAt:'bad',snapshot:{}}];inputs.push(history);
    const injection=JSON.parse(JSON.stringify(fixture()).replace('{','{"__proto__":{"polluted":true},'));inputs.push(injection);
    for(const incoming of inputs)assert.ok(b.prepare(fixture(),incoming).errors.length>0);
    assert.equal({}.polluted,undefined);
  });
  test('BACKUP-09','Dangling project, task and attachment refs and inline file bytes are refused before writing',()=>{
    const b=B(),incoming=fixture();incoming.tasks[0].projectId='absent';incoming.tasks[0].projectStageId='absent';
    assert.ok(b.prepare(fixture(),incoming).errors.some(e=>/참조/.test(e)));
    const bytes=fixture();bytes.templates[0].attachments[0].data='SYNTHETIC_BYTES';assert.ok(b.prepare(fixture(),bytes).errors.length);
  });
  test('BACKUP-10','Restore warns about removals but retains omitted completed tasks and unknown root fields',()=>{
    const b=B(),current=fixture();current.tasks.push(fresh());current.extensionFixture={keep:true};const incoming=fixture();incoming.tasks=[];
    const p=b.prepare(current,incoming,{mode:'replace'});assert.equal(p.next.tasks.length,1);assert.deepEqual(p.next.tasks[0],current.tasks[0]);assert.equal(p.counts.tasks.removed,1);assert.deepEqual(p.next.extensionFixture,{keep:true});
  });
  test('BACKUP-11','Cancel and stale review do not call snapshot, publish or persistence',async()=>{
    const b=B(),current=fixture(),incoming=plain(current);incoming.tasks.push(fresh());const p=b.prepare(current,incoming);let calls=0;
    const ports={getCurrent:()=>current,getVersion:()=>'',persistRecovery:async()=>{calls++},write:async()=>{calls++},publish:()=>{calls++}};
    await assert.rejects(()=>b.execute(p,ports,{confirmed:false}),/확인/);current.tasks[0].notes='Newer';
    await assert.rejects(()=>b.execute(p,ports,{confirmed:true}),/변경/);assert.equal(calls,0);
  });
  test('BACKUP-12','Snapshot must be durable first; committed state equals reviewed result',async()=>{
    const b=B(),current=fixture(),incoming=plain(current);incoming.tasks.push(fresh());const p=b.prepare(current,incoming);const before=plain(current),events=[];let saved;
    const ports={getCurrent:()=>current,getVersion:()=>'',persistRecovery:async recovery=>{events.push('snapshot');assert.deepEqual(current,before);assert.deepEqual(recovery.before,before)},write:async next=>{events.push('write');saved=plain(next);assert.deepEqual(current,before)},publish:next=>{events.push('publish');Object.keys(current).forEach(k=>delete current[k]);Object.assign(current,next)}};
    await b.execute(p,ports,{confirmed:true});assert.deepEqual(events,['snapshot','write','publish']);assert.deepEqual(saved,p.next);assert.deepEqual(current,p.next);
  });
  test('BACKUP-13','Snapshot failure and changes during snapshot preparation abort before any data write',async()=>{
    const b=B(),current=fixture(),p=b.prepare(current,fixture());let writes=0;
    const ports={getCurrent:()=>current,getVersion:()=>'',write:async()=>{writes++},publish:()=>assert.fail('Must not publish')};
    await assert.rejects(()=>b.execute(p,{...ports,persistRecovery:async()=>{throw Error('quota')}},{confirmed:true}),/quota/);
    await assert.rejects(()=>b.execute(p,{...ports,persistRecovery:async()=>{current.tasks[0].notes='Concurrent'}},{confirmed:true}),/변경/);assert.equal(writes,0);
  });
  test('BACKUP-14','Write failure preserves memory and exposes recovery-required status without success',async()=>{
    const b=B(),current=fixture(),incoming=plain(current);incoming.tasks.push(fresh());const p=b.prepare(current,incoming),before=plain(current);let recovery;
    await assert.rejects(()=>b.execute(p,{getCurrent:()=>current,getVersion:()=>'',persistRecovery:async r=>{recovery=plain(r)},write:async()=>{const e=Error('Synthetic partial write');e.committedChunks=1;throw e},publish:()=>assert.fail('No success')},{confirmed:true}),e=>e.recoveryRequired===true&&e.committedChunks===1);
    assert.deepEqual(current,before);assert.deepEqual(recovery.before,before);
  });
  test('BACKUP-15','Restore needs separate confirmation and forged reviews are rejected',async()=>{
    const b=B(),current=fixture(),p=b.prepare(current,fixture(),{mode:'replace'}),ports={getCurrent:()=>current,getVersion:()=>''};
    await assert.rejects(()=>b.execute(p,ports,{confirmed:true}),/전체 복원/);
    const merge=b.prepare(current,fixture());merge.next.tasks=[];await assert.rejects(()=>b.execute(merge,ports,{confirmed:true}),/미리보기/);
  });
  test('BACKUP-UI-01','Actual import file picker previews differences and cancel changes nothing',()=>withPage({width:1440,height:1000},EnvironmentUnavailable,async page=>{
    const current=fixture(),incoming=plain(current);incoming.tasks.push(fresh());incoming.tasks[0].status='planned';incoming.tasks[0].actualComplete=null;
    await page.evaluate(s=>{Object.assign(state,s);window.__backupWrites=0;window.cloudSync={mode:'local',save:async()=>{},hydrateImages:async()=>{}};writeLocalMeta=async()=>{window.__backupWrites++};writeLocalState=async()=>{window.__backupWrites++};bind();showPage('settingsPage');window.__beforeBackup=JSON.stringify(state)},current);
    await page.locator('#importBackup').setInputFiles({name:'fixture.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(incoming))});
    await page.locator('#backupPreview').waitFor();
    assert.equal(await page.locator('#backupPreview').count(),1);assert.match(await page.locator('#backupPreview').innerText(),/완료 이력/);assert.equal(await page.evaluate(()=>window.__backupWrites),0);
    await page.locator('#backupCancel').click();assert.equal(await page.evaluate(()=>JSON.stringify(state)===window.__beforeBackup),true);assert.equal(await page.evaluate(()=>window.__backupWrites),0);
  }));
  test('BACKUP-UI-02','Confirmed local import stores recovery first and failures display recovery-required',()=>withPage({width:1440,height:1000},EnvironmentUnavailable,async page=>{
    const current=fixture(),incoming=plain(current);incoming.tasks.push(fresh());
    await page.evaluate(s=>{Object.assign(state,s);window.cloudSync={mode:'local',save:async()=>{},hydrateImages:async()=>{}};window.__backupEvents=[];writeLocalMeta=async(k,v)=>{window.__backupRecovery=v;window.__backupEvents.push('snapshot')};writeLocalState=async next=>{window.__backupEvents.push('write');throw Error('Synthetic local write failure')};bind();showPage('settingsPage');window.__beforeBackup=JSON.stringify(state)},current);
    await page.locator('#importBackup').setInputFiles({name:'fixture.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(incoming))});await page.locator('#backupConfirm').click();
    await page.waitForFunction(()=>document.querySelector('#backupResult')?.textContent.includes('복구 확인 필요'));
    assert.equal(await page.evaluate(()=>state.tasks.length),1);assert.deepEqual(await page.evaluate(()=>window.__backupEvents),['snapshot','write']);assert.deepEqual(await page.evaluate(()=>window.__backupRecovery.before.tasks),current.tasks);
  }));
  test('BACKUP-UI-03','Successful merge matches preview and stale UI cannot apply an obsolete review',()=>withPage({width:1440,height:1000},EnvironmentUnavailable,async page=>{
    const current=fixture(),incoming=plain(current);incoming.tasks.push(fresh());
    await page.evaluate(s=>{Object.assign(state,s);window.cloudSync={mode:'local',save:async()=>{},hydrateImages:async()=>{}};writeLocalMeta=async()=>{};writeLocalState=async next=>{window.__savedBackup=JSON.parse(JSON.stringify(next))};bind();showPage('settingsPage');window.__beforeBackup=JSON.stringify(state)},current);
    const file={name:'fixture.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(incoming))};await page.locator('#importBackup').setInputFiles(file);
    await page.locator('#backupPreview').waitFor();
    await page.evaluate(()=>{state.tasks[0].notes='newer'});await page.locator('#backupConfirm').click();await page.waitForFunction(()=>document.querySelector('#backupResult')?.textContent.includes('변경'));
    assert.equal(await page.evaluate(()=>state.tasks.length),1);assert.equal(await page.evaluate(()=>!!window.__savedBackup),false);
    await page.locator('#backupCancel').click();await page.locator('#importBackup').setInputFiles(file);await page.locator('#backupConfirm').click();await page.waitForFunction(()=>!!window.__savedBackup);
    assert.deepEqual(await page.evaluate(()=>state.tasks),await page.evaluate(()=>window.__savedBackup.tasks));assert.equal(await page.evaluate(()=>state.tasks.length),2);
  }));
  test('BACKUP-UI-04','Recovery preparation cannot write a previous account snapshot into another account cache',()=>withPage({width:1440,height:1000},EnvironmentUnavailable,async page=>{
    const current=fixture(),incoming=plain(current);incoming.tasks.push(fresh());
    const result=await page.evaluate(async({current,incoming})=>{
      Object.assign(state,current);window.cloudSync={mode:'local',workspaceKey:'fixture-workspace',user:{uid:'account-a'},save:async()=>{},hydrateImages:async()=>{}};
      const writes=[];writeLocalMeta=async(key)=>writes.push(key);writeLocalState=async()=>writes.push('main');
      localSaveTailV33=new Promise(resolve=>{window.__releaseRecoveryWait=resolve});
      const review=WMBackupSafety.prepare(state,incoming),before=JSON.stringify(state);
      const attempt=WMBackupUI.commitLocal(incoming,{review,confirmed:true}).catch(error=>error.message);
      window.cloudSync.user={uid:'account-b'};window.__releaseRecoveryWait();
      const error=await attempt;return {writes,error,unchanged:before===JSON.stringify(state)};
    },{current,incoming});
    assert.deepEqual(result.writes,[]);assert.match(result.error,/계정이 변경/);assert.equal(result.unchanged,true);
  }));
};
