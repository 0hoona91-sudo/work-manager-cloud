import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  browserSessionPersistence,
  getAuth,
  inMemoryPersistence,
  onAuthStateChanged,
  reauthenticateWithPopup,
  setPersistence,
  signInWithPopup,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  documentId,
  getDocs,
  increment,
  initializeFirestore,
  limit,
  onSnapshot,
  orderBy,
  persistentLocalCache,
  persistentMultipleTabManager,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { firebaseConfig as legacyFirebaseConfig, appConfig } from "./firebase-config.js?v=20260920-v122";
import {
  initBuildingIdentity,
  signInBuildingGoogle,
  signOutBuilding,
  loadWorkspaceProfile,
  loadCachedWorkspaceProfile,
  connectPrivateWorkspace,
  ensureBuildingDriveAccess,
  invalidateBuildingDriveAccessToken,
  getBuildingDriveAccessToken,
  getBuildingUser,
  hasBuildingDriveToken,
  checkBuildingAuthorization,
} from "./workspace-profile.js?v=20260922-v124";

const SCHEMA_VERSION = 11;
const DATA_COLLECTIONS = [
  "tasks",
  "projects",
  "checklistItems",
  "taskLinks",
  "templates",
  "linkedRules",
  "manualBlocks",
  "owners",
  "categories",
  "holidays",
  "settings",
  "meta",
  "generatedKeys",
];
const LIVE_COLLECTIONS = [...DATA_COLLECTIONS, "changeLogs"];
const CHANGE_LOG_LIMIT = 300;
const ENTITY_LABELS = {
  tasks: "수행업무",
  projects: "프로젝트",
  checklistItems: "체크리스트",
  taskLinks: "업무 연계규칙",
  templates: "반복/표준 업무",
  linkedRules: "반복/표준 업무 연계규칙",
  manualBlocks: "업무 매뉴얼",
  owners: "담당자",
  categories: "업무분류",
  holidays: "휴일",
  settings: "설정",
  meta: "시스템",
  generatedKeys: "중복방지 키",
};

let firebaseApp;
let auth;
let db;
let currentUser;
let buildingUser;
let workspaceProfile;
let driveAccessToken = "";
let driveAccessTokenExpiresAt = 0;
let driveAccessTokenUid = "";
let driveFolderId = "";
let stateRef;
let recordMaps = makeRecordMaps();
let shadowMaps = makeRecordMaps();
let active = false;
let saving = false;
let queuedState = null;
let queuedResolvers = [];
let queuedVersion = 0;
let unsubscribeAll = [];
let coreReadyPromise = null;
let historyListenerStarted = false;
let historyReadyPromise = null;
let remoteApplyTimer = 0;
let renderRemote = null;
let localOnly = false;
let needsInitialUpload = false;
let lastSyncAt = null;
const driveObjectUrls = new Map();
const DRIVE_TOKEN_SESSION_KEY = "workManagerDriveSessionV23";
const DRIVE_TOKEN_LIFETIME_MS = 45 * 60 * 1000;
const MAX_DRIVE_FILE_BYTES = 50 * 1024 * 1024;
const STAGE7_LOCAL_KEY = "workManagerStage7AuxV29";
const STAGE7_TRASH_TYPE = "stage7Trash";
const STAGE7_VERSION_TYPE = "stage7TemplateVersion";
const TEMPLATE_VERSION_LIMIT = 10;
const LEGACY_DRIVE_TOKEN_SESSION_KEY = "workManagerLegacyDriveSessionV122";
const LEGACY_DRIVE_TOKEN_LIFETIME_MS = 50 * 60 * 1000;
let legacyDriveAccessToken = "";
let legacyDriveAuth = null;

function rememberDriveAccessToken(token, user = currentUser) {
  driveAccessToken = String(token || "");
  if (!driveAccessToken) return "";
  driveAccessTokenExpiresAt = Date.now() + DRIVE_TOKEN_LIFETIME_MS;
  driveAccessTokenUid = user?.uid || "";
  try {
    sessionStorage.setItem(DRIVE_TOKEN_SESSION_KEY, JSON.stringify({
      token: driveAccessToken,
      uid: driveAccessTokenUid,
      expiresAt: driveAccessTokenExpiresAt,
    }));
  } catch {
    // iPad의 저장공간 제한 환경에서는 메모리 토큰만 사용한다.
  }
  return driveAccessToken;
}

function clearDriveAccessToken() {
  driveAccessToken = "";
  driveAccessTokenExpiresAt = 0;
  driveAccessTokenUid = "";
  driveFolderId = "";
  try { sessionStorage.removeItem(DRIVE_TOKEN_SESSION_KEY); } catch {}
}

function restoreDriveAccessToken(user = currentUser) {
  const now = Date.now();
  const userUid = user?.uid || "";
  if (driveAccessToken) {
    const validTime = driveAccessTokenExpiresAt > now;
    const validUser = !driveAccessTokenUid || !userUid || driveAccessTokenUid === userUid;
    if (validTime && validUser) return driveAccessToken;
    clearDriveAccessToken();
  }
  try {
    const saved = JSON.parse(sessionStorage.getItem(DRIVE_TOKEN_SESSION_KEY) || "null");
    if (!saved?.token || Number(saved.expiresAt || 0) <= now || (saved.uid && userUid && saved.uid !== userUid)) {
      sessionStorage.removeItem(DRIVE_TOKEN_SESSION_KEY);
      return "";
    }
    driveAccessToken = saved.token;
    driveAccessTokenExpiresAt = Number(saved.expiresAt || 0);
    driveAccessTokenUid = saved.uid || "";
  } catch {
    return "";
  }
  return driveAccessToken;
}

function legacyWorkspaceEligible() {
  const currentProject = workspaceProfile?.workspace?.firebaseConfig?.projectId || "";
  return Boolean(currentProject && legacyFirebaseConfig?.projectId && currentProject === legacyFirebaseConfig.projectId);
}

function rememberLegacyDriveToken(token) {
  legacyDriveAccessToken = String(token || "");
  if (!legacyDriveAccessToken) return "";
  try {
    sessionStorage.setItem(LEGACY_DRIVE_TOKEN_SESSION_KEY, JSON.stringify({
      token: legacyDriveAccessToken,
      email: String(buildingUser?.email || "").toLowerCase(),
      expiresAt: Date.now() + LEGACY_DRIVE_TOKEN_LIFETIME_MS,
    }));
  } catch {}
  return legacyDriveAccessToken;
}

function restoreLegacyDriveToken() {
  if (legacyDriveAccessToken) return legacyDriveAccessToken;
  try {
    const saved = JSON.parse(sessionStorage.getItem(LEGACY_DRIVE_TOKEN_SESSION_KEY) || "null");
    const email = String(buildingUser?.email || "").toLowerCase();
    if (!saved?.token || Number(saved.expiresAt || 0) <= Date.now() || (saved.email && email && saved.email !== email)) {
      sessionStorage.removeItem(LEGACY_DRIVE_TOKEN_SESSION_KEY);
      return "";
    }
    legacyDriveAccessToken = saved.token;
  } catch {
    return "";
  }
  return legacyDriveAccessToken;
}

async function ensureLegacyDriveAccess() {
  const restored = restoreLegacyDriveToken();
  if (restored) return restored;
  if (!legacyWorkspaceEligible()) throw new Error("이 업무공간에는 이전 Cloud Drive 복구가 필요하지 않습니다.");
  const appName = "work-manager-legacy-drive-v122";
  let legacyApp = getApps().find((candidate) => candidate.name === appName);
  if (!legacyApp) legacyApp = initializeApp(legacyFirebaseConfig, appName);
  legacyDriveAuth = getAuth(legacyApp);
  await setPersistence(legacyDriveAuth, browserLocalPersistence);
  const provider = new GoogleAuthProvider();
  provider.addScope("https://www.googleapis.com/auth/drive.file");
  const hint = String(buildingUser?.email || "").trim();
  if (hint) provider.setCustomParameters({ login_hint: hint });
  let result;
  try {
    const existing = legacyDriveAuth.currentUser;
    if (existing && (!hint || String(existing.email || "").toLowerCase() === hint.toLowerCase())) {
      result = await reauthenticateWithPopup(existing, provider);
    } else {
      result = await signInWithPopup(legacyDriveAuth, provider);
    }
  } catch (error) {
    throw new Error(`이전 Cloud의 Google Drive 권한을 확인하지 못했습니다. ${friendlyError(error)}`);
  }
  const credential = GoogleAuthProvider.credentialFromResult(result);
  const token = credential?.accessToken || "";
  if (!token) throw new Error("이전 Cloud의 Google Drive 권한 토큰을 받지 못했습니다.");
  return rememberLegacyDriveToken(token);
}

async function driveFileResponse(fileId, token, fields = "") {
  const suffix = fields
    ? `?fields=${encodeURIComponent(fields)}`
    : "?alt=media";
  return fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}${suffix}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function readDriveFileBlob(fileId, { allowLegacyPrompt = false } = {}) {
  if (!fileId) throw new Error("Drive 파일 ID가 없습니다.");
  let currentToken = await ensureDriveAccess();
  let response = await driveFileResponse(fileId, currentToken);
  if (response.status === 401) {
    currentToken = await currentDriveToken({ forceRefresh: true });
    response = await driveFileResponse(fileId, currentToken);
  }
  if (response.ok) return { blob: await response.blob(), source: "current" };
  if (![403, 404].includes(response.status) || !legacyWorkspaceEligible()) {
    throw new Error(`Google Drive 원본 읽기 실패 (${response.status})`);
  }
  let legacyToken = restoreLegacyDriveToken();
  if (!legacyToken && allowLegacyPrompt) legacyToken = await ensureLegacyDriveAccess();
  if (!legacyToken) {
    const error = new Error("이전 Cloud에서 올린 자료입니다. 자료를 눌러 이전 Drive 권한을 한 번 연결해 주세요.");
    error.code = "app/legacy-drive-auth-required";
    throw error;
  }
  response = await driveFileResponse(fileId, legacyToken);
  if (!response.ok) throw new Error(`이전 Cloud Google Drive 원본 읽기 실패 (${response.status})`);
  return { blob: await response.blob(), source: "legacy" };
}

async function readDriveFile(fileId, item = {}, { allowLegacyPrompt = true } = {}) {
  const result = await readDriveFileBlob(fileId, { allowLegacyPrompt });
  return {
    blob: result.blob,
    name: item?.name || "첨부파일",
    mimeType: item?.mimeType || result.blob.type || "application/octet-stream",
    source: result.source,
  };
}

function makeRecordMaps() {
  return Object.fromEntries(LIVE_COLLECTIONS.map((name) => [name, new Map()]));
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function plain(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function validFirebaseConfig() { return true; }

function docId(...parts) {
  return parts.map((part) => encodeURIComponent(String(part ?? ""))).join("~");
}

function stableKeyId(key) {
  const bytes = new TextEncoder().encode(String(key));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `auto-${btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")}`;
}

function withoutSyncFields(data) {
  const out = { ...data };
  delete out.revision;
  delete out.updatedAt;
  delete out.createdAt;
  return plain(out);
}

function mapClone(maps) {
  const next = makeRecordMaps();
  for (const name of LIVE_COLLECTIONS) {
    for (const [id, value] of maps[name] || []) next[name].set(id, clone(value));
  }
  return next;
}

function recordMapsEqual(a, b) {
  for (const name of DATA_COLLECTIONS) {
    const left = a?.[name] || new Map();
    const right = b?.[name] || new Map();
    if (left.size !== right.size) return false;
    for (const [id, value] of left) {
      if (!right.has(id) || JSON.stringify(value) !== JSON.stringify(right.get(id))) return false;
    }
  }
  return true;
}

function replaceState(target, source) {
  const localApiKey = target.settings?.holidayApiKey || "";
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, clone(source));
  target.tasks ||= [];
  target.projects ||= [];
  target.templates ||= [];
  target.holidays ||= [];
  target.categories ||= [];
  target.owners ||= [];
  target.settings ||= {};
  target.selectedCategories ||= [];
  target.changeLogs ||= [];
  target.settings.holidayApiKey = localApiKey || target.settings.holidayApiKey || "";
}

function emptyState(user) {
  const ownerName = String(user?.displayName || "담당자").trim() || "담당자";
  const categories = ["소방", "시설", "행정", "교육", "회계", "인사", "복지", "기타"];
  const palette = ["#A8D5BA", "#F6C7A5", "#FFD8A8", "#D9C5EA", "#B8D9EA", "#F2B8C6", "#F4E5A3", "#C8D4CB"];
  return {
    tasks: [],
    projects: [],
    templates: [],
    holidays: [],
    categories,
    owners: [ownerName],
    selectedCategories: [],
    changeLogs: [],
    settings: {
      homeView: "gantt",
      ganttScale: "day",
      calendarMonth: new Date().toISOString().slice(0, 7),
      homeLayout: "split",
      autoHorizonMonths: 12,
      suppressedAutoKeys: [],
      taskListCategories: [],
      uiTheme: "mint",
      categoryColors: Object.fromEntries(categories.map((name, index) => [name, palette[index]])),
      ownerProfiles: { [ownerName]: { mark: "📋", color: "#CDEFD8" } },
      holidayApiKey: "",
    },
  };
}

function serializeState(state) {
  const maps = makeRecordMaps();
  for (const task of state.tasks || []) {
    const { checklist = [], link = null, ...taskFields } = task;
    maps.tasks.set(task.id, plain({ ...taskFields, id: task.id }));
    checklist.forEach((item, order) => {
      const itemId = item.id || docId("check", task.id, order, item.text || "");
      maps.checklistItems.set(docId("task", task.id, itemId),
        plain({ id: itemId, parentType: "task", parentId: task.id, order, text: item.text || "", owner: item.owner || "", dueDate: item.dueDate || "", done: Boolean(item.done) }));
    });
    if (link) maps.taskLinks.set(task.id, plain({ id: task.id, taskId: task.id, ...link }));
    if (task.generatedKey) {
      maps.generatedKeys.set(stableKeyId(task.generatedKey),
        plain({ generatedKey: task.generatedKey, taskId: task.id }));
    }
  }

  for (const project of state.projects || []) {
    if (!project.id) continue;
    const safe = clone(project);
    for (const stage of safe.stages || []) {
      stage.resources = (stage.resources || []).map(cleanAttachmentMetadata);
    }
    maps.projects.set(project.id, plain(safe));
  }

  for (const template of state.templates || []) {
    const { checklist = [], linkedSteps = [], methodBlocks = [], attachments = [], photos, method, ...templateFields } = template;
    maps.templates.set(template.id, plain({ ...templateFields, attachments: attachments.map(cleanAttachmentMetadata), id: template.id }));
    checklist.forEach((text, order) => {
      maps.checklistItems.set(docId("template", template.id, order),
        plain({ parentType: "template", parentId: template.id, order, text: String(text || ""), done: false }));
    });
    linkedSteps.forEach((step, order) => {
      const { checklist: stepChecks = [], methodBlocks: stepBlocks = [], ...stepFields } = step;
      const ruleId = docId(template.id, order);
      maps.linkedRules.set(ruleId, plain({ id: ruleId, rootTemplateId: template.id, order, ...stepFields }));
      stepChecks.forEach((text, checkOrder) => {
        maps.checklistItems.set(docId("linkedRule", ruleId, checkOrder),
          plain({ parentType: "linkedRule", parentId: ruleId, order: checkOrder, text: String(text || ""), done: false }));
      });
      stepBlocks.forEach((block, blockOrder) => {
        const id = block.id || docId("step-block", ruleId, blockOrder);
        const { data, objectUrl, ...safeBlock } = block;
        maps.manualBlocks.set(docId("linkedRule", ruleId, id),
          plain({ ...safeBlock, id, parentType: "linkedRule", parentId: ruleId, order: blockOrder }));
      });
    });
    methodBlocks.forEach((block, order) => {
      const id = block.id || docId("block", template.id, order);
      const { data, objectUrl, ...safeBlock } = block;
      maps.manualBlocks.set(docId("template", template.id, id),
        plain({ ...safeBlock, id, parentType: "template", parentId: template.id, order }));
    });
  }

  const categoryColors = state.settings?.categoryColors || {};
  (state.categories || []).forEach((name, order) => {
    maps.categories.set(docId(name), plain({ name, order, color: categoryColors[name] || "#A8D5BA" }));
  });
  const ownerProfiles = state.settings?.ownerProfiles || {};
  (state.owners || []).forEach((name, order) => {
    maps.owners.set(docId(name), plain({ name, order, ...(ownerProfiles[name] || {}) }));
  });
  (state.holidays || []).forEach((holiday) => maps.holidays.set(holiday.id, plain({ ...holiday, id: holiday.id })));

  const settings = clone(state.settings || {});
  delete settings.categoryColors;
  delete settings.ownerProfiles;
  delete settings.holidayApiKey;
  maps.settings.set("main", plain({ ...settings, selectedCategories: state.selectedCategories || [] }));
  maps.meta.set("schema", plain({ schemaVersion: SCHEMA_VERSION, app: "work-manager-cloud-v10" }));
  // 자동생성 잠금은 업무가 삭제되어도 남겨 두어 다른 기기가 같은 회차를 되살리지 못하게 한다.
  for (const [id, value] of shadowMaps.generatedKeys || []) {
    if (!maps.generatedKeys.has(id)) maps.generatedKeys.set(id, clone(value));
  }
  return maps;
}

function deserializeState(maps, localSettings = {}) {
  const settingsDoc = clone(maps.settings.get("main") || {});
  const selectedCategories = settingsDoc.selectedCategories || [];
  delete settingsDoc.selectedCategories;
  const categories = [...maps.categories.values()].sort((a, b) => (a.order || 0) - (b.order || 0));
  const owners = [...maps.owners.values()].sort((a, b) => (a.order || 0) - (b.order || 0));
  const checklistByParent = new Map();
  for (const item of maps.checklistItems.values()) {
    const key = `${item.parentType}:${item.parentId}`;
    if (!checklistByParent.has(key)) checklistByParent.set(key, []);
    checklistByParent.get(key).push(item);
  }
  for (const items of checklistByParent.values()) items.sort((a, b) => (a.order || 0) - (b.order || 0));
  const blocksByParent = new Map();
  for (const block of maps.manualBlocks.values()) {
    const key = `${block.parentType}:${block.parentId}`;
    if (!blocksByParent.has(key)) blocksByParent.set(key, []);
    blocksByParent.get(key).push(block);
  }
  for (const blocks of blocksByParent.values()) blocks.sort((a, b) => (a.order || 0) - (b.order || 0));

  const tasks = [...maps.tasks.values()].map((task) => ({
    ...task,
    checklist: (checklistByParent.get(`task:${task.id}`) || []).map((item) => ({ id: item.id, text: item.text, owner: item.owner || "", dueDate: item.dueDate || "", done: Boolean(item.done) })),
    link: maps.taskLinks.has(task.id) ? omit(maps.taskLinks.get(task.id), ["id", "taskId"]) : null,
  }));
  const rulesByTemplate = new Map();
  for (const rule of maps.linkedRules.values()) {
    if (!rulesByTemplate.has(rule.rootTemplateId)) rulesByTemplate.set(rule.rootTemplateId, []);
    rulesByTemplate.get(rule.rootTemplateId).push(rule);
  }
  for (const rules of rulesByTemplate.values()) rules.sort((a, b) => (a.order || 0) - (b.order || 0));
  const templates = [...maps.templates.values()].map((template) => {
    const linkedSteps = (rulesByTemplate.get(template.id) || []).map((rule) => {
      const ruleId = rule.id;
      return {
        ...omit(rule, ["id", "rootTemplateId", "order"]),
        checklist: (checklistByParent.get(`linkedRule:${ruleId}`) || []).map((item) => item.text),
        methodBlocks: (blocksByParent.get(`linkedRule:${ruleId}`) || []).map(cleanBlock),
      };
    });
    return {
      ...template,
      checklist: (checklistByParent.get(`template:${template.id}`) || []).map((item) => item.text),
      linkedSteps,
      methodBlocks: (blocksByParent.get(`template:${template.id}`) || []).map(cleanBlock),
      method: "",
      photos: [],
    };
  });
  const logs = [...maps.changeLogs.values()]
    .sort((a, b) => String(b.clientTime || "").localeCompare(String(a.clientTime || "")))
    .slice(0, 300);
  return {
    tasks,
    projects: [...maps.projects.values()].map(clone),
    templates,
    holidays: [...maps.holidays.values()],
    categories: categories.map((item) => item.name),
    owners: owners.map((item) => item.name),
    selectedCategories,
    changeLogs: logs,
    settings: {
      ...settingsDoc,
      categoryColors: Object.fromEntries(categories.map((item) => [item.name, item.color || "#A8D5BA"])),
      ownerProfiles: Object.fromEntries(owners.map((item) => [item.name, { mark: item.mark || "📋", color: item.color || "#CDEFD8" }])),
      holidayApiKey: localSettings.holidayApiKey || "",
    },
  };
}

function cleanBlock(block) {
  return omit(block, ["parentType", "parentId", "order"]);
}

function cleanAttachmentMetadata(file) {
  return omit(file, ["data", "objectUrl", "blobUrl", "previewUrl", "parentType", "parentId", "order"]);
}

function omit(value, keys) {
  const out = { ...(value || {}) };
  for (const key of keys) delete out[key];
  return out;
}

function cloudHasData(maps) {
  return ["tasks", "templates", "categories", "owners", "holidays"].some((name) => maps[name].size > 0);
}

function ensureCloudStylesV2() {
  if (document.getElementById("cloud-v2-auth-style")) return;
  const style = document.createElement("style");
  style.id = "cloud-v2-auth-style";
  style.textContent = `
.cloud-gate{position:fixed;inset:0;z-index:10000;display:grid!important;place-items:center;padding:22px;background:linear-gradient(145deg,#f4f8ff,#e8f0fb);color:#1f2f46}
.cloud-gate.hidden{display:none!important}
.cloud-gate-card{width:min(430px,100%);padding:34px 30px;border:1px solid rgba(35,63,99,.12);border-radius:24px;background:rgba(255,255,255,.98);box-shadow:0 24px 70px rgba(25,54,93,.18);text-align:center}
.cloud-gate-mark{display:grid;place-items:center;width:64px;height:64px;margin:0 auto 16px;border-radius:18px;background:#2f75b5;color:#fff;font-size:34px;font-weight:900}.cloud-gate-mark img{width:36px;height:36px;display:block}
.cloud-gate-card h1{margin:0 0 9px;font-size:25px}.cloud-gate-card p{margin:0 0 22px;color:#66768a;line-height:1.6}
#cloudGateActions{display:flex;flex-direction:column;gap:9px}.cloud-google-btn,.cloud-secondary-btn{min-height:48px;border:0;border-radius:14px;padding:11px 15px;font-weight:800;cursor:pointer}
.cloud-google-btn{background:#244f82;color:#fff}.cloud-google-btn span{display:inline-grid;place-items:center;width:24px;height:24px;margin-right:8px;border-radius:50%;background:#fff;color:#244f82}
.cloud-secondary-btn{background:#edf3fa;color:#36506f}.cloud-gate-error{min-height:20px;margin-top:12px;color:#c43f39;font-size:12px;line-height:1.45}
.cloud-account{margin:10px 12px 0;padding:11px 12px;border-radius:14px;background:rgba(255,255,255,.08);color:#dbe7f5;font-size:11px;line-height:1.5;overflow-wrap:anywhere}
.cloud-account>div:first-child{display:flex;align-items:center;gap:6px;font-weight:750}.cloud-user{margin-top:5px}.cloud-signout{width:100%;margin-top:8px;border:1px solid rgba(255,255,255,.18);border-radius:9px;background:rgba(255,255,255,.96);color:#38516f;padding:7px 9px;font-size:11px;font-weight:700;cursor:pointer}
.sync-dot{width:8px;height:8px;border-radius:50%;background:#9ba39d;box-shadow:0 0 0 3px rgba(155,163,157,.12)}
.sync-dot[data-state="online"]{background:#62c989}.sync-dot[data-state="syncing"]{background:#e1a34b;animation:cloudSyncPulse 1s infinite alternate}.sync-dot[data-state="offline"]{background:#98a0ad}.sync-dot[data-state="error"]{background:#e15a54}
@keyframes cloudSyncPulse{to{opacity:.35}}
.drive-image-pending{cursor:pointer}.drive-image-loading{opacity:.55}
@media(max-width:720px){.cloud-gate-card{padding:28px 21px}}
`;
  document.head.appendChild(style);
}

function ensureShell() {
  ensureCloudStylesV2();
  if (document.getElementById("cloudGate")) return;
  document.body.insertAdjacentHTML(
    "afterbegin",
    `<div class="cloud-gate" id="cloudGate" role="dialog" aria-modal="true" aria-labelledby="cloudGateTitle">
      <div class="cloud-gate-card">
        <div class="cloud-gate-mark"><img src="./icon.svg" alt=""></div>
        <h1 id="cloudGateTitle">업무관리시스템</h1>
        <p id="cloudGateText">클라우드 연결을 준비하고 있습니다.</p>
        <div id="cloudGateActions"></div>
        <div class="cloud-gate-error" id="cloudGateError" aria-live="polite"></div>
      </div>
    </div>`,
  );
  const side = document.querySelector(".side");
  side?.insertAdjacentHTML(
    "beforeend",
    `<div class="cloud-account" id="cloudAccount">
      <div><span class="sync-dot" id="syncDot"></span><span id="syncText">연결 중</span></div>
      <div class="cloud-user" id="cloudUser"></div>
      <button class="cloud-signout" id="cloudSignOut" type="button">로그아웃</button>
      <a href="./privacy.html" target="_blank" rel="noopener" style="display:block;margin-top:7px;font-size:11px;color:#718078;text-decoration:none">개인정보처리방침</a>
    </div>`,
  );
}

function gate(text, actions = "", error = "") {
  ensureShell();
  const root = document.getElementById("cloudGate");
  root.classList.remove("hidden");
  document.getElementById("cloudGateText").textContent = text;
  document.getElementById("cloudGateActions").innerHTML = actions;
  document.getElementById("cloudGateError").textContent = error;
}

function hideGate() {
  document.getElementById("cloudGate")?.classList.add("hidden");
}

function setSyncStatus(kind, text) {
  const dot = document.getElementById("syncDot");
  const label = document.getElementById("syncText");
  if (dot) dot.dataset.state = kind;
  if (label) label.textContent = text;
}

function showLoggedOutGateV2() {
  ensureShell();
  gate(
    "로그아웃되었습니다. 다시 사용하려면 Google 계정으로 로그인해 주세요.",
    `<button class="cloud-google-btn" id="cloudGoogleLoginAfterLogout" type="button"><span>G</span> Google로 로그인</button>`,
  );
  const button = document.getElementById("cloudGoogleLoginAfterLogout");
  if (!button) return;
  button.onclick = async () => {
    button.disabled = true;
    document.getElementById("cloudGateError").textContent = "";
    try {
      await signInBuildingGoogle({ selectAccount: true });
      location.reload();
    } catch (error) {
      button.disabled = false;
      document.getElementById("cloudGateError").textContent =
        error?.code === "auth/popup-closed-by-user"
          ? "로그인 창이 닫혔습니다. 다시 눌러 로그인해 주세요."
          : `로그인하지 못했습니다. ${friendlyError(error)}`;
    }
  };
}

async function authenticateBuildingAndWorkspace() {
  const identity = await initBuildingIdentity();
  buildingUser = identity.user || null;
  if (!buildingUser) {
    gate(
      "Google 계정으로 로그인하면 어느 기기에서든 내 개인 업무공간을 자동으로 찾습니다.",
      `<button class="cloud-google-btn" id="cloudGoogleLogin" type="button"><span>G</span> Google로 로그인</button>`,
    );
    await new Promise((resolve) => {
      document.getElementById("cloudGoogleLogin").onclick = async () => {
        const button = document.getElementById("cloudGoogleLogin");
        button.disabled = true;
        document.getElementById("cloudGateError").textContent = "";
        try {
          buildingUser = await signInBuildingGoogle({ selectAccount: true });
          resolve();
        } catch (error) {
          button.disabled = false;
          document.getElementById("cloudGateError").textContent = `로그인하지 못했습니다. ${friendlyError(error)}`;
        }
      };
    });
  }

  gate("사용 권한을 확인하는 중입니다.");
  const authorization = await checkBuildingAuthorization(buildingUser);
  if (!authorization.allowed) {
    gate(
      "이 Google 계정은 업무관리시스템 사용 승인을 받지 않았습니다.",
      `<button class="cloud-secondary-btn" id="cloudUnauthorizedLogout" type="button">다른 Google 계정 사용</button>`,
      "관리자가 허용한 계정만 사용할 수 있습니다.",
    );
    document.getElementById("cloudUnauthorizedLogout").onclick = async () => {
      await signOutBuilding();
      location.reload();
    };
    const error = new Error("Access denied by allowlist.");
    error.code = "app/access-denied";
    throw error;
  }

  gate("이 기기에 저장된 내 업무공간 정보를 확인하는 중입니다.");
  const cached = loadCachedWorkspaceProfile(buildingUser);
  if (cached?.profile) {
    try {
      workspaceProfile = cached.profile;
      const cachedConnection = await connectPrivateWorkspace(workspaceProfile);
      firebaseApp = cachedConnection.app;
      auth = cachedConnection.auth;
      db = cachedConnection.db;
      currentUser = cachedConnection.user;
      buildingUser = getBuildingUser() || buildingUser;
      return cachedConnection;
    } catch (error) {
      console.warn("기기 캐시 업무공간 연결에 실패해 Drive에서 다시 확인합니다.", error);
      workspaceProfile = null;
    }
  }

  gate("내 개인 업무공간을 Google Drive에서 찾는 중입니다.");
  try {
    await ensureBuildingDriveAccess();
  } catch (error) {
    throw new Error(`Google Drive 연결을 확인하지 못했습니다. ${friendlyError(error)}`);
  }

  const loaded = await loadWorkspaceProfile();
  if (!loaded) {
    gate(
      "이 Google 계정에 연결된 개인 업무공간이 아직 없습니다.",
      `<a class="cloud-google-btn" href="./setup.html" style="display:block;text-decoration:none;line-height:26px">내 업무공간 만들기</a>
       <button class="cloud-secondary-btn" id="cloudWorkspaceLogout" type="button">다른 Google 계정 사용</button>`,
      "처음 한 번만 개인 Firebase를 연결하면 이후에는 어느 기기에서든 자동으로 찾습니다.",
    );
    document.getElementById("cloudWorkspaceLogout").onclick = async () => {
      await signOutBuilding();
      location.reload();
    };
    throw new Error("Workspace profile not found.");
  }

  workspaceProfile = loaded.profile;
  const connection = await connectPrivateWorkspace(workspaceProfile);
  firebaseApp = connection.app;
  auth = connection.auth;
  db = connection.db;
  currentUser = connection.user;
  buildingUser = getBuildingUser() || buildingUser;
  const token = getBuildingDriveAccessToken();
  if (token) rememberDriveAccessToken(token, buildingUser);
  return connection;
}

function friendlyError(error) {
  const code = error?.code || "";
  if (code.includes("unauthorized-domain")) return "이 주소가 Firebase 승인 도메인에 아직 등록되지 않았습니다.";
  if (code.includes("network")) return "인터넷 연결을 확인해 주세요.";
  if (code.includes("app/access-denied")) return "관리자가 허용한 계정만 사용할 수 있습니다.";
  if (code.includes("permission-denied")) return "이 계정에는 데이터 접근 권한이 없습니다.";
  if (code.includes("invalid-credential") || code.includes("invalid-login-credentials")) return "개인 업무공간 자동 로그인 정보가 올바르지 않습니다. setup.html에서 업무공간 연결을 다시 확인해 주세요.";
  if (code.includes("popup-blocked")) return "브라우저가 Google 로그인 창을 막았습니다. 이 사이트의 팝업을 허용한 뒤 Google로 로그인을 다시 눌러 주세요.";
  if (code.includes("popup-closed-by-user")) return "Google 권한 창이 닫혔습니다. 다시 눌러 권한 승인을 완료해 주세요.";
  if (code.includes("web-storage-unsupported")) return "브라우저 저장공간이 제한되어 있습니다. 시크릿 탭이 아닌 일반 탭에서 열고 쿠키와 사이트 데이터를 허용한 뒤 다시 시도해 주세요.";
  if (code.includes("operation-not-supported-in-this-environment")) return "현재 화면에서는 Google 로그인 창을 열 수 없습니다. 링크를 Chrome 또는 Safari의 일반 탭에서 직접 연 뒤 다시 시도해 주세요.";
  return error?.message || "잠시 후 다시 시도해 주세요.";
}

async function configureAuthPersistence(authInstance) {
  const choices = [
    [browserLocalPersistence, "local"],
    [browserSessionPersistence, "session"],
    [inMemoryPersistence, "memory"],
  ];
  let lastError = null;
  for (const [persistence, label] of choices) {
    try {
      await setPersistence(authInstance, persistence);
      if (label !== "local") console.warn(`Firebase Auth persistence fallback: ${label}`);
      return label;
    } catch (error) {
      lastError = error;
      console.warn(`Firebase Auth persistence unavailable: ${label}`, error);
    }
  }
  throw lastError || new Error("Firebase 로그인 저장소를 준비하지 못했습니다.");
}

function chooseInitialState(legacyState, user) {
  if (!legacyState?.tasks || !legacyState?.templates) return Promise.resolve(emptyState(user));
  gate(
    `이 브라우저에서 기존 v10 데이터 ${legacyState.tasks.length}개 업무와 ${legacyState.templates.length}개 DB 항목을 찾았습니다.`,
    `<button class="cloud-google-btn" id="cloudMigrate" type="button">기존 v10 데이터를 클라우드로 옮기기</button>
     <button class="cloud-secondary-btn" id="cloudStartEmpty" type="button">빈 클라우드로 시작</button>`,
  );
  return new Promise((resolve) => {
    document.getElementById("cloudMigrate").onclick = () => {
      needsInitialUpload = true;
      resolve(clone(legacyState));
    };
    document.getElementById("cloudStartEmpty").onclick = () => {
      needsInitialUpload = true;
      resolve(emptyState(user));
    };
  });
}

export async function bootstrapCloud({ state, legacyState = null } = {}) {
  stateRef = state;
  ensureShell();
  if (new URLSearchParams(location.search).has("local-preview")) {
    localOnly = true;
    replaceState(stateRef, legacyState || emptyState(null));
    hideGate();
    setSyncStatus("offline", "로컬 미리보기");
    return controller();
  }
  gate("건물 입구와 개인 업무공간을 연결하는 중입니다.");
  await authenticateBuildingAndWorkspace();
  document.getElementById("cloudUser").textContent = buildingUser?.email || buildingUser?.displayName || "Google 계정";
  document.getElementById("cloudSignOut").onclick = async () => {
    const signOutButton = document.getElementById("cloudSignOut");
    if (signOutButton) signOutButton.disabled = true;
    clearDriveAccessToken();
    stopRealtime();
    try {
      if (auth?.currentUser) await signOut(auth);
      await signOutBuilding();
      currentUser = null;
      buildingUser = null;
      workspaceProfile = null;
      document.getElementById("cloudUser").textContent = "";
      setSyncStatus("offline", "로그아웃됨");
      showLoggedOutGateV2();
    } catch (error) {
      if (signOutButton) signOutButton.disabled = false;
      setSyncStatus("error", "로그아웃 실패");
      gate("로그아웃하지 못했습니다.", "", friendlyError(error));
    }
  };
  gate("클라우드 데이터를 불러오는 중입니다.");
  recordMaps = makeRecordMaps();
  const initialLoad = await subscribeRealtime();
  shadowMaps = mapClone(recordMaps);
  if (cloudHasData(recordMaps)) {
    replaceState(stateRef, deserializeState(recordMaps, stateRef.settings || {}));
  } else if (!initialLoad.serverConfirmed) {
    gate("오프라인 캐시에 업무 데이터가 없습니다.", "", "인터넷 연결 후 다시 열어 주세요. 기존 클라우드 데이터는 변경되지 않습니다.");
    throw new Error("Cloud data is unavailable while offline.");
  } else {
    const initial = await chooseInitialState(legacyState, buildingUser || currentUser);
    replaceState(stateRef, initial);
    needsInitialUpload = true;
  }
  hideGate();
  setSyncStatus(navigator.onLine ? "online" : "offline", navigator.onLine ? "동기화 준비" : "오프라인");
  window.addEventListener("online", () => setSyncStatus("online", "온라인"));
  window.addEventListener("offline", () => setSyncStatus("offline", "오프라인 · 변경 대기"));
  return controller();
}

function controller() {
  return {
    get user() { return buildingUser || currentUser; },
    get workspaceUser() { return currentUser; },
    get workspaceKey() { return workspaceProfile?.workspace?.firebaseConfig?.projectId || (localOnly ? "local-preview" : "workspace"); },
    get mode() { return localOnly ? "local" : "cloud"; },
    hasDriveAccess() { return localOnly || hasBuildingDriveToken() || Boolean(driveAccessToken); },
    stableTaskId: stableKeyId,
    activate,
    save,
    importState,
    createImageBlock,
    createFileBlock,
    openDriveFile,
    downloadDriveFile,
    readDriveFile,
    repairLegacyDriveAttachments,
    hydrateImages,
    ensureDriveAccess,
    loadChangeLogs,
    saveTrashEntry,
    listTrashEntries,
    removeTrashEntry,
    saveTemplateVersion,
    listTemplateVersions,
    flush,
  };
}

async function activate({ onRemote } = {}) {
  renderRemote = onRemote || null;
  active = true;
  if (localOnly) return;
  await subscribeRealtime();

  // bootstrapCloud가 로컬 캐시로 먼저 열린 직후 서버 스냅샷이 도착했지만
  // activate() 전에 도착한 경우를 놓치지 않는다. 캐시와 현재 recordMaps가
  // 달라졌을 때만 한 번 최신 서버 상태를 화면에 반영한다.
  if (!needsInitialUpload && cloudHasData(recordMaps) && !recordMapsEqual(recordMaps, shadowMaps)) {
    shadowMaps = mapClone(recordMaps);
    replaceState(stateRef, deserializeState(recordMaps, stateRef.settings || {}));
    renderRemote?.();
  }

  if (needsInitialUpload || queuedState) {
    const snapshot = queuedState || clone(stateRef);
    queuedState = null;
    needsInitialUpload = false;
    await save(snapshot, { reason: "초기 클라우드 데이터 구성" });
  } else {
    setSyncStatus(navigator.onLine ? "online" : "offline", navigator.onLine ? "최신 상태" : "오프라인");
  }
}

function applySnapshotChanges(name, snapshot) {
  if (snapshot.metadata.hasPendingWrites) return false;
  const target = recordMaps[name];
  let changed = false;
  snapshot.docChanges().forEach((change) => {
    if (change.type === "removed") {
      if (target.delete(change.doc.id)) changed = true;
      return;
    }
    const next = withoutSyncFields(change.doc.data());
    if (JSON.stringify(target.get(change.doc.id)) === JSON.stringify(next)) return;
    target.set(change.doc.id, next);
    changed = true;
  });
  if (!snapshot.metadata.fromCache) {
    lastSyncAt = new Date();
    setSyncStatus("online", "최신 상태");
  }
  return changed;
}

function subscribeRealtime() {
  if (coreReadyPromise) return coreReadyPromise;
  setSyncStatus("syncing", "데이터 불러오는 중");
  const firstSnapshot = new Set();
  const serverReady = new Set();
  let settled = false;
  let resolveReady;
  let rejectReady;
  coreReadyPromise = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const resolveWhenReady = () => {
    const serverConfirmed = serverReady.size === DATA_COLLECTIONS.length;
    const firstPassReady = firstSnapshot.size === DATA_COLLECTIONS.length;
    const cachedOffline = firstPassReady && navigator.onLine === false;
    // 재방문 기기에서는 Firestore의 영구 로컬 캐시에 실제 업무 데이터가 있으면
    // 서버 왕복을 기다리지 않고 먼저 화면을 연다. 서버 스냅샷은 기존 listener가
    // 뒤에서 계속 받아 최신 상태로 교체한다. 빈 캐시는 신규 사용자로 오인하지
    // 않도록 온라인일 때 반드시 서버 확인까지 기다린다.
    const cachedOnline = firstPassReady && navigator.onLine !== false && cloudHasData(recordMaps);
    if (settled || (!serverConfirmed && !cachedOffline && !cachedOnline)) return;
    settled = true;
    resolveReady({ serverConfirmed, cacheReady: cachedOffline || cachedOnline });
  };
  for (const name of DATA_COLLECTIONS) {
    // meta에는 필요 시에만 읽는 휴지통/버전 문서도 저장한다. 핵심 listener는
    // 스키마 문서 한 건만 구독해 앱 시작 시 보조 데이터를 읽지 않는다.
    const source = name === "meta"
      ? query(collection(db, name), where(documentId(), "==", "schema"))
      : collection(db, name);
    const off = onSnapshot(source, { includeMetadataChanges: true }, (snapshot) => {
      const changed = applySnapshotChanges(name, snapshot);
      if (!snapshot.metadata.hasPendingWrites) firstSnapshot.add(name);
      if (!snapshot.metadata.hasPendingWrites && !snapshot.metadata.fromCache && !serverReady.has(name)) {
        serverReady.add(name);
      }
      resolveWhenReady();
      if (active && changed) scheduleRemoteApply();
    }, (error) => {
      console.error(`Realtime ${name}`, error);
      setSyncStatus("error", friendlyError(error));
      rejectReady(error);
    });
    unsubscribeAll.push(off);
  }
  return coreReadyPromise;
}

function loadChangeLogs() {
  if (localOnly) return Promise.resolve();
  if (historyReadyPromise) return historyReadyPromise;
  historyListenerStarted = true;
  let resolveReady;
  historyReadyPromise = new Promise((resolve) => { resolveReady = resolve; });
  const source = query(collection(db, "changeLogs"), orderBy("clientTime", "desc"), limit(CHANGE_LOG_LIMIT));
  const off = onSnapshot(source, { includeMetadataChanges: true }, (snapshot) => {
    if (applySnapshotChanges("changeLogs", snapshot) && active) {
      stateRef.changeLogs = [...recordMaps.changeLogs.values()]
        .sort((a, b) => String(b.clientTime || "").localeCompare(String(a.clientTime || "")))
        .slice(0, CHANGE_LOG_LIMIT)
        .map((item) => clone(item));
      scheduleRemoteApply();
    }
    if (!snapshot.metadata.hasPendingWrites && (!snapshot.metadata.fromCache || navigator.onLine === false)) resolveReady();
  }, (error) => {
    historyListenerStarted = false;
    historyReadyPromise = null;
    resolveReady();
    console.error("Realtime changeLogs", error);
    setSyncStatus("error", friendlyError(error));
  });
  unsubscribeAll.push(off);
  return historyReadyPromise;
}

function stage7LocalData() {
  try {
    const value = JSON.parse(localStorage.getItem(STAGE7_LOCAL_KEY) || "null");
    return value && typeof value === "object"
      ? { trash: Array.isArray(value.trash) ? value.trash : [], versions: Array.isArray(value.versions) ? value.versions : [] }
      : { trash: [], versions: [] };
  } catch {
    return { trash: [], versions: [] };
  }
}

function saveStage7LocalData(value) {
  try { localStorage.setItem(STAGE7_LOCAL_KEY, JSON.stringify(value)); } catch {}
}

function stage7MetaId(type, id) {
  return docId(type, id);
}

async function saveTrashEntry(entry) {
  const value = plain({ ...entry, recordType: STAGE7_TRASH_TYPE });
  if (!value.id) throw new Error("휴지통 항목 ID가 없습니다.");
  if (localOnly) {
    const data = stage7LocalData();
    data.trash = [value, ...data.trash.filter((item) => item.id !== value.id)];
    saveStage7LocalData(data);
    return clone(value);
  }
  await setDoc(doc(db, "meta", stage7MetaId("trash", value.id)), { ...value, createdAt: serverTimestamp() });
  return clone(value);
}

async function listTrashEntries() {
  if (localOnly) return stage7LocalData().trash.map((item) => clone(item)).sort((a, b) => String(b.deletedAt || "").localeCompare(String(a.deletedAt || "")));
  const snapshot = await getDocs(query(collection(db, "meta"), where("recordType", "==", STAGE7_TRASH_TYPE)));
  return snapshot.docs
    .map((item) => withoutSyncFields(item.data()))
    .sort((a, b) => String(b.deletedAt || "").localeCompare(String(a.deletedAt || "")));
}

async function removeTrashEntry(id) {
  if (localOnly) {
    const data = stage7LocalData();
    data.trash = data.trash.filter((item) => item.id !== id);
    saveStage7LocalData(data);
    return;
  }
  await deleteDoc(doc(db, "meta", stage7MetaId("trash", id)));
}

async function saveTemplateVersion(templateId, snapshot, metadata = {}) {
  if (!templateId || !snapshot) throw new Error("저장할 업무DB 버전 정보가 없습니다.");
  const clientTime = metadata.clientTime || new Date().toISOString();
  const id = metadata.id || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const value = plain({
    id,
    recordType: STAGE7_VERSION_TYPE,
    versionTemplateId: templateId,
    clientTime,
    reason: metadata.reason || "업무DB 수정 전",
    snapshot,
  });
  if (localOnly) {
    const data = stage7LocalData();
    data.versions = [value, ...data.versions.filter((item) => item.id !== id)]
      .sort((a, b) => String(b.clientTime || "").localeCompare(String(a.clientTime || "")));
    const own = data.versions.filter((item) => item.versionTemplateId === templateId).slice(TEMPLATE_VERSION_LIMIT);
    const remove = new Set(own.map((item) => item.id));
    data.versions = data.versions.filter((item) => !remove.has(item.id));
    saveStage7LocalData(data);
    return clone(value);
  }
  await setDoc(doc(db, "meta", stage7MetaId("template-version", `${templateId}-${id}`)), { ...value, createdAt: serverTimestamp() });
  try {
    const versions = await getDocs(query(collection(db, "meta"), where("versionTemplateId", "==", templateId)));
    const older = versions.docs
      .map((item) => ({ ref: item.ref, data: item.data() }))
      .sort((a, b) => String(b.data.clientTime || "").localeCompare(String(a.data.clientTime || "")))
      .slice(TEMPLATE_VERSION_LIMIT);
    if (older.length) {
      const batch = writeBatch(db);
      older.forEach((item) => batch.delete(item.ref));
      await batch.commit();
    }
  } catch (error) {
    // 버전 본문 저장은 완료됐다. 정리 실패는 다음 저장 때 다시 시도한다.
    console.warn("Template version trim", error);
  }
  return clone(value);
}

async function listTemplateVersions(templateId) {
  if (!templateId) return [];
  if (localOnly) return stage7LocalData().versions
    .filter((item) => item.versionTemplateId === templateId)
    .sort((a, b) => String(b.clientTime || "").localeCompare(String(a.clientTime || "")))
    .slice(0, TEMPLATE_VERSION_LIMIT)
    .map((item) => clone(item));
  const snapshot = await getDocs(query(collection(db, "meta"), where("versionTemplateId", "==", templateId)));
  return snapshot.docs
    .map((item) => withoutSyncFields(item.data()))
    .sort((a, b) => String(b.clientTime || "").localeCompare(String(a.clientTime || "")))
    .slice(0, TEMPLATE_VERSION_LIMIT);
}

function stopRealtime() {
  unsubscribeAll.forEach((off) => off());
  unsubscribeAll = [];
  coreReadyPromise = null;
  historyListenerStarted = false;
  historyReadyPromise = null;
}

function appModalOpenForRemoteApply() {
  // 폼/체크리스트 모달이 열려 있는 동안 state 전체를 원격 스냅샷으로 교체하면
  // 모달 이벤트 핸들러가 들고 있던 task 객체 참조가 끊어진다.
  // 그 상태에서 체크리스트를 연속 클릭하거나 업무를 수정하면 첫 변경만 저장되고
  // 다음 변경이 오래된 객체에 적용되는 경쟁 상태가 생길 수 있으므로,
  // 모달이 닫힐 때까지 원격 UI 반영만 잠시 미룬다. Firestore 수신 자체는 계속된다.
  return Boolean(document.querySelector('#modalRoot .modal'));
}

function scheduleRemoteApply() {
  clearTimeout(remoteApplyTimer);
  remoteApplyTimer = setTimeout(() => {
    if (saving || queuedState || appModalOpenForRemoteApply()) return scheduleRemoteApply();
    shadowMaps = mapClone(recordMaps);
    replaceState(stateRef, deserializeState(recordMaps, stateRef.settings || {}));
    renderRemote?.();
  }, 120);
}

async function save(snapshot, metadata = {}) {
  if (localOnly || !active) {
    queuedState = clone(snapshot);
    return;
  }
  queuedState = clone(snapshot);
  const targetVersion = ++queuedVersion;
  return new Promise((resolve, reject) => {
    queuedResolvers.push({ targetVersion, resolve, reject });
    if (!saving) void flushQueue(metadata);
  });
}

async function flush() {
  if (queuedState && !saving) void flushQueue({ reason: "수동 동기화" });
  while (saving || queuedState) await new Promise((resolve) => setTimeout(resolve, 25));
}

async function flushQueue(metadata = {}) {
  if (saving || !queuedState) return;
  saving = true;
  setSyncStatus("syncing", navigator.onLine ? "저장 중" : "오프라인 저장 중");
  const snapshot = queuedState;
  const snapshotVersion = queuedVersion;
  queuedState = null;
  try {
    await ensureImageUploads(snapshot);
    const nextMaps = serializeState(snapshot);
    const changes = diffMaps(shadowMaps, nextMaps);
    if (changes.length) {
      if (navigator.onLine) {
        try {
          await commitOnlineChunks(changes, nextMaps, metadata);
        } catch (error) {
          if (!["unavailable", "deadline-exceeded", "failed-precondition"].includes(error?.code)) throw error;
          await commitOfflineChunks(changes, nextMaps, metadata);
        }
      } else await commitOfflineChunks(changes, nextMaps, metadata);
      shadowMaps = mapClone(nextMaps);
      for (const name of DATA_COLLECTIONS) recordMaps[name] = new Map(nextMaps[name]);
      lastSyncAt = new Date();
    }
    setSyncStatus(navigator.onLine ? "online" : "offline", navigator.onLine ? "저장됨" : "오프라인 · 전송 대기");
    const done = queuedResolvers.filter(({ targetVersion }) => targetVersion <= snapshotVersion);
    queuedResolvers = queuedResolvers.filter(({ targetVersion }) => targetVersion > snapshotVersion);
    done.forEach(({ resolve }) => resolve());
  } catch (error) {
    console.error("Cloud save", error);
    setSyncStatus("error", friendlyError(error));
    const done = queuedResolvers.filter(({ targetVersion }) => targetVersion <= snapshotVersion);
    queuedResolvers = queuedResolvers.filter(({ targetVersion }) => targetVersion > snapshotVersion);
    done.forEach(({ reject }) => reject(error));
    window.dispatchEvent(new CustomEvent("cloud-sync-error", { detail: friendlyError(error) }));
  } finally {
    saving = false;
    if (queuedState) void flushQueue(metadata);
  }
}

function diffMaps(beforeMaps, afterMaps) {
  const changes = [];
  for (const name of DATA_COLLECTIONS) {
    const before = beforeMaps[name] || new Map();
    const after = afterMaps[name] || new Map();
    for (const [id, next] of after) {
      const previous = before.get(id);
      if (!previous) changes.push({ collection: name, id, type: "create", before: null, after: next, fields: Object.keys(next) });
      else {
        const fields = changedFields(previous, next);
        if (fields.length) changes.push({ collection: name, id, type: "update", before: previous, after: next, fields });
      }
    }
    for (const [id, previous] of before) {
      if (!after.has(id)) changes.push({ collection: name, id, type: "delete", before: previous, after: null, fields: [] });
    }
  }
  return changes;
}

function changedFields(before, after) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  return [...keys].filter((key) => JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key]));
}

function patchFor(change) {
  const patch = {};
  for (const field of change.fields) patch[field] = Object.hasOwn(change.after || {}, field) ? plain(change.after[field]) : deleteField();
  return patch;
}

function changeBundleKey(change, maps) {
  const data = change.after || change.before || {};
  if (change.collection === "tasks") return `task:${change.id}`;
  if (change.collection === "taskLinks") return `task:${data.taskId || change.id}`;
  if (change.collection === "generatedKeys") return `task:${data.taskId || change.id}`;
  if (change.collection === "checklistItems" && data.parentType === "task") return `task:${data.parentId}`;
  if (change.collection === "templates") return `template:${change.id}`;
  if (change.collection === "linkedRules") return `template:${data.rootTemplateId || change.id}`;
  if (["checklistItems", "manualBlocks"].includes(change.collection) && data.parentType === "template") return `template:${data.parentId}`;
  if (["checklistItems", "manualBlocks"].includes(change.collection) && data.parentType === "linkedRule") {
    const rule = maps.linkedRules.get(data.parentId) || shadowMaps.linkedRules.get(data.parentId);
    return `template:${rule?.rootTemplateId || data.parentId}`;
  }
  return `${change.collection}:${change.id}`;
}

function chunkChanges(changes, maps, maxWrites = 320) {
  const bundles = new Map();
  for (const change of changes) {
    const key = changeBundleKey(change, maps);
    if (!bundles.has(key)) bundles.set(key, []);
    bundles.get(key).push(change);
  }
  const chunks = [];
  let current = [];
  for (const bundle of bundles.values()) {
    if (current.length && current.length + bundle.length > maxWrites) {
      chunks.push(current);
      current = [];
    }
    if (bundle.length > maxWrites) {
      for (let index = 0; index < bundle.length; index += maxWrites) chunks.push(bundle.slice(index, index + maxWrites));
    } else current.push(...bundle);
  }
  if (current.length) chunks.push(current);
  return chunks;
}

async function commitOnlineChunks(changes, maps, metadata) {
  const chunks = chunkChanges(changes, maps);
  for (let index = 0; index < chunks.length; index++) {
    await commitTransaction(chunks[index], maps, { ...metadata, reason: chunks.length > 1 ? `${metadata.reason || "데이터 변경"} (${index + 1}/${chunks.length})` : metadata.reason });
  }
}

async function commitOfflineChunks(changes, maps, metadata) {
  const chunks = chunkChanges(changes, maps);
  for (let index = 0; index < chunks.length; index++) {
    await commitOfflineBatch(chunks[index], maps, { ...metadata, reason: chunks.length > 1 ? `${metadata.reason || "데이터 변경"} (${index + 1}/${chunks.length})` : metadata.reason });
  }
}

async function commitTransaction(changes, nextMaps, metadata) {
  const writeChanges = changes.filter((change) => change.collection !== "generatedKeys");
  const generatedCreates = changes.filter((change) => change.collection === "generatedKeys" && change.type === "create");
  await runTransaction(db, async (transaction) => {
    const snapshots = new Map();
    // 수정 충돌과 자동생성 잠금에 필요한 문서만 읽는다. 생성·삭제는 현재 상태를 다시 읽어도 결과가 달라지지 않는다.
    for (const change of [...writeChanges.filter((item) => item.type === "update"), ...generatedCreates]) {
      const ref = doc(db, change.collection, change.id);
      snapshots.set(`${change.collection}/${change.id}`, await transaction.get(ref));
    }
    const skippedTaskIds = new Set();
    for (const lockChange of generatedCreates) {
      const snap = snapshots.get(`generatedKeys/${lockChange.id}`);
      if (snap.exists()) {
        // 다른 탭/기기가 같은 회차를 먼저 확보했다면 문서 ID가 같더라도 다시 쓰지 않는다.
        // 안정적 taskId와 함께 사용해 중복뿐 아니라 완료·수정 상태의 경합 덮어쓰기도 막는다.
        skippedTaskIds.add(lockChange.after.taskId);
      }
    }
    const appliedWriteChanges = [];
    for (const change of writeChanges) {
      if (belongsToSkippedTask(change, skippedTaskIds)) continue;
      if (change.type === "update") {
        const snap = snapshots.get(`${change.collection}/${change.id}`);
        if (snap?.exists()) {
          const remote = snap.data() || {};
          const fields = change.fields.filter((field) => Object.hasOwn(change.after || {}, field)
            ? JSON.stringify(remote[field]) !== JSON.stringify(change.after[field])
            : Object.hasOwn(remote, field));
          if (!fields.length) continue;
          appliedWriteChanges.push({ ...change, fields });
          continue;
        }
      }
      appliedWriteChanges.push(change);
    }
    for (const change of appliedWriteChanges) {
      const ref = doc(db, change.collection, change.id);
      const snap = snapshots.get(`${change.collection}/${change.id}`);
      if (change.type === "delete") {
        transaction.delete(ref);
        continue;
      }
      if (change.type === "create" || !snap?.exists()) {
        transaction.set(ref, { ...plain(change.after), revision: 1, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
      } else {
        transaction.update(ref, { ...patchFor(change), revision: Number(snap.data().revision || 0) + 1, updatedAt: serverTimestamp() });
      }
    }
    for (const change of changes.filter((item) => item.collection === "generatedKeys")) {
      if (change.type !== "create") continue;
      const snap = snapshots.get(`generatedKeys/${change.id}`);
      if (!snap.exists()) transaction.set(doc(db, "generatedKeys", change.id), { ...plain(change.after), createdAt: serverTimestamp() });
    }
    if (appliedWriteChanges.length) {
      const logRef = doc(collection(db, "changeLogs"));
      transaction.set(logRef, makeLog(appliedWriteChanges, metadata));
    }
  });
}

function belongsToSkippedTask(change, taskIds) {
  if (!taskIds.size) return false;
  if (change.collection === "tasks") return taskIds.has(change.id);
  return taskIds.has(change.after?.parentId) || taskIds.has(change.before?.parentId) || taskIds.has(change.after?.taskId) || taskIds.has(change.before?.taskId);
}

async function commitOfflineBatch(changes, nextMaps, metadata) {
  const batch = writeBatch(db);
  const writeChanges = changes.filter((change) => change.collection !== "generatedKeys");
  const allowedChanges = changes.filter((change) => change.collection !== "generatedKeys" || change.type === "create");
  for (const change of allowedChanges) {
    const ref = doc(db, change.collection, change.id);
    if (change.type === "delete") batch.delete(ref);
    else if (change.type === "create") batch.set(ref, { ...plain(change.after), revision: 1, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
    else batch.set(ref, { ...patchFor(change), revision: increment(1), updatedAt: serverTimestamp() }, { merge: true });
  }
  if (writeChanges.length) batch.set(doc(collection(db, "changeLogs")), makeLog(writeChanges, metadata));
  await batch.commit();
}

function makeLog(changes, metadata = {}) {
  const summaries = changes.slice(0, 80).map((change) => ({
    collection: change.collection,
    entity: ENTITY_LABELS[change.collection] || change.collection,
    entityId: change.id,
    action: change.type,
    fields: change.fields.slice(0, 30),
    label: change.after?.name || change.after?.text || change.before?.name || change.before?.text || "",
  }));
  return {
    actorUid: currentUser?.uid || "offline",
    actorEmail: buildingUser?.email || currentUser?.email || "",
    clientTime: new Date().toISOString(),
    serverTime: serverTimestamp(),
    reason: metadata.reason || inferReason(summaries),
    changeCount: changes.length,
    changes: summaries,
    schemaVersion: SCHEMA_VERSION,
  };
}

function inferReason(summaries) {
  const entities = [...new Set(summaries.map((item) => item.entity))];
  return `${entities.slice(0, 3).join(" · ")} 변경`;
}

async function importState(incoming, { replace = false } = {}) {
  if (!incoming?.tasks || !incoming?.templates) throw new Error("올바른 v10 백업 파일이 아닙니다.");
  const next = clone(incoming);
  next.settings ||= {};
  next.settings.holidayApiKey = stateRef.settings?.holidayApiKey || next.settings.holidayApiKey || "";
  if (!replace) {
    const current = clone(stateRef);
    next.tasks = mergeById(current.tasks || [], next.tasks || []);
    next.projects = mergeById(current.projects || [], next.projects || []);
    next.templates = mergeById(current.templates || [], next.templates || []);
    next.holidays = mergeById(current.holidays || [], next.holidays || []);
    next.categories = [...new Set([...(current.categories || []), ...(next.categories || [])])];
    next.owners = [...new Set([...(current.owners || []), ...(next.owners || [])])];
    next.settings = { ...(current.settings || {}), ...(next.settings || {}) };
  }
  next.projects ||= [];
  await ensureImageUploads(next, true);
  replaceState(stateRef, next);
  await save(stateRef, { reason: replace ? "백업 전체 복원" : "v10 백업 병합 가져오기" });
  renderRemote?.();
}

function mergeById(current, incoming) {
  const map = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) map.set(item.id, item);
  return [...map.values()];
}

async function ensureDriveAccess() {
  if (localOnly) return "";
  await ensureBuildingDriveAccess();
  buildingUser = getBuildingUser() || buildingUser;
  const token = getBuildingDriveAccessToken();
  if (!token) throw new Error("Google Drive 권한을 확인하지 못했습니다.");
  return rememberDriveAccessToken(token, buildingUser);
}

async function ensureDriveFolder() {
  if (driveFolderId) return driveFolderId;
  const token = await ensureDriveAccess();
  const marker = appConfig.driveAppMarker || "work-manager-v10";
  const q = `mimeType='application/vnd.google-apps.folder' and trashed=false and appProperties has { key='workManagerApp' and value='${marker.replaceAll("'", "\\'")}' }`;
  const listUrl = new URL("https://www.googleapis.com/drive/v3/files");
  listUrl.searchParams.set("q", q);
  listUrl.searchParams.set("spaces", "drive");
  listUrl.searchParams.set("fields", "files(id,name)");
  const listed = await driveFetch(listUrl, { headers: { Authorization: `Bearer ${token}` } });
  const files = await listed.json();
  if (files.files?.[0]?.id) return (driveFolderId = files.files[0].id);
  const created = await driveFetch("https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: appConfig.driveFolderName || "업무관리시스템_매뉴얼사진",
      mimeType: "application/vnd.google-apps.folder",
      appProperties: { workManagerApp: marker },
    }),
  });
  const folder = await created.json();
  driveFolderId = folder.id;
  return driveFolderId;
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableDriveStatus(status) {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

function isNetworkFetchError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return error instanceof TypeError || message.includes("failed to fetch") || message.includes("networkerror") || message.includes("network request failed");
}

async function currentDriveToken({ forceRefresh = false } = {}) {
  if (forceRefresh) {
    clearDriveAccessToken();
    invalidateBuildingDriveAccessToken?.();
    await ensureBuildingDriveAccess({ forceRefresh: true });
  } else {
    await ensureBuildingDriveAccess();
  }
  buildingUser = getBuildingUser() || buildingUser;
  const token = getBuildingDriveAccessToken();
  if (!token) throw new Error("Google Drive 권한을 확인하지 못했습니다.");
  return rememberDriveAccessToken(token, buildingUser);
}

async function uploadDriveMediaWithRetry(fileId, file, mimeType, { attempts = 3 } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let token = await currentDriveToken();
    try {
      let response = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media&fields=id,name,mimeType,size`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": mimeType },
        body: file,
      });
      if (response.status === 401 && attempt < attempts) {
        token = await currentDriveToken({ forceRefresh: true });
        response = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media&fields=id,name,mimeType,size`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": mimeType },
          body: file,
        });
      }
      if (response.ok) return response;
      if (!isRetryableDriveStatus(response.status) || attempt >= attempts) {
        let message = `Google Drive 업로드 실패 (${response.status})`;
        try {
          const body = await response.json();
          message = body?.error?.message || message;
        } catch {}
        throw new Error(message);
      }
      lastError = new Error(`Google Drive 업로드 일시 오류 (${response.status})`);
    } catch (error) {
      lastError = error;
      if (!isNetworkFetchError(error) || attempt >= attempts) throw error;
    }
    await sleepMs(attempt === 1 ? 450 : 1100);
  }
  throw lastError || new Error("Google Drive 업로드에 실패했습니다.");
}

async function verifyDriveUpload(fileId, expectedSize) {
  const token = await currentDriveToken();
  const response = await driveFetchResponse(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,trashed`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Google Drive 업로드 확인 실패 (${response.status})`);
  const meta = await response.json();
  const uploadedSize = Number(meta?.size || 0);
  if (meta?.trashed) throw new Error("Google Drive 업로드 확인 중 파일이 휴지통 상태입니다.");
  if (Number(expectedSize || 0) > 0 && uploadedSize !== Number(expectedSize)) {
    throw new Error(`Google Drive 업로드 크기 확인 실패 (${uploadedSize}/${Number(expectedSize)} bytes)`);
  }
  return meta;
}

async function cleanupFailedDriveFile(fileId) {
  if (!fileId) return;
  try {
    const token = await currentDriveToken();
    const response = await driveFetchResponse(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok && response.status !== 404) throw new Error(`Google Drive 임시 파일 정리 실패 (${response.status})`);
  } catch (error) {
    console.warn("실패한 Drive 임시 파일 정리 실패", fileId, error);
  }
}

async function createDriveBlock(file, { id, type, kind }) {
  if (!file?.name) throw new Error("첨부할 파일을 확인하지 못했습니다.");
  if (Number(file.size || 0) <= 0) throw new Error("빈 파일은 첨부할 수 없습니다.");
  if (Number(file.size || 0) > MAX_DRIVE_FILE_BYTES) throw new Error("첨부파일은 한 개당 50MB 이하만 업로드할 수 있습니다.");
  const folderId = await ensureDriveFolder();
  const token = await currentDriveToken();
  const mimeType = file.type || "application/octet-stream";
  const uniqueSuffix = Math.random().toString(36).slice(2, 8);
  const driveName = `${new Date().toISOString().replaceAll(":", "-")}_${uniqueSuffix}_${file.name}`;
  const metadataResponse = await driveFetch("https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType,size", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: driveName,
      mimeType,
      parents: [folderId],
      appProperties: { workManagerApp: appConfig.driveAppMarker || "work-manager-v10", kind },
    }),
  });
  const metadata = await metadataResponse.json();
  if (!metadata?.id) throw new Error("Google Drive 임시 파일 ID를 받지 못했습니다.");
  try {
    await uploadDriveMediaWithRetry(metadata.id, file, mimeType, { attempts: 3 });
    const verified = await verifyDriveUpload(metadata.id, Number(file.size || 0));
    const objectUrl = URL.createObjectURL(file);
    const previous = driveObjectUrls.get(metadata.id);
    if (previous) try { URL.revokeObjectURL(previous); } catch {}
    driveObjectUrls.set(metadata.id, objectUrl);
    return {
      id,
      type,
      driveFileId: metadata.id,
      name: file.name,
      mimeType: verified?.mimeType || mimeType,
      size: Number(verified?.size || file.size || 0),
      caption: "",
      ...(type === "image" ? { data: objectUrl } : {}),
    };
  } catch (error) {
    await cleanupFailedDriveFile(metadata.id);
    const message = String(error?.message || error || "");
    if (isNetworkFetchError(error)) {
      throw new Error("Google Drive 전송 중 네트워크 연결이 끊겼습니다. 사진은 저장되지 않았습니다. 잠시 후 다시 첨부해 주세요.");
    }
    throw new Error(message || "Google Drive에 파일을 저장하지 못했습니다.");
  }
}

async function createImageBlock(file, id = `mb-${Date.now().toString(36)}`) {
  if (!file?.type?.startsWith("image/")) throw new Error("이미지 파일만 첨부할 수 있습니다.");
  return createDriveBlock(file, { id, type: "image", kind: "manual-photo" });
}

async function createFileBlock(file, id = `mb-${Date.now().toString(36)}`) {
  return createDriveBlock(file, { id, type: "file", kind: "template-attachment" });
}

async function ensureImageUploads(state, allowPrompt = false) {
  const pending = [];
  for (const template of state.templates || []) {
    for (const block of template.methodBlocks || []) if (block.type === "image" && !block.driveFileId && String(block.data || "").startsWith("data:")) pending.push(block);
    for (const step of template.linkedSteps || []) {
      for (const block of step.methodBlocks || []) if (block.type === "image" && !block.driveFileId && String(block.data || "").startsWith("data:")) pending.push(block);
    }
  }
  if (!pending.length) return;
  if (!driveAccessToken && !allowPrompt) throw new Error("사진을 Google Drive에 저장하려면 Drive 연결 버튼을 먼저 눌러 주세요.");
  await ensureDriveAccess();
  for (const block of pending) {
    const blob = await (await fetch(block.data)).blob();
    const file = new File([blob], block.name || `manual-${Date.now()}.${mimeExtension(blob.type)}`, { type: blob.type || block.mimeType || "image/jpeg" });
    const uploaded = await createImageBlock(file, block.id);
    Object.assign(block, uploaded);
  }
}

function mimeExtension(type) {
  return ({ "image/png": "png", "image/webp": "webp", "image/gif": "gif" }[type] || "jpg");
}

async function hydrateImages(root = document) {
  const images = [...root.querySelectorAll("img[data-drive-file]")];
  for (const image of images) {
    const fileId = image.dataset.driveFile;
    if (!fileId) continue;
    if (driveObjectUrls.has(fileId)) {
      image.src = driveObjectUrls.get(fileId);
      image.classList.remove("drive-image-pending");
      continue;
    }
    const load = async (allowLegacyPrompt = false) => {
      image.classList.add("drive-image-loading");
      try {
        const objectUrl = await getDriveObjectUrl(fileId, { allowLegacyPrompt });
        image.src = objectUrl;
        image.classList.remove("drive-image-pending");
        image.title = "";
      } catch (error) {
        image.title = friendlyError(error);
        image.classList.add("drive-image-pending");
      } finally {
        image.classList.remove("drive-image-loading");
      }
    };
    image.onclick = () => void load(true);
    image.onkeydown = (event) => {
      if (event.key === "Enter" || event.key === " ") void load(true);
    };
    if (driveAccessToken) void load(false);
  }
}

async function getDriveObjectUrl(fileId, { allowLegacyPrompt = false } = {}) {
  if (driveObjectUrls.has(fileId)) return driveObjectUrls.get(fileId);
  const result = await readDriveFileBlob(fileId, { allowLegacyPrompt });
  const objectUrl = URL.createObjectURL(result.blob);
  driveObjectUrls.set(fileId, objectUrl);
  return objectUrl;
}

async function downloadDriveFile(fileId, fileName = "첨부파일") {
  if (!fileId) throw new Error("다운로드할 Drive 파일 정보가 없습니다.");
  const objectUrl = await getDriveObjectUrl(fileId, { allowLegacyPrompt: true });
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = String(fileName || "첨부파일");
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

async function openDriveFile(fileId, fileName = "첨부파일", mimeType = "") {
  if (!fileId) throw new Error("열 Google Drive 파일 정보가 없습니다.");
  const lowerName = String(fileName || "").toLowerCase();
  const previewable = String(mimeType || "").startsWith("image/") || String(mimeType || "").startsWith("text/") || mimeType === "application/pdf" || /\.(pdf|txt|csv)$/.test(lowerName);
  if (!previewable) return downloadDriveFile(fileId, fileName);
  const preview = window.open("", "_blank");
  try {
    const objectUrl = await getDriveObjectUrl(fileId, { allowLegacyPrompt: true });
    if (!preview) return downloadDriveFile(fileId, fileName);
    preview.opener = null;
    preview.location.replace(objectUrl);
  } catch (error) {
    preview?.close();
    throw error;
  }
}

async function repairLegacyDriveAttachments() {
  if (!legacyWorkspaceEligible()) return { scanned: 0, repaired: 0, alreadyAccessible: 0, failed: 0, notNeeded: true };
  if (!stateRef) throw new Error("업무 데이터를 아직 불러오지 못했습니다.");
  await ensureDriveAccess();
  await ensureLegacyDriveAccess();

  const refsByFile = new Map();
  const collect = (item, kind = "file") => {
    const id = String(item?.driveFileId || "");
    if (!id) return;
    if (!refsByFile.has(id)) refsByFile.set(id, []);
    refsByFile.get(id).push({ item, kind });
  };
  for (const template of stateRef.templates || []) {
    for (const block of template.methodBlocks || []) collect(block, block?.type === "image" ? "image" : "file");
    for (const file of template.attachments || []) collect(file, "file");
    for (const step of template.linkedSteps || []) {
      for (const block of step.methodBlocks || []) collect(block, block?.type === "image" ? "image" : "file");
    }
  }

  let repaired = 0, alreadyAccessible = 0, failed = 0;
  const currentToken = await ensureDriveAccess();
  const legacyToken = await ensureLegacyDriveAccess();
  for (const [oldId, refs] of refsByFile) {
    try {
      const currentMeta = await driveFileResponse(oldId, currentToken, "id,name,mimeType,size");
      if (currentMeta.ok) {
        alreadyAccessible++;
        continue;
      }
      if (![403, 404].includes(currentMeta.status)) {
        failed++;
        continue;
      }
      const legacyMetaResponse = await driveFileResponse(oldId, legacyToken, "id,name,mimeType,size");
      if (!legacyMetaResponse.ok) {
        failed++;
        continue;
      }
      const legacyMeta = await legacyMetaResponse.json();
      const legacyDataResponse = await driveFileResponse(oldId, legacyToken);
      if (!legacyDataResponse.ok) {
        failed++;
        continue;
      }
      const blob = await legacyDataResponse.blob();
      const first = refs[0]?.item || {};
      const fileName = String(first.name || legacyMeta.name || `legacy-${oldId}`);
      const mimeType = String(first.mimeType || legacyMeta.mimeType || blob.type || "application/octet-stream");
      const file = new File([blob], fileName, { type: mimeType });
      const kind = refs.some((ref) => ref.kind === "image") ? "manual-photo" : "template-attachment";
      const uploaded = await createDriveBlock(file, { id: String(first.id || `legacy-${Date.now()}`), type: refs.some((ref) => ref.kind === "image") ? "image" : "file", kind });
      for (const ref of refs) {
        ref.item.driveFileId = uploaded.driveFileId;
        ref.item.mimeType = ref.item.mimeType || uploaded.mimeType;
        ref.item.size = Number(ref.item.size || uploaded.size || 0);
        ref.item.name = ref.item.name || uploaded.name;
        if (ref.kind === "image") delete ref.item.data;
        ref.item.localFileMissing = false;
      }
      repaired++;
    } catch (error) {
      console.warn("이전 Cloud 첨부 복구 실패", oldId, error);
      failed++;
    }
  }
  if (repaired) await save(stateRef, { reason: "이전 Cloud 첨부자료 Drive 연결 복구" });
  return { scanned: refsByFile.size, repaired, alreadyAccessible, failed, notNeeded: false };
}

async function driveFetchResponse(url, options = {}, { retryAuth = true } = {}) {
  let requestOptions = { ...options, headers: { ...(options.headers || {}) } };
  let response = await fetch(url, requestOptions);
  if (response.status === 401 && retryAuth && !localOnly) {
    clearDriveAccessToken();
    invalidateBuildingDriveAccessToken?.();
    const freshToken = await currentDriveToken({ forceRefresh: true });
    requestOptions = {
      ...requestOptions,
      headers: { ...requestOptions.headers, Authorization: `Bearer ${freshToken}` },
    };
    response = await fetch(url, requestOptions);
  }
  if (response.status === 401) {
    clearDriveAccessToken();
    invalidateBuildingDriveAccessToken?.();
  }
  return response;
}

async function driveFetch(url, options = {}) {
  const response = await driveFetchResponse(url, options);
  if (!response.ok) {
    let message = `Google Drive ${response.status}`;
    try {
      const body = await response.json();
      message = body?.error?.message || message;
    } catch {}
    throw new Error(message);
  }
  return response;
}

window.addEventListener("beforeunload", stopRealtime);
