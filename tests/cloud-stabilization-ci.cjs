// Test-only demo/loopback gate; never authenticates to production services.
const {spawnSync}=require('node:child_process');
const fs=require('node:fs'),assert=require('node:assert/strict');
if(process.env.GCLOUD_PROJECT!=='demo-work-manager'||!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw Error('Only loopback demo-work-manager Emulator is permitted');
const run=spawnSync(process.execPath,['tests/run.cjs'],{stdio:'inherit'});
const before=JSON.parse(fs.readFileSync('docs/features/project-schedule/full-run-before-label-expectation.json'));
const after=JSON.parse(fs.readFileSync('test-results/phase10-results.json'));
assert.equal(before.total,440);
assert.equal(new Set(after.results.map(r=>r.id)).size,after.total);
for(const old of before.results){
  const current=after.results.find(r=>r.id===old.id);
  assert.ok(current,`Removed ID ${old.id}`);assert.equal(current.title,old.title);
  assert.deepEqual(current.expected,old.expected);assert.equal(current.status,'PASS',old.id);
}
for(const key of ['FAIL','XFAIL','XPASS','NOT_RUN'])assert.equal(after.counts[key],0,key);
assert.equal(run.status,0);
fs.writeFileSync('test-results/cloud-baseline-preservation.json',JSON.stringify({baseline:'3f5a443320075a6837f86a13303f54e64796be10',preserved:440,newIds:after.results.filter(r=>!before.results.some(b=>b.id===r.id)).map(r=>r.id)},null,2)+'\n');
console.log('Cloud stabilization: existing 440 contracts retained and every added check passed.');
