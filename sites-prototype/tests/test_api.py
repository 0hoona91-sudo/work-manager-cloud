import json
import sqlite3
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import httpx
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.providers import DRIVE_SCOPE, challenge
from tests.support import FakeGoogle, seed_session, seed_storage


class API(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.settings = Settings(Path(self.temp.name), "http://127.0.0.1:8080", Fernet.generate_key().decode(),
            dev_mode=True, test_storage=True, google_client_id="google-client", google_client_secret="fixture-secret",
            oidc_issuer="https://identity.example", oidc_client_id="identity-client", oidc_client_secret="fixture-secret",
            oidc_authorize_url="https://identity.example/authorize", oidc_token_url="https://identity.example/token",
            oidc_jwks_url="https://identity.example/jwks")
        self.fake = FakeGoogle()
        self.app = create_app(self.settings, transport=httpx.MockTransport(self.fake.transport))
        self.fake.app = self.app
        self.a, self.b, self.anon = [TestClient(self.app, base_url=self.settings.base_url,
                                                client=("127.0.0.1", 12345)) for _ in range(3)]
        self.ua, self.ub = seed_session(self.app, self.a, "a"), seed_session(self.app, self.b, "b")
        seed_storage(self.app, self.ua); seed_storage(self.app, self.ub)

    def tearDown(self):
        for client in (self.a, self.b, self.anon):
            client.close()
        self.app.state.providers.client.close()
        self.temp.cleanup()

    def task(self, client=None, title="설비 점검"):
        response = (client or self.a).post("/api/tasks", json={"title": title, "notes": "private"})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def upload(self, task, client=None, body=b"private-file", name="note.txt"):
        return (client or self.a).post(f"/api/tasks/{task['id']}/attachments", content=body,
                                       headers={"X-File-Name": name, "Content-Type": "application/octet-stream"})

    def begin_google(self, client=None):
        response = (client or self.a).post("/api/google/connect")
        self.assertEqual(response.status_code, 200, response.text)
        params = parse_qs(urlsplit(response.json()["url"]).query)
        self.fake.remember_nonce("google")
        return params

    def connect_google(self, subject="google-a", client=None):
        params = self.begin_google(client)
        return (client or self.a).get("/auth/google/callback", params={"state": params["state"][0], "code": subject}, follow_redirects=False)

    def test_01_shell_and_fail_closed(self):
        self.assertEqual(self.anon.get("/").status_code, 200)
        self.assertEqual(self.anon.get("/healthz").json(), {"status": "ok"})
        for path in ("/api/me", "/api/tasks", "/api/drive", "/api/tasks/x", "/api/attachments/x/content"):
            self.assertEqual(self.anon.get(path).status_code, 401, path)
        self.assertEqual(self.anon.post("/api/tasks", headers={"Origin": self.settings.base_url}, json={"title": "x"}).status_code, 401)

    def test_02_task_create_read_update_and_persistence(self):
        task = self.task()
        updated = self.a.put("/api/tasks/" + task["id"], json={"title": "완료 점검", "status": "done"})
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(self.a.get("/api/tasks").json()[0]["status"], "done")
        reopened = create_app(self.settings, transport=httpx.MockTransport(self.fake.transport))
        with TestClient(reopened, base_url=self.settings.base_url, client=("127.0.0.1", 1)) as client:
            seed_session(reopened, client, "a")
            self.assertEqual(client.get("/api/tasks/" + task["id"]).json()["title"], "완료 점검")

    def test_03_two_users_cannot_read_update_or_attach(self):
        task = self.task()
        self.assertEqual(self.b.get("/api/tasks").json(), [])
        for path in (f"/api/tasks/{task['id']}", f"/api/tasks/{task['id']}/attachments"):
            self.assertEqual(self.b.get(path).status_code, 404)
        self.assertEqual(self.b.put("/api/tasks/" + task["id"], json={"title": "intrusion"}).status_code, 404)
        self.assertEqual(self.upload(task, self.b).status_code, 404)
        self.assertEqual(self.a.get("/api/tasks/" + task["id"]).json()["title"], task["title"])

    def test_04_attachment_roundtrip_and_idor(self):
        task = self.task()
        result = self.upload(task, body=b"<script>alert(1)</script>")
        self.assertEqual(result.status_code, 201)
        file = result.json()
        self.assertNotIn("remote_id", file)
        self.assertEqual(self.a.get(f"/api/tasks/{task['id']}/attachments").json(), [file])
        data = self.a.get(f"/api/attachments/{file['id']}/content")
        self.assertEqual(data.content, b"<script>alert(1)</script>")
        self.assertEqual(data.headers["content-type"], "application/octet-stream")
        self.assertTrue(data.headers["content-disposition"].startswith("attachment;"))
        for suffix in ("", "/content"):
            self.assertEqual(self.b.get(f"/api/attachments/{file['id']}" + suffix).status_code, 404)
            self.assertEqual(self.anon.get(f"/api/attachments/{file['id']}" + suffix).status_code, 401)

    def test_05_owner_spoofing_and_input_validation(self):
        for body in ({"title": "x", "owner_id": self.ub["id"]}, {"title": " "},
                     {"title": "x", "status": "bogus"}, {"title": "x" * 201}):
            self.assertEqual(self.a.post("/api/tasks", json=body).status_code, 422)

    def test_06_csrf_and_origin(self):
        for headers in ({"X-CSRF-Token": "invalid"}, {"Origin": "https://evil.example"}, {"Origin": "null"}):
            self.assertEqual(self.a.post("/api/tasks", json={"title": "x"}, headers=headers).status_code, 403)
        self.assertEqual(self.a.post("/api/tasks", json={"title": "x"}, headers={"X-CSRF-Token": ""}).status_code, 403)

    def test_07_logout_invalidates_session(self):
        token = self.a.cookies.get("wm_session")
        self.assertEqual(self.a.post("/api/logout").status_code, 200)
        self.a.cookies.set("wm_session", token)
        self.assertEqual(self.a.get("/api/tasks").status_code, 401)

    def test_08_expired_session_and_hashed_storage(self):
        token = self.a.cookies.get("wm_session")
        with self.app.state.db.connect() as conn:
            hashes = [r[0] for r in conn.execute("SELECT token_hash FROM sessions")]
            self.assertNotIn(token, hashes)
            conn.execute("UPDATE sessions SET expires_at=0 WHERE user_id=?", (self.ua["id"],))
        self.assertEqual(self.a.get("/api/tasks").status_code, 401)

    def test_09_composite_foreign_key_blocks_owner_mismatch(self):
        task = self.task()
        with self.assertRaises(sqlite3.IntegrityError), self.app.state.db.connect() as conn:
            conn.execute("INSERT INTO attachments VALUES (?,?,?,?,?,?,?,?,?)",
                         ("bad", self.ub["id"], task["id"], "x", "text/plain", 1, "demo", "x", 0))

    def test_10_file_size_and_filename_limits(self):
        task = self.task()
        self.assertEqual(self.upload(task, body=b"x" * (self.settings.max_upload + 1)).status_code, 413)
        self.assertEqual(self.upload(task, name="%0Aheader.txt").status_code, 400)
        result = self.upload(task, name="../../file.txt")
        self.assertEqual(result.json()["name"], "file.txt")

    def test_11_no_fake_login_routes(self):
        for route in ("/api/dev/login", "/api/dev/drive/connect"):
            self.assertEqual(self.a.post(route, json={"account": "b"}).status_code, 404)

    def test_12_google_pkce_scopes_and_redirect(self):
        params = self.begin_google()
        self.assertEqual(set(params["scope"][0].split()), {"openid", "email", DRIVE_SCOPE})
        self.assertEqual(params["redirect_uri"], [self.settings.base_url + "/auth/google/callback"])
        self.assertEqual(params["code_challenge_method"], ["S256"])
        with self.app.state.db.connect() as conn:
            flow = conn.execute("SELECT * FROM oauth_flows WHERE kind='google'").fetchone()
            self.assertEqual(params["code_challenge"][0], challenge(flow["verifier"]))
            self.assertNotEqual(params["state"][0], flow["state_hash"])

    def test_13_oauth_cross_session_replay_and_cancel(self):
        params = self.begin_google()
        callback = {"state": params["state"][0], "code": "google-a"}
        self.assertEqual(self.b.get("/auth/google/callback", params=callback).status_code, 400)
        self.assertEqual(self.a.get("/auth/google/callback", params=callback, follow_redirects=False).status_code, 303)
        self.assertEqual(self.a.get("/auth/google/callback", params=callback).status_code, 400)
        params = self.begin_google()
        self.assertEqual(self.a.get("/auth/google/callback", params={"state": params["state"][0], "error": "access_denied"}).status_code, 400)

    def test_14_expired_oauth_state(self):
        params = self.begin_google()
        with self.app.state.db.connect() as conn:
            conn.execute("UPDATE oauth_flows SET expires_at=0")
        self.assertEqual(self.a.get("/auth/google/callback", params={"state": params["state"][0], "code": "a"}).status_code, 400)

    def test_15_invalid_identity_claims(self):
        for claims in ({"aud": "attacker"}, {"iss": "https://attacker.example"}, {"nonce": "wrong"},
                       {"exp": 1}, {"azp": "attacker"}):
            self.fake.claim_overrides = claims
            self.assertEqual(self.connect_google().status_code, 401)
        self.assertEqual(self.fake.folder_creates, 0)

    def test_16_scope_denial_and_missing_refresh_token(self):
        self.fake.scope = "openid email"
        self.assertEqual(self.connect_google().status_code, 400)
        self.fake.scope += " " + DRIVE_SCOPE
        self.fake.include_refresh = False
        self.assertEqual(self.connect_google().status_code, 409)

    def test_17_encrypted_tokens_and_owner_binding(self):
        self.assertEqual(self.connect_google().status_code, 303)
        with self.app.state.db.connect() as conn:
            row = conn.execute("SELECT * FROM google_connections").fetchone()
        self.assertNotIn("access-google-a", row["token_ciphertext"])
        self.assertNotIn("refresh-google-a", row["token_ciphertext"])
        self.assertEqual(self.app.state.providers.decrypt(self.ua["id"], row["token_ciphertext"])["refresh_token"], "refresh-google-a")
        with self.assertRaises(Exception) as context:
            self.app.state.providers.decrypt(self.ub["id"], row["token_ciphertext"])
        self.assertEqual(context.exception.status_code, 503)
        self.assertNotIn("token", json.dumps(self.a.get("/api/drive").json()))

    def test_18_same_google_account_cannot_link_two_users(self):
        self.assertEqual(self.connect_google().status_code, 303)
        self.assertEqual(self.connect_google(client=self.b).status_code, 409)
        self.assertEqual(self.fake.folder_creates, 1)

    def test_19_reconnect_keeps_folder_and_refresh_token(self):
        self.assertEqual(self.connect_google().status_code, 303)
        self.fake.include_refresh = False
        self.assertEqual(self.connect_google().status_code, 303)
        self.assertEqual(self.fake.folder_creates, 1)
        self.assertEqual(self.connect_google("different-account").status_code, 409)

    def test_20_drive_roundtrip_refresh_and_cross_user_block(self):
        self.fake.expired = True
        self.assertEqual(self.connect_google().status_code, 303)
        self.assertGreaterEqual(self.fake.refreshes, 1)
        self.assertEqual(self.connect_google("google-b", self.b).status_code, 303)
        task = self.task()
        result = self.upload(task, body=b"actual-adapter-fixture")
        self.assertEqual(result.status_code, 201, result.text)
        file = result.json()
        self.assertEqual(file["provider"], "google")
        self.assertEqual(self.a.get(f"/api/attachments/{file['id']}/content").content, b"actual-adapter-fixture")
        count = len(self.fake.requests)
        self.assertEqual(self.b.get(f"/api/attachments/{file['id']}/content").status_code, 404)
        self.assertEqual(len(self.fake.requests), count, "IDOR must fail before calling Google")

    def test_21_failed_folder_can_be_retried(self):
        self.fake.fail_folder = True
        self.assertEqual(self.connect_google().status_code, 502)
        status = self.a.get("/api/drive").json()
        self.assertTrue(status["connected"]); self.assertFalse(status["folder_ready"])
        self.fake.fail_folder = False
        self.assertEqual(self.a.post("/api/google/folder").status_code, 200)
        self.assertTrue(self.a.get("/api/drive").json()["folder_ready"])

    def test_22_identity_oidc_protocol_not_chatgpt(self):
        start = self.anon.get("/auth/login", follow_redirects=False)
        self.assertEqual(start.status_code, 303)
        params = parse_qs(urlsplit(start.headers["location"]).query)
        self.fake.remember_nonce("identity")
        callback = self.anon.get("/auth/callback", params={"state": params["state"][0], "code": "identity-a"}, follow_redirects=False)
        self.assertEqual(callback.status_code, 303, callback.text)
        self.assertIn("HttpOnly", callback.headers["set-cookie"])
        self.assertEqual(self.anon.get("/api/me").json()["authentication"], "oidc")
        self.assertFalse(self.anon.get("/api/config").json()["sites_verified"])

    def test_23_unconfigured_provider_stays_unconnected(self):
        config = replace(self.settings, google_client_id="", google_client_secret="", oidc_issuer="", oidc_client_id="",
                         oidc_client_secret="", oidc_authorize_url="", oidc_token_url="", oidc_jwks_url="")
        app = create_app(config)
        with TestClient(app, base_url=config.base_url, client=("127.0.0.1", 1)) as client:
            self.assertEqual(client.get("/auth/login").status_code, 503)
            self.assertFalse(client.get("/api/config").json()["identity_configured"])
            seed_session(app, client, "a")
            self.assertEqual(client.post("/api/google/connect").status_code, 503)

    def test_24_production_has_secure_cookies_and_no_test_storage(self):
        config = replace(self.settings, dev_mode=False, test_storage=False, base_url="https://work.example")
        app = create_app(config)
        with TestClient(app, base_url=config.base_url) as client:
            seed_session(app, client, "a")
            self.assertIn("__Host-wm_session", client.cookies)
            response = client.get("/auth/login", follow_redirects=False)
            self.assertIn("Secure", response.headers["set-cookie"])
            self.assertIn("HttpOnly", response.headers["set-cookie"])
            self.assertEqual(client.post("/api/dev/login", json={"account": "a"}).status_code, 404)
            self.assertFalse(client.get("/api/drive").json()["connected"])
            self.assertNotIn("access-control-allow-origin", client.get("/").headers)

    def test_25_dev_public_origin_is_rejected(self):
        with self.assertRaises(ValueError):
            replace(self.settings, base_url="http://public.example")
        with TestClient(self.app, base_url=self.settings.base_url, client=("203.0.113.10", 1)) as client:
            self.assertEqual(client.get("/").status_code, 403)

    def test_26_spoofed_sites_headers_are_not_authentication(self):
        headers = {"oai-authenticated-user-email": "victim@example.com", "oai-authenticated-user-full-name": "Victim"}
        self.assertEqual(self.anon.get("/api/tasks", headers=headers).status_code, 401)
        self.assertEqual(self.anon.get("/api/me", headers=headers).status_code, 401)

    def test_27_chunked_json_body_limit(self):
        def chunks():
            for _ in range(40):
                yield b"x" * 1024
        self.assertEqual(self.a.post("/api/tasks", content=chunks(),
                                    headers={"Content-Type": "application/json"}).status_code, 413)

    def test_28_d1_candidate_sql_parses_and_is_repeatable_locally(self):
        sql = (Path(__file__).parents[1] / "sites-adapter/001_initial.sql").read_text()
        conn = sqlite3.connect(":memory:")
        try:
            conn.executescript(sql); conn.executescript(sql)
            tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            self.assertEqual(tables, {"users", "sessions", "oauth_flows", "tasks", "google_connections", "attachments"})
        finally:
            conn.close()

    def test_29_forged_signature_is_rejected(self):
        import jwt
        from cryptography.hazmat.primitives.asymmetric import rsa
        attacker_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        token = jwt.encode({"sub": "victim"}, attacker_key, algorithm="RS256", headers={"kid": "fixture"})
        with self.assertRaises(Exception) as context:
            self.app.state.providers.verify_id_token(token, audience="google-client",
                issuer="https://accounts.google.com", jwks_url="https://www.googleapis.com/oauth2/v3/certs", nonce="expected")
        self.assertEqual(context.exception.status_code, 401)


if __name__ == "__main__":
    unittest.main(verbosity=2)
