const assert = require('node:assert/strict');
const { loadRecurrence, plain } = require('./helpers.cjs');
const { recurring } = require('./fixtures.cjs');
const source = 'js/project-ui.js installRollingRecurrencesV181 / phase1 evidence/browser-results.json';
module.exports = ({ test, known }) => {
  test('REPEAT-01', 'Month end clamps correctly across short months and leap years', () => {
    const R = loadRecurrence(recurring());
    assert.equal(R.addMonths('2026-01-31', 1), '2026-02-28');
    assert.equal(R.addMonths('2024-01-31', 1), '2024-02-29');
    assert.equal(R.addMonths('2026-12-31', 1), '2027-01-31');
  });
  test('REPEAT-02', 'Monthly generation has stable dates, fresh checklist IDs and is idempotent', () => {
    const state = recurring(), R = loadRecurrence(state);
    assert.equal(R.ensureOccurrences(), 3);
    assert.deepEqual(state.tasks.map(t => t.start), ['2026-10-01', '2026-11-01', '2026-12-01', '2027-01-01']);
    assert.equal(new Set(state.tasks.map(t => t.id)).size, 4);
    assert.equal(new Set(state.tasks.map(t => t.checklist[0].id)).size, 4);
    assert.ok(state.tasks.slice(1).every(t => t.status === 'planned' && t.actualComplete === null && !t.checklist[0].done));
    const before = plain(state); assert.equal(R.ensureOccurrences(), 0); assert.deepEqual(plain(state), before);
  });
  test('REPEAT-03', 'Canonical semiannual schedule generates every six months', () => {
    const state = recurring('semiannual', '2026-01-31'), R = loadRecurrence(state);
    R.ensureOccurrences();
    assert.deepEqual(state.tasks.map(t => t.start), ['2026-01-31', '2026-07-31']);
    assert.equal(R.ensureOccurrences(), 0);
  });
  test('REPEAT-04', 'Recurrence end is inclusive and completed roots remain unchanged', () => {
    const state = recurring(); state.tasks[0].repeatUntilV181 = '2026-11-01';
    loadRecurrence(state).ensureOccurrences();
    assert.deepEqual(state.tasks.map(t => t.start), ['2026-10-01', '2026-11-01']);
    const completed = recurring(); Object.assign(completed.tasks[0], { status: 'done', actualComplete: '2026-10-01' });
    const before = plain(completed); assert.equal(loadRecurrence(completed).ensureOccurrences(), 0);
    assert.deepEqual(plain(completed), before);
  });
  test('REPEAT-05', 'Supported selectedMonths filters dates and holiday shifts preserve weekends', () => {
    const state = recurring('monthly', '2026-10-01', { selectedMonths: [1, 4, 7, 10] });
    const R = loadRecurrence(state); R.ensureOccurrences();
    assert.deepEqual(state.tasks.map(t => t.start), ['2026-10-01', '2027-01-01']);
    assert.equal(R.dueShift('2026-10-24', 'next'), '2026-10-26');
    assert.equal(R.dueShift('2026-10-24', 'prev'), '2026-10-23');
  });
  test('BUG-10', 'Schema11 cycleMonths must filter actual generated occurrences', () => {
    const state = recurring('monthly', '2026-10-01', { cycleMonths: [1, 4, 7, 10] });
    loadRecurrence(state).ensureOccurrences();
    assert.deepEqual(state.tasks.map(t => t.start), ['2026-10-01', '2027-01-01']);
  });
  test('BUG-11', 'Legacy half cycle must generate the semiannual occurrence', () => {
    const state = recurring('half', '2026-01-31'); loadRecurrence(state).ensureOccurrences();
    assert.deepEqual(state.tasks.map(t => t.start), ['2026-01-31', '2026-07-31']);
  });
  known('BUG-12', 'Generated recurrence must carry a durable deduplication key', () => {
    const state = recurring(); loadRecurrence(state).ensureOccurrences();
    const generated = state.tasks.slice(1);
    assert.equal(generated.length, 3);
    return generated.map(t => typeof t.generatedKey === 'string' && t.generatedKey.length > 0);
  }, [true, true, true], [false, false, false], source);
};
