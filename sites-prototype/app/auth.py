"""Identity-independent sessions. Sites integration can replace the identity route,
but must call issue() only after verifying the platform's documented credentials.
"""
import secrets
import time
import uuid

from fastapi import HTTPException, Request

from .providers import digest


class SessionAuth:
    def __init__(self, db, settings):
        self.db = db
        self.secure = not settings.dev_mode
        self.cookie = "wm_session" if settings.dev_mode else "__Host-wm_session"

    def current(self, request: Request):
        token = request.cookies.get(self.cookie, "")
        with self.db.connect() as conn:
            row = conn.execute("SELECT s.*, u.display_name, u.issuer FROM sessions s JOIN users u "
                               "ON u.id=s.user_id WHERE token_hash=? AND expires_at>?",
                               (digest(token), int(time.time()))).fetchone()
        if not row:
            raise HTTPException(401, "로그인이 필요합니다.")
        return row

    def mutation(self, request: Request):
        session = self.current(request)
        if not secrets.compare_digest(request.headers.get("x-csrf-token", ""), session["csrf"]):
            raise HTTPException(403, "보안 토큰이 만료되었습니다. 화면을 새로 고쳐 주세요.")
        return session

    def issue(self, issuer, subject, display_name, response, old_token=""):
        token = secrets.token_urlsafe(32)
        with self.db.connect() as conn:
            conn.execute("INSERT INTO users VALUES (?,?,?,?,?) ON CONFLICT(issuer,subject) "
                         "DO UPDATE SET display_name=excluded.display_name",
                         (str(uuid.uuid4()), issuer, subject, display_name[:100], int(time.time())))
            user = conn.execute("SELECT id FROM users WHERE issuer=? AND subject=?", (issuer, subject)).fetchone()
            conn.execute("DELETE FROM sessions WHERE token_hash=? OR expires_at<=?",
                         (digest(old_token), int(time.time())))
            conn.execute("INSERT INTO sessions VALUES (?,?,?,?)",
                         (digest(token), user["id"], secrets.token_urlsafe(32), int(time.time()) + 28800))
        response.set_cookie(self.cookie, token, max_age=28800, httponly=True,
                            secure=self.secure, samesite="lax", path="/")
        return response
