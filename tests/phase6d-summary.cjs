const fs=require('node:fs');
let text=`## Phase 6-D evidence\n\nCommit: ${process.env.GITHUB_SHA||'local'}\n\nProject: demo-work-manager. No production credentials or deployments.\n\n`;
const files=fs.existsSync('test-results')?fs.readdirSync('test-results').filter(f=>f.endsWith('-results.json')):[];
for(const file of files){const report=JSON.parse(fs.readFileSync('test-results/'+file));text+=`### ${file}\n\nTotal ${report.total}: ${JSON.stringify(report.counts)}\n\n| ID | Status | Check |\n|---|---|---|\n`;for(const r of report.results)text+=`| ${r.id} | ${r.status} | ${r.title.replaceAll('|','/')} |\n`;for(const r of report.results.filter(r=>r.status==='FAIL'||r.status==='NOT_RUN'))text+=`\n#### ${r.id}\n\n\`\`\`text\n${r.error}\n\`\`\`\n`;}
if(!files.length)text+='No result report: see environment/setup/emulator log. No test success is inferred.\n';
if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,text);else process.stdout.write(text);
// Public job annotations expose compact synthetic results even when API/log downloads are unavailable.
const annotation=(kind,title,value)=>console.log(`::${kind} title=${title}::${String(value).replaceAll('%','%25').replaceAll('\r','%0D').replaceAll('\n','%0A')}`);
for(const file of files){const report=JSON.parse(fs.readFileSync('test-results/'+file));annotation('notice','Phase6D report',JSON.stringify({file,sha:report.checkoutHead,total:report.total,counts:report.counts,results:report.results.map(r=>({id:r.id,status:r.status}))}));for(const r of report.results.filter(r=>r.status==='FAIL'||r.status==='NOT_RUN'))annotation('warning',r.id,r.error);}
if(!files.length&&fs.existsSync('phase6d-emulator.log'))annotation('warning','Phase6D environment',fs.readFileSync('phase6d-emulator.log','utf8').slice(-10000));
