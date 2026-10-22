"""Run from sites-prototype. --dev allows loopback HTTP, never fake login."""
import argparse
import os
from pathlib import Path

import uvicorn
from cryptography.fernet import Fernet

from app.config import Settings
from app.main import create_app

parser = argparse.ArgumentParser()
parser.add_argument("--dev", action="store_true", help="loopback HTTP development; authentication remains required")
parser.add_argument("--port", type=int, default=8080)
args = parser.parse_args()
os.umask(0o077)
if args.dev:
    os.environ["WM_DEV_MODE"] = "1"
    os.environ.setdefault("APP_BASE_URL", f"http://127.0.0.1:{args.port}")
    data = Path(os.environ.get("WM_DATA_DIR", ".data"))
    data.mkdir(mode=0o700, parents=True, exist_ok=True)
    key_path = data / "development-token.key"
    if not os.environ.get("TOKEN_ENCRYPTION_KEY"):
        if not key_path.exists():
            with key_path.open("xb") as handle:
                handle.write(Fernet.generate_key())
        os.environ["TOKEN_ENCRYPTION_KEY"] = key_path.read_text()
elif os.environ.get("WM_DEV_MODE") == "1":
    raise SystemExit("Use --dev explicitly for local HTTP; never enable it in production.")

config = Settings.from_env()
# Disable access logs so OAuth callback codes never enter request logs.
# Production should use a TLS reverse proxy to this loopback listener.
uvicorn.run(create_app(config), host="127.0.0.1", port=args.port,
            access_log=False, proxy_headers=False)
