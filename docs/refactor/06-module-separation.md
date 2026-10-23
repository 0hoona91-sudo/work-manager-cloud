# 모듈 분리 계획

목표는 책임·수명·데이터 소유권을 분리하는 것이다. 기존 UI·Pages 경로·Firestore schema11을 우선 보존한다. React 등 framework 전환은 이번 계획의 전제 조건이 아니다.

## 1. 목표 디렉터리와 의존 방향

아래 경로는 후속 구현 제안이며 아직 생성하지 않았다.

```text
src/
  domain/
    model/            task, checklist, library, project, attachment, history
    schedule/         date-only, holiday-calendar, linked-graph, recurrence
    commands/         task/project/library transitions, import planning
    query/            search, calendar, gantt, annual-plan projections
  application/
    commands/         UI/API 요청 조율, commit, optimistic state
    services/         occurrence scheduler, attachment lifecycle, handover
    ports/            repository, identity, attachments, clock, ids, documents, ai
  adapters/
    legacy/           schema11 decode/encode, old globals facade
    firebase/         app initialization, auth, repository, subscriptions
    google-drive/     token scope, upload/download, legacy migration
    google-tasks/     model mapping, conflict resolution, sync coordinator
    browser/          IndexedDB cache, settings, download, visibility
    local-folder/     workspace manifests, atomic storage, attachments
    ai/               approved server endpoint client (future)
  ui/
    shell/            navigation, bootstrap status, lifecycle
    features/         home, tasks, library, projects, history, settings
    components/       modal, date-field, checklist, attachment-viewer
    styles/           tokens, base, components, themes, responsive
  export/             handover read model + readonly renderer + archive
tests/                 fixtures, domain, adapter-contract, emulator, browser
```

`domain`은 application/UI/adapter를 import하지 않는다. application은 ports/domain만 의존한다. adapter는 port를 구현한다. composition root만 실제 Firebase/Drive/로컬 구현을 선택한다. UI는 application command/query를 호출하며 저장 SDK를 직접 참조하지 않는다. `export`는 같은 read model을 쓰되 수정 명령은 제공하지 않는다.

## 2. 기존 파일에서 이동할 책임

| 현 위치 | 이동 목표 | 이동 전 반드시 확보할 계약 |
|---|---|---|
| I의 state와 모델 보정 | legacy codec + application store | 미해석 필드·migration 부작용 fixture |
| I의 날짜·반복·linked 계산 | domain/schedule | 모든 ruleKind/완료/override/월말 특성화 |
| M 프로젝트 모델 | domain/project + schedule | no hidden clock/id, immutable input, 완료보존 |
| C serialize/deserialize/diff | legacy codec + firebase repository | schema11 round-trip, lock, identity |
| C bootstrap/auth/gate | application bootstrap + UI gate + identity adapter | 대기/오류/계정전환/취소 상태 |
| C realtime/queue/transaction | firebase repository + sync coordinator | subscription 1개/범위, conflict/partial failure |
| W profile/credentials/token | identity adapter + credential provider | 비밀값 수명·보안 규칙·계정 분리 |
| C Drive + I 파일 함수 | google-drive + browser/local attachment adapter | MIME 정책, upload orphan, token refresh |
| I/P/R의 task/project/library 화면 | ui/features + 공통 components | 현 UI snapshot, 선택/IME/모달/뒤로가기 |
| I/P의 recurrence wrapper | application scheduler → domain plan | render/save 재진입 없이 한 번만 apply |
| I/P/R의 settings·테마·명칭 | UI preferences + style tokens | active/hidden 기능 그대로, 사용자 preference 호환 |
| G Google Tasks | google-tasks adapter + domain mapper | 누락 model 원본, merge fingerprint, 완료/삭제 계약 |
| I 검색·인수인계 | query/search + export | 개인정보/첨부 누락/readonly 인쇄 출력 |

## 3. 전역 함수·monkey patch 제거 절차

1. `script-blocks.csv`, `function-assignments.csv`를 바탕으로 “선언→캡처→래퍼→최종 대입”을 기능별로 기록한다. 중복 선언과 의도적인 wrapper를 분리한다.
2. 기존 entrypoint 이름을 보존한 facade를 만들고 호출 횟수·입출력 fixture를 수집한다. facade는 새 로직을 중복 실행하지 않는다.
3. 하나의 command 또는 query를 새 모듈로 이동한다. UI callback은 facade를 통하도록 연결한다. DOM query와 data calculation이 섞인 함수는 계산 부분만 먼저 분리한다.
4. old/new 결과 비교는 **순수 계산**에만 적용한다. 저장·업로드 함수를 shadow 실행하면 실제 부작용이 두 번 발생하므로 금지한다.
5. wrapper가 수행하던 각 책임을 새 command/query/component 한 곳에 배정한다. snapshot/event 테스트 통과 후 해당 wrapper만 제거한다.
6. 호출부를 새 import로 바꿔 facade 사용을 0으로 만든 뒤 전역 이름을 삭제한다. 외부 export/인수인계 문자열/동적 handler 참조까지 확인한다.

예: `renderTaskTable`은 원본 rows 계산, 정렬, 카드화, 통합검색, 프로젝트 통합, 반복보충을 수행한다. 목표는 `queryTaskBoard(filters)`가 rows/projects/searchResults를 반환하고, `TaskBoard.render(model)`이 DOM을 한 번 생성하는 것이다. 반복보충은 별도 scheduler event에서 실행하고 렌더 함수에는 넣지 않는다.

## 4. 이벤트·observer 수명

각 feature는 `mount(root, dependencies) -> dispose()`를 제공한다. 이벤트는 feature root에 위임하고 AbortController로 해제한다. 모달은 생성당 1개의 draft와 listener scope만 가진다. resize/orientationchange는 shell의 단일 viewport service에서 필요한 feature에 전달한다.

MutationObserver를 무작정 없애지 않는다. 먼저 어떤 다른 renderer가 DOM을 다시 만드는지 추적해 그 책임을 component로 가져온다. 테마 아이콘은 state→class로, 라이브러리 명칭은 navigation model로, 테이블 헤더는 table renderer로, 완료 날짜 잠금은 폼 model의 editable 속성으로 옮긴다. 외부 DOM 변경 관찰이 꼭 필요한 경우에만 observer를 남기고 guard/dispose를 테스트한다.

`setTimeout(...,25)`로 readiness를 추측하지 않고 bootstrap Promise/event를 구독한다. 작업 취소는 AbortSignal, 네트워크 timeout은 adapter 정책, UI busy 상태는 명시적 command state로 처리한다.

## 5. CSS·테마·이미지

base→component→theme→responsive의 우선순위를 정의한다. theme은 token을 변경하고 DOM을 다시 쓰지 않는다. 같은 `.modal`/table 규칙을 버전명으로 계속 덮어쓰지 않는다. `!important` 감소는 숫자 목표보다 시각 회귀 통과를 기준으로 한다.

우선 여분 `}`와 중복 data URL을 별도 작업으로 다룬다. 이미지 추출은 해시로 동일성을 확인하고 Pages 상대 경로·캐시 query·모바일 배율을 검사한다. 대형 data URL을 삭제하면서 기본 UI가 참조하는 asset을 바꾸지 않는다. 미사용 CSS 후보는 coverage 수집 후 한 묶음씩 제거한다.

## 6. 배포·도구 도입

첫 추출은 브라우저 native ES modules 또는 기존 IIFE facade로도 가능하다. 필요한 시점에 최소 test runner/package manifest를 도입하되 별도 변경으로 검토한다. bundler는 빌드 재현성·로컬 패키징 요구가 생겼을 때 선택하고, output의 Pages base path가 `/work-manager-cloud/`임을 검증한다.

배포는 이번 단계에서 하지 않는다. 후속 단계마다 별도 브랜치/PR로 docs·tests·작은 코드 변경을 제출한다. 공개 artifact에 fixture, 테스트 자격증명, 보고서의 민감 자료가 포함되지 않도록 산출물 목록을 검사한다. 운영 main과 Pages 설정 변경은 마지막 검증·승인 단계다.

## 7. 완료의 정의

작은 파일 수가 늘었다는 이유로 완료 처리하지 않는다. domain의 IO 의존 0, renderer의 업무 mutation 0, 중복 소유자 없는 UI component, dispose 가능한 이벤트, 단일 recurrence planner, 호환 adapter 테스트, 기능별 검증 증거가 있어야 해당 영역 분리가 끝난 것이다.
