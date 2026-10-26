// 12-A gate only. No HTTP fallback, policy override, mock picker, or operating data.
const fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright-core');
const root=path.resolve(__dirname,'../..');
(async()=>{
 const report={baseSha:'a8eff0b8b47575bc7ad1db96fb0eda669d27ca96',platform:process.platform,
  transport:'file://',productionAccess:false,results:[],gate:'NOT_VERIFIED'};
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 report.browser=browser.version();
 try{
  const page=await browser.newPage();
  await page.route('**/*',route=>new URL(route.request().url()).protocol==='file:'?route.continue():route.abort());
  await page.goto(pathToFileURL(path.join(root,'local/12a-folder-probe.html')).href);
  report.results.push({id:'LOCAL-FILE-01',status:'PASS',detail:'HTML opened through file://'});
  report.capabilities=await page.evaluate(()=>({secure:isSecureContext,picker:typeof showDirectoryPicker}));
  // Native folder selection must not be replaced with a mocked directory/OPFS handle.
  report.results.push({id:'LOCAL-FOLDER-01',status:'NOT_RUN',detail:'Native user folder selection and permission are required.'});
 }catch(e){
  report.results.push({id:'LOCAL-FILE-01',status:e.message.includes('ERR_BLOCKED_BY_ADMINISTRATOR')?'NOT_RUN':'FAIL',detail:e.message});
  report.results.push({id:'LOCAL-FOLDER-01',status:'NOT_RUN',detail:'file:// navigation prerequisite not met.'});
 }finally{await browser.close()}
 for(const id of ['LOCAL-WRITE-READ-01','LOCAL-RESTART-01'])report.results.push({id,status:'NOT_RUN',detail:'No native directory handle was acquired; no PC folder write or restart verification claimed.'});
 report.counts=Object.fromEntries(['PASS','FAIL','NOT_RUN'].map(s=>[s,report.results.filter(r=>r.status===s).length]));
 fs.writeFileSync(path.join(root,'docs/local/phase12/12a-results.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({gate:report.gate,browser:report.browser,counts:report.counts}));
 process.exitCode=report.results.some(r=>r.status!=='PASS')?2:0;
})().catch(e=>{console.error(e.message);process.exitCode=1});
