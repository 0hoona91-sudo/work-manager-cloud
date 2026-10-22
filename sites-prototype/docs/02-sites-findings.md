# Sites 공식 문서 조사와 연결 계획

확인일: 2026-10-23 (Asia/Seoul). 최초 요청은 환경 프록시의 CONNECT 403으로 실패했으나, 필요한 도메인 설정이 적용된 뒤 아래 원문을 HTTP 200으로 읽었다. 초기 차단은 현재 조사 결과의 미확인 사유가 아니다.

## 확인한 공식 근거

- [Sites 개요](https://learn.chatgpt.com/docs/sites)
- [Data and connections](https://learn.chatgpt.com/docs/sites/data-and-connections)
- [Create a site](https://learn.chatgpt.com/docs/sites/creating-a-site)
- [Manage a site](https://learn.chatgpt.com/docs/sites/managing-a-site)
- [Publish and share](https://learn.chatgpt.com/docs/sites/publishing-and-sharing)
- [Creating and using ChatGPT Sites](https://help.openai.com/en/articles/20001339-creating-and-using-chatgpt-sites)

| 항목 | 공식 문서에서 확인한 내용 | 이번 구현에 반영한 결정 |
|---|---|---|
| 시작 | ChatGPT 웹 Work 또는 데스크톱 Work/Codex에서 website 또는 `@Sites` 요청 | 현재 Cloud 도구 목록에는 Sites 생성/저장/배포 도구가 없어 생성하지 않음 |
| 정형 저장 | D1 관계형 DB, 사이트당 10GB | Sites 목표 DB를 D1으로 정함. 로컬 검증은 SQLite. D1 migration 후보 제공 |
| 파일 저장 | R2 지원, 사이트당 고정 파일 저장 한도 없음(사용량 제한은 존재) | 이번 요구는 개인 Google Drive이므로 R2를 요청하지 않음 |
| ChatGPT 로그인 | `/signin-with-chatgpt`, `/signout-with-chatgpt` 플랫폼 경로 | 독립 인증 경계 모듈에 정확한 경로 기록. 일반 OIDC를 Sites 로그인으로 가정하지 않음 |
| 서버 신원 | `oai-authenticated-user-email`, 선택적 `oai-authenticated-user-full-name` | 이름이 없으면 이메일로 표시. 클라이언트가 보낸 헤더는 신원으로 사용하지 않음 |
| 권한 | 서버에서 권한 판단. 공유 범위와 앱 로그인은 서로 다른 설정 | 개인 업무 API는 항상 인증 및 owner 검사 |
| 비밀값 | Sites → More actions → Settings에서 환경변수/secret 관리 | OAuth client secret/암호화 키는 여기에 설정. `.openai/hosting.json`에는 비밀값 금지 |
| 프로젝트 연결 | `.openai/hosting.json`에 project_id, d1/r2 binding 이름 | 실제 project_id나 바인딩을 발급받지 않았으므로 가짜 manifest를 만들지 않음 |
| 배포 | Save version과 Deploy version은 별도. 모든 배포 URL은 운영 URL | 이번에는 배포하지 않음. 다음 단계에서 먼저 배포 없이 버전을 저장 |
| 연결 앱 | 지원 workspace의 비공개 사이트에서 방문자 자신의 연결 사용 | 개인/외부 사용자까지 지원하려는 목표에 맞춰 직접 Google OAuth를 우선 구현. Drive 플러그인의 실제 업로드 action은 미확인 |

## 정확한 다음 작업 위치

1. ChatGPT 웹에서 **Work**를 열고 `@Sites`를 포함해 아래 인계 요청을 보낸다. 데스크톱에서는 Work 또는 Codex도 가능하다.
2. **More → sites**, 또는 <https://chatgpt.com/sites>에서 생성된 사이트를 찾는다.
3. 최초 사이트는 소유자 및 workspace admin 범위로 제한한다. 두 계정 검증을 위해 **Share → Only those invited** 또는 계정에서 제공하는 제한 공유 옵션으로 두 번째 사용자를 Viewer로 초대한다. 외부 초대 가능 여부는 플랜/롤아웃에 따라 다르다.
4. 사이트의 **More actions → Settings**에서 hosted 변수·secret을 입력한다. 필요한 이름은 Google 안내서에 정리했다. 채팅이나 소스에 값을 붙여넣지 않는다.
5. 실제 Sites 스타터와 실행 도구를 사용해 빌드 호환성을 확인한다. 이 문서만으로 Python ASGI 서버, 파일 SQLite, 임의 npm SDK가 지원된다고 단정하지 않는다.
6. 플랫폼 경계가 위조된 사용자 헤더를 제거/교체하는지 확인한 뒤 `sites-adapter/identity.mjs`를 서버 handler 안에 연결한다. 공개 원본 서버가 우회 접근 가능하면 헤더 신뢰를 켜지 않는다. UI의 로그인/로그아웃 동작도 플랫폼 경로로 교체한다.
7. D1 binding으로 신규 SQL을 적용하고 owner 복합 FK, 일회용 OAuth state 소비, 동시 갱신을 D1에서 다시 테스트한다. 로컬 SQLite 파일을 업로드해 기존 데이터를 이전하지 않는다.
8. 배포 없이 **Save a version**을 요청해 코드·DB 변경을 검토한다. 실제 공개 범위와 외부 계정 설정이 준비된 후 소유자가 첫 배포를 진행한다.
9. 생성된 실제 HTTPS origin을 Google OAuth client의 callback과 서버 origin에 반영하고 두 계정 실검증을 수행한다. 사이트 URL은 이번에 생성되지 않았다.

인계 요청 예시:

> @Sites `0hoona91-sudo/work-manager-cloud`의 `dev/sites-phase1` 브랜치에서 `sites-prototype/`을 참고해 업무관리 website를 준비하세요. 기존 GitHub Pages는 변경하지 마세요. 추천 Sites 스타터와 D1을 사용하고, 실제 지원되는 서버 런타임에 API를 연결하세요. 플랫폼 `/signin-with-chatgpt`와 서버 사용자 헤더를 사용해 로그인과 모든 API 소유권 검사를 연결하세요. `sites-adapter/`는 미연결 계약/SQL 후보이므로 빌드 및 D1 테스트를 먼저 수행하세요. 첨부 원본은 방문자별 Google OAuth drive.file 권한으로 개인 Drive에 보관합니다. 가짜 로그인은 금지합니다. 비밀값은 사이트 Settings에서 받으세요. 처음에는 제한 공유로, 배포하지 말고 버전을 저장해 검토 가능하게 하세요. 이후 두 실제 계정 테스트 결과를 보고하세요.

## 남아 있는 기술 검증

- 이 환경에는 Sites의 실제 starter, SDK, build artifact schema, 배포 권한이 노출되지 않았다. `sites-adapter/`는 완성된 배포 번들이 아니다.
- 공식 사용자 헤더는 이메일을 제공한다. 불변 subject/UID는 해당 문서에서 확인되지 않았다. 이메일 변경/재할당 시 계정 병합·소유권 이전을 자동 처리하면 안 된다. 정식 운영 전에 플랫폼의 안정적 식별자 제공 여부를 확인하고 없으면 수동 재검증 정책을 마련한다.
- D1의 런타임 binding 호출, 트랜잭션/원자적 소비, 토큰 갱신 경쟁 처리, Google로의 HTTPS outbound, callback Cookie 유지, CSP/iframe 정책은 실제 Sites 환경에서 확인해야 한다.
- 현재 앱은 iframe 사용을 차단한다. Sites preview가 iframe을 요구한다면 공식 신뢰 origin을 확인해 제한적으로 조정한다. 임의 wildcard는 사용하지 않는다.
- Sites 코드 rollback은 DB/파일 rollback이 아니다. DB 변경 실패 시 적용 상태를 먼저 조사한다.

## 비용과 무료 우선

공식 Help Center 확인 시점 기준:

- Sites는 Plus·Pro와 지원 Business·Enterprise workspace에서 사용할 수 있다. **Free·Go는 지원하지 않는다.** 기존에 해당 플랜이 없다면 구독 비용이 필요하다.
- Plus·Pro의 Sites hosting은 현재 포함되어 있다. 생성·편집은 Codex 사용량을 소비한다. 사이트 간 공유 사용량/저장 제한이 있다.
- Enterprise hosting 비용은 현재 면제라고 안내한다. 향후 비용은 workspace 계약에 따르며, 모든 플랜에 대한 영구 무료 약속은 아니다. Business의 정확한 별도 요금은 이 안내만으로 확정하지 않는다.
- 이 시험판의 Python/SQLite/오픈소스 라이브러리에는 서비스 사용료가 없고 OpenAI API를 호출하지 않는다.
- Drive API의 표준 사용은 공식 안내상 현재 추가 비용이 없지만, 2026년 이후 한도 초과 과금 계획이 명시되어 있다. 현재 quota/billing 화면을 확인해야 한다. 기존 계정 저장공간을 우선 사용하고 부족하면 추가 저장 비용이 생길 수 있다. 유료 호스팅, 스토리지, 도메인을 구매하지 않았다.
