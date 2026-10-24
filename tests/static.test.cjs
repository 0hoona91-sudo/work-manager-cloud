const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const postcss = require('postcss');
const { root, read, parse, walk, blocks } = require('./helpers.cjs');

function scripts() {
  return ['index.html', 'privacy.html'].flatMap(file => blocks('script', file).filter(b => !/\bsrc\s*=/.test(b.attrs)))
    .filter(b => !/type\s*=\s*["']application\//.test(b.attrs))
    .map(b => ({ ...b, type: /type\s*=\s*["']module["']/.test(b.attrs) ? 'module' : 'script' }))
    .concat(fs.readdirSync(path.join(root, 'js')).filter(f => f.endsWith('.js')).map(f => ({
      file: `js/${f}`, label: `js/${f}`, source: read(`js/${f}`), type: /^(?:import|export)\s/m.test(read(`js/${f}`)) ? 'module' : 'script'
    })));
}
function localImports() {
  const refs = [];
  for (const script of scripts()) {
    walk(parse(script.source, script.type), n => {
      if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression'].includes(n.type) && n.source?.value) {
        const specifier = n.source.value;
        if (!/^(?:https?:|data:)/.test(specifier)) refs.push({ from: script.file, specifier });
      }
    });
  }
  for (const file of ['index.html', 'privacy.html']) {
    for (const m of read(file).matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
      if (!/^(?:https?:|data:|#)/.test(m[1])) refs.push({ from: file, specifier: m[1] });
    }
  }
  return refs.map(r => ({ ...r, target: path.posix.normalize(path.posix.join(path.posix.dirname(r.from), r.specifier.split(/[?#]/)[0])) }));
}
const brokenStyle = b => /\bid=["']app-v21-navy-dashboard-style["']/.test(b.attrs || '');
module.exports = ({ test, known }) => {
  test('STATIC-01', 'All production classic/module JavaScript parses in its actual mode', () => {
    const items = scripts();
    assert.ok(items.length >= 49);
    for (const item of items) assert.doesNotThrow(() => parse(item.source, item.type), item.label);
  });
  test('STATIC-02', 'Local imports and script/stylesheet references resolve without retired Tasks modules', () => {
    const refs = localImports();
    assert.ok(refs.length > 7);
    assert.deepEqual(refs.filter(r => !fs.existsSync(path.join(root, r.target))), []);
  });
  test('BUG-01', 'Retired Google Tasks has no module, UI, scope or active synchronization entry', () => {
    assert.equal(fs.existsSync(path.join(root,'js/google-tasks-sync.js')),false);
    assert.equal(fs.existsSync(path.join(root,'js/google-tasks-model.js')),false);
    assert.deepEqual(localImports().filter(r=>/google-tasks/.test(r.target)),[]);
    assert.doesNotMatch(read('index.html'),/googleTasksToggle|workManagerTasksBridge|wm:tasks-v15-saved/);
    assert.doesNotMatch(read('js/workspace-profile.js'),/googleapis\.com\/auth\/tasks|authorizeBuildingTasks|getBuildingTasksToken/);
  });
  test('STATIC-03', 'All inline and external CSS parses', () => {
    const items = ['index.html', 'privacy.html'].flatMap(f => blocks('style', f))
      .concat(fs.readdirSync(path.join(root, 'css')).filter(f => f.endsWith('.css')).map(f => ({ source: read(`css/${f}`), label: f })));
    assert.ok(items.length >= 64);
    for (const b of items) assert.doesNotThrow(() => postcss.parse(b.source, { from: b.label }), b.label);
  });
  test('BUG-02', 'Dashboard style block must have valid CSS syntax', () => {
    const items = blocks('style').filter(brokenStyle);
    assert.equal(items.length, 1);
    assert.doesNotThrow(() => postcss.parse(items[0].source));
  });
};
