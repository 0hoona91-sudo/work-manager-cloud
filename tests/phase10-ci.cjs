// Demo-only full regression gate for integration preflight.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const assert = require('node:assert/strict');
if (process.env.GCLOUD_PROJECT !== 'demo-work-manager' || !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw Error('Expected loopback demo-work-manager emulator');
const run = spawnSync(process.execPath, ['tests/run.cjs'], { stdio: 'inherit' });
if (run.status !== 0) process.exitCode = run.status ?? 1;
const baseline = JSON.parse(fs.readFileSync('docs/refactor/phase9/after-results.json'));
const current = JSON.parse(fs.readFileSync('test-results/phase10-results.json'));
assert.equal(baseline.total, 415);
assert.equal(new Set(current.results.map(row => row.id)).size, current.total);
for (const old of baseline.results) assert.equal(current.results.find(row => row.id === old.id)?.status, old.status, `Regression ${old.id}`);
assert.equal(current.counts.FAIL, 0);
assert.equal(current.counts.XFAIL, 0);
assert.equal(current.counts.XPASS, 0);
assert.equal(current.counts.NOT_RUN, 0);
fs.writeFileSync('test-results/baseline-preservation.json', JSON.stringify({
  baseline: baseline.verifiedCodeSha, checked: 415,
  newIds: current.results.filter(row => !baseline.results.some(old => old.id === row.id)).map(row => row.id)
}, null, 2) + '\n');
console.log('Phase10: all 415 phase9 IDs and statuses retained.');
