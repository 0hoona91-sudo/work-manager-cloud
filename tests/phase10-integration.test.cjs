const assert = require('node:assert/strict');
const C = require('../js/save-command.js');
const { plain } = require('./helpers.cjs');
const { schema11, project } = require('./fixtures.cjs');
const { harness } = require('./recurrence-cloud-harness.cjs');
const { withEmulator } = require('./recurrence-emulator.cjs');
const Backup = require('../js/backup-safety.js');
const Files = require('../js/backup-files.js');
const Model = require('../js/project-model.js');

module.exports = ({ test, EnvironmentUnavailable }) => {
  test('INTEG-BACKUP-01', 'JSON backup, completed edits, reviewed restore and partial ZIP preserve IDs and originals status', async () => {
    const initial = schema11();
    const linked = project();
    Model.initializeRelativeDates(linked);
    initial.projects = [linked];
    initial.tasks.push(...linked.stages.map((stage, i) => Model.buildStageTask(linked, stage, i)));
    initial.tasks[0].status = 'planned';
    initial.tasks[0].actualComplete = null;
    initial.tasks[0].attachments = [{ id: 'fixture-attachment', driveFileId: 'drive-synthetic', name: '한글.pdf', mimeType: 'application/pdf' }];
    const backup = Files.jsonSnapshot(initial);
    assert.equal(backup.backupMeta.externalOriginalsIncluded, false);
    assert.ok(backup.backupMeta.attachments.some(ref => ref.driveFileId === 'drive-synthetic'));
    const current = plain(initial);
    current.tasks[0].status = 'done';
    current.tasks[0].actualComplete = '2026-10-03';
    Model.reopenTask(current.tasks[0]);
    current.tasks[0].status = 'done';
    current.tasks[0].actualComplete = '2026-10-04';
    const history = plain(current.tasks[0].completionHistory);
    const original = plain(current);
    const review = Backup.prepare(current, backup, { mode: 'replace' });
    assert.deepEqual(review.errors, []);
    assert.ok(review.protectedConflicts.length > 0);
    assert.deepEqual(current, original, 'Preview must not mutate current data');
    let snapshots = 0, writes = 0, published = 0;
    const ports = { getCurrent: () => current, getVersion: () => '',
      persistRecovery: async recovery => { snapshots++; assert.deepEqual(recovery.before, original); },
      write: async next => { writes++; assert.deepEqual(next, review.next); },
      publish: next => { published++; Object.assign(current, next); } };
    await assert.rejects(Backup.execute(review, ports, { confirmed: false, replaceConfirmed: false }));
    assert.deepEqual([snapshots, writes, published], [0, 0, 0]);
    await Backup.execute(review, ports, { confirmed: true, replaceConfirmed: true });
    assert.deepEqual([snapshots, writes, published], [1, 1, 1]);
    assert.deepEqual(current.tasks[0].completionHistory, history);
    assert.equal(current.tasks[0].actualComplete, '2026-10-04');
    assert.equal(current.tasks[0].id, 'fixture-task');
    assert.equal(current.tasks[0].generatedKey, initial.tasks[0].generatedKey);
    assert.equal(current.tasks[0].attachments[0].driveFileId, 'drive-synthetic');
    assert.deepEqual(current.projects, initial.projects);
    const items = [{ sourceDriveFileId: 'drive-synthetic', name: '한글.pdf' }, { sourceDriveFileId: 'missing', name: '한글.pdf' }];
    const packed = await Files.prepare(items, async item => item.sourceDriveFileId === 'missing'
      ? Promise.reject(Error('synthetic original unavailable'))
      : { blob: new Blob(['synthetic-original'], { type: 'application/pdf' }), name: item.name },
    { nameFor: (name, _mime, index) => `${index}_${name}` });
    assert.equal(packed.entries.length, 1);
    assert.equal(packed.manifest.complete, false);
    assert.equal(packed.manifest.files[0].sha256, await Files.hash(packed.entries[0].blob));
    assert.match(packed.manifest.files[1].reason, /unavailable/);
    assert.equal(items[1].originalMissing, true);
  });
  test('INTEG-EMU-01', 'REAL SDK two clients changing one checklist cannot silently overwrite each other', () =>
    withEmulator(EnvironmentUnavailable, async t => {
      const state = schema11();
      state.projects = [];
      state.templates = [];
      state.tasks = [{ id: 'integration-task', name: 'Synthetic integration task', status: 'planned',
        start: '2026-10-23', end: '2026-10-23', actualComplete: null,
        checklist: [{ id: 'check-1', text: 'Original', done: false }],
        completionHistory: [{ id: 'history-protected', actualComplete: '2026-10-22' }] }];
      const a = harness(t, state), b = harness(t, state);
      const seed = t.sdk.writeBatch(t.db);
      for (const [collection, records] of Object.entries(a.codec.serializeState(state))) {
        for (const [id, value] of records) seed.set(t.sdk.doc(t.db, collection, id), { ...plain(value), revision: 1 });
      }
      await seed.commit();
      const send = (client, operationId, text) => {
        const original = plain(client.ctx.stateRef);
        const command = { operationId, type: 'task.update', context: 'cloud:demo-work-manager:synthetic-owner',
          changeSet: C.plan(original, { operationId, type: 'task.update', taskId: 'integration-task',
            expected: plain(original.tasks[0]), patch: { checklist: [{ id: 'check-1', text, done: true }] } }) };
        return client.api.save(original, { taskCommand: command });
      };
      const outcomes = await Promise.allSettled([send(a, 'client-a', 'A checked'), send(b, 'client-b', 'B checked')]);
      assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
      assert.equal(outcomes.find(result => result.status === 'rejected')?.reason.code, 'conflict');
      const task = (await t.sdk.getDocFromServer(t.sdk.doc(t.db, 'tasks', 'integration-task'))).data();
      const children = await t.list('checklistItems');
      assert.equal(task.revision, 2);
      assert.deepEqual(task.completionHistory, [{ id: 'history-protected', actualComplete: '2026-10-22' }]);
      assert.equal(children.length, 1);
      assert.ok(['A checked', 'B checked'].includes(children[0].text));
      assert.equal(children[0].done, true);
    }));
};
