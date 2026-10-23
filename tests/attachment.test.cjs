const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { chromium } = require('playwright-core');
const { parse, read } = require('./helpers.cjs');

// Synthetic storage only. The payload deliberately tests same-origin access even
// after openDriveFile nulls window.opener. No credential or external destination.
const payload = "localStorage.setItem('fixture-read',localStorage.getItem('fixture-secret'))";
const html = `<html><script>${payload}</script></html>`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg"><script>${payload}</script></svg>`;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8ZcAAAAASUVORK5CYII=', 'base64');
function pdf() {
  let value = '%PDF-1.4\n';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>'];
  const offsets = [0];
  objects.forEach((body, i) => { offsets.push(value.length); value += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = value.length;
  value += 'xref\n0 4\n0000000000 65535 f \n' + offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('');
  return Buffer.from(value + `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}
function attachmentCode() {
  const source = read('js/cloud-sync.js');
  const required = ['readDriveFileBlob', 'getDriveObjectUrl', 'downloadDriveFile', 'openDriveFile', 'createDriveBlock'];
  const policy = ['drivePreviewType', 'drivePreviewExtension', 'drivePreviewMime', 'safeDriveDisplayBlob'];
  const nodes = parse(source, 'module').body.filter(n => n.type === 'FunctionDeclaration' && [...required, ...policy].includes(n.id.name));
  for (const name of required) assert.equal(nodes.filter(n => n.id.name === name).length, 1, name);
  return nodes.map(n => source.slice(n.start, n.end)).join('\n');
}
async function exercise(fixture, EnvironmentUnavailable) {
  const executablePath = process.env.CHROMIUM_PATH || ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find(fs.existsSync);
  if (!executablePath || !fs.existsSync(executablePath)) throw new EnvironmentUnavailable('Chromium required for attachment security tests');
  const server = http.createServer((req, res) => res.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>Synthetic attachment test</title>'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  const data = Buffer.isBuffer(fixture.body) ? fixture.body : Buffer.from(fixture.body);
  try {
    browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-background-networking'] });
    const ctx = await browser.newContext({ acceptDownloads: true, serviceWorkers: 'block' });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const external = [];
    await ctx.route('**/*', route => {
      if (route.request().url().startsWith(origin + '/') && route.request().method() === 'GET') return route.continue();
      if (route.request().url().startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/')) return route.continue(); // built-in PDF viewer
      external.push(route.request().url()); return route.abort();
    });
    const page = await ctx.newPage(), downloads = [], popups = [];
    let activityReady, downloadReady;
    const activity = new Promise(resolve => { activityReady = resolve; });
    const downloaded = new Promise(resolve => { downloadReady = resolve; });
    const onDownload = d => { downloads.push(d); downloadReady(); activityReady(); };
    page.on('download', onDownload);
    page.on('popup', p => { popups.push(p); p.on('download', onDownload); activityReady(); });
    await page.goto(origin);
    await page.evaluate(({ bytes, type, blockPopup, code }) => {
      localStorage.setItem('fixture-secret', 'SYNTHETIC_STORAGE_MARKER');
      window.__reads = [];
      window.__created = [];
      window.__blob = new Blob([new Uint8Array(bytes)], { type });
      const original = URL.createObjectURL.bind(URL);
      URL.createObjectURL = blob => { const url = original(blob); __created.push({ url, type: blob.type }); return url; };
      if (blockPopup) window.open = () => null;
      // Stub the transport/auth boundary only; run the real read and open functions.
      window.ensureDriveAccess = async () => 'SYNTHETIC_PLACEHOLDER';
      window.driveFileResponse = async id => { __reads.push(id); return new Response(__blob, { headers: { 'Content-Type': type } }); };
      window.currentDriveToken = async (options = {}) => { if (options.forceRefresh) throw Error('Unexpected auth retry'); return 'SYNTHETIC_PLACEHOLDER'; };
      window.legacyWorkspaceEligible = () => false;
      window.ensureDriveFolder = async () => 'synthetic-folder';
      window.appConfig = {};
      window.driveFetch = async () => ({ json: async () => ({ id: 'synthetic-file' }) });
      window.uploadDriveMediaWithRetry = async () => {};
      window.verifyDriveUpload = async () => ({ size: __blob.size, mimeType: type });
      window.cleanupFailedDriveFile = async () => { throw Error('Unexpected cleanup'); };
      window.isNetworkFetchError = () => false;
      (0, eval)('const driveObjectUrls = new Map(); const MAX_DRIVE_FILE_BYTES = 50*1024*1024;\n' + code);
    }, { bytes: [...data], type: fixture.type, blockPopup: fixture.blockPopup || false, code: attachmentCode() });
    if (fixture.action === 'cache' || fixture.action === 'upload-cache') {
      const observation = await page.evaluate(async ({ action, name }) => {
        if (action === 'upload-cache') {
          const result = await createDriveBlock(new File([__blob], name, { type: __blob.type }), { id: 'fixture-block', type: 'image', kind: 'manual-photo' });
          if (result.driveFileId !== 'synthetic-file') throw Error('Attachment ID changed');
        }
        const url = await getDriveObjectUrl('synthetic-file');
        const blob = await (await fetch(url)).blob();
        return { type: blob.type, bytes: [...new Uint8Array(await blob.arrayBuffer())] };
      }, { action: fixture.action, name: fixture.name });
      assert.deepEqual(Buffer.from(observation.bytes), data, 'Cached bytes must remain unchanged');
      assert.equal(observation.type, 'application/octet-stream', 'Active cached Blob must not be navigable as HTML/SVG');
      return;
    }
    await page.evaluate(async ({ name, declared, action }) => {
      if (action === 'download') await downloadDriveFile('synthetic-file', name);
      else await openDriveFile('synthetic-file', name, declared);
    }, { name: fixture.name, declared: fixture.declared ?? fixture.type, action: fixture.action });
    // Wait for actual navigation or download completion, not a synthetic mocked window.
    const wait = async promise => {
      let timer;
      try { await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('No attachment action completed')), 8000); })]); }
      finally { clearTimeout(timer); }
    };
    await wait(activity);
    for (const popup of popups) {
      if (!popup.isClosed()) {
        try { await popup.waitForURL('blob:**', { timeout: 8000 }); await popup.waitForLoadState('load'); }
        catch (error) { if (!popup.isClosed()) throw error; }
      }
    }
    if (!popups.some(p => !p.isClosed())) await wait(downloaded);
    assert.equal(await page.evaluate(() => localStorage.getItem('fixture-read')), null, 'Attachment executed and read same-origin localStorage');
    if (fixture.preview) {
      assert.equal(downloads.length, 0);
      assert.equal(popups.filter(p => !p.isClosed()).length, 1);
      const popup = popups.find(p => !p.isClosed());
      await popup.waitForURL('blob:**');
      assert.equal(await page.evaluate(() => __created.at(-1).type), fixture.type);
      if (fixture.type === 'image/png') {
        await popup.waitForFunction(() => document.querySelector('img')?.naturalWidth === 1);
      }
    } else {
      assert.equal(downloads.length, 1, 'Unsafe or ordinary attachment must download');
      assert.equal(downloads[0].suggestedFilename(), fixture.name);
      const stream = await downloads[0].createReadStream(), chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      assert.deepEqual(Buffer.concat(chunks), data, 'Download must preserve exact original bytes');
      assert.equal(popups.filter(p => !p.isClosed()).length, 0);
    }
    assert.deepEqual(external, [], 'No external network request allowed');
    assert.deepEqual(await page.evaluate(() => __reads), ['synthetic-file'], 'Read the original ID once; no duplicate fetch');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
module.exports = ({ test, EnvironmentUnavailable }) => {
  const cases = [
    ['HTML cannot read app localStorage', { name: 'fixture.html', type: 'text/html', body: html }],
    ['SVG script cannot read app localStorage', { name: 'fixture.svg', type: 'image/svg+xml', body: svg }],
    ['XHTML downloads', { name: 'fixture.xhtml', type: 'application/xhtml+xml', body: '<html xmlns="http://www.w3.org/1999/xhtml"><body>Fixture</body></html>' }],
    ['XML downloads despite text MIME', { name: 'fixture.xml', type: 'text/xml', body: '<fixture />' }],
    ['PDF extension cannot disguise HTML response', { name: 'fixture.pdf', type: 'text/html', declared: 'application/pdf', body: html }],
    ['Image extension cannot disguise SVG response', { name: 'fixture.png', type: 'image/svg+xml', declared: 'image/png', body: svg }],
    ['Forged image MIME with HTML bytes downloads', { name: 'fixture.png', type: 'image/png', body: html }],
    ['Recognized MIME must match extension', { name: 'fixture.jpg', type: 'image/png', body: png }],
    ['Normal PNG still renders', { name: 'fixture.png', type: 'image/png', body: png, preview: true }],
    ['Normal PDF still opens', { name: 'fixture.pdf', type: 'application/pdf', body: pdf(), preview: true }],
    ['Ordinary binary downloads unchanged', { name: 'fixture.bin', type: 'application/octet-stream', body: Buffer.from([0, 1, 2, 255]) }],
    ['Explicit active-file download preserves bytes', { name: 'fixture.html', type: 'text/html', body: html, action: 'download' }],
    ['Blocked popup falls back to download', { name: 'fixture.png', type: 'image/png', body: png, blockPopup: true }],
    ['Legacy missing declared MIME still previews a verified image', { name: 'fixture.PNG', type: 'image/png', declared: '', body: png, preview: true }],
    ['Hydrated HTML cache cannot supply an active document', { name: 'fixture.html', type: 'text/html', body: html, action: 'cache' }],
    ['Newly uploaded SVG cache cannot supply an active document', { name: 'fixture.svg', type: 'image/svg+xml', body: svg, action: 'upload-cache' }]
  ];
  for (const [i, [title, fixture]] of cases.entries()) {
    test(`SEC-${String(i + 1).padStart(2, '0')}`, title, () => exercise(fixture, EnvironmentUnavailable));
  }
};
