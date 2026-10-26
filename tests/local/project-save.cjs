// Browser connection smoke test over loopback with an in-memory MOCK FSA; not native file:// evidence.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright-core');
(async()=>{
 const html=fs.readFileSync(path.join(__dirname,'../../local/dist/업무관리.html'));
 const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html)});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-background-networking']});
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   const folders=new Map(),locks=new Set();window.__mockFS={folders,fail:false};
   const directory=(prefix='')=>({name:prefix||'synthetic',queryPermission:async()=> 'granted',requestPermission:async()=> 'granted',getDirectoryHandle:async name=>directory(prefix+name+'/'),getFileHandle:async(name,{create=false}={})=>{
    const id=prefix+name;if(!folders.has(id)){if(!create)throw Object.assign(Error(id),{name:'NotFoundError'});folders.set(id,'')}
    return {getFile:async()=>({size:new TextEncoder().encode(folders.get(id)).length,text:async()=>folders.get(id)}),createWritable:async options=>{if(options.mode==='exclusive'){if(locks.has(id))throw Object.assign(Error('locked'),{name:'NoModificationAllowedError'});locks.add(id)}let value='';return {write:async x=>{value=x},close:async()=>{if(window.__mockFS.fail)throw Error('synthetic write failure');folders.set(id,value);locks.delete(id)},abort:async()=>locks.delete(id)}}}
   },async *entries(){for(const [id] of folders)if(id.startsWith(prefix)&&!id.slice(prefix.length).includes('/'))yield [id.slice(prefix.length),{kind:'file'}]}});
   window.showDirectoryPicker=async()=>directory();
  });
  await page.goto('http://127.0.0.1:'+server.address().port+'/',{waitUntil:'domcontentloaded'});
  const before=await page.evaluate(async()=>({gate:!!document.getElementById('localGate'),appInert:document.querySelector('.app')?.hasAttribute('inert'),save:await saveState()}));
  if(!before.gate||!before.appInert||before.save.persistence!=='not-connected')throw Error('unconnected gate/save contract failed');
  await page.locator('#localChoose').click();try{await page.waitForFunction(()=>!document.getElementById('localGate'),null,{timeout:4000})}catch(e){console.log('gate diagnostic',await page.evaluate(()=>({message:document.querySelector('#localGateMessage')?.textContent,status:document.querySelector('#localStatus')?.textContent,ready:window.__LOCAL_STATE_READY_V121__,files:[...window.__mockFS.folders.keys()].slice(0,8)})),errors);throw e}
  const dialogs=[];page.on('dialog',async d=>{dialogs.push(d.message());await d.accept()});
  await page.evaluate(()=>openTaskForm());
  if(await page.locator('#tfLinkBox').count()||await page.locator('#tfAddStep').count())throw Error('single-task stages visible');
  await page.locator('#tfName').fill('합성 단일 업무');await page.locator('#saveTask').click();
  await page.waitForFunction(()=>!document.querySelector('#saveTask'));
  const single=await page.evaluate(()=>({count:state.tasks.length,project:state.tasks[0].projectId,group:state.tasks[0].groupId,links:state.templates.at(-1)?.linkedSteps}));
  if(single.count!==1||single.project||single.group||single.links?.length!==0)throw Error('single-task classification failed');
  if(dialogs.length!==1||!dialogs[0].includes('업무 DB에도'))throw Error('unexpected single-task dialog');dialogs.length=0;
  await page.evaluate(()=>WMProjectUI.openEditor());
  await page.locator('#prj-name').fill('합성 프로젝트');
  await page.locator('#prj-category').selectOption({index:1});
  await page.locator('[data-stage-field="title"]').fill('합성 단계');
  await page.locator('[data-person]').first().check();
  await page.locator('#prjSave').click();
  await page.waitForTimeout(500);
  const result=await page.evaluate(()=>({mode:cloudSync.mode,projects:state.projects.length,tasks:state.tasks.length,folderProjects:WMLocalStore.snapshot.projects.length,modal:!!document.querySelector('#prjSave'),status:document.querySelector('#localStatus').textContent}));
  console.log(JSON.stringify({result,dialogs,pageErrors:errors}));
  if(result.projects!==1||result.folderProjects!==1||result.modal||dialogs.length||errors.length)process.exitCode=1;
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve))}
})().catch(e=>{console.error(e);process.exitCode=1});
