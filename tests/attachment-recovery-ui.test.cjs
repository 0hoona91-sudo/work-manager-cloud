const assert=require('node:assert/strict');
const {read,parse}=require('./helpers.cjs');
const {withPage}=require('./browser.test.cjs');
module.exports=({test,EnvironmentUnavailable})=>{
 test('ATTACH-UI-01','Chromium recovery button initializes once, rejects late account results and clears dialogs on logout',()=>withPage({width:1200,height:900},EnvironmentUnavailable,async page=>{
  const source=read('js/cloud-sync.js');
  const names=new Set(['initializeAttachmentRecoveryUI','disposeAttachmentRecoveryUI']);
  const code=parse(source,'module').body.filter(n=>n.type==='FunctionDeclaration'&&names.has(n.id.name)).map(n=>source.slice(n.start,n.end)).join('\n');
  assert.equal((source.match(/initializeAttachmentRecoveryUI\(\);/g)||[]).length,1,'Only browser bootstrap initializes UI');
  await page.evaluate(code=>{
   const anchor=document.createElement('span');anchor.id='cloudUser';document.body.append(anchor);
   (0,eval)(`(function(){let attachmentUiGeneration=0,currentUser={uid:'private-A'},buildingUser={uid:'google-A'},workspace='A',stateRef={};
    let reads=0,resolveRead;const recurrenceWorkspace=()=>workspace;
    const getAttachmentStore=()=>({diagnose:()=>{reads++;return new Promise(r=>{resolveRead=r;});}});
    ${code}
    window.attachmentFixture={init:initializeAttachmentRecoveryUI,reads:()=>reads,resolve:rows=>resolveRead(rows),switch:()=>{workspace='B';currentUser={uid:'private-B'};buildingUser={uid:'google-B'};}};
   })()`);
   attachmentFixture.init();attachmentFixture.init();
  },code);
  assert.equal(await page.locator('#attachmentRecoveryButton').count(),1);
  await page.evaluate(()=>{const b=document.getElementById('attachmentRecoveryButton');b.click();b.click();});
  assert.equal(await page.evaluate(()=>attachmentFixture.reads()),1);
  await page.evaluate(()=>{window.dispatchEvent(new Event('work-manager-credentials-cleared'));attachmentFixture.switch();attachmentFixture.resolve([{fileId:'PRIVATE-A',name:'old user'}]);});
  assert.equal(await page.locator('#attachmentRecoveryDialog').count(),0);
  assert.equal(await page.locator('#attachmentRecoveryButton').count(),0);
  await page.evaluate(()=>{attachmentFixture.init();document.getElementById('attachmentRecoveryButton').click();attachmentFixture.resolve([{fileId:'FILE-B',name:'current user',phase:'uploaded',referenced:false}]);});
  await page.locator('#attachmentRecoveryDialog').waitFor({state:'visible'});
  const text=await page.locator('#attachmentRecoveryDialog').innerText();assert.match(text,/FILE-B/);assert.doesNotMatch(text,/PRIVATE-A/);
  await page.evaluate(()=>window.dispatchEvent(new Event('work-manager-credentials-cleared')));
  assert.equal(await page.locator('#attachmentRecoveryDialog').count(),0);
 }));
};
