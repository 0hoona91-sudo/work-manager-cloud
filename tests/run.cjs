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
  const emulatorOnly = process.argv.includes('--emulator-only');
  const journalOnly = process.argv.includes('--journal-only');
  const conflictsOnly = process.argv.includes('--conflicts-only');
  const commandsOnly = process.argv.includes('--commands-only');
  const atomicityOnly = process.argv.includes('--atomicity-only');
  const recurrenceOnly = process.argv.includes('--recurrence-only');
  const scheduleOnly = process.argv.includes('--schedule-only');
  const dateOnly = process.argv.includes('--dates-only');
  const attachmentOnly = process.argv.includes('--attachments-only');
  const credentialOnly = process.argv.includes('--credentials-only');
  const backupOnly = process.argv.includes('--backups-only');
  const completionOnly = process.argv.includes('--completion-only');
  const styleOnly = process.argv.includes('--styles-only');
  const phase10Only = process.argv.includes('--phase10-only');
  const releaseOnly = process.argv.includes('--release-only');
  const idFilter = process.argv.find(arg => arg.startsWith('--id='))?.slice(5);
  if (emulatorOnly || journalOnly || conflictsOnly || commandsOnly || atomicityOnly || recurrenceOnly || scheduleOnly || dateOnly || attachmentOnly || credentialOnly || completionOnly || backupOnly || styleOnly || phase10Only || releaseOnly) cases.length = 0;
  for (const suite of (emulatorOnly ? ['recurrence-atomicity','emulator-integration','rules-hardening','provisioning','tasks-retirement'] : journalOnly ? ['journal'] : conflictsOnly ? ['save-conflicts'] : commandsOnly ? ['save-command'] : atomicityOnly ? ['recurrence-atomicity'] : recurrenceOnly ? ['recurrence','recurrence-rules','recurrence-identity'] : scheduleOnly ? ['model','schedule'] : dateOnly ? ['model','date'] : backupOnly ? ['data','backup','backup-cloud','backup-files'] : completionOnly ? ['model','completion'] : credentialOnly ? ['credential','drive-auth'] : attachmentOnly ? ['attachment','attachment-store','attachment-recovery-ui'] : styleOnly ? ['static','style-assets','reach'] : phase10Only ? ['phase10-integration'] : releaseOnly ? ['release-predeploy','hotfix'] : ['static','style-assets','reach','model', 'data', 'recurrence', 'browser','feature-ui', 'attachment','attachment-store','attachment-recovery-ui', 'credential','drive-auth','completion','backup','backup-cloud','backup-files','date','schedule','recurrence-rules','recurrence-identity','recurrence-atomicity','save-command','save-conflicts','journal','emulator-integration','rules-hardening','provisioning','tasks-retirement','phase10-integration','release-predeploy','hotfix'])) {
    require(`./${suite}.test.cjs`)({ test, known, EnvironmentUnavailable });
  }
  const results = [];
  for (const item of idFilter ? cases.filter(item => item.id === idFilter) : cases) {
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
  assert.ok(results.length > (phase10Only || releaseOnly || idFilter ? 0 : 1), 'Zero test runs are forbidden');
  const counts = Object.fromEntries(['PASS', 'FAIL', 'XFAIL', 'XPASS', 'NOT_RUN'].map(s => [s, results.filter(r => r.status === s).length]));
  const report = { generatedAt: new Date().toISOString(), sourceBaseline: '091dbecd701153e7e1880bd6bb84a277b789c58f',
    refactorBase: 'b1f448ec0620b0ccba4f3614d6335e04726e07a0',
    rulesSourceSha256: Object.fromEntries(['js/firestore-rules-policy.js','js/workspace-rules-ui.js','js/workspace-preflight.js','tests/emulator/firestore.rules'].map(file=>[file,createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')])),
    commandSourceSha256: Object.fromEntries(['index.html','js/cloud-sync.js','js/save-command.js','js/save-command-adapter.js','js/task-save-conflict.js','js/operation-journal.js','js/recovery-ui.js'].map(file=>[file,createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')])),
    recurrenceSourceSha256: Object.fromEntries(['index.html','js/recurrence-rules.js','js/recurrence-identity.js','js/project-ui.js','js/cloud-sync.js'].map(file => [file,createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')])),
    scheduleSourceSha256: Object.fromEntries(['index.html','js/project-model.js','js/project-ui.js'].map(file => [file,createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')])),
    dateSourceSha256: Object.fromEntries(['index.html','js/date-only.js','js/project-model.js'].map(file => [file,createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')])),
    backupSourceSha256: Object.fromEntries(['index.html','js/backup-safety.js','js/backup-ui.js','js/cloud-sync.js'].map(file => [file,createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')])),
    completionSourceSha256: Object.fromEntries(['index.html','js/project-model.js','js/project-ui.js'].map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')])),
    credentialSourceSha256: createHash('sha256').update(fs.readFileSync(path.join(root, 'js/workspace-profile.js'))).digest('hex'),
    attachmentSourceSha256: createHash('sha256').update(fs.readFileSync(path.join(root, 'js/cloud-sync.js'))).digest('hex'),
    checkoutHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    node: process.version, timezone: process.env.TZ, strict: process.argv.includes('--strict'), total: results.length, counts, results };
  const dir = path.join(root, 'test-results');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, emulatorOnly ? 'emulator-results.json' : journalOnly ? 'journal-results.json' : conflictsOnly ? 'conflict-results.json' : commandsOnly ? 'command-results.json' : atomicityOnly ? 'atomicity-results.json' : recurrenceOnly ? 'recurrence-results.json' : scheduleOnly ? 'schedule-results.json' : dateOnly ? 'date-results.json' : backupOnly ? 'backup-results.json' : completionOnly ? 'completion-results.json' : credentialOnly ? 'credential-results.json' : attachmentOnly ? 'attachment-results.json' : styleOnly ? 'style-results.json' : phase10Only ? 'phase10-focused-results.json' : releaseOnly ? 'release-focused-results.json' : 'phase10-results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`\nTotal ${results.length}: ${JSON.stringify(counts)}`);
  process.exitCode = counts.FAIL || counts.XPASS || counts.NOT_RUN || (process.argv.includes('--strict') && counts.XFAIL) ? 1 : 0;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
