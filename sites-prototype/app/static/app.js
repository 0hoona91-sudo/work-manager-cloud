"use strict";
const $ = (selector) => document.querySelector(selector);
let config,
  me = null,
  tasks = [],
  selected = null,
  drive = null;
const statusNames = { todo: "예정", doing: "진행 중", done: "완료" };
function notice(message = "") {
  $("#notice").textContent = message;
  $("#notice").hidden = !message;
}
async function api(path, options = {}) {
  const headers = { ...options.headers };
  if (options.method && options.method !== "GET" && me)
    headers["X-CSRF-Token"] = me.csrf;
  const response = await fetch(path, {
    ...options,
    headers,
    credentials: "same-origin",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    if (response.status === 401 && me) {
      me = null;
      tasks = [];
      selected = null;
      $("#taskDialog").close();
      $("#previewDialog").close();
      $("#attachments").replaceChildren();
      $("#previewText").textContent = "";
      renderIdentity();
      renderTasks();
    }
    throw new Error(
      typeof body.detail === "string"
        ? body.detail
        : `요청 실패 (${response.status})`,
    );
  }
  return response;
}
async function json(path, options = {}) {
  return (await api(path, options)).json();
}
function jsonOptions(method, body) {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
function action(fn) {
  return async (...args) => {
    notice();
    try {
      await fn(...args);
    } catch (error) {
      notice(error.message);
    }
  };
}
function renderIdentity() {
  $("#loginPanel").hidden = !!me;
  $("#accountName").textContent = me?.name || "로그인 전";
  $("#accountKind").textContent = me
    ? me.authentication === "local-test"
      ? "자동 테스트 세션"
      : "검증된 인증 세션"
    : "인증 연결 대기";
  $("#avatar").textContent = me?.name?.slice(0, 1) || "·";
  $("#logout").hidden = !me;
  $("#newTask").disabled = !me;
  $("#search").disabled = !me;
  $("#login").disabled = !config.identity_configured;
  $("#login").textContent = config.identity_configured
    ? "설정된 인증 제공자로 로그인"
    : "ChatGPT 로그인 · 연결 필요";
  $("#identityDescription").textContent = config.identity_configured
    ? "서버에 설정된 인증 제공자로 이동합니다. ChatGPT Sites 연동 여부는 별도 확인이 필요합니다."
    : "ChatGPT Sites의 공식 인증 연결이 아직 설정되지 않았습니다. 연결 후 개인 업무공간을 사용할 수 있습니다.";
  $("#identityBadge").textContent = config.identity_configured
    ? "OIDC 설정됨 · Sites 미검증"
    : "로그인 미연결";
  if (!me) {
    drive = null;
    $("#driveStatus").textContent = "로그인 후 연결 가능";
    $("#connectDrive").disabled = true;
    $("#retryFolder").hidden = true;
  }
}
function renderTasks() {
  $("#countAll").textContent = me ? tasks.length : "—";
  $("#countDoing").textContent = me
    ? tasks.filter((t) => t.status === "doing").length
    : "—";
  $("#countDone").textContent = me
    ? tasks.filter((t) => t.status === "done").length
    : "—";
  $("#taskCount").textContent = tasks.length;
  const query = $("#search").value.toLocaleLowerCase();
  const visible = tasks.filter((t) =>
    t.title.toLocaleLowerCase().includes(query),
  );
  const list = $("#taskList");
  list.replaceChildren();
  for (const task of visible) {
    const row = document.createElement("button");
    row.className = "task-row";
    row.dataset.taskId = task.id;
    const title = document.createElement("span");
    title.className = "task-name";
    title.textContent = task.title;
    const status = document.createElement("span");
    status.className = `status ${task.status}`;
    status.textContent = statusNames[task.status];
    const date = document.createElement("span");
    date.className = "task-date";
    date.textContent = new Date(task.updated_at * 1000).toLocaleDateString(
      "ko-KR",
      { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit" },
    );
    row.append(title, status, date);
    row.onclick = action(() => openTask(task));
    list.append(row);
  }
  $("#empty").hidden = visible.length > 0;
  $("#emptyDescription").textContent = !me
    ? "로그인 연결 후 나의 업무를 등록할 수 있습니다."
    : tasks.length
      ? "검색 조건에 맞는 업무가 없습니다."
      : "새 업무를 등록해 하루를 정리해 보세요.";
}
async function refreshTasks() {
  tasks = await json("/api/tasks");
  renderTasks();
}
async function refreshDrive() {
  drive = await json("/api/drive");
  $("#driveStatus").textContent = drive.connected
    ? drive.provider === "demo"
      ? "자동 테스트 전용 저장소 · Google 미연결"
      : `${drive.email || "Google 계정"} · ${drive.folder_ready ? "연결됨" : "폴더 생성 필요"}`
    : config.google_configured
      ? "아직 연결되지 않음"
      : "서버 OAuth 설정 필요";
  $("#connectDrive").textContent =
    drive.provider === "google"
      ? "Google Drive 다시 연결"
      : "Google Drive 연결";
  $("#connectDrive").disabled = !config.google_configured;
  $("#retryFolder").hidden = !(
    drive.provider === "google" && !drive.folder_ready
  );
  $("#driveDot").classList.toggle("muted-dot", !drive.connected);
}
async function openTask(task = null) {
  selected = task;
  $("#dialogTitle").textContent = task ? "업무 상세" : "새 업무";
  $("#titleInput").value = task?.title || "";
  $("#statusInput").value = task?.status || "todo";
  $("#notesInput").value = task?.notes || "";
  $("#attachmentSection").hidden = !task;
  $("#attachments").replaceChildren();
  $("#fileInput").value = "";
  $("#fileInput").disabled = !drive?.connected;
  $("#taskDialog").showModal();
  if (task) await refreshFiles();
}
async function refreshFiles() {
  const files = await json(`/api/tasks/${selected.id}/attachments`);
  const list = $("#attachments");
  list.replaceChildren();
  for (const file of files) {
    const li = document.createElement("li");
    const label = document.createElement("span");
    label.className = "file-name";
    label.textContent = `${file.name} · ${(file.size / 1024).toFixed(1)} KB`;
    const link = document.createElement("a");
    link.href = `/api/attachments/${file.id}/content`;
    link.textContent = "다운로드";
    link.download = file.name;
    li.append(label);
    if (
      file.mime_type.startsWith("text/") ||
      file.mime_type === "application/json"
    ) {
      const view = document.createElement("button");
      view.type = "button";
      view.textContent = "조회";
      view.onclick = action(async () => {
        const body = await (
          await api(`/api/attachments/${file.id}/content`)
        ).text();
        $("#previewTitle").textContent = file.name;
        $("#previewText").textContent = body; // Never render attachment text as HTML.
        $("#previewDialog").showModal();
      });
      li.append(view);
    }
    li.append(link);
    list.append(li);
  }
  if (!files.length) {
    const li = document.createElement("li");
    li.textContent = "첨부된 파일이 없습니다.";
    list.append(li);
  }
}
$("#login").onclick = () => {
  location.href = "/auth/login";
};
$("#logout").onclick = action(async () => {
  await api("/api/logout", { method: "POST" });
  location.replace("/");
});
$("#newTask").onclick = action(() => openTask());
$("#closeTask").onclick = () => $("#taskDialog").close();
$("#closePreview").onclick = () => {
  $("#previewDialog").close();
  $("#previewText").textContent = "";
};
$("#search").oninput = renderTasks;
$("#taskForm").onsubmit = action(async (event) => {
  event.preventDefault();
  $("#saveTask").disabled = true;
  try {
    const body = {
      title: $("#titleInput").value,
      notes: $("#notesInput").value,
      status: $("#statusInput").value,
    };
    await json(
      selected ? `/api/tasks/${selected.id}` : "/api/tasks",
      jsonOptions(selected ? "PUT" : "POST", body),
    );
    $("#taskDialog").close();
    await refreshTasks();
    notice("업무를 저장했습니다.");
  } finally {
    $("#saveTask").disabled = false;
  }
});
$("#fileInput").onchange = action(async (event) => {
  const file = event.target.files[0];
  if (!file || !selected) return;
  if (file.size > config.max_upload_bytes)
    throw new Error("첨부파일은 최대 10MB입니다.");
  event.target.disabled = true;
  try {
    await api(`/api/tasks/${selected.id}/attachments`, {
      method: "POST",
      headers: {
        "X-File-Name": encodeURIComponent(file.name),
        "Content-Type": "application/octet-stream",
      },
      body: file,
    });
    await refreshFiles();
    notice("파일을 업로드했습니다.");
  } finally {
    event.target.disabled = !drive?.connected;
    event.target.value = "";
  }
});
$("#connectDrive").onclick = action(async () => {
  const result = await json("/api/google/connect", { method: "POST" });
  location.href = result.url;
});
$("#retryFolder").onclick = action(async () => {
  await api("/api/google/folder", { method: "POST" });
  await refreshDrive();
});
action(async () => {
  config = await json("/api/config");
  const response = await fetch("/api/me", { credentials: "same-origin" });
  if (response.ok) me = await response.json();
  else if (response.status !== 401)
    throw new Error("로그인 상태를 확인하지 못했습니다.");
  renderIdentity();
  renderTasks();
  if (me) await Promise.all([refreshTasks(), refreshDrive()]);
})();
