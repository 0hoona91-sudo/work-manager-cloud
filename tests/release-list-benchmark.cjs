// Run once against an immutable phase10 checkout and current release tree.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright-core');
const roots={before:process.env.RELEASE_BASELINE_DIR,after:path.resolve(__dirname,'..')};
if(!roots.before||!fs.existsSync(path.join(roots.before,'index.html')))throw Error('RELEASE_BASELINE_DIR must contain the verified phase10 checkout');
const server=http.createServer((req,res)=>{
  const match=req.url.match(/^\/(before|after)\/(.*?)(?:\?.*)?$/);
  if(!match)return res.writeHead(404).end();
  const file=path.join(roots[match[1]],match[2]||'index.html');
  if(!file.startsWith(roots[match[1]]+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return res.writeHead(404).end();
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.webp')?'image/webp':'text/html');
  fs.createReadStream(file).pipe(res);
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-background-networking']});
  const results=[];
  try{for(const count of [1000,10000])for(const variant of ['before','after']){
    const context=await browser.newContext({viewport:{width:1440,height:900},timezoneId:'Asia/Seoul',serviceWorkers:'block'});
    await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
    const page=await context.newPage();page.setDefaultTimeout(120000);
    await page.goto(`http://127.0.0.1:${server.address().port}/${variant}/index.html`,{waitUntil:'networkidle',timeout:120000});
    const result=await page.evaluate(count=>{
      state.tasks=Array.from({length:count},(_,i)=>({id:`release-${String(i).padStart(5,'0')}`,name:`합성 업무 ${i}`,category:'기타',status:'planned',start:'2026-10-23',end:'2026-10-24',checklist:[],attachments:[]}));
      state.settings.taskListViewV35='active';document.querySelector('#taskSearch').value='';document.querySelector('#taskStatusFilter').value='all';
      let saves=0;const original=saveState;saveState=()=>{saves++;return Promise.resolve();};
      const start=performance.now();let error=null;
      try{showPage('taskListPage');}catch(e){error=e.message;}finally{saveState=original;}
      return {milliseconds:Math.round((performance.now()-start)*10)/10,rows:document.querySelectorAll('#taskTableBody tr').length,pages:document.querySelector('#taskListPageSelectRelease')?.options.length||1,saves,error,sourceCount:state.tasks.length};
    },count);
    results.push({count,variant,...result});console.log(JSON.stringify(results.at(-1)));await context.close();
  }}finally{await browser.close();server.close();}
  const output=process.env.RELEASE_BENCH_OUTPUT||'/tmp/release-list-benchmark.json';
  fs.mkdirSync(path.dirname(output),{recursive:true});
  fs.writeFileSync(output,JSON.stringify({baseline:'082cee075f2f699d1c1b2c9fb46ff75b7b7cbc90',fixture:'synthetic 1k/10k same Chromium and machine, one run each',results},null,2)+'\n');
})().catch(error=>{console.error(error);process.exitCode=1;server.close();});
