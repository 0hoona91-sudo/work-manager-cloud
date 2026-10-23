# 단계별 리팩터링 작업지시서

이번 산출물은 **1단계 정밀 분석**이다. 아래 작업은 다음 별도 지시 후 시작한다. 각 회차는 테스트→작은 코드 변경→증거/롤백 확인→리뷰 순서를 지킨다. 한 회차에 전체 프로그램을 다시 쓰지 않는다.

## 공통 작업 조건

- GitHub Pages/Firebase Auth/Firestore/Drive 유지. Sites/D1/시험판 서버를 기반으로 사용하지 않는다.
- 기존 checkout에서 별도 기능 브랜치를 사용한다. 사용자 요청 없이 worktree를 추가하지 않는다.
- 시작 때 main·배포 최신 SHA를 확인하고 분석 기준과 달라졌으면 delta 보고부터 한다.
- 운영 데이터에 migration/repair/import/upload/delete를 실행하지 않는다. fixture와 emulator, 별도 테스트 계정만 사용한다.
- schema11·ID·완료·생성키·첨부 참조를 보존한다. 구조 추출과 동작 수정은 별도 commit/PR로 나눈다.
- 각 회차 결과에는 바뀐 책임, 보존 기능 ID, 테스트 결과, known failure, 롤백 방법을 기록한다.
- test plan의 해당 테스트를 **수정 전** 추가한다. 테스트 없이 파일만 옮기는 변경은 완료로 인정하지 않는다.

## 회차 2 — 기준선과 자동 검증 기반

**입력**: 이번 문서와 SHA, F01~F70, 합성 fixture. **대상**: 최소 test tooling·fixtures·CI 제안. 앱 동작은 그대로 둔다.

작업: 테스트 runner/lockfile을 별도 도입하고 JS/CSS/import 검사, 프로젝트 모델, schema11 codec 특성화, browser fake adapter harness를 만든다. 현재 결함의 실패 재현을 기록한다. Pages artifact에 테스트 파일이 포함되는지 검토한다.

검증: T-BASE-01, T-BOOT-01/02, T-MODEL-01, T-PRJ-01~05, T-REC-01/02, T-STYLE-01. **종료**: 실행 가능한 테스트와 known-failure 목록, 기준 screenshot/hash 확보. **롤백**: tooling/test 변경만 되돌림. **차단 요인**: 실제 배포 응답 확인은 네트워크 허용 후 보완; fixture 기반 테스트는 계속 진행.

## 회차 3 — 첨부·이력·복원 보호를 위한 최소 수정

**목적**: 구조 이동 전에 TD-01/02/04의 손실 가능 경로를 보호한다. 한 PR에 하나의 정책만 다룬다.

작업 단위: (a) HTML/SVG 등 능동 첨부 미리보기 격리와 credential/cache 수명 검토, (b) 완료 단계 삭제/재개 보호와 archive, (c) JSON 입력 검증·same-ID 충돌 preview. 각각 기존 동작, 변경할 정책, UI 영향을 문서화한다. 운영 Auth 방식 전체 교체는 이 회차 범위가 아니다.

검증: T-SEC-01/02, T-AUTH-04/05, T-PRJ-03~05, T-IO-01~06. **종료**: 위험 fixture에서 자격증명 origin 접근/완료 소실/무검증 복원 차단, 기존 정상 흐름 유지. **롤백**: app 코드 revert; 새로운 archive 기록은 구 버전 읽기 호환 확인. 되돌릴 수 없는 데이터 변환은 만들지 않는다.

## 회차 4 — 호환 모델·DateOnly·프로젝트 엔진

**대상**: M 전체, I의 date/linked 순수 계산, schema11 decode/encode. **선행**: 회차2 테스트, 회차3의 완료 정책.

작업: Clock/Id/holiday 입력 주입, ruleKind별 anchor 명시, 완료 단계 고정 순서, invalid/cycle/bounds 오류. legacy 함수 facade로 기존 UI를 유지한다. schema version/문서 ID를 바꾸지 않는다.

검증: T-MODEL-01~03, T-DATE-01~07, T-PRJ-01~05. **종료**: 엔진 DOM/SDK 의존 0, 원본 mutation 0, timezone deterministic, 완료 fixture 보존. **롤백**: facade가 이전 구현을 호출하도록 되돌림; read model을 운영 데이터에 일괄 저장하지 않음.

## 회차 5 — 반복·연계 엔진 단일화

**대상**: V2/V5/V24/V181의 규칙 해석과 planner. 구형 자동생성 no-op 정책은 그대로 유지한다.

작업: cycleMonths/half 및 분기·반기 선택 규칙, until·horizon·휴일·override, stable occurrence key, series와 완료 occurrence 분리. 변경 전에 두 기기 중복 fixture를 만든다. 기존 V181 ID를 삭제·재생성하지 않고 key mapping migration의 필요성을 별도 판단한다.

검증: T-REC-01~07, T-DATE-02/04, T-SYNC-03/04. **종료**: planner idempotence, 완료·수정 회차 불변, 미등록 라이브러리에서 자동생성 없음. **롤백**: 신규 planner 활성 전 pure shadow diff; 쓰기는 한 구현만 수행. key migration이 필요하면 별도 작업으로 분리.

## 회차 6 — application command/store와 저장 계층

**대상**: saveState, C queue/diff/subscription/transaction, UI의 직접 mutation.

작업: command 입력·ChangeSet·operationId·conflict 결과 도입. serialize는 schema11 유지. 초기화/캐시/서버확정/저장중/실패/재시도/취소 상태 명시. 모달 draft와 remote snapshot을 분리하고 renderer의 write를 제거한다. aggregate transaction 범위를 설정한다.

검증: T-SYNC-01~08, T-BOOT-03/04, T-UI-03. **종료**: render commit 0, 중복 구독 0, offline/충돌/부분실패 결과 명확. **롤백**: adapter facade 단위 revert; operation journal을 도입했다면 구 버전 호환/재시도 중지 경로 검증.

## 회차 7 — Google/첨부·백업·인수인계 adapter

**대상**: W/C Drive·token, G Google Tasks, I 첨부·backup/export.

작업: TokenProvider와 AttachmentStore 분리, 권한 scope별 재승인, upload→metadata commit 보상. Google Tasks 모델은 누락 원본·명세부터 확인하고 별도 복구한다. 백업 schema/manifest/hash·누락 파일 보고와 ZIP 총량 제한, 인수인계 read model 재사용.

검증: T-AUTH-01~05, T-FILE-01~03, T-IO-01~09, T-GTASK-01~05. **종료**: fake/contract 통과 + 테스트 계정 실제 OAuth·Drive 검증 결과 구분. **롤백**: adapter 교체 해제, 파일 ID 유지. 고아 정리 중에도 운영 파일 자동 삭제 금지.

## 회차 8 — UI를 기능별로 순차 교체

회차 8a 홈·검색·달력 → 8b 업무·체크리스트 → 8c 라이브러리·프로젝트 → 8d 설정·이력·테마로 나눈다. 각각 기존 markup/사용 동선을 먼저 특성화한다.

작업: 하나의 feature가 자기 DOM을 소유하고 mount/dispose를 제공하도록 전환한다. 전역 래퍼에서 기능을 옮긴 후 그 래퍼만 제거한다. MutationObserver로 재수정하던 명칭·버튼·잠금을 원래 render model에 포함한다. resize/IME 이벤트 소유권을 통합한다.

검증: 각 F 기능 매핑, T-UI-01~08, T-SEARCH-01~03, T-HIST-01~04. **종료**: 동일 UI 동작, focus/취소/모바일 보존, listener 누적 0, 불필요 DOM observer 제거. **롤백**: feature route/facade 단위로 이전 renderer 복귀; 구/신 renderer 동시 mount 금지.

## 회차 9 — CSS·자원·미사용 코드 정리

작업: 정확한 이미지 hash 기반 외부 asset 추출, CSS 오류 정정, component/theme/responsive 층 분리. coverage와 사용처가 확인된 함수·CSS만 개별 삭제한다. 숨긴 기능은 사용자 의도와 기능 목록에 맞춰 존치/제거 결정한다.

검증: T-STYLE-01~03, T-REACH-01, 전체 기능 browser subset, 1k/10k 성능. **종료**: asset 404 0, 시각 diff 검토, JS/CSS parser 오류 0, 삭제 근거 문서화. **롤백**: 자원/스타일 묶음별 revert; 캐시 버전 일치 유지.

## 회차 10 — 통합 검증과 배포 준비

작업: 기능 매트릭스 전체, 두 브라우저 계정/두 client, offline 재접속, backup→restore, 구 데이터 호환, 접근성·모바일·대량 데이터 검증. 배포 artifact/source map/비밀값/Pages base path 확인. 최신 production SHA와 다시 비교한다.

**종료**: 자동 suite·별도 테스트 계정 검증, known limitation, rollback artifact가 준비된 구체 결과. main merge/운영 배포는 이 결과의 별도 승인 후 실시한다. 코드 rollback과 데이터 rollback은 다르므로 백업 형식·복구 연습 결과를 함께 제시한다.

## 회차 11 이후 — AI/PC 로컬판 별도 개발

공통 엔진·ports·보안/파일 계약이 검증된 뒤 [09](09-ai-local-preparation.md)의 spike를 진행한다. AI를 먼저 연결해 기존 엔진의 불명확한 저장 경로를 직접 호출하게 만들지 않는다. PC판이 같은 contract suite를 통과해야 “공통 엔진 재사용”이 완료된 것이다.

## 다음 지시에 사용할 작업 문구

> 회차 2만 수행한다. `docs/refactor/` 분석을 읽고 최신 main/Pages 기준 변화부터 확인한다. 합성 schema11 fixture와 최소 테스트 실행 기반을 만들고, 완료 단계·반복 월/반기·누락 import·CSS 오류·백업 충돌의 현재 현상을 자동으로 검출한다. 운영 데이터·배포는 변경하지 않는다. 앱 기능 수정은 포함하지 않고, 테스트 결과와 알려진 실패를 보고한다.
