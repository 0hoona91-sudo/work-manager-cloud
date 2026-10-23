# 자동 테스트 구축 계획

이번 단계에는 제품 테스트 suite를 새로 도입하지 않았다. 소스 무변경 분석용 probe 결과만 [10](10-evidence-and-limits.md)에 기록했다. 아래는 **각 기능 수정 전에** 구축할 자동 검증 계획이다.

## 1. 기준선과 fixture

- SHA `091dbec`의 화면·도메인 관찰값을 기준으로 한다. 이미 확인한 버그를 영구 정답으로 고정하지 않는다. `legacy-observation`과 `desired-contract` 테스트를 분리하고, 의도적 수정 시 차이와 적용 범위를 설명한다.
- 운영 Firestore/Drive dump를 자동 수집하지 않는다. 수동·반복·프로젝트·완료·휴지통·첨부를 포함한 합성 schema11 JSON으로 시작한다. 후속 익명화 실데이터가 필요하면 별도 동의와 비식별 검토를 거친다.
- fixture pack: `minimal`, `legacy-v11`, `all-features`, `completed-history`, `relative-project`, `monthly-end`, `two-device-conflict`, `broken-reference`, `attachments-missing`, `large-1000-tasks`, `large-10000-tasks`.
- 날짜는 고정 Clock, ID는 deterministic factory를 사용한다. 업무 시간대는 Asia/Seoul; date-only 호환은 UTC, UTC+14, DST 지역을 추가한다. 브라우저 테스트는 매번 새 context를 사용한다.
- 각 F01~F70은 테스트 또는 “숨김/비활성/외부 조건 때문에 미실행” 사유에 매핑한다. 기능 목록의 공백을 리뷰 gate로 삼는다.

## 2. 검증 계층

| 계층 | 도구/방법 제안 | 검증 대상 |
|---|---|---|
| 정적 | JS parser, CSS parser, local asset/import graph | 누락 파일, 중복 binding, import 방향, CSS syntax |
| domain | Node test runner 또는 동등 runner | 순수 날짜·반복·상태전이·round-trip; DB/DOM 불필요 |
| property/model | 결정적 난수 seed, frozen input | 반복 idempotence, 날짜 유효성, 완료 snapshot 불변 |
| application | fake repository/attachment/clock | save 횟수, 실패 rollback, 취소, 원격 변경과 draft |
| adapter contract | 동일 suite를 Firestore emulator/local adapter에 실행 | load/commit/subscribe/conflict/idempotency |
| Firebase | 별도 demo project ID와 Emulator Suite | rules, transaction, offline queue, 두 client, reconnect |
| browser | Playwright desktop/mobile | UI/IME/탐색·모달·테마·다운로드·미리보기 격리 |
| 외부 통합 | 명시적 테스트 계정·테스트 폴더 | OAuth popup, Drive scope/revoke, Pages authorized domain |

emulator는 production projectId로 연결하지 않는다. tests 기본 네트워크는 localhost만 허용한다. OAuth/Drive는 mock으로 계약을 검증하고, 실제 외부 통합은 마지막 별도 실행으로 표시한다. emulator 통과를 운영 rules 검증으로 표현하지 않는다.

## 3. 구체 테스트 목록

| ID | 입력·시나리오 | 필수 기대 결과 |
|---|---|---|
| T-BASE-01 | 고정 SHA, 원격 branch/Pages 실행, fixture hash | 어느 버전을 시험했는지 결과에 SHA·시간·runner 명시 |
| T-BOOT-01 | 전체 script 원래 순서 로딩; 반복 mount/dispose | 최종 entrypoint 일치; 이벤트·구독 수 증가 없음 |
| T-BOOT-02 | 모든 src/href/import/url 자원 요청 | 필수 local asset 200; Google Tasks 누락을 실패로 검출 |
| T-BOOT-03 | SDK 실패, 권한 거절, profile 없음, timeout | 구체 오류·재시도·취소 가능; 빈 UI를 정상 로그인으로 오인하지 않음 |
| T-BOOT-04 | cache 있음/없음 × online/offline | 빈 cache로 신규 workspace 생성 안 함; 불완전 초기화 시 write 없음 |
| T-MODEL-01 | schema11 모든 필드·알 수 없는 extension | decode/encode round-trip ID·값·참조 보존 |
| T-MODEL-02 | template string checks / task object checks / 잘못된 object | 올바른 변환 또는 validation error; `[object Object]` 저장 금지 |
| T-MODEL-03 | project/task/template/step 첨부 data·blob URL | 원본과 volatile preview가 메타 저장소에 섞이지 않음 |
| T-DATE-01 | same/date/after, duration 0/1/N, 윤년/월말 | inclusive/exclusive 의미를 ruleKind별 명시한 golden date |
| T-DATE-02 | parent end 11/17, start offset 1, due 15, business/calendar | DB cascade/일반 link/project 각각 현재 anchor 의미 검증 |
| T-DATE-03 | 주말·연휴·custom 휴일, keep/prev/next | 선택 정책과 유효 범위 만족; 같은 입력 같은 출력 |
| T-DATE-04 | 수동 override·미확정·link cycle/없는 parent | 완료·override 불변; cycle은 명시 오류, 20 pass 결과 은폐 금지 |
| T-DATE-05 | 완료 A→미완료 B, A 수정 draft, stage 재정렬 | A의 완료 날짜 고정 후 B 계산; 1/1+2=1/3 |
| T-DATE-06 | 모든 날 휴일/극단 offset/invalid date | 제한 시간/횟수 안에 structured error, UI 멈춤 없음 |
| T-DATE-07 | UTC/Seoul/UTC+14/DST, 음수 offset | DateOnly 결과 동일; UTC+14 하루 오차 검출 |
| T-REC-01 | cycleMonths=[1,4,7,10], cycle=monthly | 비선택 월 생성 없음 |
| T-REC-02 | cycle=half, weekdays, 분기·반기 선택 행 | legacy enum/필드 모두 의미 보존 |
| T-REC-03 | 두 번 planner 실행·두 기기 동시 생성 | stable occurrence key 동일, 실제 task 1개 |
| T-REC-04 | 완료 root, 과거 완료/수정 회차, until 축소 | 과거 불변; future 생성과 series 수명 정책 일치 |
| T-REC-05 | user delete vs horizon eviction | 사용자 삭제 재생성 안 됨; 기간 축소를 사용자 삭제로 오인 안 함 |
| T-REC-06 | 같은 날로 휴일 이동하는 서로 다른 회차 | raw occurrence identity 유지, 의도 없는 병합 없음 |
| T-REC-07 | library 저장만 / 명시 register / render 10회 | 저장만으로 생성 안 됨; register 규칙 적용; render는 생성/저장 0 |
| T-PRJ-01 | 3단계 생성·담당 변경·순서 이동 | stageId/taskId/checkId 보존, 이중 task 없음 |
| T-PRJ-02 | 체크 담당자 변경·일부/전체 완료 | task/stage mirror 정합, 완료 날짜·상태 계산 정확 |
| T-PRJ-03 | 완료 단계 추가 체크/제거 | 명시 재개 정책 없이 완료 이력 소실 없음 |
| T-PRJ-04 | 완료 단계 삭제·프로젝트 폐기 | archive/확인 정책, 이력 조회 가능, 참조 무결성 |
| T-PRJ-05 | 닫힌 project의 체크 취소/편집 | 확인 거절 시 변화 0, 승인 시 reopen event·이력 보존 |
| T-SYNC-01 | bootstrap+activate+history 여러 번 | collection별 구독 1개, history lazy, dispose 후 0 |
| T-SYNC-02 | 두 client의 서로 다른 필드/같은 필드 수정 | 비충돌 merge, 충돌 명시; 완료 상태 last-write 승리 금지 |
| T-SYNC-03 | offline 생성·수정 후 reconnect | pending/committed 상태 구분, 중복·유실 없음 |
| T-SYNC-04 | generated key 이미 존재·삭제 task·재시도 | lock 보존, 기존 완료 업무 덮어쓰기 없음 |
| T-SYNC-05 | 원격 snapshot→모달→닫기→render | 편집 draft 보호, 원격 반영 1회, 피드백 write 0 |
| T-SYNC-06 | 319/320/321 및 큰 aggregate, 중간 chunk 실패 | 일부 성공을 전체 성공으로 표시 안 함; 재시도 operationId 일치 |
| T-SYNC-07 | flush network hang/구독 오류/창 종료 | timeout/cancel, 저장 경고와 durable queue 상태 명확 |
| T-SYNC-08 | projects만 존재/고아 체크/고아 link | 빈 DB로 오판해 초기 데이터 덮어쓰기 금지 |
| T-AUTH-01 | unverified/denied/allowed user | server allowlist 결과에 따른 접근; client cache만 신뢰 안 함 |
| T-AUTH-02 | 중앙 actor A / profile B / private UID mismatch | 연결 거절, 다른 workspace 조회·쓰기 0 |
| T-AUTH-03 | 운영과 다른 emulator rules fixture | 허용 UID만 접근, 거부 case 실제 실패; rules 문서와 결과 연결 |
| T-AUTH-04 | logout/account switch/relogin | profile/token/subscription/objectURL 범위 정리; 이전 user 데이터 누출 없음 |
| T-AUTH-05 | drive/tasks/legacy expiry,401,403,popup cancel | scope별 갱신 1회, 무한 재승인 없음, 다른 scope token 유지/폐기 정책 |
| T-FILE-01 | 0B/50MB/초과·MIME mismatch·401/404/429/5xx | 제한·재시도·취소·사용자 메시지와 메타 일치 |
| T-FILE-02 | upload 성공 후 commit 실패·사용자 취소 | orphan 추적/정리 재시도, 기존 참조 파일은 삭제 안 함 |
| T-FILE-03 | 같은 file 동시 미리보기, 화면 반복 mount | inflight 중복 억제, URL 해제, 계정별 캐시 분리 |
| T-SEC-01 | HTML/SVG/이미지/PDF/텍스트 첨부와 합성 marker | 능동 첨부가 app storage 접근 불가; plain text는 안전하게 표시 |
| T-SEC-02 | script 종료 문자열·HTML 속성·URL payload | 앱·인수인계에서 텍스트 escaping, unsafe scheme 차단 |
| T-IO-01 | 유효/불완전/다른 schema/너무 큰 JSON | validation report, 데이터 변경 전 실패 |
| T-IO-02 | 같은 ID planned backup vs done current | conflict preview; 승인 없는 완료 덮어쓰기 0 |
| T-IO-03 | local replace vs cloud merge | 안내 문구·선택·실제 결과 일치, dry-run와 commit diff 동일 |
| T-IO-04 | Drive/local/template/project/task 첨부 백업 | metadata-only/원본포함 범위 정확, 비밀 프로필 제외 |
| T-IO-05 | 복원 중 실패·quota·취소 | 기존 데이터/backup snapshot 복구 가능, 반쪽 성공 표시 금지 |
| T-IO-06 | unknown fields·dangling refs·중복 IDs | 보존/오류 정책, ID 재발급/자동 삭제 없음 |
| T-IO-07 | 인수인계 HTML/ZIP, 한글명·중복명·missing 원본 | readonly 문서 열기/검색/인쇄, 누락 목록·hash·경로 안전 |
| T-IO-08 | 많은 파일·ZIP 32bit 경계·메모리 제한 | 총량 사전 검사, 안전 실패, 취소 후 자원 해제 |
| T-IO-09 | CSV =,+,-,@ 시작 셀 | 선택한 spreadsheet 안전 정책 적용 |
| T-HIST-01~04 | 휴지통 복원, template 최근10개, 반복삭제, project archive | ID·완료일·첨부 참조 보존; auxiliary 정리 실패를 별도 표시 |
| T-SEARCH-01~03 | 한국어/공문명/checklist/method, 필터, 더보기·대량 자료 | 정확한 결과·일관된 정렬·IME 도중 중간검색 억제 |
| T-UI-01~02 | F01~F70의 접근 경로·키보드·뒤로가기·폼 취소 | 버튼·필드·포커스·취소 후 상태 보존 |
| T-UI-03 | 모든 주요 render 반복 | freeze한 domain state 불변; repository.commit 0 |
| T-UI-04 | observer 사용 화면 idle·모달 20회 열기 | idle callback 수 수렴, listener/observer 누적 없음 |
| T-UI-05~08 | 390×844/1440×1000, 320/720/760 경계, 회전, 테마 | 가로 overflow·숨긴 입력·중복 명칭 없음; 선택 상태 동일 |
| T-STYLE-01~03 | CSS parse, 테마 snapshot, 이미지 해시/경로 | syntax 0오류, 승인한 시각 diff만, asset 404 없음 |
| T-REACH-01 | 숨김/비활성 기능·export·인수인계 코드 coverage | dead-code 후보를 근거 없이 삭제하지 않음 |
| T-GTASK-01~05 | 모델 복구 후 import/export/완료/충돌/해제/재승인 | fingerprint 결정표, 이미 있던 local 업무 대량 export 금지, 삭제/재개 정책 |
| T-LOCAL-01~05 | 폴더권한·손상·원자저장·충돌·offline 재시작 | 원본 파일과 metadata 일치, 네트워크 0으로 독립 실행 |

## 4. 브라우저 실행 경로

기본 시나리오는 홈→빠른 업무→상세 수정→체크 완료→완료 목록→재개→휴지통→복원이다. 두 번째는 라이브러리 일반/프로젝트 등록→수행방법/첨부→선택 등록→단계 순서/날짜→프로젝트 종료다. 세 번째는 검색·연간계획·설정·JSON·인수인계 ZIP이다. 동일 fixture로 데스크톱/모바일 및 기본/Kitty/Shinchan을 비교한다.

첫 계층에서는 fake adapter를 명시적으로 주입한다. 운영 인증을 우회하는 query parameter를 앱에 추가하지 않는다. 실제 Firebase 계정 검증을 fake test 통과로 대체하지 않는다.

성능은 1k/10k fixture에서 load, search, render, serialize, observer 횟수·commit 횟수·메모리를 측정한다. 기준 하드웨어/브라우저/데이터를 기록한 뒤 허용 예산을 정한다. 근거 없는 밀리초 목표를 미리 정상 기준으로 고정하지 않는다. render 중 commit 0, 구독 중복 0, idle 수렴은 즉시 적용 가능한 구조 기준이다.

## 5. 단계별 gate와 결과 보고

1. 변경 전 현재 현상을 검출하는 자동 테스트를 작성한다. known bug는 기대 실패나 별도 관찰 테스트로 명확히 표시한다.
2. 관련 domain/adapter/browser subset을 실행한다. 전체 기능 snapshot은 모듈 교체 경계마다 실행한다.
3. 결과에는 실행 수, pass/fail/expected-failure/skipped/unrun을 구분한다. 0-test 성공을 검증으로 인정하지 않는다.
4. 보호 규칙·완료이력·같은 ID·같은 generatedKey·같은 fileId를 자동 비교한다.
5. main 배포 전 별도 테스트 Firebase/Drive에서 auth·scope·실시간 두 client 검증을 완료한다. 운영 계정 읽기조차 이번 분석에 포함하지 않았다.
6. 테스트 실패를 피하기 위해 assertion 삭제, timeout 무한 증대, 네트워크/TLS 검증 해제, fixture 의미 변경을 하지 않는다.

## 6. 이번 실행과 향후 계획의 구분

이번에는 49개 JS 단위 구문 분석, CSS 구조 분석, 2개 뷰포트의 격리 브라우저 관찰, 9개 모델/직렬화 probe, timezone probe, 안전한 Blob origin 실험을 했다. 위 표의 통합 test suite와 Firebase emulator/실계정 테스트는 **미구축·미실행**이다.
