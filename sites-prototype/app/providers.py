"""Server-only OAuth/OIDC and Drive clients. No browser-supplied identity is trusted."""
import base64
import hashlib
import json
import secrets
import time
from urllib.parse import urlencode, quote

import httpx
import jwt
from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException

GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN = "https://oauth2.googleapis.com/token"
GOOGLE_JWKS = "https://www.googleapis.com/oauth2/v3/certs"
DRIVE_API = "https://www.googleapis.com/drive/v3/files"
DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file"
GOOGLE_SCOPES = "openid email " + DRIVE_SCOPE


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def challenge(verifier):
    return base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()


class Providers:
    def __init__(self, settings, db, transport=None):
        self.settings, self.db = settings, db
        self.client = httpx.Client(timeout=25, follow_redirects=False, transport=transport)
        self.fernet = Fernet(settings.encryption_key.encode())

    def json_request(self, method, url, **kwargs):
        try:
            response = self.client.request(method, url, **kwargs)
            if response.status_code == 401:
                raise HTTPException(409, "Google 연결이 만료되었습니다. 다시 연결해 주세요.")
            if response.status_code >= 400:
                raise HTTPException(502, f"외부 인증/저장 서비스 요청 실패 (HTTP {response.status_code})")
            return response.json()
        except (httpx.HTTPError, ValueError):
            raise HTTPException(502, "외부 인증/저장 서비스에 연결하지 못했습니다.") from None

    def verify_id_token(self, token, *, audience, issuer, jwks_url, nonce):
        try:
            header = jwt.get_unverified_header(token)
            keys = self.json_request("GET", jwks_url)["keys"]
            key = next(k for k in keys if k.get("kid") == header.get("kid")
                       and k.get("kty") == "RSA" and k.get("use", "sig") == "sig"
                       and k.get("alg", "RS256") == "RS256")
            claims = jwt.decode(token, jwt.PyJWK.from_dict(key).key, algorithms=["RS256"],
                                audience=audience, issuer=issuer,
                                options={"require": ["exp", "iat", "iss", "aud", "sub", "nonce"]})
            if not isinstance(claims["sub"], str) or not claims["sub"]:
                raise ValueError()
            if not secrets.compare_digest(str(claims["nonce"]), nonce):
                raise ValueError()
            if (isinstance(claims["aud"], list) and len(claims["aud"]) > 1
                    and claims.get("azp") != audience):
                raise ValueError()
            if claims.get("azp", audience) != audience:
                raise ValueError()
            return claims
        except (jwt.PyJWTError, ValueError, KeyError, StopIteration, TypeError):
            raise HTTPException(401, "로그인 토큰 검증에 실패했습니다.") from None

    def start_flow(self, kind, binding):
        state, verifier, nonce = (secrets.token_urlsafe(32) for _ in range(3))
        with self.db.connect() as conn:
            conn.execute("DELETE FROM oauth_flows WHERE expires_at <= ?", (int(time.time()),))
            conn.execute("INSERT INTO oauth_flows VALUES (?,?,?,?,?,?)",
                         (digest(state), kind, digest(binding), verifier, nonce, int(time.time()) + 600))
        google = kind == "google"
        config = self.settings
        params = dict(response_type="code", client_id=config.google_client_id if google else config.oidc_client_id,
                      redirect_uri=config.base_url + ("/auth/google/callback" if google else "/auth/callback"),
                      scope=GOOGLE_SCOPES if google else "openid profile email", state=state, nonce=nonce,
                      code_challenge=challenge(verifier), code_challenge_method="S256")
        if google:
            params.update(access_type="offline", prompt="consent select_account")
        return (GOOGLE_AUTH if google else config.oidc_authorize_url) + "?" + urlencode(params)

    def consume_flow(self, kind, state, binding):
        with self.db.connect() as conn:
            row = conn.execute(
                "DELETE FROM oauth_flows WHERE state_hash=? AND kind=? AND binding_hash=? AND expires_at>? RETURNING *",
                (digest(state), kind, digest(binding), int(time.time()))).fetchone()
        if not row:
            raise HTTPException(400, "로그인 요청이 만료되었거나 현재 세션과 다릅니다. 다시 시작해 주세요.")
        return row

    def exchange(self, kind, code, flow):
        config = self.settings
        google = kind == "google"
        result = self.json_request("POST", GOOGLE_TOKEN if google else config.oidc_token_url,
            data=dict(grant_type="authorization_code", code=code, code_verifier=flow["verifier"],
                      client_id=config.google_client_id if google else config.oidc_client_id,
                      client_secret=config.google_client_secret if google else config.oidc_client_secret,
                      redirect_uri=config.base_url + ("/auth/google/callback" if google else "/auth/callback")))
        identity = self.verify_id_token(result.get("id_token", ""),
            audience=config.google_client_id if google else config.oidc_client_id,
            issuer=["https://accounts.google.com", "accounts.google.com"] if google else config.oidc_issuer,
            jwks_url=GOOGLE_JWKS if google else config.oidc_jwks_url, nonce=flow["nonce"])
        return result, identity

    def encrypt(self, owner, tokens):
        return self.fernet.encrypt(json.dumps({"owner": owner, "tokens": tokens}).encode()).decode()

    def decrypt(self, owner, encrypted):
        try:
            data = json.loads(self.fernet.decrypt(encrypted.encode()))
            if data["owner"] != owner:
                raise ValueError()
            return data["tokens"]
        except (InvalidToken, ValueError, KeyError):
            raise HTTPException(503, "저장된 연결 정보를 복호화하지 못했습니다. 서버 설정을 확인해 주세요.") from None

    def connection(self, owner):
        with self.db.connect() as conn:
            row = conn.execute("SELECT * FROM google_connections WHERE owner_id=?", (owner,)).fetchone()
        if not row:
            raise HTTPException(409, "먼저 Google Drive를 연결해 주세요.")
        return row

    def access_token(self, owner):
        row = self.connection(owner)
        tokens = self.decrypt(owner, row["token_ciphertext"])
        if tokens["expires_at"] > time.time() + 60:
            return tokens["access_token"]
        refresh = self.json_request("POST", GOOGLE_TOKEN, data={
            "grant_type": "refresh_token", "refresh_token": tokens["refresh_token"],
            "client_id": self.settings.google_client_id, "client_secret": self.settings.google_client_secret})
        if not refresh.get("access_token"):
            raise HTTPException(409, "Google Drive를 다시 연결해 주세요.")
        tokens.update(access_token=refresh["access_token"],
                      expires_at=time.time() + int(refresh.get("expires_in", 3600)))
        if refresh.get("refresh_token"):
            tokens["refresh_token"] = refresh["refresh_token"]
        with self.db.connect() as conn:
            conn.execute("UPDATE google_connections SET token_ciphertext=?, updated_at=? WHERE owner_id=?",
                         (self.encrypt(owner, tokens), int(time.time()), owner))
        return tokens["access_token"]

    def headers(self, owner):
        return {"Authorization": "Bearer " + self.access_token(owner)}

    def ensure_folder(self, owner):
        row = self.connection(owner)
        headers = self.headers(owner)
        if row["folder_id"]:
            meta = self.json_request("GET", DRIVE_API + "/" + quote(row["folder_id"], safe=""),
                                     headers=headers, params={"fields": "id,trashed,mimeType"})
            if not meta.get("trashed") and meta.get("mimeType") == "application/vnd.google-apps.folder":
                return row["folder_id"]
        # owner is a server-generated UUID, never a client query fragment.
        data = self.json_request("GET", DRIVE_API, headers=headers, params={
            "q": "trashed=false and mimeType='application/vnd.google-apps.folder' and "
                 "appProperties has { key='wm_owner' and value='" + owner + "' }",
            "fields": "files(id)", "pageSize": 100})
        folders = data.get("files", [])
        folder = folders[0]["id"] if folders else self.json_request("POST", DRIVE_API,
            headers=headers, params={"fields": "id"}, json={"name": "업무관리시스템 전용 파일",
            "mimeType": "application/vnd.google-apps.folder",
            "appProperties": {"wm_owner": owner, "wm_app": "sites-phase1"}})["id"]
        with self.db.connect() as conn:
            conn.execute("UPDATE google_connections SET folder_id=? WHERE owner_id=?", (folder, owner))
        return folder

    def upload(self, owner, name, body):
        folder = self.ensure_folder(owner)
        boundary = "wm_" + secrets.token_hex(20)
        metadata = json.dumps({"name": name, "parents": [folder]}, ensure_ascii=False).encode()
        data = (f"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n".encode()
                + metadata + f"\r\n--{boundary}\r\nContent-Type: application/octet-stream\r\n\r\n".encode()
                + body + f"\r\n--{boundary}--\r\n".encode())
        return self.json_request("POST", "https://www.googleapis.com/upload/drive/v3/files",
            params={"uploadType": "multipart", "fields": "id,size"}, content=data,
            headers={**self.headers(owner), "Content-Type": f"multipart/related; boundary={boundary}"})["id"]

    def download(self, owner, remote_id):
        try:
            with self.client.stream("GET", DRIVE_API + "/" + quote(remote_id, safe=""),
                                    headers=self.headers(owner), params={"alt": "media"}) as response:
                if response.status_code != 200:
                    raise HTTPException(502, "Drive 파일을 가져오지 못했습니다. 연결과 파일 상태를 확인해 주세요.")
                body = bytearray()
                for chunk in response.iter_bytes():
                    body.extend(chunk)
                    if len(body) > self.settings.max_upload:
                        raise HTTPException(413, "시험판의 파일 크기 제한을 초과했습니다.")
                return bytes(body)
        except httpx.HTTPError:
            raise HTTPException(502, "Drive 파일을 가져오지 못했습니다.") from None

    def delete_uploaded(self, owner, remote_id):
        try:
            self.client.delete(DRIVE_API + "/" + quote(remote_id, safe=""), headers=self.headers(owner))
        except (httpx.HTTPError, HTTPException):
            pass  # Best effort compensation; see the operations guide for orphan reconciliation.
