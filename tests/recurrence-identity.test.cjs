const assert=require('node:assert/strict');
const I=require('../js/recurrence-identity.js');
const {loadRecurrence,loadCloud,plain,read,parse,walk}=require('./helpers.cjs');
const {recurring}=require('./fixtures.cjs');
const {withPage}=require('./browser.test.cjs');
const scope='synthetic-workspace',today='2026-10-23';
const plan=(s,options={})=>I.plan(s,{scope,today,...options});
let sequence=0;
const apply=(s,p,options={})=>I.apply(s,p,{scope,id:prefix=>`${prefix}-identity-${++sequence}`,...options});
module.exports=({test,EnvironmentUnavailable})=>{
  test('IDENT-01','Keys are deterministic, namespace-separated and based on raw date',()=>{
    assert.equal(I.key(scope,'root','2026-11-01'),I.key(scope,'root','2026-11-01'));
    assert.notEqual(I.key(scope,'root','2026-11-01'),I.key(scope,'other','2026-11-01'));
    assert.notEqual(I.key(scope,'root','2026-11-01'),I.key('other-workspace','root','2026-11-01'));
    assert.notEqual(I.key('a:b','c','2026-11-01'),I.key('a','b:c','2026-11-01'));
    assert.ok(I.key(scope,'root','2026-11-01').startsWith('wm-recurrence:v1:'));
  });
  test('IDENT-02','Different roots using the same template and date both get distinct recurrence keys',()=>{
    const s=recurring();s.tasks.push({...plain(s.tasks[0]),id:'second-root'});
    const p=plan(s);assert.equal(p.additions.length,6);assert.equal(new Set(p.additions.map(a=>a.generatedKey)).size,6);
  });
  test('IDENT-03','Holiday-collapsed weekdays keep two raw slots and two distinct keys',()=>{
    const s=recurring('weekly','2026-10-23',{weekdays:[0,6],holidayShiftV181:'next'});s.tasks[0].repeatUntilV181='2026-10-26';
    const p=plan(s);assert.equal(p.additions.length,2);
    assert.deepEqual(p.additions.map(a=>[a.occurrence.scheduled,a.occurrence.start]),[['2026-10-24','2026-10-26'],['2026-10-25','2026-10-26']]);
    assert.notEqual(p.additions[0].generatedKey,p.additions[1].generatedKey);apply(s,p);assert.equal(plan(s).additions.length,0);
  });
  test('IDENT-04','Planning is pure and applying twice adds nothing while preserving manual/history records',()=>{
    const s=recurring(),before=plain(s),p=plan(s);assert.deepEqual(plan(s),p);assert.deepEqual(s,before);
    apply(s,p);Object.assign(s.tasks[1],{start:'2026-11-19',end:'2026-11-21',status:'done',actualComplete:'2026-11-21',completionHistory:[{id:'synthetic-history',snapshot:{notes:'Original'}}],attachments:[{id:'synthetic-file'}]});
    const after=plain(s),again=plan(s);assert.equal(again.additions.length,0);assert.equal(again.mappings.length,0);apply(s,again);assert.deepEqual(s,after);
  });
  test('IDENT-05','Keyless legacy mapping requires a trustworthy origin and raw date, preserves all other fields',()=>{
    const s=recurring();s.tasks.push({...plain(s.tasks[0]),id:'legacy',repeatGeneratedV181:true,repeatOriginV181:'fixture-root',repeatScheduledDateV181:'2026-11-01',start:'2026-11-20',status:'done',actualComplete:'2026-11-20',completionHistory:[{id:'old'}]});
    const before=plain(s.tasks[1]),p=plan(s);assert.deepEqual(p.mappings,[{taskId:'legacy',generatedKey:I.key(scope,'fixture-root','2026-11-01')}]);
    apply(s,p);assert.deepEqual(s.tasks[1],{...before,generatedKey:I.key(scope,'fixture-root','2026-11-01')});
  });
  test('IDENT-06','Ambiguous legacy dates stop that root without deleting, merging or overwriting records',()=>{
    const s=recurring();s.tasks.push({...plain(s.tasks[0]),id:'unknown-slot',repeatGeneratedV181:true,repeatOriginV181:'fixture-root'});
    const before=plain(s),p=plan(s);assert.equal(p.additions.length,0);assert.equal(p.mappings.length,0);assert.equal(p.conflicts[0].code,'AMBIGUOUS_OCCURRENCE');apply(s,p);assert.deepEqual(s,before);
  });
  test('IDENT-07','Foreign key ownership and duplicate legacy slots are reported without destructive resolution',()=>{
    const s=recurring();s.tasks.push({id:'foreign-task',generatedKey:I.key(scope,'fixture-root','2026-11-01')});
    const p=plan(s);assert.equal(p.additions.length,2);assert.equal(p.conflicts[0].code,'KEY_COLLISION');
    s.tasks.push({id:'one',repeatOriginV181:'fixture-root',repeatScheduledDateV181:'2026-12-01'},{id:'two',repeatOriginV181:'fixture-root',repeatScheduledDateV181:'2026-12-01'});
    const before=plain(s.tasks);assert.ok(plan(s).conflicts.some(c=>c.code==='DUPLICATE_SLOT'));assert.deepEqual(s.tasks,before);
  });
  test('IDENT-08','Existing normal key remains intact and its raw-slot alias suppresses later recreation',()=>{
    const s=recurring();s.tasks.push({id:'legacy-keyed',repeatOriginV181:'fixture-root',repeatScheduledDateV181:'2026-11-01',generatedKey:'legacy-valid-key',start:'2026-11-20'});
    apply(s,plan(s));assert.equal(s.tasks[1].generatedKey,'legacy-valid-key');
    s.tasks=s.tasks.filter(t=>t.id!=='legacy-keyed');assert.equal(plan(s).additions.length,0);
  });
  test('IDENT-09','Deleted cloud locks and local reserved keys both prevent resurrection',()=>{
    const s=recurring(),key=I.key(scope,'fixture-root','2026-11-01');
    assert.equal(plan(s,{locks:[{generatedKey:key,taskId:'deleted'}]}).additions.length,2);
    apply(s,plan(s));const deleted=s.tasks[1].generatedKey;s.tasks.splice(1,1);
    assert.ok(s.settings.suppressedAutoKeys.includes(deleted));assert.equal(plan(s).additions.length,0);
    const C=loadCloud(),maps=C.serializeState(s),restored=C.deserializeState(maps);assert.equal(plan(restored).additions.length,0);
  });
  test('IDENT-10','Codec preserves exact keys and server generatedKeys locks after task removal',()=>{
    const s=recurring();apply(s,plan(s));const C=loadCloud(),maps=C.serializeState(s);
    assert.equal(maps.generatedKeys.size,3);assert.deepEqual(plain(C.deserializeState(maps).tasks.map(t=>t.generatedKey||null)),s.tasks.map(t=>t.generatedKey||null));
    C.setShadow(maps);s.tasks=s.tasks.slice(0,1);const next=C.serializeState(s);assert.equal(next.generatedKeys.size,3);
    assert.equal(plan(s,{locks:plain([...next.generatedKeys.values()])}).additions.length,0);
  });
  test('IDENT-11','Stale, cross-workspace and tampered plans are rejected before mutation',()=>{
    const s=recurring(),p=plan(s);s.tasks[0].notes='New edit';const before=plain(s);assert.throws(()=>apply(s,p),/변경/);assert.deepEqual(s,before);
    const current=plan(s);assert.throws(()=>apply(s,current,{scope:'other'}),/변경/);
    current.additions[0].generatedKey='forged';assert.throws(()=>apply(s,current),/계획/);assert.deepEqual(s,before);
  });
  test('IDENT-12','Registration save creates and persists a single batch, concurrent supplement calls share it',async()=>{
    const s=recurring();let saves=0,release;const h=loadRecurrence(s,{harness:true,save:()=>{saves++;return new Promise(r=>{release=r;});}});
    const saving=h.save({reason:'등록'}),one=h.api.supplement(),two=h.api.supplement();assert.strictEqual(one,two);assert.strictEqual(one,saving);
    assert.equal(s.tasks.length,4);assert.equal(saves,1);assert.equal(h.api.getStatus().phase,'saving');release();await saving;
    assert.equal(h.api.getStatus().phase,'saved');assert.equal((await h.api.supplement()).added,0);assert.equal(saves,1);
  });
  test('IDENT-13','Independent ready procedure waits for sync and extends an existing rolling series',async()=>{
    const s=recurring();let ready=false,saves=0;const cloud={mode:'cloud',get recurrenceContext(){return {scope,ready,locks:[]};}};
    const h=loadRecurrence(s,{harness:true,save:async()=>{saves++;},window:{cloudSync:cloud}});
    await h.save();assert.equal(s.tasks.length,1);assert.equal(saves,1);
    ready=true;h.window.__RECURRENCE_DATA_READY__=true;h.events['wm-data-ready']();await h.api.supplement();
    assert.equal(s.tasks.length,4);assert.equal(saves,2);assert.equal(h.api.getStatus().phase,'saved');
    assert.ok(s.tasks.slice(1).every(t=>t.generatedKey.includes(scope)));
  });
  test('IDENT-14','Failed persistence is not success; generated memory is rolled back and unsafe retries blocked',async()=>{
    const s=recurring(),before=plain(s);let saves=0;const h=loadRecurrence(s,{harness:true,save:async()=>{saves++;throw Error('Synthetic storage failure');}});
    await assert.rejects(h.api.supplement(),/Synthetic/);assert.equal(h.api.getStatus().phase,'recovery-required');assert.deepEqual(plain(s),before);
    await assert.rejects(h.api.supplement(),/확인/);assert.equal(saves,1);
  });
  test('IDENT-15','Failure during concurrent editing never overwrites the newer user change',async()=>{
    const s=recurring();let reject;const h=loadRecurrence(s,{harness:true,save:()=>new Promise((_,r)=>{reject=r;})});
    const saving=h.api.supplement();s.tasks[0].notes='Concurrent edit';reject(Error('Synthetic failure'));
    await assert.rejects(saving);assert.equal(s.tasks[0].notes,'Concurrent edit');assert.equal(h.api.getStatus().phase,'recovery-required');
  });
  test('IDENT-16','Recurrence installer leaves renderer untouched, even with a due ungenerated schedule',()=>{
    const s=recurring(),before=plain(s);let saves=0,renders=0;const h=loadRecurrence(s,{harness:true,save:async()=>{saves++;},render:()=>{renders++;}});
    for(let i=0;i<5;i++)h.render();assert.equal(renders,5);assert.equal(saves,0);assert.deepEqual(s,before);
  });
  test('IDENT-17','Cloud read-only context exposes workspace and surviving locks without auth or writes (MOCK)',()=>{
    const vm=require('node:vm'),source=read('js/cloud-sync.js'),node=parse(source,'module').body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='controller');
    const descriptorSource=source.slice(node.start,node.end);
    const stub=()=>{};const ctx={workspaceProfile:{workspace:{firebaseConfig:{projectId:scope}}},buildingUser:null,currentUser:{uid:'synthetic'},active:true,needsInitialUpload:false,recurrenceReady:true,localOnly:false,
      recordMaps:{generatedKeys:new Map([['one',{generatedKey:'old-key',taskId:'removed'}]])},clone:plain};
    // Only create the controller object; SDK/network methods are never invoked.
    for(const name of ['hasBuildingDriveToken','stableKeyId','activate','save','importState','previewImport','createImageBlock','createFileBlock','openDriveFile','downloadDriveFile','readDriveFile','repairLegacyDriveAttachments','hydrateImages','ensureDriveAccess','loadChangeLogs','saveTrashEntry','listTrashEntries','removeTrashEntry','saveTemplateVersion','listTemplateVersions','flush'])ctx[name]=stub;
    const api=vm.runInNewContext(descriptorSource+';controller()',ctx),value=api.recurrenceContext;
    assert.deepEqual(plain(value),{scope,ready:true,locks:[{generatedKey:'old-key',taskId:'removed'}]});value.locks[0].taskId='changed';assert.equal(ctx.recordMaps.generatedKeys.get('one').taskId,'removed');
  });
  test('IDENT-18','A dense weekly rolling plan is applied completely; a second plan adds zero',()=>{
    const s=recurring('weekly','2026-10-23',{weekdays:[0,1,2,3,4,5,6]});
    const p=plan(s);assert.ok(p.additions.length>40);apply(s,p);assert.equal(plan(s).additions.length,0);
  });
  test('IDENT-19','An existing legacy key with foreign cloud ownership is reported and never rewritten',()=>{
    const s=recurring();s.tasks.push({id:'legacy',repeatOriginV181:'fixture-root',repeatScheduledDateV181:'2026-11-01',generatedKey:'old-valid-key'});
    const p=plan(s,{locks:[{generatedKey:'old-valid-key',taskId:'foreign'}]});
    assert.ok(p.conflicts.some(c=>c.code==='KEY_COLLISION'));assert.equal(p.reservations.length,0);assert.equal(s.tasks[1].generatedKey,'old-valid-key');
  });
  test('IDENT-UI-01','Real browser render paths generate no tasks, keys or saves before explicit supplementation',()=>withPage({width:1440,height:1000},EnvironmentUnavailable,async page=>{
    const s=recurring();const result=await page.evaluate(input=>{
      state.tasks=input.tasks;state.templates=input.templates;state.holidays=[];
      let saves=0;saveState=async()=>{saves++;};
      const before=JSON.stringify(state);
      for(let i=0;i<3;i++){renderTaskTable();renderHome();renderDbTable();}
      return {same:before===JSON.stringify(state),saves,tasks:state.tasks.length,keys:state.tasks.filter(t=>t.generatedKey).length};
    },s);assert.deepEqual(result,{same:true,saves:0,tasks:1,keys:0});
  }));
};
