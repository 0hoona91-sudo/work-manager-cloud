// Demo-only full regression gate for feature UI branch.
const {spawnSync}=require('node:child_process'),fs=require('node:fs'),assert=require('node:assert/strict');
if(process.env.GCLOUD_PROJECT!=='demo-work-manager'||!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw Error('Expected loopback demo-work-manager emulator');
const child=spawnSync(process.execPath,['tests/run.cjs'],{stdio:'inherit'});process.exitCode=child.status??1;
const baseline=JSON.parse(fs.readFileSync('docs/refactor/phase7/after-results.json'));
const current=JSON.parse(fs.readFileSync('test-results/phase8-results.json'));
assert.equal(baseline.total,406);assert.equal(new Set(current.results.map(r=>r.id)).size,current.total);
for(const before of baseline.results){const after=current.results.find(r=>r.id===before.id);assert.ok(after,`Missing baseline ${before.id}`);assert.equal(after.status,['BUG-08','BUG-09'].includes(before.id)?'PASS':before.status,`Regression ${before.id}`);}
const historical=JSON.parse(fs.readFileSync('docs/refactor/phase6c/after-results.json'));
const oldCss=historical.results.find(r=>r.id==='BUG-02'),newCss=current.results.find(r=>r.id==='BUG-02');
assert.deepEqual(newCss.expected,oldCss.expected);assert.deepEqual(newCss.observed,oldCss.observed);
fs.writeFileSync('test-results/baseline-preservation.json',JSON.stringify({baseline:'1b834ca7230f1478f9778898c226329c6384001b',checked:406,changed:['BUG-08','BUG-09'],newIds:current.results.filter(r=>!baseline.results.some(b=>b.id===r.id)).map(r=>r.id)},null,2));
console.log('Phase8: all 406 phase7 IDs retained; BUG-08/09 PASS and BUG-02 unchanged.');
