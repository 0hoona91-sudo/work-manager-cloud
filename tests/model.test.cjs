const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { loadModel, plain } = require('./helpers.cjs');
const { project } = require('./fixtures.cjs');
const source = 'js/project-model.js / phase1 evidence/model-results.json';
function setup() {
  const M = loadModel(), p = project();
  M.initializeRelativeDates(p);
  return { M, p, state: { projects: [p], tasks: p.stages.map((s, i) => M.buildStageTask(p, s, i)) } };
}
module.exports = ({ test, known }) => {
  test('MODEL-01', 'Date normalization accepts compact dates and leap day, rejects invalid day', () => {
    const M = loadModel();
    assert.equal(M.date('2026101'), '2026-10-01');
    assert.equal(M.date('2024.2.29'), '2024-02-29');
    assert.equal(M.date(''), '');
    assert.throws(() => M.date('2026-02-30'), /올바른 날짜/);
  });
  test('MODEL-02', 'Stage end counts working days and shifts holiday deadlines', () => {
    const M = loadModel(), step = project().stages[0];
    const weekend = d => [0, 6].includes(d.getDay());
    Object.assign(step, { start: '2026-10-23', endType: 'after', afterDays: 1, includeHolidays: false });
    assert.equal(M.stageEnd(step, weekend), '2026-10-26');
    step.includeHolidays = true;
    assert.equal(M.stageEnd(step, weekend), '2026-10-24');
    step.holidayShift = 'next';
    assert.equal(M.stageEnd(step, weekend), '2026-10-26');
    step.holidayShift = 'prev';
    assert.equal(M.stageEnd(step, weekend), '2026-10-23');
  });
  test('MODEL-03', 'Legacy absolute stage dates become stable relative offsets', () => {
    const { M, p } = setup();
    assert.equal(p.stages[1].relativeStartDays, 2);
    assert.equal(p.stages[1].relativeEndDays, 2);
    const draft = M.clone(p); draft.stages[0].start = draft.stages[0].endDate = '2026-01-10';
    const normalized = M.normalizeProject(draft);
    assert.equal(normalized.stages[1].start, '2026-01-12');
    assert.equal(p.stages[1].start, '2026-01-03');
    assert.deepEqual(plain(M.normalizeProject(normalized)), plain(normalized));
  });
  test('MODEL-04', 'Unchanged completed stage retains its dates and completion history', () => {
    const { M, p, state } = setup();
    Object.assign(state.tasks[0], { status: 'done', actualComplete: '2026-01-01' });
    const next = M.reconcile(state, M.normalizeProject(p));
    assert.deepEqual(plain(next.tasks[0]), plain(state.tasks[0]));
    assert.deepEqual(plain(next.deletedTaskIds), []);
  });
  test('MODEL-05', 'Explicit checklist completion and reopen update only the target task', () => {
    const M = loadModel(), task = { status: 'planned', actualComplete: null, checklist: [{ id: 'c', done: false }] };
    assert.equal(M.setCheck(task, 'missing', true, '2026-10-23'), false);
    M.setCheck(task, 'c', true, '2026-10-23');
    assert.equal(task.status, 'done'); assert.equal(task.actualComplete, '2026-10-23');
    M.setCheck(task, 'c', false, '2026-10-23');
    assert.equal(task.status, 'progress'); assert.equal(task.actualComplete, null);
  });
  known('BUG-03', 'Dependent stage dates must use the preserved completed stage anchor', () => {
    const { M, p, state } = setup();
    Object.assign(state.tasks[0], { status: 'done', actualComplete: '2026-01-01' });
    const draft = M.clone(p); draft.stages[0].start = draft.stages[0].endDate = '2026-01-10';
    const next = M.reconcile(state, M.normalizeProject(draft));
    return next.tasks.map(t => t.start);
  }, ['2026-01-01', '2026-01-03'], ['2026-01-01', '2026-01-12'], source);
  known('BUG-04', 'Adding a new checklist item must not silently reopen completed history', () => {
    const { M, p } = setup();
    p.stages[0].checklist = [{ id: 'c1', text: 'Old', done: true }];
    const old = M.buildStageTask(p, p.stages[0], 0);
    p.stages[0].checklist.push({ id: 'c2', text: 'New', done: false });
    const next = M.buildStageTask(p, p.stages[0], 0, old);
    return [next.status, next.actualComplete];
  }, ['done', '2026-10-23'], ['progress', null], source);
  known('BUG-05', 'Deleting a stage must retain its completed task history', () => {
    const { M, p, state } = setup();
    Object.assign(state.tasks[1], { status: 'done', actualComplete: '2026-01-03' });
    const draft = M.clone(p); M.removeStep(draft, 1);
    const next = M.reconcile(state, M.normalizeProject(draft));
    return { retained: next.tasks.some(t => t.id === 'task-b' && t.status === 'done'), deleted: plain(next.deletedTaskIds) };
  }, { retained: true, deleted: [] }, { retained: false, deleted: ['task-b'] }, source);
  known('BUG-06', 'Negative stage offsets must be timezone independent (UTC+14)', () => {
    const script = `const {loadModel}=require('./tests/helpers.cjs');const {project}=require('./tests/fixtures.cjs');
      const M=loadModel(),p=project();p.stages[0].start=p.stages[0].endDate='2026-01-10';
      p.stages[1].relativeStartDays=p.stages[1].relativeEndDays=-1;
      process.stdout.write(M.applyRelativeDates(p).stages[1].start);`;
    return execFileSync(process.execPath, ['-e', script], { cwd: require('./helpers.cjs').root,
      env: { ...process.env, TZ: 'Pacific/Kiritimati' }, timeout: 5000, encoding: 'utf8' });
  }, '2026-01-09', '2026-01-08', 'js/project-model.js / phase1 evidence/timezone-result.json');
};
