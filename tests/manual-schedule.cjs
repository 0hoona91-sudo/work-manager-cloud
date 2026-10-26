const assert=require('node:assert/strict');const {loadModel,loadCloud,plain}=require('./helpers.cjs');const {project,stage,schema11}=require('./fixtures.cjs');const {withPage}=require('./browser.test.cjs');
(async()=>{
 const M=loadModel(),p=project();p.stages[1].scheduleMode='manual';p.stages[1].start='2026-11-15';p.stages[1].endDate='2026-11-20';p.stages[1].endType='date';p.stages.push(stage('c','2026-11-21'));p.stages[2].relativeStartDays=1;p.stages[2].relativeEndDays=2;
 M.applyRelativeDates(p);p.stages[0].start='2026-11-10';p.stages[0].endType='date';p.stages[0].endDate='2026-11-12';M.applyRelativeDates(p);
 assert.equal(p.stages[1].start,'2026-11-15');assert.equal(p.stages[1].endDate,'2026-11-20');assert.equal(p.stages[2].start,'2026-11-21');
 const reload=JSON.parse(JSON.stringify(p));M.applyRelativeDates(reload);assert.deepEqual(plain(reload),plain(p));
 const bad=M.clone(p);bad.stages[1].endDate='2026-11-01';const before=JSON.stringify(bad);assert.throws(()=>M.applyRelativeDates(bad));assert.equal(JSON.stringify(bad),before);
 const C=loadCloud(),data=schema11();data.projects=[p];data.templates[0].linkedSteps[0].scheduleMode='manual';const restored=C.deserializeState(C.serializeState(data));assert.equal(restored.projects[0].stages[1].scheduleMode,'manual');assert.equal(restored.templates[0].linkedSteps[0].scheduleMode,'manual');assert.equal(JSON.parse(JSON.stringify(restored)).projects[0].stages[1].start,'2026-11-15');
 console.log('MANUAL-MODEL PASS');
 await withPage({width:1440,height:1000},Error,async page=>{
  await page.evaluate(()=>{seed();window.cloudSync=localCloudShim();WMProjectUI.openEditor()});
  await page.locator('#prj-name').fill('일정 시험');await page.locator('#prj-category').selectOption({index:1});await page.locator('[data-stage-field="title"]').fill('첫 단계');await page.locator('[data-person]').first().check();await page.locator('#prj-add-step').click();await page.locator('[data-stage-field="title"]').fill('직접 단계');await page.locator('[data-person]').first().check();
  await page.locator('#prj-schedule-mode').selectOption('manual');await page.locator('#prj-stageStart').fill('2026-11-15');await page.locator('#prj-stageStart').dispatchEvent('change');await page.locator('#prj-stageEnd').fill('2026-11-20');await page.locator('#prj-stageEnd').dispatchEvent('change');await page.locator('#prjSave').click();await page.waitForFunction(()=>!document.querySelector('#prjSave'));
  assert.deepEqual(await page.evaluate(()=>{const s=state.projects[0].stages[1];return [s.scheduleMode,s.start,s.endDate]}),['manual','2026-11-15','2026-11-20']);
  await page.evaluate(()=>WMProjectUI.openEditor(state.projects[0].id,state.projects[0].stages[1].id));assert.equal(await page.locator('#prj-schedule-mode').inputValue(),'manual');await page.locator('#prjCancel').click();
  const lib=await page.evaluate(()=>{const t={id:'synthetic-template',name:'라이브러리 시험',category:state.categories[0],owner:state.owners[0],libraryKindV175:'project',checklist:[],linkedSteps:[{name:'직접 선택',scheduleMode:'manual',checklist:[]}]};let refused=false;try{createProjectFromLibraryV175(t,'2026-11-01')}catch{refused=true};const before=state.projects.length;const res=createProjectFromLibraryV175(t,'2026-11-01',{1:{start:'2026-11-15',end:'2026-11-20'}});const p=state.projects.find(p=>p.id===res.projectId);return {refused,before,after:state.projects.length,mode:p.stages[1].scheduleMode,start:p.stages[1].start,html:registerCardHtmlV10({root:t,startStage:0,maxStage:1,row:{ref:t.id,name:t.name,category:t.category,kind:'root'}},0)}});
  assert.ok(lib.refused);assert.equal(lib.after,lib.before+1);assert.equal(lib.mode,'manual');assert.equal(lib.start,'2026-11-15');assert.match(lib.html,/data-manual-start/);assert.match(lib.html,/data-manual-end/);
 });console.log('MANUAL-UI PASS');
 for(const width of [390,1440])await withPage({width,height:1000},Error,async page=>{
  page.on('dialog',d=>{console.log('DIALOG',d.message());d.accept()});
  page.on('console',m=>{if(m.type()==='error')console.log(m.text())});
  await page.evaluate(()=>{seed();window.cloudSync=localCloudShim();state.templates=[{id:'lib',projectRootStepNameV175:'첫 단계',cycle:'none',cycleMonths:[],dayRule:'exact',exactDay:1,activeFrom:'2026-10-26',name:'시험 라이브러리',category:state.categories[0],owner:state.owners[0],libraryKindV175:'project',checklist:[],methodBlocks:[],attachments:[],linkedSteps:[{name:'둘째',checklist:[],scheduleMode:'relative'}]}];openDbForm('lib')});
  await page.locator('[data-v6schedule="0"]').selectOption('manual');await page.locator('#saveDb').click();if(await page.locator('#applyTemplateImpactV29').count())await page.locator('#applyTemplateImpactV29').click();try{await page.waitForFunction(()=>!document.querySelector('#saveDb'))}catch(e){console.log(await page.locator('#toast').textContent());throw e};
  assert.equal(await page.evaluate(()=>state.templates[0].linkedSteps[0].scheduleMode),'manual');
  await page.evaluate(()=>{selectedDbRefsV10.clear();selectedDbRefsV10.add('root|lib');openDbRegisterModalV10()});
  await page.locator('[data-manual-start="0|1"]').fill('2026-11-15');await page.locator('[data-manual-end="0|1"]').fill('2026-11-20');await page.locator('#v10RegisterDbTasks').click();await page.waitForFunction(()=>!document.querySelector('#v10RegisterDbTasks'));
  assert.equal(await page.evaluate(()=>state.projects[0].stages[1].scheduleMode),'manual');
  await page.evaluate(()=>{state.projects[0].expanded=true;renderTaskTable()});
  // Measure controls after the feature's DOM decoration has installed the method button.
  await page.waitForFunction(()=>document.querySelectorAll('.workflow-project-actions-v174>button').length>=3);
  const sizes=await page.locator('.workflow-project-actions-v174>button').evaluateAll(els=>els.slice(0,3).map(el=>{const c=getComputedStyle(el);return [c.width,c.minHeight,c.padding,c.fontSize,c.borderRadius]}));assert.equal(new Set(sizes.map(JSON.stringify)).size,1);
 });console.log('LIBRARY-AND-BUTTONS PASS (390/1440)');
})().catch(e=>{console.error(e);process.exitCode=1});
