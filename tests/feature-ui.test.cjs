const assert=require('node:assert/strict');
const {withPage}=require('./browser.test.cjs');
module.exports=({test,EnvironmentUnavailable})=>{
 test('FEATURE-UI-01','Home rendering alone issues no save command',()=>withPage({width:1440,height:1000},EnvironmentUnavailable,async page=>{
  const result=await page.evaluate(()=>{let calls=0;const original=saveState;saveState=()=>{calls++;return Promise.resolve();};try{renderHome();renderHome();return calls;}finally{saveState=original;}});
  assert.equal(result,0);
 }));
 test('FEATURE-UI-02','Search IME and filters survive viewport changes without duplicate input handling',()=>withPage({width:1440,height:900},EnvironmentUnavailable,async page=>{
  await page.evaluate(()=>showPage('taskListPage'));
  await page.locator('#taskSearch').fill('한글');await page.locator('#taskStatusFilter').selectOption('pending');
  for(const width of [320,390,768,1440]){
   await page.setViewportSize({width,height:900});
   await page.evaluate(()=>{renderTaskTable();renderHome();});
   assert.equal(await page.locator('#taskSearch').inputValue(),'한글');
   assert.equal(await page.locator('#taskStatusFilter').inputValue(),'pending');
  }
  await page.locator('#taskSearch').evaluate(input=>{input.value='한';input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));input.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));input.value='한글';input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));});
  await page.waitForTimeout(50);assert.equal(await page.locator('#taskSearch').inputValue(),'한글');
 }));
 test('FEATURE-UI-03','Home viewport feature mount is replaceable and disposes listeners',()=>{
  const {create}=require('../js/feature-ui-viewport.js');const listeners=new Map();let scheduled=null,calls=0,removed=0;
  const host={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name)=>{listeners.delete(name);removed++;},requestAnimationFrame:fn=>{scheduled=fn;return 1;},cancelAnimationFrame:()=>{scheduled=null;}};
  const api=create(host),old=api.mount('home',()=>calls+=10),current=api.mount('home',()=>calls++);
  old();assert.equal(listeners.size,2);listeners.get('resize')();listeners.get('orientationchange')();scheduled();assert.equal(calls,1);
  current();assert.equal(listeners.size,0);assert.equal(removed,2);
 });
 test('FEATURE-UI-04','Task navigation labels agree after mobile rotation and desktop resize',()=>withPage({width:1440,height:900},EnvironmentUnavailable,async page=>{
  const labels=()=>page.locator('.navbtn[data-page="taskListPage"][data-task-view-v35="active"] span:last-child').allTextContents();
  let values=await labels();assert.ok(values.length>0);assert.ok(values.every(v=>v==='진행(예정) 업무'));
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.dispatchEvent(new Event('orientationchange')));await page.waitForTimeout(50);
  values=await labels();assert.ok(values.every(v=>v==='진행업무'));
  await page.setViewportSize({width:1440,height:900});await page.waitForTimeout(50);
  values=await labels();assert.ok(values.every(v=>v==='진행(예정) 업무'));
 }));
};
