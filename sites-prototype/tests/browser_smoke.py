"""Real Chromium UI test. All identities/storage live only in a temporary test DB.
Requires Playwright and an installed Chromium; no external Google calls occur.
"""
import json
import os
import socket
import tempfile
import threading
import time
from pathlib import Path

import httpx
import uvicorn
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from playwright.sync_api import sync_playwright

from app.config import Settings
from app.main import create_app
from tests.support import seed_session, seed_storage


def run():
    output = Path("test-results")
    output.mkdir(exist_ok=True)
    results = []
    with tempfile.TemporaryDirectory() as directory:
        sock = socket.socket()
        sock.bind(("127.0.0.1", 0))
        origin = f"http://127.0.0.1:{sock.getsockname()[1]}"
        settings = Settings(Path(directory), origin, Fernet.generate_key().decode(), dev_mode=True, test_storage=True)
        app = create_app(settings)
        cookies = {}
        for subject in ("a", "b"):
            with TestClient(app, base_url=origin, client=("127.0.0.1", 1)) as client:
                user = seed_session(app, client, subject)
                seed_storage(app, user)
                cookies[subject] = client.cookies.get("wm_session")
        # TestClient lifespan closed this client's network pool; no external provider is needed here.
        server = uvicorn.Server(uvicorn.Config(app, access_log=False, log_level="warning", proxy_headers=False))
        thread = threading.Thread(target=lambda: server.run(sockets=[sock]), daemon=True)
        thread.start()
        try:
            for _ in range(100):
                if server.started:
                    break
                time.sleep(.05)
            assert server.started, "server failed to start"
            with sync_playwright() as p:
                browser = p.chromium.launch(executable_path=os.environ.get("CHROMIUM_PATH", "/usr/bin/chromium"), headless=True, args=["--no-sandbox"])
                errors = []
                guest = browser.new_context(viewport={"width": 1440, "height": 1000})
                page = guest.new_page()
                page.on("pageerror", lambda e: errors.append(str(e)))
                page.goto(origin); page.get_by_text("로그인 미연결", exact=True).wait_for()
                assert page.get_by_role("button", name="ChatGPT 로그인 · 연결 필요").is_disabled()
                assert page.get_by_role("button", name="＋ 새 업무").is_disabled()
                assert page.get_by_text("시험 사용자 A", exact=True).count() == 0
                page.screenshot(path=str(output / "signed-out-desktop.png"), full_page=True)
                page.set_viewport_size({"width": 390, "height": 844})
                assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "mobile horizontal overflow"
                page.screenshot(path=str(output / "signed-out-mobile.png"), full_page=True)
                results.append("Signed-out desktop/mobile: no fake login, protected actions disabled, no overflow")

                a, b = [browser.new_context(viewport={"width": 1440, "height": 1000}, accept_downloads=True) for _ in range(2)]
                for context, subject in ((a, "a"), (b, "b")):
                    context.add_cookies([{"name": "wm_session", "value": cookies[subject], "url": origin, "httpOnly": True, "sameSite": "Lax"}])
                pa, pb = a.new_page(), b.new_page()
                pa.on("pageerror", lambda e: errors.append(str(e)))
                pb.on("pageerror", lambda e: errors.append(str(e)))
                pa.goto(origin)
                pa.get_by_role("button", name="＋ 새 업무").click()
                pa.get_by_label("업무명", exact=True).fill("분기 시설 점검")
                pa.get_by_label("상태", exact=True).select_option("doing")
                pa.get_by_label("업무 메모", exact=True).fill("A 사용자만 볼 수 있는 점검 업무")
                pa.get_by_role("button", name="저장", exact=True).click()
                pa.locator(".task-row").filter(has_text="분기 시설 점검").wait_for()
                task_id = pa.locator(".task-row").first.get_attribute("data-task-id")
                pa.reload(); pa.locator(".task-row").filter(has_text="분기 시설 점검").wait_for()
                pa.screenshot(path=str(output / "authenticated-test-fixture.png"), full_page=True)
                results.append("A creates a task through UI; database record survives reload")
                pa.locator(".task-row").first.click()
                payload = "A의 첨부파일\n<script>window.attachmentExecuted=true</script>".encode()
                pa.get_by_label("첨부파일 업로드").set_input_files({"name": "점검메모.txt", "mimeType": "text/plain", "buffer": payload})
                pa.get_by_role("link", name="다운로드", exact=True).wait_for()
                href = pa.get_by_role("link", name="다운로드", exact=True).get_attribute("href")
                pa.get_by_role("button", name="조회", exact=True).click()
                pa.locator("#previewText").filter(has_text="A의 첨부파일").wait_for()
                assert not pa.evaluate("Boolean(window.attachmentExecuted)"), "attachment HTML executed"
                pa.get_by_role("button", name="파일 조회 닫기", exact=True).click()
                with pa.expect_download() as download_event:
                    pa.get_by_role("link", name="다운로드", exact=True).click()
                download = download_event.value
                assert download.suggested_filename == "점검메모.txt"
                assert Path(download.path()).read_bytes() == payload
                results.append("A uploads, safely views text, and downloads identical bytes with Korean filename")
                pa.get_by_label("상태", exact=True).select_option("done")
                pa.get_by_role("button", name="저장", exact=True).click()
                pa.locator(".task-row .status.done").wait_for()
                assert pa.locator("#countDone").inner_text() == "1"
                results.append("Status update and completed count verified in browser")

                pb.goto(origin); pb.get_by_text("시험 사용자 B", exact=True).wait_for()
                assert pb.locator(".task-row").count() == 0
                assert b.request.get(origin + f"/api/tasks/{task_id}").status == 404
                assert b.request.get(origin + href).status == 404
                assert b.request.get(origin + href.removesuffix("/content")).status == 404
                bme = b.request.get(origin + "/api/me").json()
                assert b.request.put(origin + f"/api/tasks/{task_id}", data={"title": "B tries to overwrite"},
                                     headers={"Origin": origin, "X-CSRF-Token": bme["csrf"]}).status == 404
                results.append("Separate browser B cannot list/read/update A's task or read/download A's attachment")
                pa.get_by_role("button", name="로그아웃", exact=True).click()
                pa.get_by_text("로그인 미연결", exact=True).wait_for()
                assert a.request.get(origin + href).status == 401
                results.append("Logout clears session; former attachment URL returns 401")
                assert not errors, errors
                results.append("No JavaScript page errors in guest/A/B flows")
                browser.close()
        finally:
            server.should_exit = True
            thread.join(timeout=10)
            sock.close()
    report = {"passed": len(results), "failed": 0, "checks": results,
              "limitations": "Test fixture identities and local storage only; no ChatGPT or Google production login tested."}
    (output / "browser-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    run()
