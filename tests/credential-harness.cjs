const vm = require('node:vm');
const { parse, read, plain } = require('./helpers.cjs');
const user = id => ({ uid: id, email: `${id}@example.invalid`, emailVerified: true, providerData: [{ providerId: 'google.com' }] });
const profile = (id = 'google-a') => ({ app: 'work-manager-cloud', schemaVersion: 1,
  google: { uid: id, email: `${id}@example.invalid`, displayName: 'Synthetic' },
  workspace: { firebaseConfig: { apiKey: 'SYNTHETIC_CONFIG', projectId: 'fixture-project', authDomain: 'fixture.invalid', appId: 'fixture-app' },
    auth: { uid: `private-${id}`, email: `private-${id}@example.invalid`, password: 'SYNTHETIC_PASSWORD' } } });
const keys = { profile: 'workManagerWorkspaceProfileCacheV2', drive: 'workManagerBuildingDriveTokenV1',
  tasks: 'workManagerTasksTokenV15', duplicate: 'workManagerDriveSessionV23', legacy: 'workManagerLegacyDriveSessionV122' };
function storage() {
  const data = new Map();
  return { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: k => data.delete(k),
    dump: () => Object.fromEntries(data) };
}
function state() { return { local: storage(), session: storage(), apps: [], next: user('google-a'),
  now: Date.parse('2026-10-23T03:00:00Z'), profile: profile(), emailLogins: [], signouts: [], fetches: [], logs: [],
  failSignout: '', responseError: false, reauthUser: null, allowed: true }; }
function moduleSource(file) {
  const source = read(file);
  return parse(source, 'module').body.filter(n => n.type !== 'ImportDeclaration').map(n => {
    if (n.type === 'ExportNamedDeclaration') return source.slice(n.declaration.start, n.declaration.end);
    // Avoid even loading the repository's public lobby config into the mock SDK.
    if (n.type === 'VariableDeclaration' && n.declarations[0].id.name === 'buildingFirebaseConfig') return 'const buildingFirebaseConfig = {projectId:"synthetic-lobby"};';
    return source.slice(n.start, n.end);
  }).join('\n');
}
function workspace(shared = state()) {
  const listeners = new Map(), events = [];
  const authFor = app => app.auth ||= { currentUser: null, app };
  const notify = auth => { for (const cb of listeners.get(auth) || []) queueMicrotask(() => cb(auth.currentUser)); };
  const sdk = {
    initializeApp(config, name) { const app = { options: config, name }; shared.apps.push(app); return app; },
    getApps: () => shared.apps, getAuth: authFor, deleteApp: async () => {},
    browserLocalPersistence: 'sdk-local', setPersistence: async () => {},
    onAuthStateChanged(auth, cb) { const list = listeners.get(auth) || new Set(); list.add(cb); listeners.set(auth, list);
      queueMicrotask(() => {
        if (shared.delayedPrivate && auth.app.name === 'wm-private-fixture-project') { auth.currentUser = shared.delayedPrivate; shared.delayedPrivate = null; }
        if (list.has(cb)) cb(auth.currentUser);
      }); return () => list.delete(cb); },
    async signInWithPopup(auth) { auth.currentUser = shared.next; notify(auth); return { user: shared.next }; },
    async reauthenticateWithPopup(u) { return { user: shared.reauthUser || u, credential: { accessToken: 'SYNTHETIC_DRIVE_TOKEN' } }; },
    async signInWithEmailAndPassword(auth, email, password) {
      shared.emailLogins.push({ email, password });
      if (password !== shared.profile.workspace.auth.password) throw Error('Bad synthetic password');
      auth.currentUser = { uid: shared.profile.workspace.auth.uid, email }; return { user: auth.currentUser };
    },
    async signOut(auth) { shared.signouts.push(auth.app.name); if (shared.failSignout === auth.app.name) throw Error('Synthetic signout failure'); auth.currentUser = null; notify(auth); },
    getFirestore: app => ({ app }), initializeFirestore: app => ({ app }),
    persistentLocalCache: x => x, persistentMultipleTabManager: () => ({}),
    doc: (db, ...path) => ({ db, path }),
    getDocFromServer: async () => ({ exists: () => true, data: () => ({ enabled: shared.allowed }) }),
    getDoc: async ref => ({ exists: () => !!ref.db.fixture, data: () => ref.db.fixture }),
    setDoc: async (ref, data) => { ref.db.fixture = data; }, serverTimestamp: () => 'synthetic-time'
  };
  class Provider { addScope() {} setCustomParameters() {} static credentialFromResult(r) { return r.credential; } }
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [shared.now])); } static now() { return shared.now; } }
  const ctx = vm.createContext({ ...sdk, GoogleAuthProvider: Provider, Date: Clock, URLSearchParams,
    localStorage: shared.local, sessionStorage: shared.session,
    console: { warn: (...v) => shared.logs.push(v.map(String).join(' ')), error: (...v) => shared.logs.push(v.map(String).join(' ')) },
    window: { dispatchEvent: event => events.push(event.type), addEventListener() {} }, Event: class { constructor(type) { this.type = type; } },
    fetch: async url => { shared.fetches.push(String(url)); if (shared.responseError) throw Error('SYNTHETIC_PASSWORD SYNTHETIC_DRIVE_TOKEN');
      return { ok: true, json: async () => String(url).includes('alt=media') ? plain(shared.profile) : { files: [{ id: 'fixture-profile' }] } }; }
  });
  // Reuse SDK auth state across a new JS runtime, like a refreshed browser tab.
  const oldLobby = shared.apps.find(a => a.name === 'work-manager-building-v1');
  if (oldLobby) ctx.initializeApp = (config, name) => shared.apps.find(a => a.name === name) || sdk.initializeApp(config, name);
  vm.runInContext(moduleSource('js/workspace-profile.js'), ctx);
  const get = expression => vm.runInContext(expression, ctx);
  return { shared, get, events, sdk, async login() { await get('signInBuildingGoogle')(); },
    async loadConnect() { const loaded = await get('loadWorkspaceProfile')(); return get('connectPrivateWorkspace')(loaded.profile); },
    async tick() { await new Promise(resolve => setImmediate(resolve)); } };
}
function cloud(shared = state()) {
  const source = read('js/cloud-sync.js');
  const names = new Set(['rememberDriveAccessToken','restoreDriveAccessToken','clearDriveAccessToken',
    'rememberLegacyDriveToken','restoreLegacyDriveToken','clearLegacyDriveToken','ensureLegacyDriveAccess','legacyWorkspaceEligible']);
  const defs = parse(source,'module').body.filter(n => n.type === 'FunctionDeclaration' && names.has(n.id.name)).map(n => source.slice(n.start,n.end)).join('\n');
  const ctx = vm.createContext({ Date: { now: () => shared.now }, sessionStorage: shared.session,
    getBuildingUser: () => shared.next, getBuildingDriveAccessToken: () => shared.canonicalToken || '',
    signOut: async () => {}, });
  vm.runInContext(`let currentUser=null,buildingUser=${JSON.stringify(shared.next)},workspaceProfile=null;
    let driveAccessToken='',driveAccessTokenExpiresAt=0,driveAccessTokenUid='',driveFolderId='';
    let legacyDriveAccessToken='',legacyDriveAccessTokenExpiresAt=0,legacyDriveAccessTokenUid='',legacyDriveAccessTokenEmail='',legacyDriveAuth=null;
    const DRIVE_TOKEN_SESSION_KEY='${keys.duplicate}',LEGACY_DRIVE_TOKEN_SESSION_KEY='${keys.legacy}';
    const DRIVE_TOKEN_LIFETIME_MS=2700000,LEGACY_DRIVE_TOKEN_LIFETIME_MS=3000000;\n${defs}`,ctx);
  const cleared = parse(source,'module').body.find(n => n.type === 'ExpressionStatement' && n.expression.type === 'CallExpression'
    && n.expression.arguments[0]?.value === 'work-manager-credentials-cleared');
  ctx.stopRealtime = () => { shared.stopped = true; };
  ctx.setSyncStatus = () => {};
  ctx.showLoggedOutGateV2 = () => { shared.gated = true; };
  return { shared, get: expression => vm.runInContext(expression,ctx),
    dispatchClear: () => { if (!cleared) throw Error('Missing cloud credential cleanup listener');
      const callback = cleared.expression.arguments[1]; return vm.runInContext(`(${source.slice(callback.start,callback.end)})()`,ctx); } };
}
module.exports = { user, profile, keys, state, workspace, cloud };
