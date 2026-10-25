import "./backup-files.js?v=phase7";
import "./attachment-store.js?v=phase7";
import "./workspace-rules-ui.js?v=phase6f-rules-v1";
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
  getDocFromServer,
  getDocsFromServer,
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
import { firebaseConfig as legacyFirebaseConfig, appConfig } from "./firebase-config.js?v=20261021-privacy-clean-v1";
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
} from "./workspace-profile.js?v=phase6f-rules-v1";

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
let projectSaveInFlight = false;
let backupImporting = false;
let backupRecoveryRequired = false;
let queuedState = null;
let queuedResolvers = [];
let commandSaveGuard = null; // Scoped ordinary edit; retained until cache acknowledgement/review.
let queuedVersion = 0;
let unsubscribeAll = [];
let coreReadyPromise = null;
let historyListenerStarted = false;
let historyReadyPromise = null;
let remoteApplyTimer = 0;
let renderRemote = null;
let localOnly = false;
let needsInitialUpload = false;
let recurrenceReady = false;
let recurrenceRecoveryRequired = false;
let recurrenceLocalEditsPending = false;
let queuedWorkspace = null;
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
let legacyDriveAccessTokenExpiresAt = 0;
let legacyDriveAccessTokenUid = "";
let legacyDriveAccessTokenEmail = "";
let legacyDriveAuth = null;

function rememberDriveAccessToken(token, user = getBuildingUser()) {
  // workspace-profile owns the sole current Drive token cache and its expiry.
  try { sessionStorage.removeItem(DRIVE_TOKEN_SESSION_KEY); } catch {}
  const current = getBuildingUser();
  if (!current?.uid || user?.uid !== current.uid || !token || token !== getBuildingDriveAccessToken()) {
    clearDriveAccessToken();
    return "";
  }
  driveAccessToken = token;
  driveAccessTokenUid = current.uid;
  return token;
}

function clearDriveAccessToken() {
  for(const url of driveObjectUrls.values())URL.revokeObjectURL(url);
  driveObjectUrls.clear();
  driveAccessToken = "";
  driveAccessTokenExpiresAt = 0;
  driveAccessTokenUid = "";
  driveFolderId = "";
  try { sessionStorage.removeItem(DRIVE_TOKEN_SESSION_KEY); } catch {}
}

function restoreDriveAccessToken(user = getBuildingUser()) {
  return rememberDriveAccessToken(getBuildingDriveAccessToken(), user);
}

function legacyWorkspaceEligible() {
  const currentProject = workspaceProfile?.workspace?.firebaseConfig?.projectId || "";
  return Boolean(currentProject && legacyFirebaseConfig?.projectId && currentProject === legacyFirebaseConfig.projectId);
}

function clearLegacyDriveToken() {
  clearLegacyDriveToken.epoch = (clearLegacyDriveToken.epoch || 0) + 1;
  legacyDriveAccessToken = "";
  legacyDriveAccessTokenExpiresAt = 0;
  legacyDriveAccessTokenUid = "";
  legacyDriveAccessTokenEmail = "";
  try { sessionStorage.removeItem(LEGACY_DRIVE_TOKEN_SESSION_KEY); } catch {}
}

function rememberLegacyDriveToken(token) {
  const user = getBuildingUser();
  if (typeof token !== "string" || !token || !user?.uid || !user.email) { clearLegacyDriveToken(); return ""; }
  legacyDriveAccessToken = token;
  rememberLegacyDriveToken.workspace = workspaceProfile?.workspace?.firebaseConfig?.projectId || "";
  legacyDriveAccessTokenUid = user.uid;
  legacyDriveAccessTokenEmail = user.email.trim().toLowerCase();
  legacyDriveAccessTokenExpiresAt = Date.now() + LEGACY_DRIVE_TOKEN_LIFETIME_MS;
  try {
    sessionStorage.setItem(LEGACY_DRIVE_TOKEN_SESSION_KEY, JSON.stringify({
      token, uid: legacyDriveAccessTokenUid, email: legacyDriveAccessTokenEmail, workspace: rememberLegacyDriveToken.workspace,
      expiresAt: legacyDriveAccessTokenExpiresAt,
    }));
  } catch {}
  return token;
}

function restoreLegacyDriveToken() {
  const user = getBuildingUser(), now = Date.now();
  const email = String(user?.email || "").trim().toLowerCase();
  if (!user?.uid || !email) { clearLegacyDriveToken(); return ""; }
  if (legacyDriveAccessToken) {
    if (rememberLegacyDriveToken.workspace === (workspaceProfile?.workspace?.firebaseConfig?.projectId || "") && legacyDriveAccessTokenUid === user.uid && legacyDriveAccessTokenEmail === email
      && Number.isFinite(legacyDriveAccessTokenExpiresAt) && legacyDriveAccessTokenExpiresAt > now) return legacyDriveAccessToken;
    clearLegacyDriveToken();
    return "";
  }
  try {
    const saved = JSON.parse(sessionStorage.getItem(LEGACY_DRIVE_TOKEN_SESSION_KEY) || "null");
    if ((saved?.workspace || "") !== (workspaceProfile?.workspace?.firebaseConfig?.projectId || "") || typeof saved?.token !== "string" || !saved.token || saved.uid !== user.uid || saved.email !== email
      || !Number.isFinite(saved.expiresAt) || saved.expiresAt <= now || saved.expiresAt > now + LEGACY_DRIVE_TOKEN_LIFETIME_MS) {
      clearLegacyDriveToken();
      return "";
    }
    rememberLegacyDriveToken.workspace = saved.workspace || "";
    legacyDriveAccessToken = saved.token;
    legacyDriveAccessTokenUid = saved.uid;
    legacyDriveAccessTokenEmail = saved.email;
    legacyDriveAccessTokenExpiresAt = saved.expiresAt;
  } catch { clearLegacyDriveToken(); return ""; }
  return legacyDriveAccessToken;
}

async function ensureLegacyDriveAccess() {
  if (ensureLegacyDriveAccess.pending) return ensureLegacyDriveAccess.pending;
  const pending = authorizeLegacyDriveOnce();
  ensureLegacyDriveAccess.pending = pending;
  try { return await pending; } finally { if (ensureLegacyDriveAccess.pending === pending) ensureLegacyDriveAccess.pending = null; }
}
async function authorizeLegacyDriveOnce() {
  const restored = restoreLegacyDriveToken();
  if (restored) return restored;
  if (!legacyWorkspaceEligible()) throw new Error("이 업무공간에는 이전 Cloud Drive 복구가 필요하지 않습니다.");
  const epoch = clearLegacyDriveToken.epoch;
  const workspace = workspaceProfile?.workspace?.firebaseConfig?.projectId;
  const originalUid = getBuildingUser()?.uid;
  const appName = "work-manager-legacy-drive-v122";
  let legacyApp = getApps().find((candidate) => candidate.name === appName);
  if (!legacyApp) legacyApp = initializeApp(legacyFirebaseConfig, appName);
  legacyDriveAuth = getAuth(legacyApp);
  await setPersistence(legacyDriveAuth, browserLocalPersistence);
  const provider = new GoogleAuthProvider();
  provider.addScope("https://www.googleapis.com/auth/drive.file");
  const expectedUser = getBuildingUser();
  const hint = String(expectedUser?.email || "").trim();
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
  if (epoch !== clearLegacyDriveToken.epoch || workspace !== workspaceProfile?.workspace?.firebaseConfig?.projectId || originalUid !== getBuildingUser()?.uid || !expectedUser?.uid || getBuildingUser()?.uid !== expectedUser.uid
    || String(result.user?.email || "").toLowerCase() !== hint.toLowerCase()) {
    clearLegacyDriveToken();
    if (legacyDriveAuth.currentUser) await signOut(legacyDriveAuth);
    throw new Error("다른 Google 계정을 선택했습니다. 기존 계정으로 다시 승인하세요.");
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
  const workspace=recurrenceWorkspace();
  if (!fileId) throw new Error("Drive 파일 ID가 없습니다.");
  let currentToken = await ensureDriveAccess();
  assertRecurrenceWorkspace(workspace);
  let response = await driveFileResponse(fileId, currentToken);
  assertRecurrenceWorkspace(workspace);
  if (response.status === 401) {
    currentToken = await currentDriveToken({ forceRefresh: true });
    assertRecurrenceWorkspace(workspace);
    response = await driveFileResponse(fileId, currentToken);
    assertRecurrenceWorkspace(workspace);
  }
  if (response.ok) {const blob=await window.WMBackupFiles.read(response);assertRecurrenceWorkspace(workspace);return {blob,source:"current"};}
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
  assertRecurrenceWorkspace(workspace);
  response = await driveFileResponse(fileId, legacyToken);
  assertRecurrenceWorkspace(workspace);
  if (!response.ok) throw new Error(`이전 Cloud Google Drive 원본 읽기 실패 (${response.status})`);
  const blob=await window.WMBackupFiles.read(response);assertRecurrenceWorkspace(workspace);return {blob,source:"legacy"};
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
    maps.tasks.set(task.id, plain({ ...taskFields, ...(Array.isArray(taskFields.projectResources) ? { projectResources: taskFields.projectResources.map(cleanAttachmentMetadata) } : {}), id: task.id }));
    checklist.forEach((item, order) => {
      const itemId = item.id || docId("check", task.id, order, item.text || "");
      maps.checklistItems.set(docId("task", task.id, itemId),
        plain({ id: itemId, parentType: "task", parentId: task.id, order, text: item.text || "", owner: item.owner || "", dueDate: item.dueDate || "", done: Boolean(item.done), ...(item.googleTaskId ? { googleTaskId: item.googleTaskId } : {}) }));
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
        plain({ parentType: "template", parentId: template.id, order, text: typeof text === "object" && text !== null ? String(text.text || "") : String(text || ""), done: false }));
    });
    linkedSteps.forEach((step, order) => {
      const { checklist: stepChecks = [], methodBlocks: stepBlocks = [], ...stepFields } = step;
      const ruleId = docId(template.id, order);
      maps.linkedRules.set(ruleId, plain({ id: ruleId, rootTemplateId: template.id, order, ...stepFields }));
      stepChecks.forEach((text, checkOrder) => {
        maps.checklistItems.set(docId("linkedRule", ruleId, checkOrder),
          plain({ parentType: "linkedRule", parentId: ruleId, order: checkOrder, text: typeof text === "object" && text !== null ? String(text.text || "") : String(text || ""), done: false }));
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
    checklist: (checklistByParent.get(`task:${task.id}`) || []).map((item) => ({ id: item.id, text: item.text, owner: item.owner || "", dueDate: item.dueDate || "", done: Boolean(item.done), ...(item.googleTaskId ? { googleTaskId: item.googleTaskId } : {}) })),
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
      <button class="cloud-signout" id="workspaceRulesGuide" type="button" disabled>보안 규칙 안내</button>
      <button class="cloud-signout" id="cloudSignOut" type="button">로그아웃</button>
      <a href="./privacy.html" target="_blank" rel="noopener" style="display:block;margin-top:7px;font-size:11px;color:#718078;text-decoration:none">개인정보처리방침</a>
    </div>`,
  );
}

function installWorkspaceRulesGuide() {
  const rulesButton = document.getElementById("workspaceRulesGuide");
  rulesButton.disabled = false;
  rulesButton.onclick = () => window.WMWorkspaceRulesUI.open({uid:currentUser?.uid,projectId:workspaceProfile?.workspace?.firebaseConfig?.projectId});
  return rulesButton;
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
      "본인 계정으로 로그인하면 개인 업무공간을 불러옵니다.",
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
      "이 업무관리시스템은 소유자 계정으로만 이용할 수 있습니다.",
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
      workspaceProfile = cachedConnection.profile;
      buildingUser = getBuildingUser() || buildingUser;
      return cachedConnection;
    } catch (error) {
      console.warn("기기 캐시 업무공간 연결에 실패해 Drive에서 다시 확인합니다.");
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
      `<button class="cloud-secondary-btn" id="cloudWorkspaceLogout" type="button">로그아웃 후 다시 로그인</button>`,
      "기존 개인 업무공간 연결정보가 발견되지 않았습니다. 보관한 설정 백업을 확인해 주세요. 신규 사용자 등록 페이지는 제공하지 않습니다.",
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
  workspaceProfile = connection.profile;
  assertRecurrenceWorkspace(workspace);
  if (googleUid !== getBuildingUser()?.uid) throw new Error("Drive 인증 중 계정이 변경되었습니다.");
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
  if (code.includes("invalid-credential") || code.includes("invalid-login-credentials")) return "개인 업무공간 자동 로그인 정보가 올바르지 않습니다. 업무공간 연결정보를 확인해 주세요.";
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
      console.warn(`Firebase Auth persistence unavailable: ${label}`);
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
  // 개인 전용 운영판: ?local-preview 인증 우회 경로를 제거했습니다.
  gate("건물 입구와 개인 업무공간을 연결하는 중입니다.");
  await authenticateBuildingAndWorkspace();
  const recovery = await window.__wmRecoveryReady;
  if (!recovery) throw new Error("복구 기록 모듈을 불러오지 못했습니다. 새로고침 후 확인하세요.");
  await recovery.initialize(`cloud:${workspaceProfile?.workspace?.firebaseConfig?.projectId}:${currentUser?.uid}:${buildingUser?.uid||currentUser?.uid}`);
  document.getElementById("cloudUser").textContent = buildingUser?.email || buildingUser?.displayName || "Google 계정";
  const rulesButton = installWorkspaceRulesGuide();
  document.getElementById("cloudSignOut").onclick = async () => {
    document.getElementById("workspace-rules-guide")?.remove();
    rulesButton.disabled = true;
    const signOutButton = document.getElementById("cloudSignOut");
    if (signOutButton) signOutButton.disabled = true;
    disposeAttachmentRecoveryUI();
    window.WMRecovery?.suspend();
    clearDriveAccessToken();
    stopRealtime();
    try {
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
  } else if (window.WMRecovery?.blocksWrites) {
    replaceState(stateRef, emptyState(currentUser));
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
  window.addEventListener("online", () => setSyncStatus("online", commandSaveGuard ? "온라인 · 저장 결과 확인 필요" : "온라인"));
  window.addEventListener("offline", () => setSyncStatus("offline", "오프라인 · 변경 대기"));
  initializeAttachmentRecoveryUI();
  return controller();
}

let attachmentUiGeneration = 0;
function disposeAttachmentRecoveryUI() {
  attachmentUiGeneration++;
  document.getElementById('attachmentRecoveryButton')?.remove();
  document.getElementById('attachmentRecoveryDialog')?.remove();
  window.removeEventListener('work-manager-credentials-cleared', disposeAttachmentRecoveryUI);
}
function initializeAttachmentRecoveryUI() {
  disposeAttachmentRecoveryUI();
  const anchor=document.getElementById('cloudUser');
  if(!anchor || !currentUser || !buildingUser)return;
  const generation=attachmentUiGeneration;
  const scope=()=>`${recurrenceWorkspace()}/${buildingUser?.uid||''}`;
  const bound=scope();
  const current=()=>generation===attachmentUiGeneration && Boolean(currentUser) && Boolean(buildingUser) && scope()===bound;
  const button=document.createElement('button');button.id='attachmentRecoveryButton';button.textContent='첨부 저장 확인';
  button.onclick=async()=>{
    if(button.disabled || !current())return;
    button.disabled=true;
    try {
      const rows=await getAttachmentStore().diagnose(stateRef);
      if(!current())return;
      const report=rows.map(r=>({fileId:r.fileId,name:r.name,phase:r.phase,referenced:r.referenced,needsReview:r.needsReview}));
      document.getElementById('attachmentRecoveryDialog')?.remove();
      const dialog=document.createElement('dialog'),text=document.createElement('pre'),close=document.createElement('button');
      dialog.id='attachmentRecoveryDialog';
      text.textContent='업로드와 업무 저장은 별개입니다. 미확정 파일은 자동 삭제하지 않습니다. 같은 계정에서 원본 파일을 다시 선택하면 기존 ID로 확인·재시도합니다. 참조 있음은 현재 화면 기준이며 서버 확정을 뜻하지 않습니다.\n'+JSON.stringify(report,null,2);
      close.textContent='닫기';close.onclick=()=>{dialog.close();dialog.remove();};dialog.append(text,close);document.body.append(dialog);dialog.showModal();
    }catch(error){if(current())alert('첨부 기록 확인 실패: '+error.message);}
    finally{button.disabled=false;}
  };
  anchor.after(button);
  window.addEventListener('work-manager-credentials-cleared', disposeAttachmentRecoveryUI);
}

function controller() {
  return {
    get user() { return buildingUser || currentUser; },
    get workspaceUser() { return currentUser; },
    get workspaceKey() { return workspaceProfile?.workspace?.firebaseConfig?.projectId || (localOnly ? "local-preview" : "workspace"); },
    get mode() { return localOnly ? "local" : "cloud"; },
    hasDriveAccess() { return localOnly || hasBuildingDriveToken(); },
    get recurrenceContext() {
      return { scope: workspaceProfile?.workspace?.firebaseConfig?.projectId || '',
        ready: recurrenceReady && active && Boolean(currentUser) && !needsInitialUpload,
        locks: [...recordMaps.generatedKeys.values()].map(clone) };
    },
    attachmentDiagnostics:()=>getAttachmentStore().diagnose(stateRef),
    stableTaskId: stableKeyId,
    activate,
    save,
    acknowledgeTaskCommand(operationId) { if (commandSaveGuard?.operationId === operationId && commandSaveGuard.confirmed) commandSaveGuard = null; },
    importState,
    previewImport,
    get backupWriteBlocked() { return backupImporting || backupRecoveryRequired; },
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
  recurrenceReady = false;
  renderRemote = onRemote || null;
  active = true;
  if (localOnly) return;
  await subscribeRealtime();

  // bootstrapCloud가 로컬 캐시로 먼저 열린 직후 서버 스냅샷이 도착했지만
  // activate() 전에 도착한 경우를 놓치지 않는다. 캐시와 현재 recordMaps가
  // 달라졌을 때만 한 번 최신 서버 상태를 화면에 반영한다.
  if (!window.WMRecovery?.blocksWrites && !needsInitialUpload && cloudHasData(recordMaps) && !recordMapsEqual(recordMaps, shadowMaps)) {
    shadowMaps = mapClone(recordMaps);
    replaceState(stateRef, deserializeState(recordMaps, stateRef.settings || {}));
    renderRemote?.();
  }

  if (window.WMRecovery?.blocksWrites) {setSyncStatus("error","미확정 저장 복구 확인 필요");return;}
  if (needsInitialUpload || queuedState) {
    const snapshot = queuedState || clone(stateRef);
    queuedState = null;
    needsInitialUpload = false;
    await save(snapshot, { reason: "초기 클라우드 데이터 구성" });
  } else {
    setSyncStatus(navigator.onLine ? "online" : "offline", navigator.onLine ? "최신 상태" : "오프라인");
  }
  recurrenceReady = true;
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
    if (!commandSaveGuard && !window.WMSaveCommands?.blocksRemoteApply) setSyncStatus("online", "최신 상태");
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
    if (window.WMRecovery?.blocksRemoteApply || commandSaveGuard || recurrenceRecoveryRequired || recurrenceLocalEditsPending || window.WMSaveCommands?.blocksRemoteApply) return;
    if (saving || queuedState || backupImporting || backupRecoveryRequired || appModalOpenForRemoteApply()) return scheduleRemoteApply();
    shadowMaps = mapClone(recordMaps);
    replaceState(stateRef, deserializeState(recordMaps, stateRef.settings || {}));
    renderRemote?.();
  }, 120);
}

async function save(snapshot, metadata = {}) {
  if (typeof document !== 'undefined' && document.querySelector('meta[name="wm-release"]')?.content !== 'predeploy1') {
    const error=Object.assign(new Error('화면과 저장 코드 버전이 다릅니다. 입력을 보관하고 모든 탭에서 새로고침한 뒤 다시 저장해 주세요.'),{code:'client/update-required',definiteFailure:true});
    window.dispatchEvent(new CustomEvent('cloud-sync-error',{detail:error.message}));
    throw error;
  }
  if (metadata.taskCommand && !localOnly) return saveTaskCommand(metadata.taskCommand, metadata.reviewMode, metadata.journalUncertain);
  if (projectSaveInFlight || metadata.projectSave && (saving || queuedState)) throw Object.assign(new Error('다른 저장이 진행 중입니다. 프로젝트 입력을 유지하고 완료 후 다시 확인해 주세요.'),{code:'project/save-busy',definiteFailure:true});
  if (metadata.projectSave && !localOnly && (!active || navigator.onLine === false)) throw Object.assign(new Error('프로젝트 저장은 온라인 서버 확인 후 가능합니다. 입력을 유지하고 연결 상태를 확인해 주세요.'),{code:'project/online-required'});
  if (window.WMRecovery?.blocksWrites || commandSaveGuard) throw new Error("일반 업무 저장 확인이 필요합니다. 다른 저장으로 미확정 입력을 전송하지 않습니다.");
  if (recurrenceRecoveryRequired) throw new Error("반복 저장 복구 확인이 필요합니다. 새로고침 후 서버 상태를 확인해 주세요.");
  if (backupImporting || backupRecoveryRequired) throw new Error("백업 저장 또는 복구 확인 중에는 다른 저장을 중단합니다. 새로고침 후 서버 상태를 확인해 주세요.");
  if (localOnly || !active) {
    queuedState = clone(snapshot);
    return;
  }
  queuedState = clone(snapshot);
  queuedWorkspace = recurrenceWorkspace();
  const targetVersion = ++queuedVersion;
  return new Promise((resolve, reject) => {
    queuedResolvers.push({ targetVersion, operationId: metadata.operationId, resolve, reject });
    if (!saving) void flushQueue(metadata);
  });
}


// Only the 6-A ordinary edit adapter uses this port. No snapshot queue, uploads or offline batch.
async function saveTaskCommand(request, reviewMode, journalUncertain = false) {
  const C = window.WMSaveCommand, F = window.WMTaskSaveConflict;
  const change = request.changeSet.changes.find(c => c.collection === "tasks" && c.action === "update");
  if (request.type !== "task.update" || !change || request.changeSet.taskIds.length !== 1) throw new Error("일반 업무 수정 명령만 지원합니다.");
  const workspace = recurrenceWorkspace(), serverDb = db;
  if (request.context !== `cloud:${workspaceProfile?.workspace?.firebaseConfig?.projectId}:${currentUser?.uid}`) throw Object.assign(new Error("업무공간이 변경되었습니다."), {code:"conflict"});
  if (!active || backupImporting || backupRecoveryRequired || recurrenceRecoveryRequired || saving || queuedState) throw Object.assign(new Error("다른 저장 또는 복구가 진행 중입니다. 입력을 보존하고 다시 확인하세요."), {code:"conflict"});
  if (commandSaveGuard && (commandSaveGuard.operationId !== request.operationId || commandSaveGuard.signature !== C.canonical(request))) throw Object.assign(new Error("이전 명령의 서버 확인이 필요합니다."), {code:"conflict"});
  if (commandSaveGuard?.running) throw Object.assign(new Error("서버 확인 중입니다."), {code:"conflict"});
  commandSaveGuard ||= {operationId:request.operationId, signature:C.canonical(request), workspace, uncertain:journalUncertain};
  assertRecurrenceWorkspace(commandSaveGuard.workspace);
  if (commandSaveGuard.uncertain && reviewMode !== "verify") throw Object.assign(new Error("응답 불명확: 읽기 전용 서버 확인이 먼저 필요합니다."), {recoveryRequired:true});
  if (!navigator.onLine) {setSyncStatus("offline","입력 보관 · 서버 확인 대기");return {operationId:request.operationId,persistence:"pending-sync",recoveryRequired:commandSaveGuard.uncertain,message:"오프라인 입력 보관 · 서버 검사 미실행"};}
  commandSaveGuard.running = true;
  setSyncStatus("syncing", reviewMode === "verify" ? "서버 반영 확인 중" : "업무 충돌 검사 중");
  let transactionStarted = false;
  try {
    const baseMaps = serializeState({tasks:[change.before]});
    const desiredMaps = serializeState({tasks:[change.after]});
    const recordAtStart = clone(recordMaps.tasks.get(change.id) || null);
    const checksAtStart = C.canonical([...recordMaps.checklistItems]);
    const inspectAndCommit = async () => {
      // Membership discovery is server-only. Task revision is the participating-writer fence.
      const head = await getDocFromServer(doc(serverDb,"tasks",change.id));
      const discovered = await getDocsFromServer(query(collection(serverDb,"checklistItems"),where("parentType","==","task"),where("parentId","==",change.id)));
      const checkIds = [...new Set([...baseMaps.checklistItems.keys(),...desiredMaps.checklistItems.keys(),...discovered.docs.map(d=>d.id)])];
      if (checkIds.length > 300) throw Object.assign(new Error("체크 항목 묶음이 안전한 트랜잭션 한도를 초과했습니다."),{code:"validation",definiteFailure:true});
      assertRecurrenceWorkspace(workspace);
      transactionStarted = true;
      return runRulesAwareTransaction(serverDb, async transaction => {
        assertRecurrenceWorkspace(workspace);
        const taskRef = doc(serverDb,"tasks",change.id), taskSnap = await transaction.get(taskRef);
        const linkSnap = await transaction.get(doc(serverDb,"taskLinks",change.id));
        const maps = makeRecordMaps();
        if (taskSnap.exists()) maps.tasks.set(change.id,withoutSyncFields(taskSnap.data()));
        if (linkSnap.exists()) maps.taskLinks.set(change.id,withoutSyncFields(linkSnap.data()));
        for (const id of checkIds) {const snap=await transaction.get(doc(serverDb,"checklistItems",id));if(snap.exists())maps.checklistItems.set(id,withoutSyncFields(snap.data()));}
        const remote = deserializeState(maps).tasks[0] || null;
        // Compare normalized checklist fields as stored in schema11, not UI-only defaults.
        const base = deserializeState(baseMaps).tasks[0], desired = deserializeState(desiredMaps).tasks[0];
        if(request.journalHistoryHash){
          if(await window.WMOperationJournal.digest(remote?.completionHistory)!==request.journalHistoryHash)throw Object.assign(new Error("완료 이력이 변경되었습니다."),{code:"conflict",definiteFailure:true,conflicts:[{field:"completionHistory",reason:"보관한 완료 이력 해시와 서버 기록이 다릅니다."}]});
          if(remote&&Object.hasOwn(remote,'completionHistory')){base.completionHistory=remote.completionHistory;desired.completionHistory=remote.completionHistory;}
        }
        const comparison = F.compare(base,desired,remote);
        const checklistChanged = comparison.fields.includes("checklist");
        if ((taskSnap.exists()?taskSnap.data().revision:null) !== (head.exists()?head.data().revision:null)) throw Object.assign(new Error("목록 조회 중 서버 revision이 변경되었습니다."),{code:"command-membership-retry",definiteFailure:true,conflicts:[{field:"checklist",reason:"목록과 업무 revision 재확인이 필요합니다.",base:base.checklist,local:desired.checklist,server:remote?.checklist}]});
        if (comparison.conflicts.length) throw Object.assign(new Error("서버 변경과 충돌했습니다. 입력을 보존하고 차이를 확인하세요."),{code:"conflict",conflicts:comparison.conflicts,serverTask:remote,definiteFailure:true});
        if (comparison.alreadyApplied) return {confirmed:true,serverTask:remote,maps,revision:taskSnap.data()?.revision,alreadyApplied:true};
        if (reviewMode === "verify") return {confirmed:false,serverTask:remote,revision:taskSnap.data()?.revision};
        const mergedMaps=serializeState({tasks:[comparison.merged]});
        if(!checklistChanged)mergedMaps.checklistItems=new Map(maps.checklistItems);
        else for(const [id,value] of mergedMaps.checklistItems)if(maps.checklistItems.has(id))mergedMaps.checklistItems.set(id,{...maps.checklistItems.get(id),...value});
        const writes=diffMaps(maps,mergedMaps).filter(c=>c.collection==="tasks"||checklistChanged&&c.collection==="checklistItems");
        assertRecurrenceWorkspace(workspace);
        // A checklist-only edit also updates the task revision, fencing other participating writers.
        if (writes.length) {
          const taskChange=writes.find(c=>c.collection==="tasks");
          transaction.update(taskRef,{...(taskChange?patchFor(taskChange):{}),revision:Number(taskSnap.data().revision||0)+1,updatedAt:serverTimestamp()});
          for(const c of writes.filter(c=>c.collection==="checklistItems")){
            const ref=doc(serverDb,c.collection,c.id);
            if(c.type==="delete")transaction.delete(ref);
            else if(c.type==="create")transaction.set(ref,{...c.after,revision:1,updatedAt:serverTimestamp()});
            else transaction.update(ref,{...patchFor(c),updatedAt:serverTimestamp()});
          }
          transaction.set(doc(collection(serverDb,"changeLogs")),makeLog(writes,{reason:"일반 업무 충돌 검사 저장"}));
        }
        return {confirmed:true,serverTask:comparison.merged,maps:mergedMaps,revision:Number(taskSnap.data()?.revision||0)+(writes.length?1:0),alreadyApplied:comparison.alreadyApplied};
      });
    };
    let result;
    for(let attempt=0;attempt<3;attempt++){
      try{result=await inspectAndCommit();break;}
      catch(error){if(error.code!=="command-membership-retry")throw error;if(attempt===2){error.code="conflict";throw error;}}
    }
    assertRecurrenceWorkspace(workspace);
    if (!result.confirmed) {setSyncStatus("online","서버 미반영 · 입력 보관 중");return {operationId:request.operationId,persistence:"pending-sync",recoveryRequired:commandSaveGuard.uncertain,serverTask:result.serverTask};}
    const current=stateRef.tasks.find(t=>t.id===change.id);
    if(current)F.reconcile(current,change.after,result.serverTask);
    for(const maps of [shadowMaps,recordMaps]){
      if(maps===shadowMaps || C.equal(recordAtStart,maps.tasks.get(change.id)||null))maps.tasks.set(change.id,result.maps.tasks.get(change.id));
      if(maps===recordMaps && checksAtStart!==C.canonical([...maps.checklistItems]))continue;
      for(const [id,value] of maps.checklistItems)if(value.parentType==="task"&&value.parentId===change.id)maps.checklistItems.delete(id);
      for(const [id,value] of result.maps.checklistItems)maps.checklistItems.set(id,value);
    }
    if(typeof attachmentStore!=="undefined" && attachmentStore)await attachmentStore.confirm({tasks:[result.serverTask]});
    commandSaveGuard.confirmed=true;
    setSyncStatus("online","해당 업무 서버 저장 확인");
    return {operationId:request.operationId,persistence:"server-confirmed",commandReconciled:true,serverTask:result.serverTask,revision:result.revision,alreadyApplied:result.alreadyApplied};
  } catch(error) {
    if(!transactionStarted || ["permission-denied","invalid-argument"].includes(error.code)) error.definiteFailure=true;
    if(transactionStarted && !error.definiteFailure) {commandSaveGuard.uncertain=true;error.recoveryRequired=true;}
    setSyncStatus("error",error.code==="conflict"?"충돌 · 입력 보존":error.definiteFailure?"저장 보류 · 입력 보존":"서버 확인 필요 · 입력 보존");
    throw error;
  } finally { if(commandSaveGuard)commandSaveGuard.running=false; }
}

async function flush() {
  if (queuedState && !saving) void flushQueue({ reason: "수동 동기화" });
  while (saving || queuedState) await new Promise((resolve) => setTimeout(resolve, 25));
}

async function flushQueue(metadata = {}) {
  if (saving || !queuedState) return;
  saving = true;
  projectSaveInFlight=Boolean(metadata.projectSave);
  setSyncStatus("syncing", navigator.onLine ? "저장 중" : "오프라인 저장 중");
  const snapshot = queuedState;
  const snapshotVersion = queuedVersion;
  const workspace = queuedWorkspace || recurrenceWorkspace();
  let guarded = false, reconciled = false, serverConfirmed = false;
  queuedState = null;
  try {
    assertRecurrenceWorkspace(workspace);
    await ensureImageUploads(snapshot);
    assertRecurrenceWorkspace(workspace);
    const nextMaps = serializeState(snapshot);
    const changes = diffMaps(shadowMaps, nextMaps);
    if (metadata.projectSave && navigator.onLine === false) throw Object.assign(new Error('프로젝트 저장은 온라인 서버 확인 후 가능합니다.'),{code:'project/online-required'});
    guarded = needsRecurrenceClaim(changes);
    if (changes.length) {
      if (navigator.onLine) {
        try {
          const collisions = await commitOnlineChunks(changes, nextMaps, { ...metadata, recurrenceWorkspace: workspace });
          serverConfirmed = true;
          if (collisions.length) {
            await reconcileRecurrenceCollisions(collisions, snapshot, nextMaps, workspace);
            reconciled = true;
          }
        } catch (error) {
          if (metadata.projectSave || guarded || error.committedChunks > 0 || error.code?.startsWith("recurrence/")) throw error;
          if (!["unavailable", "deadline-exceeded", "failed-precondition"].includes(error?.code)) throw error;
          await commitOfflineChunks(changes, nextMaps, metadata);
        }
      } else await commitOfflineChunks(changes, nextMaps, metadata);
      assertRecurrenceWorkspace(workspace);
      if(serverConfirmed && !reconciled && attachmentStore)await attachmentStore.confirm(snapshot);
      shadowMaps = mapClone(nextMaps);
      for (const name of DATA_COLLECTIONS) recordMaps[name] = new Map(nextMaps[name]);
      if (guarded || reconciled || recurrenceLocalEditsPending) recurrenceLocalEditsPending = diffMaps(nextMaps, serializeState(stateRef)).length > 0;
      lastSyncAt = new Date();
    }
    setSyncStatus(navigator.onLine ? "online" : "offline", serverConfirmed && !reconciled ? "서버 저장 확인" : reconciled ? "충돌 조정 · 확인 필요" : "동기화 확인 대기");
    const done = queuedResolvers.filter(({ targetVersion }) => targetVersion <= snapshotVersion);
    queuedResolvers = queuedResolvers.filter(({ targetVersion }) => targetVersion > snapshotVersion);
    done.forEach(({ resolve, targetVersion, operationId }) => resolve({ recurrenceReconciled: reconciled,
      operationId, persistence: metadata.projectSave && changes.length===0 ? "no-change" : serverConfirmed && targetVersion === snapshotVersion && !reconciled ? "server-confirmed" : "pending-sync" }));
  } catch (error) {
    if (guarded || error.code?.startsWith("recurrence/")) {
      recurrenceRecoveryRequired = true; error.recoveryRequired = true;
      queuedState = null;
    }
    console.error("Cloud save", error?.code || "save-failed");
    setSyncStatus("error", friendlyError(error));
    const done = recurrenceRecoveryRequired ? queuedResolvers : queuedResolvers.filter(({ targetVersion }) => targetVersion <= snapshotVersion);
    queuedResolvers = recurrenceRecoveryRequired ? [] : queuedResolvers.filter(({ targetVersion }) => targetVersion > snapshotVersion);
    done.forEach(({ reject }) => reject(error));
    window.dispatchEvent(new CustomEvent("cloud-sync-error", { detail: friendlyError(error) }));
  } finally {
    saving = false;
    projectSaveInFlight=false;
    if (queuedState) void flushQueue(metadata);
  }
}

function recurrenceError(code, message) {
  const error = new Error(message); error.code = `recurrence/${code}`; return error;
}
function recurrenceWorkspace() {
  return `${workspaceProfile?.workspace?.firebaseConfig?.projectId || ''}/${currentUser?.uid || ''}`;
}
function assertRecurrenceWorkspace(expected) {
  if (expected !== recurrenceWorkspace()) throw recurrenceError("workspace-changed", "업무공간 또는 계정이 변경되어 대기 저장을 중단합니다.");
}
function needsRecurrenceClaim(changes) {
  return changes.some(c => c.collection === "generatedKeys" && c.type === "create" || c.collection === "tasks" && c.type === "create" && c.after?.generatedKey);
}
async function reconcileRecurrenceCollisions(collisions, submitted, nextMaps, workspace) {
  // Fetch only the affected server task bundles, never replace the whole local state.
  const serverDb = db, replacements = [];
  for (const collision of collisions) {
    assertRecurrenceWorkspace(workspace);
    const {remoteTaskId,lockId,lock} = collision;
    const [task, checks, link, currentLock] = await Promise.all([
      getDocFromServer(doc(serverDb,"tasks",remoteTaskId)),
      getDocsFromServer(query(collection(serverDb,"checklistItems"),where("parentType","==","task"),where("parentId","==",remoteTaskId))),
      getDocFromServer(doc(serverDb,"taskLinks",remoteTaskId)),
      getDocFromServer(doc(serverDb,"generatedKeys",lockId))
    ]);
    if (!currentLock.exists() || JSON.stringify(withoutSyncFields(currentLock.data())) !== JSON.stringify(lock)) throw recurrenceError("lock-changed", "충돌 확인 중 생성키 잠금이 변경되었습니다.");
    if (task.exists() && task.data().generatedKey !== lock.generatedKey) throw recurrenceError("owner-changed", "서버 업무 소유권을 확인할 수 없습니다.");
    const maps = makeRecordMaps();
    if (task.exists()) {
      maps.tasks.set(remoteTaskId,withoutSyncFields(task.data()));
      for (const check of checks.docs) maps.checklistItems.set(check.id,withoutSyncFields(check.data()));
      if (link.exists()) maps.taskLinks.set(remoteTaskId,withoutSyncFields(link.data()));
    }
    maps.generatedKeys.set(lockId,lock);
    replacements.push({collision,maps,task:deserializeState(maps).tasks[0] || null});
  }
  assertRecurrenceWorkspace(workspace);
  // Validate every replacement first, including a newer queued save. No partial local reconciliation.
  for (const target of [stateRef,queuedState].filter(Boolean)) for (const {collision} of replacements) {
    const before = submitted.tasks.find(t=>t.id===collision.localTaskId);
    const local = target.tasks.find(t=>t.id===collision.localTaskId);
    if (!before || JSON.stringify(local) !== JSON.stringify(before) || collision.remoteTaskId !== collision.localTaskId && target.tasks.some(t=>t.id===collision.remoteTaskId)) {
      throw recurrenceError("local-edit-conflict", "충돌한 임시 업무에 새 편집이 있습니다. 편집을 보존했으며 서버 결과와 비교가 필요합니다.");
    }
  }
  for (const {collision,maps,task} of replacements) {
    for (const target of [stateRef,queuedState].filter(Boolean)) {
      const index = target.tasks.findIndex(t=>t.id===collision.localTaskId);
      target.tasks.splice(index,1,...(task?[clone(task)]:[]));
    }
    const ids = new Set([collision.localTaskId,collision.remoteTaskId]);
    for (const name of ["tasks","checklistItems","taskLinks"]) {
      for (const [id,value] of nextMaps[name]) {
        if (name === "tasks" ? ids.has(id) : name === "taskLinks" ? ids.has(value.taskId || id) : value.parentType === "task" && ids.has(value.parentId)) nextMaps[name].delete(id);
      }
      for (const [id,value] of maps[name]) nextMaps[name].set(id,clone(value));
    }
    nextMaps.generatedKeys.set(collision.lockId,clone(collision.lock));
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

// Add revision-only parent writes before bundling; never split child/parent contracts.
function withChecklistParents(changes, maps) {
  const result = changes.map(change => ({ ...change }));
  for (const change of changes.filter(c => c.collection === "checklistItems")) {
    const value = change.after || change.before;
    if (change.before && change.after && (change.before.parentType !== value.parentType || change.before.parentId !== value.parentId))
      throw recurrenceError("check-parent-change", "체크 항목의 부모를 직접 변경할 수 없습니다.");
    const collection = {task:"tasks", template:"templates", linkedRule:"linkedRules"}[value?.parentType];
    if (!collection || !value.parentId) throw recurrenceError("invalid-check-parent", "체크 항목의 부모를 확인할 수 없습니다.");
    let parent = result.find(c => c.collection === collection && c.id === value.parentId);
    if (!parent) {
      const before = shadowMaps[collection].get(value.parentId), after = maps?.[collection]?.get(value.parentId) || before;
      if (!before || !after) throw recurrenceError("missing-check-parent", "체크 항목과 부모를 함께 저장해야 합니다.");
      parent = {collection, id:value.parentId, type:"update", before, after, fields:[]};result.push(parent);
    }
    parent.revisionFence = true;
  }
  return result;
}

function chunkChanges(changes, maps, maxWrites = 320) {
  const bundles = new Map();
  for (const change of withChecklistParents(changes, maps)) {
    const key = changeBundleKey(change, maps);
    if (!bundles.has(key)) bundles.set(key, []);
    bundles.get(key).push(change);
  }
  const chunks = [];
  let current = [], accessCost = 0;
  for (const bundle of bundles.values()) {
    // Budget both before/after documents. Repeated accesses to a parent are cached by Rules.
    const parents = new Set(bundle.filter(c => c.revisionFence).map(c => `${c.collection}/${c.id}`));
    const keys = new Set(bundle.filter(c => c.collection === "generatedKeys" && c.type === "create").map(c => c.id));
    for (const c of bundle) if(c.collection === "generatedKeys" && c.type === "create")parents.add(`tasks/${c.after.taskId}`);
    for (const c of bundle) if(c.collection === "tasks" && c.type === "create" && c.after?.generatedKey){parents.add(`tasks/${c.id}`);keys.add(stableKeyId(c.after.generatedKey));}
    const cost = 2 * (parents.size + keys.size);
    if (bundle.length > maxWrites || cost > 20) throw recurrenceError("bundle-too-large", "부모·체크·잠금 묶음이 저장 한도를 초과합니다. 저장하지 않았습니다.");
    if (current.length && (current.length + bundle.length > maxWrites || accessCost + cost > 20)) {
      chunks.push(current);current = [];accessCost = 0;
    }
    current.push(...bundle);accessCost += cost;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

async function commitOnlineChunks(changes, maps, metadata) {
  const chunks = chunkChanges(changes, maps);
  if (metadata.projectSave && chunks.length !== 1) throw Object.assign(new Error('프로젝트와 단계 업무를 한 트랜잭션에 저장할 수 없습니다. 저장을 중단하고 변경 범위를 줄여 주세요.'),{code:'project/too-large'});
  const backupBaseMaps = metadata.backupImport ? mapClone(shadowMaps) : null;
  const collisions = [];
  for (let index = 0; index < chunks.length; index++) {
    try {
      collisions.push(...(await commitTransaction(chunks[index], maps, { ...metadata, backupBaseMaps, reason: chunks.length > 1 ? `${metadata.reason || "데이터 변경"} (${index + 1}/${chunks.length})` : metadata.reason }) || []));
      if (backupBaseMaps) for (const change of chunks[index]) {
        if (change.type === "delete") backupBaseMaps[change.collection].delete(change.id);
        else backupBaseMaps[change.collection].set(change.id, clone(change.after));
      }
    } catch (error) {
      error.committedChunks = index; error.totalChunks = chunks.length;
      throw error;
    }
  }
  return collisions;
}

async function commitOfflineChunks(changes, maps, metadata) {
  if (needsRecurrenceClaim(changes)) throw recurrenceError("online-required", "신규 반복 회차는 온라인 잠금 확인 후 저장할 수 있습니다.");
  const chunks = chunkChanges(changes, maps);
  for (let index = 0; index < chunks.length; index++) {
    await commitOfflineBatch(chunks[index], maps, { ...metadata, reason: chunks.length > 1 ? `${metadata.reason || "데이터 변경"} (${index + 1}/${chunks.length})` : metadata.reason });
  }
}

// Rules may reject a stale revision/claim before the SDK reports ABORTED.
// Retry only a definitively rejected atomic transaction whose read documents actually changed.
async function runRulesAwareTransaction(transactionDb, callback) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let observed = [];
    try {
      return await runTransaction(transactionDb, async transaction => {
        observed = [];
        return callback({
          get: async ref => {
            const snap = await transaction.get(ref);
            observed.push({ref, value:JSON.stringify(snap.exists() ? snap.data() : null)});
            return snap;
          },
          set: (...args) => transaction.set(...args),
          update: (...args) => transaction.update(...args),
          delete: (...args) => transaction.delete(...args),
        });
      });
    } catch (error) {
      if (error.code !== "permission-denied" || attempt === 2) throw error;
      let changed = false;
      for (const {ref, value} of observed) {
        let snap;try { snap = await getDocFromServer(ref); } catch { throw error; }
        if (value !== JSON.stringify(snap.exists() ? snap.data() : null)) { changed = true;break; }
      }
      if (!changed) throw error;
    }
  }
}

async function commitTransaction(changes, nextMaps, metadata) {
  changes = withChecklistParents(changes, nextMaps);
  if (changes.length > 320) throw recurrenceError("transaction-too-large", "트랜잭션 쓰기 한도를 초과했습니다.");
  const writeChanges = changes.filter((change) => change.collection !== "generatedKeys");
  const generatedCreates = changes.filter((change) => change.collection === "generatedKeys" && change.type === "create");
  // A key may already be in the local shadow; every keyed task CREATE still needs a server guard.
  for (const change of writeChanges) {
    if (metadata.backupImport || change.collection !== "tasks" || change.type !== "create" || !change.after.generatedKey) continue;
    const id = stableKeyId(change.after.generatedKey);
    if (!generatedCreates.some(c => c.id === id)) generatedCreates.push({collection:"generatedKeys",id,type:"create",after:{generatedKey:change.after.generatedKey,taskId:change.id}});
  }
  const workspace = metadata.recurrenceWorkspace || recurrenceWorkspace(), transactionDb = db;
  assertRecurrenceWorkspace(workspace);
  return runRulesAwareTransaction(transactionDb, async (transaction) => {
    assertRecurrenceWorkspace(workspace);
    const snapshots = new Map();
    // 일반 저장은 기존 읽기 범위를 유지한다. 백업은 생성·삭제도 기준값을 재검사한다.
    const readChanges = metadata.backupImport || metadata.projectSave ? [...changes] : [...generatedCreates, ...writeChanges.filter((item) => item.type === "update" || item.collection === "tasks" && item.type === "create" && item.after.generatedKey)];
    if (metadata.projectSave && metadata.projectId) {
      const guarded=new Set(readChanges.map(change=>`${change.collection}/${change.id}`));
      const include=(collection,id,before)=>{if(guarded.has(`${collection}/${id}`))return;readChanges.push({collection,id,before,guardOnly:true});guarded.add(`${collection}/${id}`);};
      include('projects',metadata.projectId,shadowMaps.projects.get(metadata.projectId)||null);
      for(const [id,task] of shadowMaps.tasks)if(task.projectId===metadata.projectId){
        include('tasks',id,task);
        for(const [childId,check] of shadowMaps.checklistItems)if(check.parentType==='task'&&check.parentId===id)include('checklistItems',childId,check);
      }
    }
    if (metadata.backupImport) {
      const base = metadata.backupBaseMaps || shadowMaps;
      const guarded = new Set(readChanges.map(change => `${change.collection}/${change.id}`));
      const guardTask = id => {
        if (!id || guarded.has(`tasks/${id}`)) return;
        readChanges.push({ collection: "tasks", id, before: base.tasks.get(id) || null });guarded.add(`tasks/${id}`);
      };
      for (const change of changes) {
        const value = change.after || change.before || {};
        if (change.collection === "checklistItems" && value.parentType === "task") guardTask(value.parentId);
        if (change.collection === "taskLinks") guardTask(value.taskId || change.id);
        if (["projects", "templates"].includes(change.collection)) {
          for (const [id,task] of base.tasks) {
            if (change.collection === "projects" ? task.projectId === change.id : [task.templateId,task.autoSourceTemplateId,task.dbManualRootTemplateId,task.dbSourceTemplateId,task.sourceTemplateId].includes(change.id)) guardTask(id);
          }
        }
      }
    }
    for (const change of readChanges) {
      const ref = doc(db, change.collection, change.id);
      snapshots.set(`${change.collection}/${change.id}`, await transaction.get(ref));
    }
    if (metadata.projectSave) for (const change of readChanges) {
      const snap = snapshots.get(`${change.collection}/${change.id}`);
      const remote = snap?.exists() ? withoutSyncFields(snap.data()) : null;
      const fields=remote&&change.before?changedFields(remote,change.before):[];
      const independentNote=change.guardOnly&&change.collection==='tasks'&&fields.length>0&&fields.every(field=>field==='notes');
      if (!independentNote && (remote === null ? change.before !== null : !change.before || fields.length)) {
        throw Object.assign(new Error('프로젝트 또는 단계 업무가 다른 기기에서 변경됐습니다. 입력을 유지하고 서버 내용을 다시 확인해 주세요.'),{code:'project/conflict',definiteFailure:true,collection:change.collection,id:change.id});
      }
    }
    if (metadata.backupImport) {
      for (const change of readChanges) {
        const snap = snapshots.get(`${change.collection}/${change.id}`);
        const remote = snap?.exists() ? withoutSyncFields(snap.data()) : null;
        if (!window.WMBackupSafety.equal(remote, change.before)) {
          const error = new Error("저장 직전 원격 데이터가 변경되었습니다. 복구본과 서버 상태를 확인한 뒤 새 미리보기를 만드세요.");
          error.code = "backup/remote-conflict";
          throw error;
        }
      }
    }
    const skippedTaskIds = new Set(), collisions = [];
    for (const lockChange of generatedCreates) {
      const snap = snapshots.get(`generatedKeys/${lockChange.id}`);
      if (snap.exists()) {
        const lock = withoutSyncFields(snap.data());
        if (lock.generatedKey !== lockChange.after.generatedKey || !lock.taskId) throw recurrenceError("invalid-lock", "생성키 잠금 소유권을 확인할 수 없습니다.");
        const remote = await transaction.get(doc(transactionDb, "tasks", lock.taskId));
        if (remote.exists() && remote.data().generatedKey !== lock.generatedKey) throw recurrenceError("invalid-owner", "잠금과 서버 업무의 생성키가 다릅니다.");
        skippedTaskIds.add(lockChange.after.taskId);
        collisions.push({localTaskId:lockChange.after.taskId, remoteTaskId:lock.taskId, lockId:lockChange.id, lock, deleted:!remote.exists()});
      } else {
        const create = writeChanges.find(c => c.collection === "tasks" && c.id === lockChange.after.taskId && c.type === "create");
        if (create && snapshots.get(`tasks/${create.id}`)?.exists()) throw recurrenceError("id-collision", "잠금 없는 기존 업무 ID를 덮어쓸 수 없습니다.");
        // A lock cannot be committed in a separate chunk from its new task.
        const task = writeChanges.find(c => c.collection === "tasks" && c.id === lockChange.after.taskId && c.type !== "delete");
        if (!task && !metadata.backupImport) throw recurrenceError("unpaired-lock", "업무와 생성키 잠금을 같은 트랜잭션으로 저장해야 합니다.");
      }
    }
    assertRecurrenceWorkspace(workspace);
    const appliedWriteChanges = [];
    for (const change of writeChanges) {
      if (belongsToSkippedTask(change, skippedTaskIds)) continue;
      if (change.type === "update") {
        const snap = snapshots.get(`${change.collection}/${change.id}`);
        if (change.revisionFence && !snap?.exists()) throw recurrenceError("missing-check-parent", "서버에서 삭제된 체크 부모를 자동 복원하지 않습니다.");
        if (change.collection === "tasks" && change.after?.generatedKey && !snap?.exists()) throw recurrenceError("missing-task", "서버에서 삭제된 반복 업무를 자동 복원하지 않습니다. 저장 결과를 확인해 주세요.");
        if (snap?.exists()) {
          const remote = snap.data() || {};
          const fields = change.fields.filter((field) => Object.hasOwn(change.after || {}, field)
            ? JSON.stringify(remote[field]) !== JSON.stringify(change.after[field])
            : Object.hasOwn(remote, field));
          if (!fields.length && !change.revisionFence) continue;
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
    for (const change of generatedCreates) {
      const snap = snapshots.get(`generatedKeys/${change.id}`);
      if (!snap.exists()) transaction.set(doc(db, "generatedKeys", change.id), { ...plain(change.after), createdAt: serverTimestamp() });
    }
    if (appliedWriteChanges.length) {
      const logRef = doc(collection(db, "changeLogs"));
      transaction.set(logRef, makeLog(appliedWriteChanges, metadata));
    }
    return collisions;
  });
}

function belongsToSkippedTask(change, taskIds) {
  if (!taskIds.size) return false;
  if (change.collection === "tasks") return taskIds.has(change.id);
  return taskIds.has(change.after?.parentId) || taskIds.has(change.before?.parentId) || taskIds.has(change.after?.taskId) || taskIds.has(change.before?.taskId);
}

async function commitOfflineBatch(changes, nextMaps, metadata) {
  changes = withChecklistParents(changes, nextMaps);
  if (needsRecurrenceClaim(changes)) throw recurrenceError("online-required", "신규 반복 회차의 오프라인 잠금 선점은 허용하지 않습니다.");
  const batch = writeBatch(db);
  const writeChanges = changes.filter((change) => change.collection !== "generatedKeys");
  const allowedChanges = changes.filter((change) => change.collection !== "generatedKeys" || change.type === "create");
  for (const change of allowedChanges) {
    const ref = doc(db, change.collection, change.id);
    if (change.type === "delete") batch.delete(ref);
    else if (change.type === "create") batch.set(ref, { ...plain(change.after), revision: 1, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
    else if(change.revisionFence) batch.update(ref, { ...patchFor(change), revision: increment(1), updatedAt: serverTimestamp() });
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

function backupContextVersion() {
  const records = Object.fromEntries(DATA_COLLECTIONS.map(name => [name, [...recordMaps[name]].sort(([a],[b]) => a.localeCompare(b))]));
  return window.WMBackupSafety.version({ records, uid: currentUser?.uid || "", googleUid: buildingUser?.uid || "", workspace: workspaceProfile?.workspace?.firebaseConfig?.projectId || "" });
}

function assertBackupReady() {
  if (window.WMRecovery?.blocksWrites || commandSaveGuard) throw new Error("일반 업무 저장 확인 후 백업을 진행하세요.");
  if (!active || localOnly || !currentUser || !navigator.onLine) throw new Error("클라우드 백업 가져오기는 로그인·온라인 동기화 완료 후에만 가능합니다.");
  if (backupImporting || backupRecoveryRequired || saving || queuedState) throw new Error("저장/복구 확인이 진행 중입니다. 완료 후 미리보기를 다시 열어 주세요.");
  if (!recordMapsEqual(recordMaps, shadowMaps)) throw new Error("미리보기 기준에 원격 변경이 도착했습니다. 취소 후 화면 갱신을 기다려 다시 확인해 주세요.");
}

function previewImport(incoming, options = {}) {
  assertBackupReady();
  const B = window.WMBackupSafety;
  const plan = B.prepare(stateRef, incoming, { ...options, locks: [...recordMaps.generatedKeys.values()], contextVersion: backupContextVersion() });
  if (!plan.errors.length) {
    const decoded = deserializeState(serializeState(plan.next), plan.next.settings);
    // Audit logs remain in their existing collection, not imported from JSON.
    const missing = B.missingFields({ ...plan.next, changeLogs: [] }, { ...decoded, changeLogs: [] });
    if (missing.length) plan.errors.push("기존 저장 변환에서 필드 손실이 예상되어 가져오기를 차단합니다: " + missing.slice(0,30).join(", "));
  }
  return plan;
}

function checkedImportMaps(changes, nextMaps) {
  const B = window.WMBackupSafety, observed = mapClone(recordMaps);
  for (const change of changes) {
    const seen = observed[change.collection].get(change.id) || null;
    if (!B.equal(seen, change.before) && !B.equal(seen, change.after)) throw new Error("백업 저장 도중 원격 데이터가 다시 변경되었습니다. 복구 확인이 필요합니다.");
    if (change.type === "delete") observed[change.collection].delete(change.id);
    else observed[change.collection].set(change.id, clone(change.after));
  }
  for (const name of DATA_COLLECTIONS) {
    if (!B.equal([...observed[name]].sort(([a],[b]) => a.localeCompare(b)), [...nextMaps[name]].sort(([a],[b]) => a.localeCompare(b)))) throw new Error("백업 저장 도중 미리보기에 없던 원격 변경이 도착했습니다. 복구 확인이 필요합니다.");
  }
  return observed;
}

async function importState(incoming, options = {}) {
  assertBackupReady();
  const B = window.WMBackupSafety, review = options.review;
  if (!review || !B.equal(incoming, review.incoming) || typeof options.persistRecovery !== "function") throw new Error("백업 미리보기·명시적 확인·복구본 저장이 필요합니다.");
  const fresh = previewImport(incoming, review);
  if (fresh.errors.length) throw new Error(fresh.errors.join("\n"));
  if (!B.equal(fresh.next, review.next)) throw new Error("미리보기의 충돌 처리 결과가 변경되었습니다. 새 미리보기를 확인해 주세요.");
  try {
    const result = await B.execute(review, {
      getCurrent: () => stateRef,
      getVersion: backupContextVersion,
      persistRecovery: options.persistRecovery,
      write: async next => {
        assertBackupReady();
        backupImporting = true;
        const identity = `${currentUser?.uid}/${buildingUser?.uid}`;
        const nextMaps = serializeState(next);
        const changes = diffMaps(shadowMaps, nextMaps);
        await commitOnlineChunks(changes, nextMaps, { reason: review.mode === "replace" ? "검토된 백업 전체 복원" : "검토된 백업 병합", backupImport: true });
        checkedImportMaps(changes, nextMaps);
        if (identity !== `${currentUser?.uid}/${buildingUser?.uid}`) throw new Error("백업 저장 중 연결 계정이 변경되었습니다. 복구 확인이 필요합니다.");
        // Write the exact reviewed state, without generation or attachment upload.
        await window.WMBackupUI.writeImportedCache(next);
        const observed = checkedImportMaps(changes, nextMaps);
        if (identity !== `${currentUser?.uid}/${buildingUser?.uid}`) throw new Error("백업 저장 중 연결 계정이 변경되었습니다. 복구 확인이 필요합니다.");
        shadowMaps = mapClone(nextMaps);
        for (const name of DATA_COLLECTIONS) recordMaps[name] = observed[name];
      },
      publish: next => replaceState(stateRef, next),
    }, options);
    setSyncStatus("online", "검토된 백업 저장됨");
    renderRemote?.();
    return result;
  } catch (error) {
    if (error.recoveryRequired) {
      backupRecoveryRequired = true;
      setSyncStatus("error", "백업 일부 저장 가능 · 복구 확인 필요");
    }
    throw error;
  } finally { backupImporting = false; }
}

function mergeById(current, incoming) {
  const out = current.map(clone), seen = new Set(current.map(item => item.id));
  for (const item of incoming) if (!seen.has(item.id)) { out.push(clone(item)); seen.add(item.id); }
  return out;
}

async function ensureDriveAccess() {
  if (localOnly) return "";
  await ensureBuildingDriveAccess();
  assertRecurrenceWorkspace(workspace);
  if (googleUid !== getBuildingUser()?.uid) throw new Error("Drive 인증 중 계정이 변경되었습니다.");
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
  const workspace = recurrenceWorkspace(), googleUid = getBuildingUser()?.uid;
  if (forceRefresh) {
    clearDriveAccessToken();
    await ensureBuildingDriveAccess({ forceRefresh: true });
  } else {
    await ensureBuildingDriveAccess();
  }
  assertRecurrenceWorkspace(workspace);
  if (googleUid !== getBuildingUser()?.uid) throw new Error("Drive 인증 중 계정이 변경되었습니다.");
  buildingUser = getBuildingUser() || buildingUser;
  const token = getBuildingDriveAccessToken();
  if (!token) throw new Error("Google Drive 권한을 확인하지 못했습니다.");
  return rememberDriveAccessToken(token, buildingUser);
}

async function uploadDriveMediaWithRetry(fileId, file, mimeType, { attempts = 3 } = {}) {
  const workspace = recurrenceWorkspace();
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    assertRecurrenceWorkspace(workspace);
    let token = await currentDriveToken();
    assertRecurrenceWorkspace(workspace);
    try {
      let response = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media&fields=id,name,mimeType,size`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": mimeType },
        body: file,
      });
      assertRecurrenceWorkspace(workspace);
      if (response.status === 401 && attempt < attempts) {
        token = await currentDriveToken({ forceRefresh: true });
        assertRecurrenceWorkspace(workspace);
        response = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media&fields=id,name,mimeType,size`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": mimeType },
          body: file,
        });
      }
      assertRecurrenceWorkspace(workspace);
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

let attachmentStore = null;
function getAttachmentStore() {
  return attachmentStore ||= window.WMAttachmentStore.create({
    store:window.WMAttachmentStore.indexed(window.openDb),
    scope:()=>currentUser && buildingUser ? `${recurrenceWorkspace()}/${buildingUser.uid}` : '',
    allocate:async()=>{const token=await currentDriveToken();const r=await driveFetch('https://www.googleapis.com/drive/v3/files/generateIds?count=1&space=drive',{headers:{Authorization:`Bearer ${token}`}});const data=await r.json();if(!data.ids?.[0])throw Error('Drive ID 할당 실패');return data.ids[0];},
    upload:async(fileId,file,row)=>{
      const workspace=recurrenceWorkspace(),folderId=await ensureDriveFolder(),token=await currentDriveToken();assertRecurrenceWorkspace(workspace);
      const response=await driveFetchResponse('https://www.googleapis.com/drive/v3/files?fields=id',{
        method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
        body:JSON.stringify({id:fileId,name:row.name,mimeType:row.mimeType,parents:[folderId],appProperties:{workManagerApp:appConfig.driveAppMarker||'work-manager-v10'}})});
      if(!response.ok&&response.status!==409)throw Error(`Drive 파일 생성 실패 (${response.status})`);
      assertRecurrenceWorkspace(workspace);await uploadDriveMediaWithRetry(fileId,file,row.mimeType,{attempts:1});
    },
    verify:async(fileId,row)=>{
      const token=await currentDriveToken();const r=await driveFetchResponse(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,size,trashed,sha256Checksum`,{headers:{Authorization:`Bearer ${token}`}});
      if(r.status===404)return false;if(!r.ok)throw Error(`Drive 확인 실패 (${r.status})`);const data=await r.json();if(data.trashed)throw Error('파일이 휴지통에 있습니다. 자동 복원하지 않습니다.');if(Number(data.size)>0&&(Number(data.size)!==row.size||(data.sha256Checksum&&data.sha256Checksum!==row.hash)))throw Error('기존 원본 내용이 다릅니다. 덮어쓰지 않고 수동 확인이 필요합니다.');return data.id===fileId&&Number(data.size)===row.size;
    }
  });
}
async function createDriveBlock(file, { id, type, kind, signal }) {
  if (!file?.name) throw new Error('첨부할 파일을 확인하지 못했습니다.');
  const scope=recurrenceWorkspace();
  const row=await getAttachmentStore().send(file,{signal});assertRecurrenceWorkspace(scope);
  const block={id,type,driveFileId:row.fileId,name:file.name,mimeType:row.mimeType,size:row.size,caption:''};
  if(type==='image'){
    const display=await safeDriveDisplayBlob(file);assertRecurrenceWorkspace(scope);const objectUrl=URL.createObjectURL(display);
    const old=driveObjectUrls.get(row.fileId);if(old)URL.revokeObjectURL(old);driveObjectUrls.set(row.fileId,objectUrl);block.data=objectUrl;
  }
  return block;
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
  if (!hasBuildingDriveToken() && !allowPrompt) throw new Error("사진을 Google Drive에 저장하려면 Drive 연결 버튼을 먼저 눌러 주세요.");
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
    if (hasBuildingDriveToken()) void load(false);
  }
}

function drivePreviewMime(value) {
  return String(value || "").split(";", 1)[0].trim().toLowerCase();
}

function drivePreviewExtension(fileName) {
  const extension = String(fileName || "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
    webp: "image/webp", bmp: "image/bmp", ico: "image/x-icon", pdf: "application/pdf" })[extension] || "";
}

async function drivePreviewType(blob) {
  // Neither stored metadata nor an image/* prefix proves a passive document.
  // Check the response MIME and format header; never sniff HTML/SVG into a preview.
  const type = drivePreviewMime(blob.type);
  const bytes = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  const starts = (...values) => values.every((value, i) => bytes[i] === value);
  const text = (start, end) => String.fromCharCode(...bytes.slice(start, end));
  if (type === "image/png" && starts(137, 80, 78, 71, 13, 10, 26, 10)) return type;
  if (type === "image/jpeg" && starts(255, 216, 255)) return type;
  if (type === "image/gif" && ["GIF87a", "GIF89a"].includes(text(0, 6))) return type;
  if (type === "image/webp" && text(0, 4) === "RIFF" && text(8, 12) === "WEBP") return type;
  if (type === "image/bmp" && text(0, 2) === "BM") return type;
  if (["image/x-icon", "image/vnd.microsoft.icon"].includes(type) && starts(0, 0, 1, 0)) return "image/x-icon";
  if (type === "application/pdf" && /^%PDF-\d\.\d/.test(text(0, 8))) return type;
  return "";
}

async function safeDriveDisplayBlob(blob) {
  // Cached image URLs can also be opened in a new tab via the browser menu.
  // Keep bytes intact but give active/unknown formats a download-only MIME.
  return blob.slice(0, blob.size, (await drivePreviewType(blob)) || "application/octet-stream");
}

async function getDriveObjectUrl(fileId, { allowLegacyPrompt = false } = {}) {
  if (driveObjectUrls.has(fileId)) return driveObjectUrls.get(fileId);
  const scope=recurrenceWorkspace();
  const result = await readDriveFileBlob(fileId, { allowLegacyPrompt });
  const display=await safeDriveDisplayBlob(result.blob);assertRecurrenceWorkspace(scope);
  if(driveObjectUrls.has(fileId))return driveObjectUrls.get(fileId);
  const objectUrl = URL.createObjectURL(display);
  driveObjectUrls.set(fileId, objectUrl);
  return objectUrl;
}

async function downloadDriveFile(fileId, fileName = "첨부파일", sourceBlob = null) {
  if (!fileId) throw new Error("다운로드할 Drive 파일 정보가 없습니다.");
  const blob = sourceBlob || (await readDriveFileBlob(fileId, { allowLegacyPrompt: true })).blob;
  // A separate URL prevents a cached preview MIME from turning a download into
  // an active same-origin document. Retyping a Blob does not change its bytes.
  const objectUrl = URL.createObjectURL(blob.slice(0, blob.size, "application/octet-stream"));
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = String(fileName || "첨부파일");
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  try { anchor.click(); }
  finally {
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  }
}

async function openDriveFile(fileId, fileName = "첨부파일", mimeType = "") {
  if (!fileId) throw new Error("열 Google Drive 파일 정보가 없습니다.");
  const expectedType = drivePreviewExtension(fileName);
  let declaredType = drivePreviewMime(mimeType);
  if (declaredType === "image/vnd.microsoft.icon") declaredType = "image/x-icon";
  if (!expectedType || (declaredType && declaredType !== expectedType)) return downloadDriveFile(fileId, fileName);
  const preview = window.open("", "_blank");
  if (preview) preview.opener = null;
  try {
    // Re-read the response instead of trusting a URL cached during upload or hydration.
    const { blob } = await readDriveFileBlob(fileId, { allowLegacyPrompt: true });
    if (!preview || await drivePreviewType(blob) !== expectedType) {
      preview?.close();
      return await downloadDriveFile(fileId, fileName, blob);
    }
    const objectUrl = URL.createObjectURL(blob.slice(0, blob.size, expectedType));
    const previous = driveObjectUrls.get(fileId);
    if (previous) URL.revokeObjectURL(previous);
    driveObjectUrls.set(fileId, objectUrl);
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
      console.warn("이전 Cloud 첨부 복구 실패");
      failed++;
    }
  }
  if (repaired) await save(stateRef, { reason: "이전 Cloud 첨부자료 Drive 연결 복구" });
  return { scanned: refsByFile.size, repaired, alreadyAccessible, failed, notNeeded: false };
}

async function driveFetchResponse(url, options = {}, { retryAuth = true } = {}) {
  const workspace = recurrenceWorkspace();
  let requestOptions = { ...options, headers: { ...(options.headers || {}) } };
  let response = await fetch(url, requestOptions);
  assertRecurrenceWorkspace(workspace);
  if (response.status === 401 && retryAuth && !localOnly) {
    clearDriveAccessToken();
    const freshToken = await currentDriveToken({ forceRefresh: true });
    requestOptions = {
      ...requestOptions,
      headers: { ...requestOptions.headers, Authorization: `Bearer ${freshToken}` },
    };
    assertRecurrenceWorkspace(workspace);
    response = await fetch(url, requestOptions);
    assertRecurrenceWorkspace(workspace);
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

// Purge the obsolete duplicate token without touching Firebase SDK persistence.
try { sessionStorage.removeItem(DRIVE_TOKEN_SESSION_KEY); } catch {}
window.addEventListener("work-manager-credentials-cleared", () => {
  const wasConnected = Boolean(currentUser);
  clearDriveAccessToken();
  clearLegacyDriveToken();
  stopRealtime();
  currentUser = null;
  buildingUser = null;
  workspaceProfile = null;
  if (wasConnected) {
    setSyncStatus("offline", "계정 연결 해제됨");
    showLoggedOutGateV2();
  }
});
