const assert = require('node:assert/strict');
const C = require('../js/save-command.js');
const { plain } = require('./helpers.cjs');
const { schema11 } = require('./fixtures.cjs');
const { harness } = require('./recurrence-cloud-harness.cjs');
const { withEmulator } = require('./recurrence-emulator.cjs');

module.exports = ({ test, EnvironmentUnavailable }) => {
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
