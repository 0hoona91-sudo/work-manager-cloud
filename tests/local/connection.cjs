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
  const result=await page.evaluate(async()=>{const was=window.WMLocalStore.snapshot.tasks.length;state.tasks.push({id:'synthetic-connection-task',name:'Local smoke',status:'planned',start:'2026-10-26',end:'2026-10-26',checklist:[]});const receipt=await saveState({reason:'smoke'});const head=window.__mockFS.folders.get('data/HEAD.json');window.__mockFS.fail=true;state.tasks[0].name='Unconfirmed';let rejected=false;try{await saveState({reason:'failure smoke'})}catch{rejected=true}return {ready:window.__LOCAL_STATE_READY_V121__,inert:document.querySelector('.app')?.hasAttribute('inert'),was,persistence:receipt.persistence,head:!!head,folderHasTask:!!head&&JSON.parse(window.__mockFS.folders.get(JSON.parse(head).file.replace(/^/,'data/'))).state.tasks.some(t=>t.id==='synthetic-connection-task'),rejected,status:document.querySelector('#localStatus')?.dataset.phase}});
  console.log(JSON.stringify({before:{gate:before.gate,appInert:before.appInert,save:'not-connected'},result,pageErrors:errors}));
  if(!result.ready||result.inert||!result.folderHasTask||!result.head||!result.rejected||result.status!=='recovery-required'||errors.length)process.exitCode=1;
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve))}
})().catch(e=>{console.error(e);process.exitCode=1});
