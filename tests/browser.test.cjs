const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright-core');
const { root, FIXED_NOW } = require('./helpers.cjs');

async function withPage(viewport, EnvironmentUnavailable, run) {
  const executablePath = process.env.CHROMIUM_PATH || ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find(p => fs.existsSync(p));
  if (!executablePath || !fs.existsSync(executablePath)) throw new EnvironmentUnavailable('Chromium unavailable; set CHROMIUM_PATH to an installed executable.');
  const server = http.createServer((req, res) => {
    if (req.method !== 'GET') { res.writeHead(405).end(); return; }
    const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\//, '') || 'index.html';
    // Only unchanged production files are served; no tests, Git, credentials or directory traversal.
    if (!/^(?:index\.html|privacy\.html|manifest\.webmanifest|icon[^/]*\.(?:svg|png)|(?:js|css|assets)\/[a-zA-Z0-9_./-]+)$/.test(relative) || relative.split('/').includes('..')) {
      res.writeHead(403).end(); return;
    }
    const file = path.join(root, relative);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    // Launch errors with an installed executable are FAIL, not automatically waived.
    browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-background-networking'] });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const ctx = await browser.newContext({ viewport, timezoneId: 'Asia/Seoul', serviceWorkers: 'block' });
    const blocked = [], pageErrors = [], consoleErrors = [];
    await ctx.route('**/*', route => {
      const req = route.request();
      if (new URL(req.url()).origin === origin && req.method() === 'GET') return route.continue();
      blocked.push(new URL(req.url()).hostname); return route.abort('blockedbyclient');
    });
    await ctx.addInitScript(({ now }) => {
      const NativeDate = Date;
      window.Date = class extends NativeDate {
        constructor(...args) { super(...(args.length ? args : [now])); }
        static now() { return NativeDate.parse(now); }
      };
      let seed = 1; Math.random = () => ((seed = seed * 16807 % 2147483647) / 2147483647);
    }, { now: FIXED_NOW });
    const page = await ctx.newPage();
    page.setDefaultTimeout(8000);
    page.on('pageerror', e => pageErrors.push(e.message));
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    await page.goto(origin, { waitUntil: 'networkidle' });
    assert.match(await page.title(), /업무관리시스템/);
    await run(page);
    assert.deepEqual(pageErrors, []);
    // SDK/module network failures are expected in this deliberately offline shell test.
    assert.deepEqual(consoleErrors.filter(s => !/Failed to load resource:|앱 시작 실패.*Failed to fetch dynamically imported module/.test(s)), []);
    assert.ok(blocked.includes('www.gstatic.com'), 'Firebase SDK must be blocked');
    await ctx.close();
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
module.exports = ({ test, EnvironmentUnavailable }) => {
  test('UI-01', 'Desktop quick-task validates blank name and registers one synthetic task', () =>
    withPage({ width: 1440, height: 1000 }, EnvironmentUnavailable, async page => {
      await page.getByRole('button', { name: '＋ 빠른 업무', exact: true }).click();
      assert.equal(await page.locator('#qtNameV119').isVisible(), true);
      const before = await page.evaluate(() => state.tasks.length);
      await page.locator('#qtSaveV119').click();
      assert.equal(await page.locator('#qtNameV119').isVisible(), true);
      assert.equal(await page.evaluate(() => state.tasks.length), before);
      await page.locator('#qtNameV119').fill('PHASE2_SYNTHETIC_TASK');
      await page.locator('#qtStartV119').fill('2026-10-23');
      await page.locator('#qtDeadlineV119').fill('2026-10-24');
      await page.locator('#qtSaveV119').click();
      await page.waitForFunction(() => !document.querySelector('#qtNameV119'));
      const created = await page.evaluate(() => state.tasks.filter(t => t.name === 'PHASE2_SYNTHETIC_TASK').map(t => ({
        start: t.start, end: t.end, status: t.status, actualComplete: t.actualComplete
      })));
      assert.deepEqual(created, [{ start: '2026-10-23', end: '2026-10-24', status: 'planned', actualComplete: null }]);
      assert.equal(await page.evaluate(() => state.tasks.length), before + 1);
    }));
  test('UI-02', 'Mobile quick-task opens, accepts input and cancels without mutation', () =>
    withPage({ width: 390, height: 844 }, EnvironmentUnavailable, async page => {
      const before = await page.evaluate(() => JSON.stringify(state.tasks));
      await page.getByRole('button', { name: '＋ 빠른 업무', exact: true }).click();
      await page.locator('#qtNameV119').fill('PHASE2_CANCELLED_TASK');
      const box = await page.locator('#qtNameV119').boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= 390, 'Input must fit the mobile viewport');
      await page.locator('#modalRoot [data-close]').last().click();
      assert.equal(await page.locator('#qtNameV119').count(), 0);
      assert.equal(await page.evaluate(() => JSON.stringify(state.tasks)), before);
    }));
};
