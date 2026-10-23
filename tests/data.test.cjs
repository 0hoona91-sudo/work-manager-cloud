const assert = require('node:assert/strict');
const { loadCloud, plain } = require('./helpers.cjs');
const { schema11 } = require('./fixtures.cjs');
const source = 'js/cloud-sync.js / phase1 evidence/model-results.json, blob-result.json';
module.exports = ({ test, known }) => {
  test('DATA-01', 'Schema11 roundtrip preserves tasks, history, templates, rules, projects and settings', () => {
    const C = loadCloud(), input = schema11(), before = plain(input), maps = C.serializeState(input);
    assert.equal(maps.meta.get('schema').schemaVersion, 11);
    assert.equal(maps.tasks.size, 1); assert.equal(maps.checklistItems.size, 4);
    assert.equal(maps.linkedRules.size, 1); assert.equal(maps.manualBlocks.size, 1);
    assert.deepEqual(plain(C.deserializeState(maps)), input);
    assert.deepEqual(input, before, 'Serialization must not mutate input');
  });
  test('DATA-02', 'Removed recurrence retains its stored generation lock', () => {
    const C = loadCloud(), input = schema11();
    const saved = C.serializeState(input);
    C.setShadow(saved); input.tasks = [];
    const next = C.serializeState(input);
    assert.equal(next.tasks.size, 0);
    assert.deepEqual(plain([...next.generatedKeys]), plain([...saved.generatedKeys]));
    assert.equal(next.generatedKeys.size, 1);
  });
  test('DATA-03', 'Project and template attachments exclude inline data and transient URLs', () => {
    const C = loadCloud(), input = schema11();
    const file = { id: 'fixture-file', fileId: 'synthetic-file-id', data: 'SYNTHETIC_INLINE_DATA',
      objectUrl: 'blob:fixture', blobUrl: 'blob:fixture', previewUrl: 'blob:fixture' };
    input.projects[0].stages[0].resources = [file]; input.templates[0].attachments = [file];
    const next = C.deserializeState(C.serializeState(input));
    assert.deepEqual(plain(next.projects[0].stages[0].resources), [{ id: 'fixture-file', fileId: 'synthetic-file-id' }]);
    assert.deepEqual(plain(next.templates[0].attachments), [{ id: 'fixture-file', fileId: 'synthetic-file-id' }]);
  });
  test('DATA-04', 'Local-only holiday setting is excluded from cloud records', () => {
    const C = loadCloud(), input = schema11();
    input.settings.holidayApiKey = 'SYNTHETIC_NOT_A_CREDENTIAL';
    const maps = C.serializeState(input);
    assert.equal('holidayApiKey' in maps.settings.get('main'), false);
    assert.equal(C.deserializeState(maps, input.settings).settings.holidayApiKey, input.settings.holidayApiKey);
    assert.equal(C.deserializeState(maps).settings.holidayApiKey, '');
  });
  test('DATA-05', 'Backup merges disjoint IDs and identical records without duplication or mutation', () => {
    const C = loadCloud(), a = { id: 'a', status: 'done', actualComplete: '2026-10-01' }, b = { id: 'b', status: 'planned' };
    const current = [a], incoming = [plain(a), b];
    const before = plain([current, incoming]);
    assert.deepEqual(plain(C.mergeById(current, incoming)), [a, b]);
    assert.deepEqual(plain([current, incoming]), before);
  });
  known('BUG-07', 'Backup conflict must not silently overwrite completed history', () => {
    const C = loadCloud();
    const next = C.mergeById([{ id: 'fixture-task', status: 'done', actualComplete: '2026-10-01' }],
      [{ id: 'fixture-task', status: 'planned', actualComplete: null }]);
    return [next[0].status, next[0].actualComplete];
  }, ['done', '2026-10-01'], ['planned', null], source);
  known('BUG-08', 'Object-form template checklist must retain text instead of string coercion', () => {
    const C = loadCloud(), input = schema11();
    input.templates[0].checklist = [{ id: 'fixture-check', text: 'First', done: false }];
    return plain(C.deserializeState(C.serializeState(input)).templates[0].checklist);
  }, ['First'], ['[object Object]'], source);
  known('BUG-09', 'Task projectResources must exclude inline bytes and transient URLs too', () => {
    const C = loadCloud(), input = schema11();
    input.tasks[0].projectResources = [{ id: 'fixture-file', data: 'SYNTHETIC_INLINE_DATA', previewUrl: 'blob:fixture' }];
    return plain(C.serializeState(input).tasks.get('fixture-task').projectResources);
  }, [{ id: 'fixture-file' }], [{ id: 'fixture-file', data: 'SYNTHETIC_INLINE_DATA', previewUrl: 'blob:fixture' }], source);
};
