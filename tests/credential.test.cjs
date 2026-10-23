const assert = require('node:assert/strict');
const { plain } = require('./helpers.cjs');
const { user, profile, keys, state, workspace, cloud } = require('./credential-harness.cjs');
module.exports = ({ test }) => {
  test('AUTH-01', 'MOCK Google login, Drive profile, private auth and Firestore binding remain usable', async () => {
    const h = workspace(); await h.login(); const c = await h.loadConnect();
    assert.equal(c.user.uid, 'private-google-a'); assert.equal(c.db.app.options.projectId, 'fixture-project');
    assert.equal(h.shared.emailLogins.length, 1);
    assert.equal(await h.get('testPrivateFirestore')({ app: c.app, user: c.user }), true);
  });
  test('AUTH-02', 'MOCK reload restores the private SDK session without password or Drive prompt', async () => {
    const h = workspace(); await h.login(); await h.loadConnect();
    const refreshed = workspace(h.shared); await refreshed.get('initBuildingIdentity')(); await refreshed.get('checkBuildingAuthorization')();
    const cached = refreshed.get('loadCachedWorkspaceProfile')(); assert.ok(cached);
    assert.equal(cached.profile.workspace.auth.password, undefined);
    const before = h.shared.fetches.length; await refreshed.get('connectPrivateWorkspace')(cached.profile);
    assert.equal(h.shared.emailLogins.length, 1); assert.equal(h.shared.fetches.length, before);
  });
  test('AUTH-03', 'MOCK expired private session falls back to existing Drive credentials', async () => {
    const h = workspace(); await h.login(); await h.loadConnect();
    const cached = h.get('loadCachedWorkspaceProfile')().profile; delete cached.workspace.auth.password;
    h.shared.apps.find(a => a.name === 'wm-private-fixture-project').auth.currentUser = null;
    await assert.rejects(h.get('connectPrivateWorkspace')(cached));
    const c = await h.loadConnect(); assert.equal(c.user.uid, 'private-google-a'); assert.equal(h.shared.emailLogins.length, 2);
  });
  test('AUTH-04', 'Cache stores an allowlist without password, OAuth token or arbitrary profile fields', async () => {
    const h = workspace(); await h.login(); const p = profile(); p.extraToken = 'SYNTHETIC_TOKEN'; p.workspace.auth.refreshToken = 'SYNTHETIC_REFRESH';
    h.get('rememberWorkspaceProfileCache')(p);
    const serialized = JSON.stringify(h.shared.local.dump());
    assert.ok(!/SYNTHETIC_PASSWORD|SYNTHETIC_TOKEN|SYNTHETIC_REFRESH/.test(serialized));
    assert.equal(JSON.stringify(h.shared.session.dump()).includes('SYNTHETIC_PASSWORD'), false);
  });
  test('AUTH-05', 'Legacy full-profile cache is sanitized on module load', () => {
    const s = state(); s.local.setItem(keys.profile, JSON.stringify(profile())); workspace(s);
    assert.equal(s.local.getItem(keys.profile).includes('SYNTHETIC_PASSWORD'), false);
  });
  test('AUTH-06', 'MOCK logout clears caches and private SDK sessions; relogin still works', async () => {
    const h = workspace(); await h.login(); await h.loadConnect();
    await h.get('signOutBuilding')();
    for (const key of [keys.profile, 'workManagerBuildingEmailHintV1']) assert.equal(h.shared.local.getItem(key), null);
    for (const key of [keys.drive, keys.tasks]) assert.equal(h.shared.session.getItem(key), null);
    assert.equal(h.shared.apps.find(a => a.name === 'wm-private-fixture-project').auth.currentUser, null);
    await h.login(); assert.equal((await h.loadConnect()).user.uid, 'private-google-a');
  });
  test('AUTH-07', 'MOCK Google account switch separates cache, tokens and private auth', async () => {
    const h = workspace(); await h.login(); await h.loadConnect();
    h.shared.next = user('google-b'); h.shared.profile = profile('google-b'); await h.login();
    assert.equal(h.get('loadCachedWorkspaceProfile')(), null);
    assert.equal(h.shared.apps.find(a => a.name === 'wm-private-fixture-project').auth.currentUser, null);
    assert.equal(h.get('restoreDriveToken')(), '');
    assert.equal((await h.loadConnect()).user.uid, 'private-google-b');
  });
  test('AUTH-08', 'Profiles with wrong or missing Google owner are rejected before private login', async () => {
    const h = workspace(); await h.login();
    await assert.rejects(h.get('connectPrivateWorkspace')(profile('google-b')));
    const p = profile(); delete p.google; await assert.rejects(h.get('connectPrivateWorkspace')(p));
    assert.equal(h.shared.emailLogins.length, 0);
    assert.equal(h.get('readWorkspaceProfileCache')(null), null);
  });
  test('AUTH-09', 'Malformed profile types are rejected', () => {
    const h = workspace();
    for (const mutate of [p => { p.workspace.auth.password = {}; }, p => { p.workspace.firebaseConfig.apiKey = []; }, p => { p.google.uid = ''; }]) {
      const p = profile(); mutate(p); assert.equal(h.get('validateWorkspaceProfile')(p), false);
    }
  });
  test('AUTH-10', 'Drive token expires in memory and session storage', async () => {
    const h = workspace(); await h.login(); await h.get('ensureBuildingDriveAccess')();
    assert.equal(h.get('getBuildingDriveAccessToken')(), 'SYNTHETIC_DRIVE_TOKEN');
    h.shared.now += 46*60*1000; assert.equal(h.get('getBuildingDriveAccessToken')(), '');
    assert.equal(h.shared.session.getItem(keys.drive), null);
  });
  test('AUTH-11', 'Missing identity and malformed expiry cannot restore Drive tokens', async () => {
    const h = workspace(); await h.login();
    for (const value of [{ token:'SYNTHETIC_TOKEN',uid:'google-a',expiresAt:'invalid' }, { token:'SYNTHETIC_TOKEN',expiresAt:h.shared.now+1000 }]) {
      h.shared.session.setItem(keys.drive, JSON.stringify(value)); assert.equal(h.get('restoreDriveToken')(), '');
    }
    h.get('rememberDriveToken')('SYNTHETIC_TOKEN',user('google-a')); assert.equal(h.get('restoreDriveToken')(null), '');
  });
  test('AUTH-12', 'Drive/Tasks tokens stay separate from password-free persistent profile', async () => {
    const h = workspace(); await h.login(); await h.loadConnect(); await h.get('authorizeBuildingTasks')();
    assert.ok(h.shared.session.getItem(keys.drive)); assert.ok(h.shared.session.getItem(keys.tasks));
    assert.equal(/SYNTHETIC_PASSWORD|SYNTHETIC_DRIVE_TOKEN/.test(JSON.stringify(h.shared.local.dump())), false);
    assert.equal(JSON.stringify(h.shared.session.dump()).includes('SYNTHETIC_PASSWORD'), false);
  });
  test('AUTH-13', 'MOCK Drive reauthentication rejects a different Google identity', async () => {
    const h = workspace(); await h.login(); h.shared.reauthUser = user('google-b');
    await assert.rejects(h.get('ensureBuildingDriveAccess')({forceRefresh:true})); assert.equal(h.get('getBuildingDriveAccessToken')(), '');
  });
  test('AUTH-14', 'Logout clears app cache even when SDK signout fails', async () => {
    const h = workspace(); await h.login(); await h.loadConnect(); h.shared.failSignout = 'work-manager-building-v1';
    await assert.rejects(h.get('signOutBuilding')());
    assert.equal(h.shared.local.getItem(keys.profile), null); assert.equal(h.shared.session.getItem(keys.drive), null);
  });
  test('AUTH-15', 'Profile error logs omit arbitrary error payloads', async () => {
    const h = workspace(); await h.login(); await h.get('ensureBuildingDriveAccess')();
    h.get("readProfileFile = async () => { throw Error('SYNTHETIC_PASSWORD SYNTHETIC_DRIVE_TOKEN'); }");
    await h.get('loadWorkspaceProfile')(); assert.equal(/SYNTHETIC_PASSWORD|SYNTHETIC_DRIVE_TOKEN/.test(h.shared.logs.join(' ')), false);
  });
  test('AUTH-16', 'Legacy Drive token expires even if still held in memory', () => {
    const h = cloud(); h.get('rememberLegacyDriveToken')('SYNTHETIC_LEGACY'); h.shared.now += 51*60*1000;
    assert.equal(h.get('restoreLegacyDriveToken')(), ''); assert.equal(h.shared.session.getItem(keys.legacy), null);
  });
  test('AUTH-17', 'Legacy Drive token cannot cross Google accounts', () => {
    const h = cloud(); h.get('rememberLegacyDriveToken')('SYNTHETIC_LEGACY');
    h.shared.next = user('google-b'); h.get(`buildingUser=${JSON.stringify(user('google-b'))}`);
    assert.equal(h.get('restoreLegacyDriveToken')(), '');
  });
  test('AUTH-18', 'Cloud adapter does not persist a second copy of the current Drive token', () => {
    const h = cloud(); h.shared.canonicalToken = 'SYNTHETIC_DRIVE_TOKEN';
    h.get('rememberDriveAccessToken')('SYNTHETIC_DRIVE_TOKEN', user('google-a'));
    assert.equal(h.shared.session.getItem(keys.duplicate), null);
    h.shared.canonicalToken = ''; assert.equal(h.get('restoreDriveAccessToken')(user('google-a')), '');
  });
  test('AUTH-19', 'MOCK delayed SDK auth restoration is awaited before password fallback', async () => {
    const h = workspace(); await h.login(); const c = await h.loadConnect();
    h.shared.delayedPrivate = plain(c.user); c.auth.currentUser = null;
    const restored = await h.get('connectPrivateWorkspace')(h.get('loadCachedWorkspaceProfile')().profile);
    assert.equal(restored.user.uid, 'private-google-a'); assert.equal(h.shared.emailLogins.length, 1);
  });
  test('AUTH-20', 'MOCK auth observer clears old credentials on external account change', async () => {
    const h = workspace(); await h.login(); await h.loadConnect();
    h.shared.next = user('google-b');
    await h.sdk.signInWithPopup(h.shared.apps.find(a => a.name === 'work-manager-building-v1').auth);
    await h.tick();
    assert.equal(h.shared.local.getItem(keys.profile), null); assert.equal(h.shared.session.getItem(keys.drive), null);
    assert.equal(h.shared.apps.find(a => a.name === 'wm-private-fixture-project').auth.currentUser, null);
    assert.ok(h.events.includes('work-manager-credentials-cleared'));
  });
  test('AUTH-21', 'Cloud cleanup event clears legacy token, profile references and listeners', () => {
    const h = cloud(); h.get('rememberLegacyDriveToken')('SYNTHETIC_LEGACY');
    h.shared.session.setItem(keys.duplicate, 'SYNTHETIC_DUPLICATE');
    h.get("currentUser={uid:'fixture'};workspaceProfile={workspace:{auth:{password:'SYNTHETIC_PASSWORD'}}}");
    h.dispatchClear();
    assert.equal(h.shared.session.getItem(keys.legacy), null); assert.equal(h.shared.session.getItem(keys.duplicate), null);
    assert.equal(h.get('workspaceProfile'), null); assert.equal(h.get('currentUser'), null);
    assert.equal(h.shared.stopped, true); assert.equal(h.shared.gated, true);
  });
  test('AUTH-22', 'Blocked browser storage does not prevent authenticated workspace connection', async () => {
    const h = workspace();
    for (const storage of [h.shared.local,h.shared.session]) {
      storage.getItem = () => { throw Error('Blocked storage'); };
      storage.setItem = () => { throw Error('Blocked storage'); };
      storage.removeItem = () => { throw Error('Blocked storage'); };
    }
    await h.login(); assert.equal((await h.loadConnect()).user.uid, 'private-google-a');
    assert.equal(h.get('loadCachedWorkspaceProfile')(), null);
  });
};
