# Google OAuth 설정 안내서

실제 자격증명과 Google 계정 승인은 제공되지 않아 외부 연동은 아직 검증하지 않았다. 아래 작업은 앱 운영자가 한 번 수행한다. 이후 일반 사용자는 앱 로그인 후 **Google Drive 연결 → Google 계정 선택 → 권한 동의**만 수행하도록 구현했다. 사용자가 API 키나 Firebase 프로젝트를 만들 필요는 없다.

## 1. 운영자: Google Cloud 프로젝트

1. <https://console.cloud.google.com/>에서 신규 프로젝트를 만든다. 기존 운영 시스템 프로젝트를 수정하지 않는 것을 권장한다.
2. **APIs & Services → Library → Google Drive API → Enable**로 Drive API를 활성화한다.
3. **Google Auth platform → Branding**에서 앱 이름, 지원 이메일, 개발자 연락처를 설정한다. 운영 시 실제 사이트 홈페이지와 신규 개인정보 처리방침 URL을 등록한다. 기존 Firebase 사이트의 개인정보 문서를 그대로 사용하지 않는다.
4. **Google Auth platform → Audience**에서 사용할 audience를 선택한다. 일반 Google 계정 두 개로 시험하려면 External / Testing으로 시작하고 **Test users**에 두 Google 이메일을 추가한다. Internal은 해당 Workspace 구성원으로 한정될 수 있다.
5. **Google Auth platform → Data Access → Add or remove scopes**에서 다음 권한만 구성한다.

```text
openid
https://www.googleapis.com/auth/userinfo.email
https://www.googleapis.com/auth/drive.file
```

요청 코드에서는 OpenID Connect의 `email` 단축 scope를 사용한다. Drive 문서상 `drive.file`은 권장되는 비민감 scope이며 앱이 생성하거나 사용자가 앱에 허용한 파일에 접근한다. 전체 `drive`, `drive.readonly`, `drive.metadata.readonly`, `drive.appdata`는 요청하지 않는다. 공개 운영 전 브랜드 검증 등 콘솔이 요구하는 검증을 확인한다. 비민감 scope라고 해서 모든 검증·게시 요구가 면제되는 것은 아니다.

## 2. 운영자: OAuth client

**Google Auth platform → Clients → Create client → Web application**을 선택한다.

- 이름: 예를 들어 `Work Manager Phase 1`.
- **Authorized redirect URIs**에 실제 origin과 정확히 일치하는 경로를 등록한다.
  - Sites: `https://실제-발급된-사이트-주소/auth/google/callback`
  - 독립 로컬 개발: `http://127.0.0.1:8080/auth/google/callback` 또는 `http://localhost:8080/auth/google/callback`. 실행 서버의 APP_BASE_URL과 동일한 주소 하나를 선택한다.
- 이 서버 code flow는 브라우저 GIS SDK를 사용하지 않는다. JavaScript origins 추가만으로 redirect URI 등록을 대체할 수 없다.
- 생성된 **Client ID**와 **Client secret**을 서버 설정에 입력한다. 비밀값을 GitHub, 프런트엔드 JS, 공개 문서, 채팅에 넣지 않는다.

도메인/포트/path/끝의 slash가 다르면 `redirect_uri_mismatch`가 발생한다. 사이트 URL 변경 후에는 Sites 설정과 Google client의 redirect URI를 함께 갱신한다.

## 3. 서버 설정 위치

Sites: <https://chatgpt.com/sites> → 대상 사이트 → **More actions → Settings** → hosted environment variables / secrets. 사이트 생성 전에는 입력할 대상 자체가 없다. 실제 Sites 어댑터를 연결한 후 해당 런타임에 맞춰 아래 값을 binding한다.

| 이름 | 종류 | 용도 |
|---|---|---|
| APP_BASE_URL | 일반 변수 | 실제 HTTPS 사이트 origin, 경로/끝 slash 없음 |
| GOOGLE_CLIENT_ID | 일반 변수 | 운영자 Google OAuth Web client ID |
| GOOGLE_CLIENT_SECRET | secret | 서버 전용 code 교환 자격증명 |
| TOKEN_ENCRYPTION_KEY | secret | 독립 Python 서버의 Fernet 토큰 암호화 키. Sites 런타임 이식 시 같은 수준의 암호화/키 관리 규격을 결정해야 함 |
| WM_DATA_DIR | 로컬 Python 변수 | 영구 SQLite 경로. Sites D1에서는 파일 경로 대신 실제 binding 사용 |

Python 독립 실행 환경에서는 `.env.example`을 `.env`로 복사해 로컬에서 편집하고 실행 전에 shell에 읽어들인다. `.env`는 이미 Git에서 제외된다.

```bash
set -a
. ./.env
set +a
.venv/bin/python run.py --dev
```

로컬 `--dev`는 빈 TOKEN_ENCRYPTION_KEY 대신 `.data/development-token.key`를 생성한다. 운영 키로 자동 승격하지 않는다. 운영 키는 비밀 관리 도구에서 안전하게 생성·저장하고 유지해야 한다. 키를 잃거나 바꾸면 저장된 연결을 복호화하지 못한다. 백업/회전 정책이 필요하다.

**독립 서버에서도 앱 인증을 먼저 연결해야 실제 Google 연결 버튼을 사용할 수 있다.** 현재 미연결 화면을 우회하는 가짜 로그인 endpoint는 없다. Sites에서는 공식 플랫폼 신원 어댑터를 연결하고, 별도 호스트에서는 선택적으로 문서화된 OIDC 제공자를 설정한다. ChatGPT의 client ID/issuer를 임의로 만들지 않는다.

## 4. 실제 동작 확인

1. 앱에 실제 사용자 A로 로그인하고 Google Drive 연결을 누른다.
2. 계정 A의 Google 동의 화면에서 앱 이름, `drive.file` 권한, 올바른 redirect origin을 확인한다.
3. callback 후 `Google Drive 연결됨`과 folder_ready 상태를 확인한다.
4. Drive에서 `업무관리시스템 전용 파일` 폴더가 생성되었는지 확인한다. 같은 이름의 기존 사용자 폴더와 섞이지 않게 앱은 appProperties의 사용자 UUID로 식별한다.
5. 작은 파일을 업로드하고 앱·Drive 모두에서 확인한다. 다운로드 원본 hash를 비교한다.
6. 서버 재시작 및 access token 만료 후에도 refresh token으로 연결을 갱신하는지 확인한다.
7. 사용자 B는 별도 Google 계정으로 연결하고 다른 폴더/업무/첨부를 확인한다. 동일 Google 계정 재사용은 409로 거부한다.
8. 권한 거부·취소, Google 계정에서 앱 권한 철회, 삭제된 Drive 파일, 403/429 응답을 별도로 확인한다.

최초 정상 연결 후에는 같은 Google 계정의 refresh token을 재사용한다. 사용자가 권한을 철회하거나 정책상 토큰이 만료되면 재동의가 필요하다. External Testing 앱은 Drive 같은 권한을 포함할 때 refresh token 수명이 제한될 수 있으므로 장기 운영 전에 Publishing status 및 [Google OAuth 정책](https://developers.google.com/identity/protocols/oauth2)을 확인한다.

## 비용·네트워크·한계

- [Drive API 사용 한도/가격](https://developers.google.com/workspace/drive/api/guides/limits) 확인 시 표준 사용은 추가 비용이 없다고 안내한다. 동시에 2026년 이후 한도 초과 과금 계획을 안내하므로 무제한 무료로 가정하지 않는다. Google Cloud의 현재 quota/billing 화면과 계정 Drive 용량을 확인하고 유료 증설은 별도 결정한다.
- 필요한 서버 목적지: `accounts.google.com`, `oauth2.googleapis.com`, `www.googleapis.com`. 일반 OIDC를 쓰면 해당 실제 issuer의 authorize/token/JWKS 도메인이 추가된다.
- 환경 설정 초안에 Google token 도메인 및 공식 문서 도메인을 추가했고 공식 문서 접근을 재확인했다. 이는 Google OAuth 자격증명 생성이나 실계정 연결 완료를 뜻하지 않는다.
- Google 프로젝트 생성, consent 설정, client 발급, 사용자 동의, 실서비스 Drive 파일 생성은 이번 작업에서 수행하지 않았다.

공식 근거: [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server).
