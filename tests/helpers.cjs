const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const FIXED_NOW = '2026-10-23T03:00:00.000Z';
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [FIXED_NOW])); }
  static now() { return Date.parse(FIXED_NOW); }
}
function context(extra = {}) {
  let seed = 1;
  const math = Object.create(Math);
  math.random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  return vm.createContext({ Date: FixedDate, Math: math, TextEncoder, btoa, ...extra });
}
function parse(source, type = 'script') {
  return acorn.parse(source, { ecmaVersion: 'latest', sourceType: type, locations: true });
}
function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (node.type) visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(child => walk(child, visit));
    else if (value && typeof value === 'object') walk(value, visit);
  }
}
function blocks(tag, file = 'index.html') {
  const html = read(file);
  return [...html.matchAll(new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}\\s*>`, 'gi'))].map((m, i) => ({
    file, attrs: m[1], source: m[2], index: i,
    line: html.slice(0, m.index).split('\n').length,
    label: `${file}:${tag}[${i}]`
  }));
}
function loadModel() {
  const ctx = context({ module: { exports: {} } });
  vm.runInContext(read('js/project-model.js'), ctx, { timeout: 2000 });
  return ctx.module.exports;
}
// Execute an explicit, dependency-closed allowlist from the REAL serializer.
// Imports, auth/bootstrap, event handlers and network functions never execute.
function loadCloud() {
  const source = read('js/cloud-sync.js');
  const names = new Set(['SCHEMA_VERSION', 'DATA_COLLECTIONS', 'LIVE_COLLECTIONS', 'shadowMaps',
    'makeRecordMaps', 'serializeState', 'deserializeState', 'cleanBlock', 'cleanAttachmentMetadata',
    'omit', 'clone', 'plain', 'docId', 'stableKeyId', 'mergeById']);
  const selected = parse(source, 'module').body.filter(node => {
    if (node.type === 'FunctionDeclaration') return names.has(node.id.name);
    if (node.type === 'VariableDeclaration') return node.declarations.every(d => names.has(d.id.name));
    return false;
  });
  const found = selected.flatMap(n => n.type === 'FunctionDeclaration' ? [n.id.name] : n.declarations.map(d => d.id.name));
  assert.deepEqual([...found].sort(), [...names].sort(), 'Serializer extraction contract changed');
  const ctx = context();
  vm.runInContext(selected.map(n => source.slice(n.start, n.end)).join('\n'), ctx, { timeout: 2000 });
  return vm.runInContext('({serializeState, deserializeState, mergeById, setShadow: maps => { shadowMaps = maps; }})', ctx);
}
function loadRecurrence(state) {
  const source = read('js/project-ui.js');
  const matches = [];
  walk(parse(source), n => { if (n.type === 'FunctionDeclaration' && n.id?.name === 'installRollingRecurrencesV181') matches.push(n); });
  assert.equal(matches.length, 1, 'Recurrence extraction contract changed');
  let id = 0;
  const ctx = context({ state, M: loadModel(), window: {}, document: { addEventListener() {} },
    projectUid: prefix => `${prefix}-fixture-${++id}`, saveState: async () => {}, renderTaskTable() {} });
  const node = matches[0];
  vm.runInContext(`(${source.slice(node.start, node.end)})();`, ctx, { timeout: 2000 });
  return ctx.window.WMTaskRecurrenceV181;
}
module.exports = { root, read, plain, FIXED_NOW, parse, walk, blocks, loadModel, loadCloud, loadRecurrence };
