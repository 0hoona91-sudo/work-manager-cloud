import asyncio
import mimetypes
import secrets
import sqlite3
import threading
import time
import uuid
from collections import defaultdict
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal
from urllib.parse import quote, unquote, urlsplit

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, field_validator
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .auth import SessionAuth
from .config import Settings
from .db import Database
from .providers import DRIVE_SCOPE, Providers


class TaskInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=200)
    notes: str = Field(default="", max_length=10000)
    status: Literal["todo", "doing", "done"] = "todo"

    @field_validator("title")
    @classmethod
    def nonempty_title(cls, value):
        if not value.strip():
            raise ValueError("업무명을 입력해 주세요.")
        return value.strip()


def create_app(settings=None, *, transport=None):
    settings = settings or Settings.from_env()
    db = Database(settings.data_dir)
    providers = Providers(settings, db, transport)
    locks = defaultdict(threading.RLock)
    session_cookie = "wm_session" if settings.dev_mode else "__Host-wm_session"
    flow_cookie = "wm_flow" if settings.dev_mode else "__Host-wm_flow"
    secure = not settings.dev_mode

    @asynccontextmanager
    async def lifespan(app):
        yield
        providers.client.close()

    app = FastAPI(title="업무관리시스템 1단계 시험판", lifespan=lifespan,
                  docs_url=None, redoc_url=None, openapi_url=None)
    app.state.db, app.state.providers, app.state.settings = db, providers, settings
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=[urlsplit(settings.base_url).hostname])

    @app.middleware("http")
    async def boundary(request: Request, call_next):
        if settings.dev_mode and (not request.client or request.client.host not in ("127.0.0.1", "::1")):
            return JSONResponse({"detail": "로컬 시험 모드는 loopback에서만 사용할 수 있습니다."}, 403)
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            if request.headers.get("origin") != settings.base_url:
                return JSONResponse({"detail": "요청 출처를 확인할 수 없습니다."}, 403)
        # Bound ordinary JSON requests before parsing; file streams have a separate limit.
        if request.method in ("POST", "PUT", "PATCH") and not request.url.path.endswith("/attachments"):
            body = bytearray()
            async for chunk in request.stream():
                body.extend(chunk)
                if len(body) > 32768:
                    return JSONResponse({"detail": "요청이 너무 큽니다."}, 413)
            # Starlette's cached Request replays _body to the downstream parser.
            request._body = bytes(body)
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; "
            "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'")
        if secure:
            response.headers["Strict-Transport-Security"] = "max-age=31536000"
        return response

    auth = SessionAuth(db, settings)
    current_session, mutation, new_session = auth.current, auth.mutation, auth.issue

    def owned_task(task_id, owner):
        with db.connect() as conn:
            row = conn.execute("SELECT * FROM tasks WHERE id=? AND owner_id=?", (task_id, owner)).fetchone()
        if not row:
            raise HTTPException(404, "업무를 찾을 수 없습니다.")
        return row

    def owned_attachment(file_id, owner):
        with db.connect() as conn:
            row = conn.execute("SELECT * FROM attachments WHERE id=? AND owner_id=?", (file_id, owner)).fetchone()
        if not row:
            raise HTTPException(404, "첨부파일을 찾을 수 없습니다.")
        return row

    def public_file(row):
        return {k: row[k] for k in ("id", "task_id", "name", "mime_type", "size", "provider", "created_at")}

    @app.get("/healthz")
    def health():
        with db.connect() as conn:
            conn.execute("SELECT 1 FROM users LIMIT 1").fetchone()
        return {"status": "ok"}

    @app.get("/api/config")
    def config():
        return {"dev_mode": settings.dev_mode, "identity_configured": settings.identity_ready,
                "google_configured": settings.google_ready, "max_upload_bytes": settings.max_upload,
                "sites_verified": False}

    @app.get("/api/me")
    def me(session=Depends(current_session)):
        return {"id": session["user_id"], "name": session["display_name"], "csrf": session["csrf"],
                "authentication": "local-test" if session["issuer"] == "urn:wm:local-test" else "oidc"}

    @app.get("/auth/login")
    def login():
        if not settings.identity_ready:
            raise HTTPException(503, "ChatGPT Sites의 공식 인증 연결 규격과 서버 설정이 필요합니다.")
        binding = secrets.token_urlsafe(32)
        response = RedirectResponse(providers.start_flow("identity", binding), status_code=303)
        response.set_cookie(flow_cookie, binding, max_age=600, httponly=True,
                            secure=secure, samesite="lax", path="/")
        return response

    @app.get("/auth/callback")
    def identity_callback(request: Request, state: str = "", code: str = "", error: str = ""):
        if not settings.identity_ready:
            raise HTTPException(503, "인증 공급자 설정이 필요합니다.")
        flow = providers.consume_flow("identity", state, request.cookies.get(flow_cookie, ""))
        if error or not code:
            raise HTTPException(400, "로그인이 취소되었거나 승인 코드가 없습니다.")
        _, identity = providers.exchange("identity", code, flow)
        response = RedirectResponse("/", status_code=303)
        response.delete_cookie(flow_cookie, path="/", secure=secure, httponly=True, samesite="lax")
        return new_session(settings.oidc_issuer, identity["sub"],
                           str(identity.get("name") or "사용자"), response,
                           request.cookies.get(session_cookie, ""))

    @app.post("/api/logout")
    def logout(session=Depends(mutation)):
        with db.connect() as conn:
            conn.execute("DELETE FROM sessions WHERE token_hash=?", (session["token_hash"],))
            conn.execute("DELETE FROM oauth_flows WHERE binding_hash=?", (session["token_hash"],))
        response = JSONResponse({"ok": True})
        response.delete_cookie(session_cookie, path="/", secure=secure, httponly=True, samesite="lax")
        return response

    @app.get("/api/tasks")
    def list_tasks(session=Depends(current_session)):
        with db.connect() as conn:
            return [dict(row) for row in conn.execute("SELECT * FROM tasks WHERE owner_id=? ORDER BY created_at DESC, id",
                                                     (session["user_id"],))]

    @app.post("/api/tasks", status_code=201)
    def create_task(body: TaskInput, session=Depends(mutation)):
        task_id, owner, now = str(uuid.uuid4()), session["user_id"], int(time.time())
        with db.connect() as conn:
            conn.execute("INSERT INTO tasks VALUES (?,?,?,?,?,?,?)",
                         (task_id, owner, body.title, body.notes, body.status, now, now))
        return dict(owned_task(task_id, owner))

    @app.get("/api/tasks/{task_id}")
    def get_task(task_id: str, session=Depends(current_session)):
        return dict(owned_task(task_id, session["user_id"]))

    @app.put("/api/tasks/{task_id}")
    def update_task(task_id: str, body: TaskInput, session=Depends(mutation)):
        owner = session["user_id"]
        owned_task(task_id, owner)
        with db.connect() as conn:
            conn.execute("UPDATE tasks SET title=?, notes=?, status=?, updated_at=? WHERE id=? AND owner_id=?",
                         (body.title, body.notes, body.status, int(time.time()), task_id, owner))
        return dict(owned_task(task_id, owner))

    @app.get("/api/drive")
    def drive_status(session=Depends(current_session)):
        owner = session["user_id"]
        with db.connect() as conn:
            real = conn.execute("SELECT email, folder_id FROM google_connections WHERE owner_id=?", (owner,)).fetchone()
            demo = conn.execute("SELECT folder_id FROM demo_connections WHERE owner_id=?", (owner,)).fetchone()
        return {"provider": "google" if real else ("demo" if demo and settings.test_storage else None),
                "connected": bool(real or (demo and settings.test_storage)),
                "folder_ready": bool(real["folder_id"] if real else (demo and settings.test_storage)),
                "email": real["email"] if real else None}

    @app.post("/api/google/connect")
    def google_connect(request: Request, session=Depends(mutation)):
        if not settings.google_ready:
            raise HTTPException(503, "서버의 Google OAuth Client ID와 Client Secret 설정이 필요합니다.")
        return {"url": providers.start_flow("google", request.cookies[session_cookie])}

    @app.get("/auth/google/callback")
    def google_callback(request: Request, state: str = "", code: str = "", error: str = "",
                        session=Depends(current_session)):
        if not settings.google_ready:
            raise HTTPException(503, "Google OAuth 설정이 필요합니다.")
        flow = providers.consume_flow("google", state, request.cookies[session_cookie])
        if error or not code:
            raise HTTPException(400, "Google 연결이 취소되었거나 승인 코드가 없습니다.")
        tokens, identity = providers.exchange("google", code, flow)
        scopes = set(tokens.get("scope", "").split())
        if not {DRIVE_SCOPE, "openid"}.issubset(scopes) or not tokens.get("access_token"):
            raise HTTPException(400, "전용 파일 접근 권한이 승인되지 않았습니다. 다시 연결해 주세요.")
        owner = session["user_id"]
        with locks[owner]:
            with db.connect() as conn:
                old = conn.execute("SELECT * FROM google_connections WHERE owner_id=?", (owner,)).fetchone()
                if old and old["google_sub"] != identity["sub"]:
                    raise HTTPException(409, "기존 파일 보호를 위해 같은 Google 계정으로 다시 연결해 주세요.")
                refresh = tokens.get("refresh_token")
                if not refresh and old:
                    refresh = providers.decrypt(owner, old["token_ciphertext"]).get("refresh_token")
                if not refresh:
                    raise HTTPException(409, "지속 연결 권한이 없습니다. Google 권한을 다시 승인해 주세요.")
                stored = {"access_token": tokens["access_token"], "refresh_token": refresh,
                          "expires_at": time.time() + int(tokens.get("expires_in", 3600))}
                try:
                    conn.execute("INSERT INTO google_connections VALUES (?,?,?,?,?,?) ON CONFLICT(owner_id) "
                                 "DO UPDATE SET email=excluded.email, token_ciphertext=excluded.token_ciphertext, "
                                 "updated_at=excluded.updated_at",
                                 (owner, identity["sub"], str(identity.get("email", "")),
                                  providers.encrypt(owner, stored), old["folder_id"] if old else "", int(time.time())))
                except sqlite3.IntegrityError:
                    raise HTTPException(409, "이 Google 계정은 다른 앱 사용자에 이미 연결되어 있습니다.") from None
            providers.ensure_folder(owner)
        return RedirectResponse("/?google=connected", status_code=303)

    @app.post("/api/google/folder")
    def retry_folder(session=Depends(mutation)):
        with locks[session["user_id"]]:
            providers.ensure_folder(session["user_id"])
        return {"ok": True}

    @app.get("/api/tasks/{task_id}/attachments")
    def list_attachments(task_id: str, session=Depends(current_session)):
        owner = session["user_id"]
        owned_task(task_id, owner)
        with db.connect() as conn:
            return [public_file(row) for row in conn.execute(
                "SELECT * FROM attachments WHERE task_id=? AND owner_id=? ORDER BY created_at, id", (task_id, owner))]

    def save_attachment(owner, task_id, name, body):
        file_id = str(uuid.uuid4())
        mime_type = mimetypes.guess_type(name)[0] or "application/octet-stream"
        with locks[owner]:
            with db.connect() as conn:
                real = conn.execute("SELECT 1 FROM google_connections WHERE owner_id=?", (owner,)).fetchone()
                demo = conn.execute("SELECT 1 FROM demo_connections WHERE owner_id=?", (owner,)).fetchone()
            if real:
                remote_id, provider = providers.upload(owner, name, body), "google"
            elif demo and settings.test_storage:
                remote_id, provider = file_id, "demo"
            else:
                raise HTTPException(409, "먼저 파일 저장소를 연결해 주세요.")
            try:
                with db.connect() as conn:
                    conn.execute("INSERT INTO attachments VALUES (?,?,?,?,?,?,?,?,?)",
                                 (file_id, owner, task_id, name, mime_type, len(body), provider, remote_id, int(time.time())))
                    if provider == "demo":
                        conn.execute("INSERT INTO demo_blobs VALUES (?,?)", (file_id, body))
            except Exception:
                if provider == "google":
                    providers.delete_uploaded(owner, remote_id)
                raise
        return public_file(owned_attachment(file_id, owner))

    @app.post("/api/tasks/{task_id}/attachments", status_code=201)
    async def upload(task_id: str, request: Request, session=Depends(mutation)):
        owner = session["user_id"]
        owned_task(task_id, owner)
        name = unquote(request.headers.get("x-file-name", "")).replace("\\", "/").split("/")[-1]
        if not name or name in (".", "..") or len(name) > 200 or any(ord(c) < 32 or ord(c) == 127 for c in name):
            raise HTTPException(400, "올바른 파일 이름이 필요합니다.")
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > settings.max_upload:
                raise HTTPException(413, "첨부파일은 최대 10MB입니다.")
        return await asyncio.to_thread(save_attachment, owner, task_id, name, bytes(body))

    @app.get("/api/attachments/{file_id}")
    def file_metadata(file_id: str, session=Depends(current_session)):
        return public_file(owned_attachment(file_id, session["user_id"]))

    @app.get("/api/attachments/{file_id}/content")
    def file_content(file_id: str, session=Depends(current_session)):
        owner = session["user_id"]
        file = owned_attachment(file_id, owner)
        if file["provider"] == "google":
            with locks[owner]:
                body = providers.download(owner, file["remote_id"])
        elif settings.test_storage:
            with db.connect() as conn:
                body = conn.execute("SELECT body FROM demo_blobs WHERE attachment_id=?", (file_id,)).fetchone()["body"]
        else:
            raise HTTPException(404, "시험용 파일은 운영 환경에서 열 수 없습니다.")
        return Response(body, media_type="application/octet-stream",
                        headers={"Content-Disposition": "attachment; filename*=UTF-8''" + quote(file["name"], safe="")})

    static = Path(__file__).parent / "static"
    app.mount("/static", StaticFiles(directory=static), name="static")

    @app.get("/")
    def index():
        return FileResponse(static / "index.html")

    return app
