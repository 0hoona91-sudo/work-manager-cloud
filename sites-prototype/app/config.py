import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

from cryptography.fernet import Fernet


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    base_url: str
    encryption_key: str
    dev_mode: bool = False
    test_storage: bool = False  # Only injected by automated tests, never read from environment.
    google_client_id: str = ""
    google_client_secret: str = ""
    oidc_issuer: str = ""
    oidc_client_id: str = ""
    oidc_client_secret: str = ""
    oidc_authorize_url: str = ""
    oidc_token_url: str = ""
    oidc_jwks_url: str = ""
    max_upload: int = 10 * 1024 * 1024

    def __post_init__(self):
        url = urlsplit(self.base_url)
        if url.path not in ("", "/") or url.query or url.fragment or url.username:
            raise ValueError("APP_BASE_URL must be an origin without a path")
        local = url.hostname in ("localhost", "127.0.0.1", "::1")
        if self.dev_mode and not (local and url.scheme == "http"):
            raise ValueError("Local development requires an HTTP loopback origin")
        if self.test_storage and not self.dev_mode:
            raise ValueError("Test storage cannot be enabled in production")
        if not self.dev_mode and url.scheme != "https":
            raise ValueError("Production requires an HTTPS APP_BASE_URL")
        if bool(self.google_client_id) != bool(self.google_client_secret):
            raise ValueError("Both Google client settings are required")
        oidc = [self.oidc_issuer, self.oidc_client_id, self.oidc_client_secret,
                self.oidc_authorize_url, self.oidc_token_url, self.oidc_jwks_url]
        if any(oidc) and not all(oidc):
            raise ValueError("Configure all six OIDC fields or leave them all unset")
        for value in [self.oidc_issuer, self.oidc_authorize_url,
                      self.oidc_token_url, self.oidc_jwks_url]:
            if value:
                parsed = urlsplit(value)
                if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.fragment:
                    raise ValueError("OIDC endpoints must use trusted HTTPS URLs")
        Fernet(self.encryption_key.encode())

    @property
    def google_ready(self):
        return bool(self.google_client_id and self.google_client_secret)

    @property
    def identity_ready(self):
        return bool(self.oidc_issuer)

    @classmethod
    def from_env(cls):
        return cls(
            data_dir=Path(os.environ.get("WM_DATA_DIR", ".data")),
            base_url=os.environ.get("APP_BASE_URL", "http://127.0.0.1:8080").rstrip("/"),
            encryption_key=os.environ.get("TOKEN_ENCRYPTION_KEY", ""),
            dev_mode=os.environ.get("WM_DEV_MODE") == "1",
            **{field: os.environ.get(field.upper(), "") for field in (
                "google_client_id", "google_client_secret", "oidc_issuer",
                "oidc_client_id", "oidc_client_secret", "oidc_authorize_url",
                "oidc_token_url", "oidc_jwks_url")},
        )
