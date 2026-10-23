const assert = require('node:assert/strict');
const { isDeepStrictEqual } = require('node:util');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { root, plain } = require('./helpers.cjs');

process.env.TZ = 'UTC';
class EnvironmentUnavailable extends Error {}
function classify(actual, expected, known) {
  try { assert.deepEqual(actual, expected); return known ? 'XPASS' : 'PASS'; }
  catch (error) {
    if (!(error instanceof assert.AssertionError)) throw error;
    if (known && isDeepStrictEqual(actual, known.observed)) return 'XFAIL';
    throw error;
  }
}
async function main() {
  const cases = [];
  const test = (id, title, run) => cases.push({ id, title, run });
  const known = (id, title, observe, expected, observed, source) =>
    cases.push({ id, title, observe, expected, known: { observed, source } });
  // Verify the classification gate itself: unrelated failures cannot become XFAIL.
  test('HARNESS-01', 'Outcome gate rejects changed failure signatures and unexpected passes', () => {
    assert.equal(classify(1, 1), 'PASS');
    assert.equal(classify(0, 1, { observed: 0 }), 'XFAIL');
    assert.equal(classify(1, 1, { observed: 0 }), 'XPASS');
    assert.throws(() => classify(2, 1, { observed: 0 }), assert.AssertionError);
  });
  const attachmentOnly = process.argv.includes('--attachments-only');
  if (attachmentOnly) cases.length = 0;
  for (const suite of (attachmentOnly ? ['attachment'] : ['static', 'model', 'data', 'recurrence', 'browser', 'attachment'])) {
    require(`./${suite}.test.cjs`)({ test, known, EnvironmentUnavailable });
  }
  const results = [];
  for (const item of cases) {
    const result = { id: item.id, title: item.title };
    try {
      if (item.known) {
        result.expected = item.expected;
        result.observed = plain(await item.observe());
        result.source = item.known.source;
        result.status = classify(result.observed, item.expected, item.known);
      } else { await item.run(); result.status = 'PASS'; }
    } catch (error) {
      result.status = error instanceof EnvironmentUnavailable ? 'NOT_RUN' : 'FAIL';
      result.error = error.stack || String(error);
    }
    results.push(result);
    console.log(`${result.status.padEnd(7)} ${result.id} ${result.title}`);
    if (result.error) console.error(result.error);
  }
  assert.ok(results.length > 1, 'Zero test runs are forbidden');
  const counts = Object.fromEntries(['PASS', 'FAIL', 'XFAIL', 'XPASS', 'NOT_RUN'].map(s => [s, results.filter(r => r.status === s).length]));
  const report = { generatedAt: new Date().toISOString(), sourceBaseline: '091dbecd701153e7e1880bd6bb84a277b789c58f',
    refactorBase: '748db8132cfd24a5963c6f0187b9b0be628a3544',
    attachmentSourceSha256: createHash('sha256').update(fs.readFileSync(path.join(root, 'js/cloud-sync.js'))).digest('hex'),
    checkoutHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    node: process.version, timezone: process.env.TZ, strict: process.argv.includes('--strict'), total: results.length, counts, results };
  const dir = path.join(root, 'test-results');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, attachmentOnly ? 'attachment-results.json' : 'phase3a-results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`\nTotal ${results.length}: ${JSON.stringify(counts)}`);
  process.exitCode = counts.FAIL || counts.XPASS || counts.NOT_RUN || (process.argv.includes('--strict') && counts.XFAIL) ? 1 : 0;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
