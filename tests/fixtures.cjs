// Synthetic schema11 records only. No account IDs, tokens or production data.
const stage = (id, start, end = start) => ({ id, taskId: `task-${id}`, title: id,
  participants: ['fixture-owner'], start, endType: 'date', endDate: end,
  holidayShift: 'keep', includeHolidays: true, checklist: [], resources: [] });
const project = () => ({ id: 'fixture-project', name: 'Fixture project', category: 'fixture-category',
  manager: 'fixture-owner', start: '2026-01-01', end: '',
  stages: [stage('a', '2026-01-01'), stage('b', '2026-01-03')] });
const schema11 = () => ({
  tasks: [{ id: 'fixture-task', name: 'Synthetic task', category: 'fixture-category', owner: 'fixture-owner',
    start: '2026-10-01', end: '2026-10-02', status: 'done', actualComplete: '2026-10-02',
    generatedKey: 'fixture-template:2026-10-01', extensionFixture: { retained: true },
    checklist: [{ id: 'fixture-check', text: 'Check', owner: '', dueDate: '', done: true }],
    link: { rootId: 'fixture-root', offset: 2 } }],
  projects: [project()],
  templates: [{ id: 'fixture-template', name: 'Synthetic template', cycle: 'monthly', cycleMonths: [1, 4, 7, 10],
    checklist: ['First', 'Second'], attachments: [{ id: 'fixture-file', fileId: 'synthetic-file-id', name: 'fixture.txt' }],
    linkedSteps: [{ name: 'Next', offset: 2, checklist: ['Next check'], methodBlocks: [] }],
    methodBlocks: [{ id: 'fixture-block', type: 'text', text: 'Instructions' }], method: '', photos: [] }],
  categories: ['fixture-category'], owners: ['fixture-owner'], selectedCategories: ['fixture-category'],
  holidays: [{ id: 'fixture-holiday', date: '2026-10-09', name: 'Synthetic holiday' }], changeLogs: [],
  settings: { theme: 'dark', categoryColors: { 'fixture-category': '#123456' },
    ownerProfiles: { 'fixture-owner': { mark: 'F', color: '#654321' } }, holidayApiKey: '' }
});
const recurring = (cycle = 'monthly', start = '2026-10-01', extra = {}) => ({
  templates: [{ id: 'fixture-template', cycle, ...extra }], holidays: [],
  tasks: [{ id: 'fixture-root', name: 'Synthetic recurrence', start, end: start, status: 'planned',
    actualComplete: null, dbManualRootTemplateId: 'fixture-template', checklist: [{ id: 'fixture-check', text: 'Check', done: true }] }]
});
module.exports = { stage, project, schema11, recurring };
