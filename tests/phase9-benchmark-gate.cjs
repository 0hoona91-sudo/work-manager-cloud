// Compare a fixed synthetic fixture on the phase8 baseline and current tree.
// A pre-existing benchmark failure is retained as a limitation, never called PASS.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const report = JSON.parse(fs.readFileSync(process.env.PHASE9_BENCH_OUTPUT || 'test-results/performance-results.json'));
assert.equal(report.baseline, 'daa15a100837ad4f3aeca2e31136041bf48ad10f');
const limitations = [];
for (const count of [1000, 10000]) {
  const before = report.results.find(row => row.count === count && row.variant === 'before');
  const after = report.results.find(row => row.count === count && row.variant === 'after');
  assert.ok(before && after, `Missing benchmark pair ${count}`);
  for (const row of [before, after]) {
    assert.equal(row.taskCount, count, `Fixture count ${count}/${row.variant}`);
    assert.equal(row.saveCalls, 0, `Read-only render saved data ${count}/${row.variant}`);
  }
  for (const operation of ['home', 'tasks', 'search', 'calendar', 'library', 'projects', 'serialize']) {
    const baselineError = before[operation]?.error;
    const currentError = after[operation]?.error;
    if (baselineError || currentError) {
      assert.equal(currentError, baselineError, `New benchmark failure ${count}/${operation}`);
      limitations.push({ count, operation, error: currentError, status: 'BASELINE_FAILURE' });
    } else {
      assert.equal(typeof before[operation], 'number', `Missing baseline duration ${count}/${operation}`);
      assert.equal(typeof after[operation], 'number', `Missing current duration ${count}/${operation}`);
    }
  }
}
report.limitations = limitations;
fs.writeFileSync(process.env.PHASE9_BENCH_OUTPUT || 'test-results/performance-results.json', JSON.stringify(report, null, 2) + '\n');
console.log(`Phase9 performance pairs preserved; baseline failures: ${JSON.stringify(limitations)}`);
