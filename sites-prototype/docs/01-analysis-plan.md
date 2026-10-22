# 1단계 분석·구현 계획 (구현 전 기록)

기준 커밋: `091dbecd701153e7e1880bd6bb84a277b789c58f`, 개발 브랜치: `dev/sites-phase1`.
기존 파일 전체 목록, 진입점, 저장·인증·첨부 흐름을 조사했다. 기존 데이터 이전은 하지 않는다.

## 기존 구조

| 파일 | 역할 / 신규 설계에서 참고할 점 |
|---|---|
| `index.html` (12,231줄, 약 8MB) | HTML/CSS, 전역 state, 다수의 inline script, 업무·캘린더·간트·반복 업무·설정·인수인계 화면. IndexedDB와 localStorage 보조 저장. UI/상태/통신을 분리할 필요가 있다. |
| `js/cloud-sync.js` (1,776줄) | Firebase 로그인, Firestore 스키마 v11 직렬화, 실시간 구독, 차이 저장/트랜잭션, 휴지통·버전, Drive 원본 업로드/다운로드. 신규 앱에는 의존하지 않는다. |
| `js/workspace-profile.js` (660줄) | 공용 Firebase 신원과 개인 workspace 연결, Drive appDataFolder에 프로필, Google 권한 관리. 신규 앱은 서버에서 검증한 사용자 ID로 바로 DB를 구분한다. |
| `js/firebase-config.js` | 기존 프로젝트의 공개 웹 설정. 신규 앱에서 읽거나 사용하지 않는다. |
| `js/project-model.js` (224줄) | 날짜 정규화, 단계·체크리스트·프로젝트 업무 계산. 순수 도메인 로직을 이후 재구현할 때 참고하기 좋다. |
| `js/project-ui.js` (1,143줄) | 프로젝트 편집, 첨부, 반복 일정, 화면 확장. 전역 함수 재정의와 DOM 후처리 의존을 제거할 계획이다. |
| `js/workflow-reform-v17.js` (705줄) | 업무DB 중심 등록, 완료 프로젝트, 보드·검색·분류 UI 후처리. 도메인 정책과 화면을 분리한다. |
| `js/google-tasks-sync.js` (322줄) | Google Tasks 연동. 참조하는 `google-tasks-model.js`가 현재 저장소에 없다. 기존 결함으로 기록하며 이번 시험판에서는 Tasks 연동을 범위 밖으로 둔다. |
| `css/*` | 프로젝트/업무 화면 스타일. 신규 UI는 사이드바, 업무 목록, 상태 표시를 참고한다. |
| `privacy.html`, `manifest.webmanifest`, 아이콘/이미지 | 개인정보 안내 및 정적 배포 자산. 신규 개인정보 안내는 별도로 필요하며 기존 문서를 그대로 사용하지 않는다. |
| `README.md` | GitHub Pages 정적 배포. 패키지 선언, 빌드, CI, 테스트 러너, 백엔드가 없다. |

주요 데이터: tasks, projects, checklistItems, taskLinks, templates, linkedRules, manualBlocks, owners, categories, holidays, settings, meta, generatedKeys, changeLogs.
기존 시작 흐름은 cloud-sync 동적 import → Google/개인 workspace 인증 → Firestore 구독 → 사용자별 로컬 캐시 활성화다.

## 구현 순서와 결정

1. 별도 개발 브랜치와 `sites-prototype/`에만 신규 파일을 추가한다. 기존 GitHub Pages 배포를 변경하지 않는다.
2. FastAPI + SQLite로 신규 사용자·세션·업무·Google 연결·첨부 스키마를 만든다. Firebase 의존성 없음.
3. 서버가 검증한 issuer/subject를 사용자 키에 연결한다. HttpOnly 세션, CSRF/Origin 검사, 모든 API의 소유권 필터를 구현한다.
4. ChatGPT Sites 인증/배포 도구와 공개 규격은 이 환경에서 확인되지 않았다. OIDC를 지원하는 호스트를 위한 연결 지점만 구현하고, 이를 ChatGPT 로그인 성공으로 표시하지 않는다. 공식 규격이 다르면 해당 어댑터를 교체한다.
5. 로컬 loopback에서만 명시적으로 켜는 A/B 시험 로그인과 모의 저장소를 제공한다. 실제 로그인 및 Drive와 화면에서 구분한다.
6. Google OAuth authorization code + PKCE + state + nonce, `openid email drive.file` 권한. 서버에서만 토큰 교환/암호화 저장, 사용자별 전용 폴더, 업로드/조회/다운로드를 구현한다.
7. 자동 API 통합 테스트 및 실제 Chromium으로 두 로컬 계정의 접근 차단을 검증한다. 외부 OAuth/Drive는 프로토콜 모의 테스트와 실계정 검증을 구분한다.
8. 실행법, DB/인증 설계, Google 설정 위치, 두 실계정 테스트 절차, 결과표, 후속 기능 이전 설계서를 작성한다.

## 위험과 대응

- **Sites 런타임 미확인**: Python 실행·영구 볼륨·서버 비밀값·OAuth callback·인증 검증 규격이 필요하다. 정적 호스팅만 제공한다면 별도 API 호스팅이 필요하며 무료/유료 여부를 확인해야 한다. 지금 배포 완료를 주장하지 않는다.
- **신원 위조/IDOR**: 브라우저가 보낸 user_id나 이메일로 권한을 정하지 않는다. 서버 세션으로만 owner_id를 결정하고, 타인의 ID에는 404를 반환한다.
- **OAuth 계정 혼동**: 연결 state를 현재 세션에 묶고 일회용/만료 처리한다. 이미 다른 앱 사용자에 연결된 Google subject는 재사용 금지한다. 재연결 시 다른 Google 계정으로 몰래 바뀌지 않게 한다.
- **토큰 유출**: 브라우저/localStorage/저장소에 토큰을 쓰지 않는다. 서버 환경의 암호화 키로 DB의 OAuth 토큰을 암호화한다. callback 쿼리 기록 방지를 위해 실행 시 access log를 끈다.
- **최소 권한**: 앱이 만든 파일에 대한 drive.file만 요청한다. 공유 링크 생성이나 전체 Drive 권한 요청을 하지 않는다. Google Drive 자체에서 사용자가 따로 공유하는 행위는 앱 권한 경계 밖이다.
- **두 저장소 간 부분 실패**: Drive 업로드 성공 후 메타데이터 기록 실패 시 삭제를 시도한다. DB+Drive는 분산 트랜잭션이 아니므로 잔여 파일 정리/모니터링은 후속 작업이다.
- **무료 운영 한계**: 로컬 개발은 유료 서비스 없이 가능하다. Drive 계정 용량·API 쿼터·OAuth 테스트 모드 제한과 실제 호스트 비용은 별도다. SQLite는 영구 디스크를 쓰는 단일 인스턴스 시험판용이다.
- **검증 한계**: 실제 ChatGPT 두 계정과 Google OAuth 앱 자격증명이 없다. 시험 계정/모의 Google 테스트 결과를 실서비스 성공으로 대체하지 않는다.

## 사용자 추가 지시 및 공식 문서 확인 후 수정

- 제품에 가짜 로그인이나 시험 계정 선택 기능을 제공하지 않는다. 자동 테스트 코드에서만 DB에 격리된 두 사용자·세션을 준비한다. 제품 라우트에는 시험 로그인/모의 Drive 연결 endpoint가 없다.
- 사용자 제공 공식 문서에 대한 초기 프록시 403은 네트워크 설정 적용 후 해소되었다. `docs/02-sites-findings.md`에 실제 확인한 규격과 아직 확인하지 못한 항목을 구분한다.
- Sites의 공식 로그인은 플랫폼 경로 `/signin-with-chatgpt`, `/signout-with-chatgpt` 및 서버 사용자 헤더다. 일반 OIDC 어댑터를 ChatGPT 로그인으로 취급하지 않는다. OIDC는 독립 실행 호스트의 선택적 인증 확장점이다.
- Sites 목표 DB는 D1이다. 현재 SQLite 구현은 독립 실행 검증용이며, Python 서버/파일 기반 SQLite를 Sites에 그대로 배포할 수 있다고 가정하지 않는다. 공식 스타터·산출물 규격에 맞추는 후속 연결이 필요하다.
- `sites-adapter/`에는 확인된 로그인 경로·헤더를 처리하는 경계 함수와 SQL 초안을 제공한다. 실제 Sites 배포 연결은 하지 않는다.
