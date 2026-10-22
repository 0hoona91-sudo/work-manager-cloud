"""Test-only identities and provider fixtures; never imported by the application."""
import json
import time
from urllib.parse import parse_qs

import httpx
import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.responses import JSONResponse

from app.auth import SessionAuth
from app.providers import DRIVE_SCOPE


def seed_session(app, client, subject):
    # This bypass exists only in tests. The running app has no test-login endpoint.
    auth = SessionAuth(app.state.db, app.state.settings)
    response = auth.issue("urn:wm:local-test", subject, "시험 사용자 " + subject.upper(), JSONResponse({}))
    token = response.headers["set-cookie"].split(";", 1)[0].split("=", 1)[1]
    client.cookies.set(auth.cookie, token)
    user = client.get("/api/me").json()
    client.headers.update({"Origin": app.state.settings.base_url, "X-CSRF-Token": user["csrf"]})
    return user


def seed_storage(app, user):
    with app.state.db.connect() as conn:
        conn.execute("INSERT INTO demo_connections VALUES (?,?)", (user["id"], "fixture-folder-" + user["id"]))


class FakeGoogle:
    """Signed test identity tokens and isolated in-memory Drive, no external calls."""
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    def __init__(self):
        self.app = None
        self.requests = []
        self.claim_overrides = {}
        self.scope = "openid email " + DRIVE_SCOPE
        self.include_refresh = True
        self.expired = False
        self.fail_folder = False
        self.files = {}
        self.folders = {}
        self.folder_creates = 0
        self.uploads = 0
        self.refreshes = 0
        self.id_subject = None

    def transport(self, request):
        self.requests.append(request)
        path = request.url.path
        if path in ("/oauth2/v3/certs", "/jwks"):
            key = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(self.private_key.public_key()))
            return httpx.Response(200, json={"keys": [{**key, "kid": "fixture", "alg": "RS256", "use": "sig"}]})
        if path in ("/token", "/oauth2/token"):
            body = parse_qs(request.content.decode())
            if body["grant_type"] == ["refresh_token"]:
                self.refreshes += 1
                subject = body["refresh_token"][0].removeprefix("refresh-")
                return httpx.Response(200, json={"access_token": "access-" + subject, "expires_in": 3600})
            google = request.url.host == "oauth2.googleapis.com"
            subject = self.id_subject or body["code"][0]
            # The consumed flow is gone from DB; tests set nonce before the callback.
            claims = {"iss": "https://accounts.google.com" if google else "https://identity.example",
                      "aud": "google-client" if google else "identity-client", "sub": subject,
                      "email": subject + "@example.test", "name": "Fixture " + subject,
                      "iat": int(time.time()) - 10, "exp": int(time.time()) + 300,
                      "nonce": self.nonce, **self.claim_overrides}
            token = jwt.encode(claims, self.private_key, algorithm="RS256", headers={"kid": "fixture"})
            data = {"access_token": "access-" + subject, "expires_in": -1 if self.expired else 3600,
                    "scope": self.scope, "id_token": token}
            if self.include_refresh:
                data["refresh_token"] = "refresh-" + subject
            return httpx.Response(200, json=data)
        subject = request.headers.get("authorization", "").removeprefix("Bearer access-")
        if path == "/drive/v3/files" and request.method == "GET":
            return httpx.Response(200, json={"files": []})
        if path == "/drive/v3/files" and request.method == "POST":
            if self.fail_folder:
                return httpx.Response(503, json={"error": "fixture failure"})
            self.folder_creates += 1
            folder_id = "folder-" + subject
            self.folders[folder_id] = subject
            return httpx.Response(200, json={"id": folder_id})
        if path == "/upload/drive/v3/files":
            self.uploads += 1
            file_id = "file-" + str(self.uploads)
            # Multipart body: retain only media bytes for a realistic round trip.
            body = request.content.split(b"Content-Type: application/octet-stream\r\n\r\n", 1)[1].rsplit(b"\r\n--", 1)[0]
            self.files[file_id] = (subject, body)
            return httpx.Response(200, json={"id": file_id, "size": len(body)})
        file_id = path.rsplit("/", 1)[-1]
        if file_id in self.folders and self.folders[file_id] == subject:
            return httpx.Response(200, json={"id": file_id, "trashed": False, "mimeType": "application/vnd.google-apps.folder"})
        if file_id in self.files and self.files[file_id][0] == subject:
            if request.method == "DELETE":
                del self.files[file_id]
                return httpx.Response(204)
            return httpx.Response(200, content=self.files[file_id][1])
        return httpx.Response(404, json={"error": "not found"})

    def remember_nonce(self, kind):
        with self.app.state.db.connect() as conn:
            self.nonce = conn.execute("SELECT nonce FROM oauth_flows WHERE kind=? ORDER BY rowid DESC", (kind,)).fetchone()["nonce"]
