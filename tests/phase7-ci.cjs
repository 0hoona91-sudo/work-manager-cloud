// Demo-only, locked regression gate; no production fallback.
const {spawnSync}=require('node:child_process'),fs=require('node:fs'),assert=require('node:assert/strict');
if(process.env.GCLOUD_PROJECT!=='demo-work-manager'||!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw Error('Expected loopback demo-work-manager emulator');
const child=spawnSync(process.execPath,['tests/run.cjs'],{stdio:'inherit'});process.exitCode=child.status??1;
const baseline=JSON.parse(fs.readFileSync('docs/refactor/phase6f/after-results.json'));
const current=JSON.parse(fs.readFileSync('test-results/phase7-results.json'));
assert.equal(baseline.total,371);assert.equal(new Set(current.results.map(r=>r.id)).size,current.total);
for(const before of baseline.results){const after=current.results.find(r=>r.id===before.id);assert.ok(after,`Missing baseline ${before.id}`);assert.equal(after.status,before.id==='BUG-01'?'PASS':before.status,`Baseline regression ${before.id}`);}
// Preserve detailed known expectations from the original full evidence, except retired BUG-01.
const historical=JSON.parse(fs.readFileSync('docs/refactor/phase6c/after-results.json'));
for(const before of historical.results.filter(r=>r.status==='XFAIL'&&r.id!=='BUG-01')){const after=current.results.find(r=>r.id===before.id);assert.deepEqual(after.expected,before.expected);assert.deepEqual(after.observed,before.observed);}
fs.writeFileSync('test-results/baseline-preservation.json',JSON.stringify({baseline:'3d3f81ac055a32d6951c41eb5c41b0b9da2faad2',checked:371,documentedContracts:['BUG-01: removed feature; no active Tasks imports','STATIC-02: no missing-model exception','AUTH-12: retired token purge and Drive isolation','PROVISION-07: remaining auth importer and Tasks module absence'],newIds:current.results.filter(r=>!baseline.results.some(b=>b.id===r.id)).map(r=>r.id)},null,2));
console.log('Phase7: all 371 baseline IDs preserved; BUG-01 retirement PASS, other statuses unchanged.');
