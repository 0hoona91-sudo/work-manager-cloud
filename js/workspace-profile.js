import { initializeApp, deleteApp, getApps } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  reauthenticateWithPopup,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  serverTimestamp,
  setDoc,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
// 공용 건물 입구(로비) 전용 Firebase.
// 실제 업무 데이터는 이 프로젝트에 저장하지 않습니다.
const buildingFirebaseConfig = {
  apiKey: "AIzaSyDwh-_j23oDqM-E7Q55xSCLoL1P5VreAA8",
  authDomain: "work-manager-cloud-lobby.firebaseapp.com",
  projectId: "work-manager-cloud-lobby",
  storageBucket: "work-manager-cloud-lobby.firebasestorage.app",
  messagingSenderId: "928594815811",
  appId: "1:928594815811:web:361a139863c392786b5df6",
};

const PROFILE_FILE_NAME = "work-manager-workspace-v1.json";
const PROFILE_SCHEMA_VERSION = 1;
const APP_ID = "work-manager-cloud";
const DRIVE_TOKEN_KEY = "workManagerBuildingDriveTokenV1";
const DRIVE_TOKEN_LIFETIME_MS = 45 * 60 * 1000; // OAuth 만료 직전 재사용을 피하기 위한 안전 여유
const PROFILE_CACHE_KEY = "workManagerWorkspaceProfileCacheV2";
const BUILDING_EMAIL_HINT_KEY = "workManagerBuildingEmailHintV1";

let buildingApp = null;
let buildingAuth = null;
let buildingDb = null;
let buildingUser = null;
let buildingAuthorization = null;
let driveAccessToken = "";
let driveAccessTokenExpiresAt = 0;
let driveAccessTokenUid = "";
let identityObserverInstalled = false;
let identityCleanup = Promise.resolve();

// Firebase Firestore는 같은 app 인스턴스에 서로 다른 옵션으로 initializeFirestore()를
// 두 번 호출할 수 없습니다. 설정 화면에서 연결 확인을 재시도해도 같은 인스턴스를
// 재사용하도록 캐시합니다.
const firestoreByApp = new WeakMap();

function getOrInitFirestore(app, { persistent = false } = {}) {
  const cached = firestoreByApp.get(app);
  if (cached) return cached;

  let db;
  if (persistent) {
    try {
      db = initializeFirestore(app, {
        localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
      });
    } catch (error) {
      // 이미 같은 app에서 Firestore가 초기화된 경우 기존 인스턴스를 그대로 사용합니다.
      if (!String(error?.message || "").includes("already been called")) throw error;
      db = getFirestore(app);
    }
  } else {
    db = getFirestore(app);
  }

  firestoreByApp.set(app, db);
  return db;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function randomBase64Url(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function makeWorkspacePassword() {
  return `Wm!${randomBase64Url(32)}aA7`;
}

function makeWorkspaceEmail(buildingUid) {
  const safeUid = String(buildingUid || "user").replace(/[^a-zA-Z0-9]/g, "").slice(0, 32) || "user";
  const suffix = randomBase64Url(6).toLowerCase();
  return `wm.${safeUid}.${suffix}@work-manager.invalid`;
}

function profileFileQuery() {
  return `name='${PROFILE_FILE_NAME.replaceAll("'", "\\'")}' and trashed=false`;
}

function driveHeaders(token = driveAccessToken) {
  if (!token || token !== restoreDriveToken(buildingUser)) throw new Error("Google Drive 권한 토큰이 없습니다.");
  return { Authorization: `Bearer ${token}` };
}

function rememberDriveToken(token, user = buildingUser) {
  if (typeof token !== "string" || !token || !user?.uid || user.uid !== buildingAuth?.currentUser?.uid) {
    clearDriveToken();
    return "";
  }
  driveAccessToken = String(token || "");
  if (!driveAccessToken) return "";
  driveAccessTokenExpiresAt = Date.now() + DRIVE_TOKEN_LIFETIME_MS;
  driveAccessTokenUid = user?.uid || "";
  try {
    sessionStorage.setItem(DRIVE_TOKEN_KEY, JSON.stringify({
      token: driveAccessToken,
      uid: driveAccessTokenUid,
      expiresAt: driveAccessTokenExpiresAt,
    }));
  } catch {}
  return driveAccessToken;
}

function restoreDriveToken(user = buildingUser) {
  const now = Date.now();
  const userUid = user?.uid || "";
  if (!userUid || userUid !== buildingAuth?.currentUser?.uid) { clearDriveToken(); return ""; }
  if (driveAccessToken) {
    const validTime = Number.isFinite(driveAccessTokenExpiresAt) && driveAccessTokenExpiresAt > now;
    const validUser = driveAccessTokenUid === userUid;
    if (validTime && validUser) return driveAccessToken;
    clearDriveToken();
  }
  try {
    const saved = JSON.parse(sessionStorage.getItem(DRIVE_TOKEN_KEY) || "null");
    if (typeof saved?.token !== "string" || !saved.token || !Number.isFinite(saved.expiresAt)
      || saved.expiresAt <= now || saved.expiresAt > now + DRIVE_TOKEN_LIFETIME_MS || saved.uid !== userUid) {
      sessionStorage.removeItem(DRIVE_TOKEN_KEY);
      return "";
    }
    driveAccessToken = saved.token;
    driveAccessTokenExpiresAt = Number(saved.expiresAt || 0);
    driveAccessTokenUid = saved.uid || "";
  } catch {
    clearDriveToken();
    return "";
  }
  return driveAccessToken;
}

function clearDriveToken() {
  driveAccessToken = "";
  driveAccessTokenExpiresAt = 0;
  driveAccessTokenUid = "";
  try { sessionStorage.removeItem(DRIVE_TOKEN_KEY); } catch {}
}


function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

// 소유자 이메일을 공개 소스에 하드코딩하지 않습니다.
// 서버에서 owner-only Firestore 규칙으로 보호되는 allowedUsers 문서 확인에 성공한
// 현재 Google 계정만 소유자로 판별합니다. 서버 보안규칙은 절대로 완화하지 마세요.
function hasVerifiedGoogleIdentity(user) {
  return Boolean(user?.uid && normalizeEmail(user?.email) && user?.emailVerified === true
    && Array.isArray(user.providerData)
    && user.providerData.some(provider => provider?.providerId === "google.com"));
}
function isPersonalOwner(user) {
  return hasVerifiedGoogleIdentity(user)
    && buildingAuthorization?.allowed === true
    && buildingAuthorization?.uid === user.uid
    && buildingAuthorization?.email === normalizeEmail(user.email);
}
function assertPersonalOwner(user) {
  if (!isPersonalOwner(user)) {
    const error = new Error("이 업무관리시스템은 소유자 전용입니다. 해당 Google 계정은 사용할 수 없습니다.");
    error.code = "app/access-denied";
    throw error;
  }
}

function rememberBuildingEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return "";
  try { localStorage.setItem(BUILDING_EMAIL_HINT_KEY, normalized); } catch {}
  return normalized;
}

function getRememberedBuildingEmail() {
  const direct = normalizeEmail(buildingUser?.email || "");
  if (direct) return direct;
  try { return normalizeEmail(localStorage.getItem(BUILDING_EMAIL_HINT_KEY) || ""); } catch { return ""; }
}

function rememberWorkspaceProfileCache(profile) {
  const snapshot = workspaceConnectionMetadata(profile);
  if (!snapshot || !workspaceProfileMatchesUser(snapshot, buildingUser)) return null;
  try { localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(snapshot)); }
  catch { clearWorkspaceProfileCache(); }
  rememberBuildingEmail(snapshot?.google?.email || "");
  return snapshot;
}

function readWorkspaceProfileCache(user = buildingUser) {
  try {
    const cached = workspaceConnectionMetadata(JSON.parse(localStorage.getItem(PROFILE_CACHE_KEY) || "null"));
    if (!cached || !workspaceProfileMatchesUser(cached, user)) { clearWorkspaceProfileCache(); return null; }
    return rememberWorkspaceProfileCache(cached);
  } catch {
    clearWorkspaceProfileCache();
    return null;
  }
}

function clearWorkspaceProfileCache() {
  try { localStorage.removeItem(PROFILE_CACHE_KEY); } catch {}
}

function workspaceProfileMatchesUser(profile, user) {
  return hasVerifiedGoogleIdentity(user) && profile?.google?.uid === user.uid
    && normalizeEmail(profile.google.email) === normalizeEmail(user.email);
}

function workspaceConnectionMetadata(profile) {
  if (!validateWorkspaceProfile(profile, { allowMissingPassword: true })) return null;
  const config = profile.workspace.firebaseConfig;
  const firebaseConfig = {};
  for (const key of ["apiKey", "authDomain", "projectId", "storageBucket", "messagingSenderId", "appId", "measurementId"]) {
    if (typeof config[key] === "string" && config[key]) firebaseConfig[key] = config[key];
  }
  return { app: APP_ID, schemaVersion: PROFILE_SCHEMA_VERSION,
    google: { uid: profile.google.uid, email: normalizeEmail(profile.google.email) },
    workspace: { firebaseConfig, auth: { email: profile.workspace.auth.email, uid: profile.workspace.auth.uid } } };
}

function migrateWorkspaceProfileCache() {
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_KEY);
    if (!raw) return;
    const metadata = workspaceConnectionMetadata(JSON.parse(raw));
    if (metadata) localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(metadata));
    else clearWorkspaceProfileCache();
  } catch { clearWorkspaceProfileCache(); }
}

async function clearAccountCredentials() {
  clearWorkspaceProfileCache();
  clearDriveToken();
  invalidateBuildingTasksToken();
  buildingAuthorization = null;
  try { localStorage.removeItem(BUILDING_EMAIL_HINT_KEY); } catch {}
  // Notify the cloud adapter to drop its memory tokens and stop old subscriptions.
  window.dispatchEvent(new Event("work-manager-credentials-cleared"));
  const privateAuths = getApps().filter(app => app.name.startsWith("wm-private-") || app.name === "work-manager-legacy-drive-v122")
    .map(app => getAuth(app)).filter(auth => auth.currentUser);
  const results = await Promise.allSettled(privateAuths.map(auth => signOut(auth)));
  if (results.some(result => result.status === "rejected")) throw new Error("개인 업무공간 로그아웃을 완료하지 못했습니다. 다시 시도해 주세요.");
}

function adoptBuildingUser(user) {
  const changed = buildingUser?.uid && buildingUser.uid !== user?.uid;
  buildingUser = user;
  if (changed) {
    identityCleanup = clearAccountCredentials();
    // The caller awaits this barrier; the observer must not emit a raw SDK error.
    identityCleanup.catch(() => {});
  }
  return identityCleanup;
}

function googleProvider(selectAccount = false, includeDrive = false) {
  const provider = new GoogleAuthProvider();
  if (includeDrive) {
    provider.addScope("https://www.googleapis.com/auth/drive.file");
    provider.addScope("https://www.googleapis.com/auth/drive.appdata");
  }
  const hint = getRememberedBuildingEmail();
  const params = {};
  if (selectAccount) params.prompt = "select_account";
  if (hint) params.login_hint = hint;
  if (Object.keys(params).length) provider.setCustomParameters(params);
  return provider;
}

function waitForAuthState(auth) {
  return new Promise((resolve, reject) => {
    const off = onAuthStateChanged(auth, (user) => {
      off();
      resolve(user);
    }, reject);
  });
}

export async function initBuildingIdentity() {
  if (!buildingApp) {
    buildingApp = initializeApp(buildingFirebaseConfig, "work-manager-building-v1");
    buildingAuth = getAuth(buildingApp);
    buildingDb = getFirestore(buildingApp);
    await setPersistence(buildingAuth, browserLocalPersistence);
  }
  await adoptBuildingUser(buildingAuth.currentUser || await waitForAuthState(buildingAuth));
  if (!identityObserverInstalled) {
    identityObserverInstalled = true;
    onAuthStateChanged(buildingAuth, user => { void adoptBuildingUser(user); });
  }
  if (buildingUser?.email) rememberBuildingEmail(buildingUser.email);
  restoreDriveToken(buildingUser);
  return { user: buildingUser, hasDriveToken: Boolean(driveAccessToken) };
}

export async function signInBuildingGoogle({ selectAccount = true } = {}) {
  await initBuildingIdentity();
  const result = await signInWithPopup(buildingAuth, googleProvider(selectAccount, false));
  await adoptBuildingUser(result.user);
  buildingAuthorization = null;
  clearDriveToken();
  // Firebase 로그인 이후 서버의 소유자 전용 허용 문서를 확인합니다.
  // UI 검사뿐 아니라 서버 Firestore 보안규칙이 최종 차단을 담당합니다.
  let permission;
  try {
    permission = await checkBuildingAuthorization(buildingUser);
  } catch (error) {
    await signOut(buildingAuth);
    buildingUser = null;
    buildingAuthorization = null;
    invalidateBuildingTasksToken();
    throw error;
  }
  if (!permission?.allowed) {
    await signOut(buildingAuth);
    buildingUser = null;
    buildingAuthorization = null;
    invalidateBuildingTasksToken();
    const error = new Error("이 업무관리시스템은 소유자 계정으로만 사용할 수 있습니다.");
    error.code = "app/access-denied";
    throw error;
  }
  if (buildingUser?.email) rememberBuildingEmail(buildingUser.email);
  return buildingUser;
}

export async function checkBuildingAuthorization(user = buildingUser) {
  await initBuildingIdentity();
  const target = user || buildingUser;
  const email = String(target?.email || "").trim().toLowerCase();
  if (!target || !email) return { allowed: false, email, reason: "missing-email" };
  if (!hasVerifiedGoogleIdentity(target)) return { allowed: false, email, reason: "unverified-google" };
  if (buildingAuthorization?.uid === target.uid && buildingAuthorization?.email === email) return buildingAuthorization;
  // 강제로 서버에 조회합니다. 이전 브라우저 캐시의 enabled:true는 신뢰하지 않습니다.
  // 적용된 lobby Firestore 규칙은 소유자 본인만 allowedUsers 문서를 읽도록 제한해야 합니다.
  let snapshot;
  try {
    snapshot = await getDocFromServer(doc(buildingDb, "allowedUsers", email));
  } catch (error) {
    if (error?.code === "permission-denied") {
      buildingAuthorization = { allowed: false, uid: target.uid, email, reason: "server-denied" };
      return buildingAuthorization;
    }
    throw error;
  }
  const data = snapshot.exists() ? snapshot.data() : null;
  buildingAuthorization = {
    allowed: Boolean(snapshot.exists() && data?.enabled === true),
    uid: target.uid,
    email,
    data: data || null,
  };
  return buildingAuthorization;
}

export async function ensureBuildingDriveAccess({ forceRefresh = false } = {}) {
  await initBuildingIdentity();
  if (!buildingUser) {
    await signInBuildingGoogle({ selectAccount: true });
  }
  const authorization = await checkBuildingAuthorization(buildingUser);
  if (!authorization.allowed) {
    const error = new Error("이 Google 계정은 업무관리시스템 사용 승인을 받지 않았습니다.");
    error.code = "app/access-denied";
    throw error;
  }
  if (forceRefresh) clearDriveToken();
  if (restoreDriveToken(buildingUser)) return buildingUser;
  const expectedUid = buildingUser.uid;
  const result = await reauthenticateWithPopup(buildingUser, googleProvider(false, true));
  if (result.user?.uid !== expectedUid || buildingAuth.currentUser?.uid !== expectedUid || buildingUser?.uid !== expectedUid) {
    clearDriveToken();
    throw new Error("다른 Google 계정을 선택했습니다. 기존 계정으로 다시 승인하세요.");
  }
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (!rememberDriveToken(credential?.accessToken || "", buildingUser)) throw new Error("Google Drive 권한 토큰을 받지 못했습니다.");
  return buildingUser;
}

export function invalidateBuildingDriveAccessToken() {
  clearDriveToken();
}

export async function signOutBuilding() {
  const results = await Promise.allSettled([clearAccountCredentials(), (async () => {
    await initBuildingIdentity();
    if (buildingAuth.currentUser) await signOut(buildingAuth);
  })()]);
  buildingUser = null;
  buildingAuthorization = null;
  clearWorkspaceProfileCache();
  clearDriveToken();
  try { localStorage.removeItem(BUILDING_EMAIL_HINT_KEY); } catch {}
  if (results.some(result => result.status === "rejected")) throw new Error("로그아웃을 완료하지 못했습니다. 다시 시도해 주세요.");
}

async function listProfileFiles() {
  await ensureBuildingDriveAccess();
  const params = new URLSearchParams({
    spaces: "appDataFolder",
    q: profileFileQuery(),
    fields: "files(id,name,modifiedTime,size)",
    orderBy: "modifiedTime desc",
    pageSize: "10",
  });
  const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
    headers: driveHeaders(),
  });
  if (!response.ok) throw new Error(`Google Drive 설정 검색 실패 (${response.status})`);
  const data = await response.json();
  return Array.isArray(data.files) ? data.files : [];
}

async function readProfileFile(fileId) {
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: driveHeaders(),
  });
  if (!response.ok) throw new Error(`업무공간 설정 읽기 실패 (${response.status})`);
  return response.json();
}

export function validateWorkspaceProfile(profile, { allowMissingPassword = false } = {}) {
  const config = profile?.workspace?.firebaseConfig;
  const auth = profile?.workspace?.auth;
  const text = value => typeof value === "string" && value.trim().length > 0;
  if (profile?.app !== APP_ID || Number(profile?.schemaVersion) !== PROFILE_SCHEMA_VERSION) return false;
  if (![config?.apiKey, config?.projectId, config?.authDomain, config?.appId, auth?.email, auth?.uid,
    profile?.google?.uid, profile?.google?.email].every(text)) return false;
  if (!(allowMissingPassword && auth.password === undefined) && !text(auth.password)) return false;
  return true;
}

export async function loadWorkspaceProfile() {
  await ensureBuildingDriveAccess();
  const files = await listProfileFiles();
  for (const file of files) {
    try {
      const profile = await readProfileFile(file.id);
      if (!validateWorkspaceProfile(profile)) continue;
      if (!workspaceProfileMatchesUser(profile, buildingUser)) continue;
      rememberWorkspaceProfileCache(profile);
      return { profile, file };
    } catch (error) {
      console.warn("업무공간 설정 파일을 읽지 못했습니다.");
    }
  }
  return null;
}

async function createProfileFile(profile) {
  const boundary = `wm_profile_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const metadata = JSON.stringify({ name: PROFILE_FILE_NAME, parents: ["appDataFolder"] });
  const body = [
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(profile)}\r\n`,
    `--${boundary}--`,
  ].join("");
  const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime", {
    method: "POST",
    headers: {
      ...driveHeaders(),
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!response.ok) throw new Error(`업무공간 설정 저장 실패 (${response.status})`);
  return response.json();
}

async function updateProfileFile(fileId, profile) {
  const response = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media&fields=id,name,modifiedTime`, {
    method: "PATCH",
    headers: {
      ...driveHeaders(),
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify(profile),
  });
  if (!response.ok) throw new Error(`업무공간 설정 갱신 실패 (${response.status})`);
  return response.json();
}

export async function saveWorkspaceProfile(profile) {
  await ensureBuildingDriveAccess();
  if (!validateWorkspaceProfile(profile)) throw new Error("저장할 업무공간 설정이 올바르지 않습니다.");
  const files = await listProfileFiles();
  const saved = files[0]?.id ? await updateProfileFile(files[0].id, profile) : await createProfileFile(profile);
  rememberWorkspaceProfileCache(profile);
  return saved;
}

export async function deleteWorkspaceProfile() {
  await ensureBuildingDriveAccess();
  clearWorkspaceProfileCache();
  const files = await listProfileFiles();
  for (const file of files) {
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}`, {
      method: "DELETE",
      headers: driveHeaders(),
    });
    if (!response.ok && response.status !== 404) throw new Error(`업무공간 설정 삭제 실패 (${response.status})`);
  }
  return files.length;
}

export function parseFirebaseConfigText(text) {
  const source = String(text || "");
  const keys = ["apiKey", "authDomain", "projectId", "storageBucket", "messagingSenderId", "appId", "measurementId"];
  const out = {};
  for (const key of keys) {
    const match = source.match(new RegExp(`${key}\\s*:\\s*["']([^"']+)["']`));
    if (match?.[1]) out[key] = match[1].trim();
  }
  if (!out.apiKey || !out.authDomain || !out.projectId || !out.appId) {
    throw new Error("Firebase 설정값을 읽지 못했습니다. firebaseConfig 전체를 그대로 붙여넣어 주세요.");
  }
  return out;
}

export async function provisionPrivateWorkspace(firebaseConfig) {
  await initBuildingIdentity();
  assertPersonalOwner(buildingUser);

  const appName = `wm-private-provision-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const privateApp = initializeApp(firebaseConfig, appName);
  const privateAuth = getAuth(privateApp);
  await setPersistence(privateAuth, browserLocalPersistence);
  const generatedEmail = makeWorkspaceEmail(buildingUser.uid);
  const generatedPassword = makeWorkspacePassword();

  let createdUser = null;
  try {
    const credential = await createUserWithEmailAndPassword(privateAuth, generatedEmail, generatedPassword);
    createdUser = credential.user;
    return {
      app: privateApp,
      auth: privateAuth,
      user: createdUser,
      credentials: {
        email: generatedEmail,
        password: generatedPassword,
        uid: createdUser.uid,
      },
      firebaseConfig: clone(firebaseConfig),
    };
  } catch (error) {
    try { await deleteApp(privateApp); } catch {}
    if (error?.code === "auth/operation-not-allowed") {
      throw new Error("개인 Firebase에서 이메일/비밀번호 로그인이 아직 켜져 있지 않습니다. Authentication → 로그인 방법에서 이메일/비밀번호를 사용 설정해 주세요.");
    }
    if (error?.code === "auth/unauthorized-domain") {
      throw new Error("개인 Firebase의 승인된 도메인에 현재 GitHub Pages 주소를 추가해 주세요.");
    }
    throw error;
  }
}

export function firestoreRulesForWorkspaceUid(uid, extraUids = []) {
  const allowed = [uid, ...extraUids].filter(Boolean);
  const condition = allowed.map((value) => `request.auth.uid == "${String(value).replaceAll('"', '')}"`).join(" || ");
  return `rules_version = '2';\nservice cloud.firestore {\n  match /databases/{database}/documents {\n    match /{document=**} {\n      allow read, write: if request.auth != null && (${condition});\n    }\n  }\n}`;
}

export async function testPrivateFirestore(provisioned) {
  const { app, user } = provisioned || {};
  if (!app || !user) throw new Error("개인 업무공간 연결 정보가 없습니다.");
  // 설정 단계에서는 기본 Firestore 인스턴스로 연결만 검증합니다.
  // 이렇게 해야 규칙 전파 대기 후 버튼을 다시 눌러도 재초기화 오류가 나지 않습니다.
  const privateDb = getOrInitFirestore(app);
  const markerRef = doc(privateDb, "meta", "workspaceSetup");
  await setDoc(markerRef, {
    app: APP_ID,
    setupComplete: true,
    ownerUid: user.uid,
    updatedAt: serverTimestamp(),
  }, { merge: true });
  const snapshot = await getDoc(markerRef);
  if (!snapshot.exists()) throw new Error("Firestore 연결 확인 문서를 읽지 못했습니다.");
  return true;
}

export async function finalizeWorkspaceProvision(provisioned) {
  await initBuildingIdentity();
  assertPersonalOwner(buildingUser);
  if (!provisioned?.firebaseConfig || !provisioned?.credentials?.uid) throw new Error("개인 업무공간 생성 정보가 없습니다.");
  const profile = {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    app: APP_ID,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    google: {
      uid: buildingUser.uid,
      email: buildingUser.email || "",
      displayName: buildingUser.displayName || "",
    },
    workspace: {
      firebaseConfig: clone(provisioned.firebaseConfig),
      auth: clone(provisioned.credentials),
    },
  };
  await saveWorkspaceProfile(profile);
  rememberWorkspaceProfileCache(profile);
  return profile;
}

export async function connectPrivateWorkspace(profile) {
  await initBuildingIdentity();
  assertPersonalOwner(buildingUser);
  if (!validateWorkspaceProfile(profile, { allowMissingPassword: true })) throw new Error("업무공간 설정이 올바르지 않습니다.");
  if (profile.google?.uid && profile.google.uid !== buildingUser.uid) {
    throw new Error("현재 Google 계정과 업무공간 소유자의 UID가 일치하지 않습니다.");
  }
  if (profile.google?.email && normalizeEmail(profile.google.email) !== normalizeEmail(buildingUser.email)) {
    throw new Error("현재 Google 계정과 업무공간 소유자의 이메일이 일치하지 않습니다.");
  }
  const appName = `wm-private-${profile.workspace.firebaseConfig.projectId}`;
  let privateApp = getApps().find((candidate) => candidate.name === appName);
  if (!privateApp) privateApp = initializeApp(profile.workspace.firebaseConfig, appName);
  const privateAuth = getAuth(privateApp);
  await setPersistence(privateAuth, browserLocalPersistence);
  let privateUser = privateAuth.currentUser || await waitForAuthState(privateAuth);
  if (!privateUser || privateUser.uid !== profile.workspace.auth.uid) {
    if (privateUser) await signOut(privateAuth);
    if (!workspaceProfileMatchesUser(profile, buildingAuth.currentUser)) throw new Error("Google 계정이 변경되었습니다. 다시 연결해 주세요.");
    if (!profile.workspace.auth.password) {
      const error = new Error("개인 업무공간 로그인을 Google Drive 연결정보로 복원해야 합니다.");
      error.code = "app/workspace-reauth-required";
      throw error;
    }
    const signedIn = await signInWithEmailAndPassword(
      privateAuth,
      profile.workspace.auth.email,
      profile.workspace.auth.password,
    );
    privateUser = signedIn.user;
  }
  if (privateUser.uid !== profile.workspace.auth.uid || !workspaceProfileMatchesUser(profile, buildingAuth.currentUser)) {
    await signOut(privateAuth);
    throw new Error("개인 업무공간 또는 Google 계정이 일치하지 않습니다.");
  }
  const privateDb = getOrInitFirestore(privateApp, { persistent: true });
  const metadata = rememberWorkspaceProfileCache(profile);
  return { app: privateApp, auth: privateAuth, db: privateDb, user: privateUser, profile: metadata };
}

export function loadCachedWorkspaceProfile(user = buildingUser) {
  if (!isPersonalOwner(user)) return null;
  const profile = readWorkspaceProfileCache(user);
  return profile ? { profile, file: null, source: "cache" } : null;
}

export async function verifyExistingWorkspace() {
  const loaded = await loadWorkspaceProfile();
  if (!loaded) return null;
  const connection = await connectPrivateWorkspace(loaded.profile);
  return { ...loaded, connection };
}

export function getBuildingUser() {
  return buildingUser;
}

export function hasBuildingDriveToken() {
  return Boolean(restoreDriveToken(buildingUser));
}

export function getBuildingDriveAccessToken() {
  return isPersonalOwner(buildingUser) ? (restoreDriveToken(buildingUser) || "") : "";
}


// v1.5 — Google Tasks 추가 동의: 기존 Drive 권한이나 공용 로그인 설정과 분리합니다.
const TASKS_SCOPE_V15 = "https://www.googleapis.com/auth/tasks";
const TASKS_TOKEN_KEY_V15 = "workManagerTasksTokenV15";
let tasksTokenV15 = "";
let tasksExpiryV15 = 0;
let tasksUidV15 = "";
export function invalidateBuildingTasksToken() {
  tasksTokenV15 = ""; tasksExpiryV15 = 0; tasksUidV15 = "";
  try { sessionStorage.removeItem(TASKS_TOKEN_KEY_V15); } catch {}
}
export function getBuildingTasksToken() {
  if (!isPersonalOwner(buildingAuth?.currentUser)) { invalidateBuildingTasksToken(); return ""; }
  const uid = buildingAuth?.currentUser?.uid || buildingUser?.uid || "";
  if (tasksTokenV15 && Date.now() < tasksExpiryV15 && uid && tasksUidV15 === uid) return tasksTokenV15;
  try {
    const saved = JSON.parse(sessionStorage.getItem(TASKS_TOKEN_KEY_V15) || "null");
    if (uid && saved?.uid === uid && Number.isFinite(saved.expiresAt) && saved.expiresAt > Date.now()
      && saved.expiresAt <= Date.now() + DRIVE_TOKEN_LIFETIME_MS && typeof saved.token === "string" && saved.token) {
      tasksTokenV15 = saved.token; tasksExpiryV15 = saved.expiresAt; tasksUidV15 = uid;
      return tasksTokenV15;
    }
  } catch {}
  invalidateBuildingTasksToken();
  return "";
}
export async function authorizeBuildingTasks() {
  await initBuildingIdentity();
  const user = buildingAuth.currentUser;
  if (!user) throw new Error("업무관리시스템 Google 로그인부터 진행해 주세요.");
  const permission = await checkBuildingAuthorization(user);
  if (!permission.allowed) throw new Error("업무관리시스템에 허용된 Google 계정이 아닙니다.");
  const provider = googleProvider(false, false);
  provider.addScope(TASKS_SCOPE_V15);
  // 팝업은 사용자 클릭에서만 호출합니다. 갱신 실패로 다른 API 권한은 폐기하지 않습니다.
  const result = await reauthenticateWithPopup(user, provider);
  if (result.user?.uid !== user.uid || buildingAuth.currentUser?.uid !== user.uid) throw new Error("다른 Google 계정을 선택했습니다. 기존 계정으로 다시 승인하세요.");
  const token = GoogleAuthProvider.credentialFromResult(result)?.accessToken;
  if (!token) throw new Error("Google Tasks 권한 토큰을 받지 못했습니다.");
  tasksTokenV15 = token;
  tasksUidV15 = user.uid;
  tasksExpiryV15 = Date.now() + 45 * 60 * 1000;
  try { sessionStorage.setItem(TASKS_TOKEN_KEY_V15, JSON.stringify({token,uid:user.uid,expiresAt:tasksExpiryV15})); } catch {}
  return token;
}

// Remove legacy plaintext passwords immediately, even before a login is restored.
migrateWorkspaceProfileCache();
