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
};
