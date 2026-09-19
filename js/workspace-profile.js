import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
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
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  serverTimestamp,
  setDoc,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
// 공용 건물 입구(로비) 전용 Firebase.
// 실제 업무 데이터는 이 프로젝트에 저장하지 않습니다.
const buildingFirebaseConfig = {
  apiKey: "AIzaSyDwb-_i23oDgM-E7055xSCL0L1P5VreAA8",
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
const DRIVE_TOKEN_LIFETIME_MS = 50 * 60 * 1000;

let buildingApp = null;
let buildingAuth = null;
let buildingUser = null;
let driveAccessToken = "";

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
  if (!token) throw new Error("Google Drive 권한 토큰이 없습니다.");
  return { Authorization: `Bearer ${token}` };
}

function rememberDriveToken(token, user = buildingUser) {
  driveAccessToken = String(token || "");
  if (!driveAccessToken) return "";
  try {
    sessionStorage.setItem(DRIVE_TOKEN_KEY, JSON.stringify({
      token: driveAccessToken,
      uid: user?.uid || "",
      expiresAt: Date.now() + DRIVE_TOKEN_LIFETIME_MS,
    }));
  } catch {}
  return driveAccessToken;
}

function restoreDriveToken(user = buildingUser) {
  if (driveAccessToken) return driveAccessToken;
  try {
    const saved = JSON.parse(sessionStorage.getItem(DRIVE_TOKEN_KEY) || "null");
    if (!saved?.token || Number(saved.expiresAt || 0) <= Date.now() || (saved.uid && user?.uid && saved.uid !== user.uid)) {
      sessionStorage.removeItem(DRIVE_TOKEN_KEY);
      return "";
    }
    driveAccessToken = saved.token;
  } catch {
    return "";
  }
  return driveAccessToken;
}

function clearDriveToken() {
  driveAccessToken = "";
  try { sessionStorage.removeItem(DRIVE_TOKEN_KEY); } catch {}
}

function googleProvider(selectAccount = false) {
  const provider = new GoogleAuthProvider();
  provider.addScope("https://www.googleapis.com/auth/drive.file");
  provider.addScope("https://www.googleapis.com/auth/drive.appdata");
  if (selectAccount) provider.setCustomParameters({ prompt: "select_account" });
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
    await setPersistence(buildingAuth, browserLocalPersistence);
  }
  buildingUser = buildingAuth.currentUser || await waitForAuthState(buildingAuth);
  restoreDriveToken(buildingUser);
  return { user: buildingUser, hasDriveToken: Boolean(driveAccessToken) };
}

export async function signInBuildingGoogle({ selectAccount = true } = {}) {
  await initBuildingIdentity();
  const result = await signInWithPopup(buildingAuth, googleProvider(selectAccount));
  const credential = GoogleAuthProvider.credentialFromResult(result);
  buildingUser = result.user;
  rememberDriveToken(credential?.accessToken || "", buildingUser);
  return buildingUser;
}

export async function ensureBuildingDriveAccess() {
  await initBuildingIdentity();
  if (!buildingUser) return signInBuildingGoogle({ selectAccount: true });
  if (restoreDriveToken(buildingUser)) return buildingUser;
  const result = await reauthenticateWithPopup(buildingUser, googleProvider(false));
  const credential = GoogleAuthProvider.credentialFromResult(result);
  rememberDriveToken(credential?.accessToken || "", buildingUser);
  return buildingUser;
}

export async function signOutBuilding() {
  await initBuildingIdentity();
  clearDriveToken();
  if (buildingAuth.currentUser) await signOut(buildingAuth);
  buildingUser = null;
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

export function validateWorkspaceProfile(profile) {
  const config = profile?.workspace?.firebaseConfig;
  const auth = profile?.workspace?.auth;
  if (profile?.app !== APP_ID || Number(profile?.schemaVersion) !== PROFILE_SCHEMA_VERSION) return false;
  if (!config?.apiKey || !config?.projectId || !config?.authDomain || !config?.appId) return false;
  if (!auth?.email || !auth?.password || !auth?.uid) return false;
  return true;
}

export async function loadWorkspaceProfile() {
  await ensureBuildingDriveAccess();
  const files = await listProfileFiles();
  for (const file of files) {
    try {
      const profile = await readProfileFile(file.id);
      if (!validateWorkspaceProfile(profile)) continue;
      if (profile.google?.uid && buildingUser?.uid && profile.google.uid !== buildingUser.uid) continue;
      return { profile, file };
    } catch (error) {
      console.warn("업무공간 설정 파일을 읽지 못했습니다.", file?.id, error);
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
  if (files[0]?.id) return updateProfileFile(files[0].id, profile);
  return createProfileFile(profile);
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
  if (!buildingUser) throw new Error("먼저 Google 계정으로 로그인해 주세요.");

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
  const privateDb = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
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
  if (!buildingUser) throw new Error("건물 로그인 정보가 없습니다.");
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
  return profile;
}

export async function connectPrivateWorkspace(profile) {
  if (!validateWorkspaceProfile(profile)) throw new Error("업무공간 설정이 올바르지 않습니다.");
  const appName = `wm-private-${profile.workspace.firebaseConfig.projectId}`;
  let privateApp;
  try {
    privateApp = initializeApp(profile.workspace.firebaseConfig, appName);
  } catch (error) {
    if (!String(error?.message || "").includes("already exists")) throw error;
    throw new Error("동일한 개인 Firebase가 이미 연결되어 있습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.");
  }
  const privateAuth = getAuth(privateApp);
  await setPersistence(privateAuth, browserLocalPersistence);
  const signedIn = await signInWithEmailAndPassword(
    privateAuth,
    profile.workspace.auth.email,
    profile.workspace.auth.password,
  );
  if (signedIn.user.uid !== profile.workspace.auth.uid) throw new Error("개인 업무공간 UID가 일치하지 않습니다.");
  const privateDb = initializeFirestore(privateApp, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
  return { app: privateApp, auth: privateAuth, db: privateDb, user: signedIn.user };
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
