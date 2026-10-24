// Demo-only full regression gate for CSS, assets, reachability and performance branch.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const assert = require('node:assert/strict');
if (process.env.GCLOUD_PROJECT !== 'demo-work-manager' || !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) {
  throw Error('Expected loopback demo-work-manager emulator');
}
const child = spawnSync(process.execPath, ['tests/run.cjs'], { stdio: 'inherit' });
if (child.status !== 0) process.exitCode = child.status ?? 1;
const baseline = JSON.parse(fs.readFileSync('docs/refactor/phase8/after-results.json'));
const current = JSON.parse(fs.readFileSync('test-results/phase9-results.json'));
assert.equal(baseline.total, 411);
assert.equal(new Set(current.results.map(r => r.id)).size, current.total);
for (const before of baseline.results) {
  const after = current.results.find(r => r.id === before.id);
  assert.ok(after, `Missing baseline ${before.id}`);
  assert.equal(after.status, before.id === 'BUG-02' ? 'PASS' : before.status, `Regression ${before.id}`);
}
for (const id of ['STYLE-ASSET-01', 'STYLE-ASSET-02', 'REACH-01']) {
  assert.equal(current.results.find(r => r.id === id)?.status, 'PASS', id);
}
assert.equal(current.counts.FAIL, 0);
assert.equal(current.counts.XPASS, 0);
assert.equal(current.counts.NOT_RUN, 0);
const historical = JSON.parse(fs.readFileSync('docs/refactor/phase6c/after-results.json'));
const cssBefore = historical.results.find(r => r.id === 'BUG-02');
fs.writeFileSync('test-results/baseline-preservation.json', JSON.stringify({
  baseline: 'daa15a100837ad4f3aeca2e31136041bf48ad10f',
  checked: baseline.total,
  changed: [{ id: 'BUG-02', before: cssBefore.status, after: 'PASS', priorExpected: cssBefore.expected, priorObserved: cssBefore.observed }],
  newIds: current.results.filter(r => !baseline.results.some(b => b.id === r.id)).map(r => r.id)
}, null, 2));
console.log('Phase9: all 411 phase8 IDs retained; BUG-02 PASS; no new unexpected failure.');
