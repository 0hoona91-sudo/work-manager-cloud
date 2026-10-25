const assert = require('node:assert/strict');
const C = require('../js/save-command.js');
const { plain } = require('./helpers.cjs');
const { schema11, project } = require('./fixtures.cjs');
const { harness } = require('./recurrence-cloud-harness.cjs');
const { withEmulator } = require('./recurrence-emulator.cjs');
const Backup = require('../js/backup-safety.js');
const Files = require('../js/backup-files.js');
const Model = require('../js/project-model.js');
const { loadCloud } = require('./helpers.cjs');
const { withPage } = require('./browser.test.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { root } = require('./helpers.cjs');
const { execFileSync } = require('node:child_process');

module.exports = ({ test, EnvironmentUnavailable }) => {
  test('INTEG-ARTIFACT-01', 'Tracked production files contain no private-key, OAuth-token or debug artifact pattern', () => {
    const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root }).toString().split('\0').filter(Boolean);
    assert.deepEqual(tracked.filter(name => /(?:^|\/)(?:\.env(?:\.|$)|.*\.(?:pem|p12|map)$|.*debug\.log$|service[-_]?account.*\.json$)/i.test(name)), []);
    const production = tracked.filter(name => name === 'index.html' || name === 'privacy.html' || /^(?:js|css|assets)\//.test(name));
    for (const name of production) {
      const bytes = fs.readFileSync(path.join(root, name));
      assert.doesNotMatch(bytes.toString('latin1'), /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|ya29\.[A-Za-z0-9_-]{20,}/);
    }
  });
  test('INTEG-UI-01', 'Chromium viewport, keyboard quick-task, IME and cancel preserve data', () =>
    withPage({ width: 1440, height: 900 }, EnvironmentUnavailable, async page => {
      const before = await page.evaluate(() => JSON.stringify(state.tasks));
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(() => showPage('homePage'));
        const sizes = await page.evaluate(() => ({ visible: innerWidth, document: document.documentElement.scrollWidth }));
        assert.ok(sizes.document <= sizes.visible + 1, `Page overflows ${width}px: ${JSON.stringify(sizes)}`);
      }
      const button = page.getByRole('button', { name: '＋ 빠른 업무', exact: true });
      await button.focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('#qtNameV119').isVisible(), true);
      await page.locator('#qtNameV119').evaluate(input => {
        input.value = '한';
        input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
        input.value = '한글';
        input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
      });
      assert.equal(await page.locator('#qtNameV119').inputValue(), '한글');
      await page.locator('#modalRoot [data-close]').last().click();
      assert.equal(await page.evaluate(() => JSON.stringify(state.tasks)), before);
    }));
  test('INTEG-ASSET-01', 'Chromium resolves shared theme asset under GitHub Pages subpath at four widths', () =>
    withPage({ width: 1440, height: 900 }, EnvironmentUnavailable, async page => {
      const prefix = '/work-manager-cloud/';
      const origin = new URL(page.url()).origin;
      const asset = [];
      page.on('response', response => {
        if (response.url().includes('shared-hello-kitty-bg')) asset.push({ url: response.url(), status: response.status() });
      });
      await page.route('**/work-manager-cloud/**', async route => {
        const requestUrl = new URL(route.request().url());
        const relative = decodeURIComponent(requestUrl.pathname.slice(prefix.length)) || 'index.html';
        if (relative.split('/').includes('..')) return route.fulfill({ status: 403 });
        const file = path.join(root, relative);
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({ status: 404 });
        const type = path.extname(file) === '.webp' ? 'image/webp'
          : path.extname(file) === '.js' ? 'text/javascript'
            : path.extname(file) === '.css' ? 'text/css' : 'text/html';
        return route.fulfill({ status: 200, contentType: type, body: fs.readFileSync(file) });
      });
      await page.goto(origin + prefix, { waitUntil: 'networkidle' });
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(() => { showPage('homePage'); state.settings.uiTheme = 'hellokitty'; applyThemeV7(); });
        await page.waitForLoadState('networkidle');
      }
      assert.ok(asset.length >= 1);
      assert.ok(asset.every(item => item.status === 200 && item.url.includes(prefix + 'assets/')));
    }));
  test('INTEG-GANTT-02', 'Chromium keeps the existing full 1k Gantt view without pagination or save', () =>
    withPage({ width: 1440, height: 900 }, EnvironmentUnavailable, async page => {
      page.setDefaultTimeout(120000);
      const result = await page.evaluate(() => {
        const originalTasks = state.tasks, originalSave = saveState;
        let writes = 0;
        try {
          state.tasks = Array.from({ length: 1000 }, (_, i) => ({
            id: `SMALL-${i}`, name: `Synthetic task ${i}`, category: 'fixture-category',
            status: 'planned', start: '2026-10-23', end: '2026-10-24', checklist: []
          }));
          saveState = () => { writes++; return Promise.resolve(); };
          showPage('homePage'); renderHome();
          return { rows: document.querySelectorAll('#ganttView .gantt-v2-row').length,
            pager: document.querySelectorAll('#ganttPageV10').length, writes };
        } finally { state.tasks = originalTasks; saveState = originalSave; }
      });
      assert.deepEqual(result, { rows: 1000, pager: 0, writes: 0 });
    }));
  test('INTEG-GANTT-01', 'Chromium shows all 10k synthetic Gantt tasks through explicit pages without saving', () =>
    withPage({ width: 1440, height: 900 }, EnvironmentUnavailable, async page => {
      page.setDefaultTimeout(120000);
      const result = await page.evaluate(() => {
        const originalTasks = state.tasks, originalSave = saveState;
        let writes = 0;
        try {
          state.tasks = Array.from({ length: 10000 }, (_, i) => ({
            id: `INTEG-${String(i).padStart(5, '0')}`, name: `Synthetic task ${i}`,
            category: 'fixture-category', status: 'planned',
            start: `2026-10-${String(i % 28 + 1).padStart(2, '0')}`,
            end: `2026-11-${String(i % 28 + 1).padStart(2, '0')}`, checklist: []
          }));
          saveState = () => { writes++; return Promise.resolve(); };
          showPage('homePage');
          renderHome();
          const first = [...document.querySelectorAll('#ganttView .gantt-v2-row [data-task]')].map(el => el.dataset.task);
          const pages = document.querySelectorAll('#ganttPageV10 option').length;
          const picker = document.querySelector('#ganttPageV10');
          if (picker) { picker.value = String(pages - 1); picker.dispatchEvent(new Event('change', { bubbles: true })); }
          const last = [...document.querySelectorAll('#ganttView .gantt-v2-row [data-task]')].map(el => el.dataset.task);
          return { total: state.tasks.length, first, last, pages,
            notice: document.querySelector('#ganttPageNoticeV10')?.textContent || '', writes };
        } finally { saveState = originalSave; state.tasks = originalTasks; }
      });
      assert.equal(result.total, 10000);
      assert.equal(result.pages, 20);
      assert.equal(result.first.length, 500);
      assert.equal(result.last.length, 500);
      assert.equal(new Set([...result.first, ...result.last]).size, 1000);
      assert.match(result.notice, /10000/);
      assert.equal(result.writes, 0);
    }));
  test('INTEG-LEGACY-01', 'Older schema11 IDs, Tasks metadata and recurring locks survive codec and JSON review', () => {
    const old = schema11();
    old.projects = [];
    old.settings.googleTasksV15 = { enabled: true, listId: 'retired-list' };
    old.tasks[0].googleTaskId = 'retired-task';
    old.tasks[0].checklist[0].googleTaskId = 'retired-check';
    old.tasks[0].attachments = [{ id: 'old-attachment', driveFileId: 'old-drive-file', name: 'old.pdf' }];
    old.tasks[0].completionHistory = [{ id: 'old-history', reopenedAt: '2026-10-23T00:00:00Z',
      snapshot: { ...plain(old.tasks[0]), completionHistory: undefined } }];
    delete old.tasks[0].completionHistory[0].snapshot.completionHistory;
    const original = plain(old);
    const Cloud = loadCloud();
    const decoded = plain(Cloud.deserializeState(Cloud.serializeState(old)));
    assert.deepEqual(decoded, original);
    const json = Files.jsonSnapshot(decoded);
    const review = Backup.prepare(decoded, json);
    assert.deepEqual(review.errors, []);
    assert.equal(review.counts.tasks.identical, 1);
    const oldFormat = Backup.prepare(decoded, plain(decoded));
    assert.deepEqual(oldFormat.errors, []);
    assert.ok(oldFormat.warnings.some(warning => /스키마 표기/.test(warning)));
    assert.deepEqual(review.next.tasks[0].completionHistory, original.tasks[0].completionHistory);
    assert.equal(review.next.tasks[0].generatedKey, original.tasks[0].generatedKey);
    assert.equal(review.next.tasks[0].attachments[0].driveFileId, 'old-drive-file');
    assert.equal(review.next.settings.googleTasksV15.enabled, true);
    assert.deepEqual(old, original, 'Inspection and backup must not migrate old data');
  });
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
