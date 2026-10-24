// This entry point cannot fall back to a production Firebase project.
const {spawnSync}=require('node:child_process'),fs=require('node:fs'),assert=require('node:assert/strict');
if(process.env.GCLOUD_PROJECT!=='demo-work-manager'||!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw Error('Expected loopback demo-work-manager emulator; refusing to run');
const full=process.env.PHASE6D_SCOPE==='full';
const child=spawnSync(process.execPath,['tests/run.cjs',...(full?[]:['--emulator-only'])],{stdio:'inherit'});
process.exitCode=child.status??1;
if(full){
  // Preserve every prior test identity/expectation; only executed Emulator checks may leave NOT_RUN.
  const baseline=JSON.parse(fs.readFileSync('docs/refactor/phase6c/after-results.json'));
  const current=JSON.parse(fs.readFileSync('test-results/phase6d-results.json'));
  assert.equal(baseline.total,308);
  assert.equal(new Set(current.results.map(r=>r.id)).size,current.total,'Duplicate test IDs');
  for(const before of baseline.results){
    const after=current.results.find(r=>r.id===before.id);
    assert.ok(after,`Missing baseline test ${before.id}`);
    assert.equal(after.title,before.title,`Changed baseline title ${before.id}`);
    assert.deepEqual(after.expected,before.expected,`Changed expectation ${before.id}`);
    if(before.status==='XFAIL')assert.deepEqual(after.observed,before.observed,`Changed XFAIL signature ${before.id}`);
  }
  fs.writeFileSync('test-results/baseline-preservation.json',JSON.stringify({baselineCommit:'2798b08e80b52f85545c0551dfebcdcff337ad82',checked:308,idsTitlesAndExpectationsUnchanged:true,xfailSignaturesUnchanged:true},null,2)+'\n');
  console.log('Baseline preservation: all 308 IDs, titles and expectations unchanged; four XFAIL signatures unchanged.');
}
