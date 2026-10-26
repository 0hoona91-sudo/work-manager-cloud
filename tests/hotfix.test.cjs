// Production hotfix contracts; all identities, tokens, and files are synthetic.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {parse, read, blocks} = require('./helpers.cjs');

function declarations(file, names) {
  const sources = file.endsWith('.html') ? blocks('script',file).filter(block=>!block.attrs.includes('src=')).map(block=>block.source) : [read(file)];
  return sources.flatMap(source=>parse(source,file.endsWith('.html')?'script':'module').body
    .filter(node => node.type === 'FunctionDeclaration' && names.includes(node.id.name))
    .map(node => source.slice(node.start, node.end))).join('\n');
}
function lastAssignment(name) {
  const sources=blocks('script','index.html').filter(block=>!block.attrs.includes('src=')).map(block=>block.source);
  const assignments=sources.flatMap(source=>parse(source).body.filter(node=>node.type==='ExpressionStatement'&&node.expression.type==='AssignmentExpression'&&node.expression.left.name===name).map(node=>source.slice(node.start,node.end)));
  return assignments.at(-1);
}

function cloudFixture({cached = false, changeAccount = false, changeProject = false, signedOut = false} = {}) {
  let google = signedOut ? null : {uid:'google-a'};
  const profile = {workspace:{firebaseConfig:{projectId:'fixture-one'}}};
  const elements=new Map(),element=id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id)};
  const context = vm.createContext({
    localOnly:false, buildingUser:google, currentUser:null, workspaceProfile:null,
    firebaseApp:null,auth:null,db:null, driveAccessToken:'',
    getBuildingUser:()=>google,
    getBuildingDriveAccessToken:()=> 'synthetic-token',
    rememberDriveAccessToken:(token,user)=>`${token}/${user.uid}`,
    ensureBuildingDriveAccess:async()=>{if(changeAccount)google={uid:'google-b'};},
    initBuildingIdentity:async()=>({user:google}),
    signInBuildingGoogle:async()=>google={uid:'google-a'},
    checkBuildingAuthorization:async()=>({allowed:true}),
    loadCachedWorkspaceProfile:()=>cached?{profile}:null,
    loadWorkspaceProfile:async()=>({profile}),
    connectPrivateWorkspace:async()=>{
      if(changeProject)profile.workspace.firebaseConfig.projectId='fixture-two';
      if(changeAccount)google={uid:'google-b'};
      return {app:{},auth:{},db:{},user:{uid:'private-a'},profile};
    },
    gate:(message,actions)=>{if(actions?.includes('cloudGoogleLogin'))queueMicrotask(()=>element('cloudGoogleLogin').onclick())}, friendlyError:e=>e.message,
    console:{warn:()=>{}},
    document:{getElementById:element},
  });
  vm.runInContext(declarations('js/cloud-sync.js',[
    'recurrenceError','recurrenceWorkspace','assertRecurrenceWorkspace','ensureDriveAccess','authenticateBuildingAndWorkspace'
  ]), context);
  return {get:code=>vm.runInContext(code,context)};
}

module.exports = ({test,EnvironmentUnavailable}) => {
  test('HOTFIX-AUTH-01','MOCK Drive access executes without ReferenceError and checks account/workspace',async()=>{
    const h=cloudFixture();
    h.get('workspaceProfile={workspace:{firebaseConfig:{projectId:"fixture-one"}}};currentUser={uid:"private-a"}');
    assert.equal(await h.get('ensureDriveAccess()'),'synthetic-token/google-a');
    const switched=cloudFixture({changeAccount:true});
    switched.get('workspaceProfile={workspace:{firebaseConfig:{projectId:"fixture-one"}}};currentUser={uid:"private-a"}');
    await assert.rejects(switched.get('ensureDriveAccess()'),/계정이 변경/);
  });
  test('HOTFIX-AUTH-02','MOCK cached and Drive profile connections reject changed identity or project',async()=>{
    for(const cached of [true,false]){
      const h=cloudFixture({cached});
      assert.equal((await h.get('authenticateBuildingAndWorkspace()')).user.uid,'private-a');
      await assert.rejects(cloudFixture({cached,changeAccount:true}).get('authenticateBuildingAndWorkspace()'),/계정이 변경/);
      await assert.rejects(cloudFixture({cached,changeProject:true}).get('authenticateBuildingAndWorkspace()'),/업무공간/);
    }
  });
  test('HOTFIX-AUTH-03','MOCK signed-out Google login connects private workspace without stale pre-auth scope',async()=>{
    const h=cloudFixture({signedOut:true});
    assert.equal((await h.get('authenticateBuildingAndWorkspace()')).user.uid,'private-a');
  });
  test('HOTFIX-SERIES-01','MOCK recurring root and occurrences share deletion identity; ordinary tasks do not',()=>{
    const tasks=[
      {id:'root-a',repeat:{cycle:'monthly'},dbManualRootTemplateId:'template-a'},
      {id:'occ-a',repeatOriginV181:'root-a',repeatGeneratedV181:true,generatedKey:'key-a'},
      {id:'occ-b',repeatOriginV181:'root-a',repeatGeneratedV181:true,generatedKey:'key-b',status:'done',completionHistory:[{id:'history'}]},
      {id:'root-b',repeat:{cycle:'monthly'},dbManualRootTemplateId:'template-b'},
      {id:'ordinary',name:'Ordinary'}
    ];
    const ctx=vm.createContext({state:{tasks,templates:[]},effectiveStatus:t=>t.status||'planned'});
    vm.runInContext(declarations('index.html',['repeatSeriesIdentityVHotfix','repeatSeriesDeletionPlanVHotfix']),ctx);
    const get=expression=>vm.runInContext(expression,ctx);
    assert.equal(get('repeatSeriesIdentityVHotfix(state.tasks[1])'),'origin:root-a');
    assert.equal(get('repeatSeriesIdentityVHotfix(state.tasks[4])'),null);
    assert.deepEqual([...get('repeatSeriesDeletionPlanVHotfix([state.tasks[1]]).ids')],['root-a','occ-a']);
    ctx.state.tasks.push({id:'auto-root',dbAuto:true,autoSourceTemplateId:'auto-template',generatedKey:'dbauto:auto-template:2026-10'},
      {id:'auto-child',dbAuto:true,autoSourceTemplateId:'auto-template',parentAutoRootId:'auto-root',status:'done',completionHistory:[{id:'kept'}]});
    assert.equal(get('repeatSeriesIdentityVHotfix(state.tasks[5])'),'template:auto-template');
    assert.deepEqual([...get('repeatSeriesDeletionPlanVHotfix([state.tasks[5]]).ids')],[]);
  });
  test('HOTFIX-SERIES-02','MOCK bulk button and deletion use the same identity without deleting completed history',async()=>{
    const tasks=[{id:'root',repeat:{cycle:'monthly'}},{id:'occ',repeatOriginV181:'root',generatedKey:'key',repeatGeneratedV181:true},
      {id:'done',repeatOriginV181:'root',status:'done',completionHistory:[{id:'record'}]},
      {id:'other',seriesId:'unrelated'},{id:'ordinary'}];
    const button={disabled:null},count={textContent:''};let deleted=[];
    const ctx=vm.createContext({state:{tasks,templates:[]},selectedTaskIdsV2:new Set(['occ']),
      effectiveStatus:t=>t.status||'planned',$:selector=>selector==='#deleteSelectedSeries'?button:count,$$:()=>[],
      confirm:()=>true,deleteTaskIdsV29:async ids=>{deleted=ids;return {removed:ids.length}},toast:()=>{},console});
    vm.runInContext(declarations('index.html',['repeatSeriesIdentityVHotfix','repeatSeriesDeletionPlanVHotfix','updateBulkV2'])+'\n'+lastAssignment('deleteSeriesV2'),ctx);
    vm.runInContext('updateBulkV2()',ctx);assert.equal(button.disabled,false);
    await vm.runInContext('deleteSeriesV2()',ctx);assert.deepEqual([...deleted],['root','occ']);
    vm.runInContext('selectedTaskIdsV2.clear();selectedTaskIdsV2.add("ordinary");updateBulkV2()',ctx);assert.equal(button.disabled,true);
  });
  test('HOTFIX-DRIVE-01','MOCK folder cache and Drive response refuse changed account while retaining workspace scope',async()=>{
    let uid='google-a',workspace='fixture/private',calls=0;
    const ctx=vm.createContext({localOnly:false,driveFolderId:'',driveFolderScope:'',appConfig:{},
      getBuildingUser:()=>({uid}),recurrenceWorkspace:()=>workspace,
      assertRecurrenceWorkspace:expected=>{if(workspace!==expected)throw Error('업무공간 변경')},
      ensureDriveAccess:async()=> 'synthetic-token',
      driveFetch:async()=>{calls++;return {json:async()=>({files:[{id:'folder-'+uid}]})}},
      fetch:async()=>({status:200,ok:true}),URL,clearDriveAccessToken:()=>{},currentDriveToken:async()=> 'synthetic-token',
      invalidateBuildingDriveAccessToken:()=>{}});
    vm.runInContext(declarations('js/cloud-sync.js',['ensureDriveFolder','driveFetchResponse']),ctx);
    assert.equal(await vm.runInContext('ensureDriveFolder()',ctx),'folder-google-a');
    assert.equal(await vm.runInContext('ensureDriveFolder()',ctx),'folder-google-a');assert.equal(calls,1);
    uid='google-b';assert.equal(await vm.runInContext('ensureDriveFolder()',ctx),'folder-google-b');assert.equal(calls,2);
    ctx.fetch=async()=>{uid='google-c';return {status:200,ok:true}};
    await assert.rejects(vm.runInContext('driveFetchResponse("https://fixture.invalid")',ctx),/계정이 변경/);
  });
  test('HOTFIX-ATTACH-01','MOCK recovery-required row reuses the original Drive ID after auth failure',async()=>{
    const {create}=require('../js/attachment-store.js');
    const rows=new Map(),files=new Map();let allocates=0,uploads=0,allow=false;
    const options={store:{get:async key=>structuredClone(rows.get(key)),put:async(key,row)=>rows.set(key,structuredClone(row)),list:async()=>[...rows.values()]},
      scope:()=> 'fixture/private/google-a',allocate:async()=>`drive-${++allocates}`,
      upload:async(id,file)=>{uploads++;if(!allow)throw Error('Drive 권한 확인 필요');files.set(id,file.size)},
      verify:async(id,row)=>files.get(id)===row.size};
    const file=new File(['synthetic pdf'],'문서.pdf',{type:'application/pdf'});
    await assert.rejects(create(options).send(file),/Drive 권한/);
    const initial=[...rows.values()][0];assert.equal(initial.phase,'recovery-required');assert.equal(initial.fileId,'drive-1');
    allow=true;const retried=await create(options).send(file);
    assert.equal(retried.fileId,'drive-1');assert.equal(allocates,1);assert.equal(uploads,2);
    assert.equal((await create(options).diagnose({}))[0].referenced,false);
  });
  test('HOTFIX-SERIES-03','Chromium generated monthly occurrence enables bulk-series control without enabling ordinary task',()=>
    require('./browser.test.cjs').withPage({width:1200,height:900},EnvironmentUnavailable,async page=>{
      const result=await page.evaluate(()=>{
        const old=state.tasks,selected=[...selectedTaskIdsV2];
        try{
          state.tasks=[{id:'fixture-root',name:'월 반복',start:'2026-10-01',end:'2026-10-01',status:'planned',repeat:{cycle:'monthly'},dbManualRootTemplateId:'fixture-template'},
            {id:'fixture-occ',name:'반복 회차',start:'2026-11-01',end:'2026-11-01',status:'planned',repeatOriginV181:'fixture-root',repeatGeneratedV181:true,generatedKey:'fixture-key'},
            {id:'fixture-ordinary',name:'일반 업무',start:'2026-11-01',end:'2026-11-01',status:'planned'}];
          selectedTaskIdsV2.clear();selectedTaskIdsV2.add('fixture-occ');renderTaskTable();
          const recurring=!document.querySelector('#deleteSelectedSeries').disabled;
          selectedTaskIdsV2.clear();selectedTaskIdsV2.add('fixture-ordinary');updateBulkV2();
          return {recurring,ordinary:document.querySelector('#deleteSelectedSeries').disabled};
        }finally{state.tasks=old;selectedTaskIdsV2.clear();selected.forEach(id=>selectedTaskIdsV2.add(id));renderTaskTable()}
      });
      assert.deepEqual(result,{recurring:true,ordinary:true});
    }));
  test('HOTFIX-SERIES-04','MOCK auto-series trash keeps generated-key suppression and excludes another template',()=>{
    const tasks=[{id:'auto-a',dbAuto:true,autoSourceTemplateId:'template-a',generatedKey:'dbauto:template-a:2026-10',status:'planned'},
      {id:'auto-a2',dbAuto:true,autoSourceTemplateId:'template-a',generatedKey:'dbauto:template-a:2026-11',status:'planned'},
      {id:'auto-b',dbAuto:true,autoSourceTemplateId:'template-b',generatedKey:'dbauto:template-b:2026-10',status:'planned'}];
    const ctx=vm.createContext({state:{tasks,templates:[]},effectiveStatus:t=>t.status||'planned',
      uid:()=> 'synthetic-trash',archiveCloneV29:x=>structuredClone(x),Date});
    vm.runInContext(declarations('index.html',['repeatSeriesIdentityVHotfix','repeatSeriesDeletionPlanVHotfix','taskDeletionIdsV29','taskTrashEntryV29']),ctx);
    const plan=vm.runInContext('repeatSeriesDeletionPlanVHotfix([state.tasks[0]])',ctx);
    assert.deepEqual([...plan.ids],['auto-a','auto-a2']);
    const entry=vm.runInContext('taskTrashEntryV29(["auto-a","auto-a2"])',ctx);
    assert.deepEqual([...entry.snapshot.suppressedKeys],['dbauto:template-a:2026-10','dbauto:template-a:2026-11']);
    assert.equal(entry.snapshot.tasks.some(task=>task.id==='auto-b'),false);
  });
};
