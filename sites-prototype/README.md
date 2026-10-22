# 업무공간 — Sites 이전을 위한 1단계 시험판

독립 실행 가능한 웹 UI, 신규 SQLite DB, 서버 소유권 검사, Google OAuth/Drive 클라이언트와 테스트를 제공합니다. 기존 GitHub Pages 파일은 사용하거나 수정하지 않습니다. 기존 업무 데이터를 가져오지 않습니다.

**현재 Sites 배포 및 실제 ChatGPT 로그인은 미연결입니다.** 실행하면 로그인 미연결 화면이 열립니다. 제품에 가짜 로그인이나 사용자 선택 기능은 없습니다. 업무·파일 기능은 자동 테스트가 만드는 격리된 두 사용자 세션으로 검증합니다. Google OAuth/Drive는 모의 서버로 검증했으며 실제 Google 계정 검증은 아직 하지 않았습니다.

## 실행

Python 3.12, Node.js 24(연결 계층 테스트용)에서 확인했습니다.

```bash
cd sites-prototype
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.lock
.venv/bin/python run.py --dev
```

기본 포트는 8080입니다. 서버는 loopback 주소에만 바인딩합니다. `--dev`는 로컬 HTTP와 개발용 암호화 키 생성을 허용할 뿐 로그인을 우회하지 않습니다. 시작 확인은 `curl --fail http://127.0.0.1:8080/healthz`로 수행합니다. 이 Cloud 채팅에서 localhost 공개 미리보기는 제공하지 않습니다.

`.data/`에는 새 DB와 로컬 개발용 키가 만들어지며 Git에서 제외됩니다. 운영용 비밀값은 비밀 저장소에 따로 넣어야 합니다. 운영은 HTTPS origin과 영구 저장소가 필요합니다. `python run.py`는 `APP_BASE_URL`과 `TOKEN_ENCRYPTION_KEY`가 올바르게 설정되지 않으면 시작을 거부합니다.

선택적 독립 호스트 OIDC 설정은 `.env.example`에 있습니다. **이 설정을 ChatGPT Sites 로그인 설정으로 사용하지 마세요.** Sites 로그인은 별도 플랫폼 경로/헤더 규격이며, [연결 설계](docs/02-sites-findings.md)를 따릅니다.

## 검증

```bash
.venv/bin/python -m unittest discover -s tests -v
node --test tests/sites-identity.test.mjs
node --check app/static/app.js
```

실제 브라우저 테스트:

```bash
.venv/bin/python -m pip install -r requirements-browser.txt
# Chromium이 없다면 Playwright의 공식 설치 절차로 설치하거나 CHROMIUM_PATH를 지정합니다.
CHROMIUM_PATH=/usr/bin/chromium .venv/bin/python -m tests.browser_smoke
```

브라우저 테스트는 임시 DB·loopback 서버·두 브라우저 컨텍스트를 생성하고 종료 시 정리합니다. Google API에 연결하지 않습니다. `test-results/`에 JSON 결과와 화면을 저장합니다. 테스트 계정은 실행 중인 제품 DB에 넣지 않습니다.

## 구조

| 위치 | 책임 |
|---|---|
| `app/static/` | 업무 보드, 로그인 상태, 업무 상세, 파일 업로드·조회·다운로드 UI |
| `app/auth.py` | 검증된 신원 이후의 서버 세션, CSRF 검사 |
| `app/providers.py` | 일반 OIDC 확장점, Google OAuth와 Drive 통신, 토큰 암호화 |
| `app/db.py`, `app/schema.sql` | 신규 DB와 사용자별 소유권 관계 |
| `app/main.py` | API, 권한 검사, 서버 경계, 정적 파일 제공 |
| `sites-adapter/` | 확인된 Sites 신원 계약 처리 함수, D1 마이그레이션 후보. 아직 배포용 완성 산출물 아님 |
| `tests/` | 실제 API/DB 통합 테스트, 모의 외부 서비스, 브라우저 테스트 |
| `requirements.lock` | 별도 가상환경에서 설치·검증한 전체 의존성 버전 |

## 결과물

- [기존 구조 분석·구현 전 계획·위험](docs/01-analysis-plan.md)
- [공식 Sites 확인 사항·연결 및 배포 절차·비용](docs/02-sites-findings.md)
- [DB·인증·권한 설계](docs/03-architecture.md)
- [Google OAuth 설정 안내](docs/04-google-oauth.md)
- [두 실제 계정으로 수행하는 수동 검증](docs/05-two-account-test.md)
- [실행 결과와 기능별 완료 범위](docs/06-validation.md)
- [전체 업무 기능 이전 설계](docs/07-roadmap.md)

무료 로컬 개발이 가능하며 유료 API 호출이나 배포는 하지 않았습니다. 공식 안내 기준 Sites는 Plus·Pro 및 지원 Business·Enterprise 계정용이며 Free·Go는 지원하지 않습니다. Plus·Pro의 Sites 호스팅은 현재 포함되어 있습니다. 세부 한도와 다른 플랜 조건은 공식 문서를 확인해야 합니다.
