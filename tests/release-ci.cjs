// Demo-only full release gate; baseline IDs and results cannot be weakened.
const {spawnSync}=require('node:child_process');
const fs=require('node:fs'),assert=require('node:assert/strict');
if(process.env.GCLOUD_PROJECT!=='demo-work-manager'||!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw Error('Only loopback demo-work-manager emulator is allowed');
const run=spawnSync(process.execPath,['tests/run.cjs'],{stdio:'inherit'});
if(run.status!==0)process.exitCode=run.status??1;
const baseline=JSON.parse(fs.readFileSync('docs/refactor/phase10/after-results.json'));
const previousRelease=JSON.parse(fs.readFileSync('docs/release/predeploy/after-results.json'));
const current=JSON.parse(fs.readFileSync('test-results/phase10-results.json'));
assert.equal(baseline.total,424);
assert.equal(new Set(current.results.map(row=>row.id)).size,current.total);
for(const old of baseline.results)assert.equal(current.results.find(row=>row.id===old.id)?.status,old.status,`Regression ${old.id}`);
assert.equal(previousRelease.total,431);
for(const old of previousRelease.results)assert.equal(current.results.find(row=>row.id===old.id)?.status,old.status,`Release regression ${old.id}`);
for(const status of ['FAIL','XFAIL','XPASS','NOT_RUN'])assert.equal(current.counts[status],0,status);
assert.equal(current.total,431+9);
fs.writeFileSync('test-results/release-baseline-preservation.json',JSON.stringify({baseline:previousRelease.verifiedCodeSha,checked:431,newIds:current.results.filter(row=>!previousRelease.results.some(old=>old.id===row.id)).map(row=>row.id)},null,2)+'\n');
console.log('Hotfix: all 431 release IDs and statuses retained.');
