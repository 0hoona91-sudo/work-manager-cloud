const assert=require('node:assert/strict');const {withPage}=require('./browser.test.cjs');
(async()=>{await withPage({width:1440,height:1000},Error,async page=>{
 await page.evaluate(()=>{seed();window.cloudSync=localCloudShim();openTaskForm()});
 assert.equal(await page.locator('#tfLinkBox').count(),0);
 assert.equal(await page.locator('#tfAddStep').count(),0);
 const before=await page.evaluate(()=>state.tasks.length);
 page.on('dialog',async d=>d.accept());
 await page.locator('#tfName').fill('합성 단일 업무');
 await page.locator('#saveTask').click();
 await page.waitForFunction(()=>!document.querySelector('#saveTask'));
 const result=await page.evaluate(()=>({tasks:state.tasks.map(t=>({id:t.id,groupId:t.groupId,projectId:t.projectId})),templates:state.templates.map(t=>({name:t.name,linkedSteps:t.linkedSteps}))}));
 assert.equal(result.tasks.length,before+1);assert.ok(!result.tasks.at(-1).projectId);assert.ok(!result.tasks.at(-1).groupId);
 assert.equal(result.templates.at(-1).name,'합성 단일 업무');assert.deepEqual(result.templates.at(-1).linkedSteps,[]);
 });console.log('SINGLE-UI-01 PASS')})().catch(e=>{console.error(e);process.exitCode=1});
