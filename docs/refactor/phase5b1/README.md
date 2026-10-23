# 5-B① 반복 생성키 및 생성·렌더링 분리

기준: `refactor/phase5a-recurrence-rules`, `9c4ff82b702123220a9d809210fe0c31baf2535b`.
결과: `refactor/phase5b1-recurrence-identity`. main 병합, 배포, 운영 API 호출, 데이터 일괄 변환은 하지 않았다.

## 변경 전후

기존 V181은 생성 회차에 generatedKey를 넣지 않았고, renderTaskTable 래퍼에서 ensureOccurrences와 saveState를 호출했다. 기존 BUG-12 기대값 `[true,true,true]`에 대한 관측값 `[false,false,false]`를 수정 전에 재현했다([before-results.json](before-results.json)).

이제 `WMRecurrenceIdentity.plan`이 순수 계획을 만들고, `apply`가 검증한 계획을 적용하며, V181 application 함수가 저장 완료를 기다린다. 렌더러에서 이 명령을 호출하는 연결은 제거했다. BUG-12의 기존 기대값을 유지하고 실제 cloud-sync 직렬화/역직렬화와 generatedKeys 3건 보존 검사까지 추가했다.

## 생성키와 호환 정책

형식은 `wm-recurrence:v1:<encodeURIComponent(workspace)>:<encodeURIComponent(rootId)>:<YYYY-MM-DD>`다.

- 회차 날짜는 휴일 이동 전 `repeatScheduledDateV181`이다. 토요일·일요일 회차가 같은 월요일로 이동해도 서로 다른 키다. 표시 날짜를 수동 수정해도 기존 키는 바꾸지 않는다.
- 클라우드 범위는 실제 개인 Firebase 저장 공간인 projectId, 로컬 모드는 기존 로컬 상태 키다. 인증정보·계정 이메일·토큰을 키에 넣지 않는다. 같은 개인 프로젝트를 사용하는 기기는 같은 범위를 사용한다.
- 원본은 기존 업무 ID로 구분한다. 같은 템플릿을 독립 등록한 두 원본도 별도 시리즈다. 기존 원본 업무의 ID/키는 재발급하지 않는다. 최초 수동 등록 원본을 새 회차로 복제하지 않는다.
- 기존 정상 generatedKey는 유지한다. 원본 연결과 원래 회차일이 명확한 키 없는 회차만 키 필드를 보충한다. 완료/재개 이력, 수동 날짜, 체크 ID, 첨부 참조 등 다른 필드는 그대로 둔다.
- 기존 원본 연결 또는 원래 회차일이 불명확하면 해당 원본의 생성을 보류하고 `AMBIGUOUS_OCCURRENCE`를 보고한다. 수동 수정 가능한 start를 근거로 추정하지 않는다. 중복 회차/키 충돌은 `DUPLICATE_SLOT`/`KEY_COLLISION`으로 보고하며 기존 자료를 병합·삭제·덮어쓰지 않는다.
- 기존 키의 신뢰 가능한 원래 회차는 새 규칙의 키를 별칭으로 예약하되, 업무의 기존 키를 교체하지 않는다. 외부 업무가 그 키를 소유하면 보류한다.
- schema11의 기존 `settings.suppressedAutoKeys`에 신규/호환 키와 별칭을 예약한다. 살아 있는 회차도 예약하여 이후 삭제 시 재생성을 막는다. 기존 배열 값은 보존하며 `dbauto:` 키와 접두사를 구분한다. 정상 업무를 다시 불러올 때는 기존 업무의 원래 슬롯을 먼저 인식한다.
- cloud-sync의 기존 task.generatedKey 직렬화와 generatedKeys 문서 계약은 변경하지 않았다. 기존 stableKeyId는 전체 키의 base64url 표현이며, 삭제된 업무의 generatedKeys도 shadowMaps에서 유지한다. controller의 읽기 전용 recurrenceContext로 업무공간·초기 준비 상태·저장된 잠금 복사본만 전달한다.

이미 삭제된 과거 회차가 키도 없었거나, 기존 잠금에서 원본/원래 회차일을 복원할 수 없다면 새 키로 자동 추정할 수 없다. 이 자료의 재생성 가능성은 남으며 별도 검토 대상이다. 완료 원본에서 생성하지 않는 기존 수명 정책과 종료일 선택 정책은 유지했다.

## 계획·실행·저장 경계

`js/recurrence-rules.js`와 WMDateOnly는 수정하지 않았다. 선택 월·요일, half/semiannual, 월말·윤년, 명시 종료일, 휴일 이동, 3개월 rolling 정책을 그대로 사용한다.

1. `plan(state, {scope,today,locks})` → additions, mappings, reservations, conflicts, warnings와 기준 상태 지문. DOM·네트워크·내부 시계·난수 사용 및 입력 변경 없음.
2. `apply` → 현재 상태/업무공간/잠금이 계획 기준과 같은지 확인하고 계획을 재검증한다. 새 업무·체크 ID는 주입한 생성기로 부여하고 ID 충돌을 상태 변경 전에 거부한다.
3. 저장 명령 → 등록 시 기존 종료일 선택/휴일 처리, 계획 적용, 기존 saveState 한 번, Promise 결과 확인. 연속 보충 호출은 같은 진행 중 Promise를 공유한다. 추가 편집 저장은 앞선 실행 후 별도 명령으로 처리한다.

기존 40건/원본·100건/호출의 중간 절단은 제거했다. 3개월 범위의 순수 계획 전체를 적용해야 같은 입력을 두 번째 실행했을 때 추가 생성이 0건이 되기 때문이다. 매일 선택한 주간 일정으로 40건 초과 및 재실행 0건을 검증했다. recurrence-rules의 날짜 탐색 한도는 유지된다. 원본이 매우 많은 공간의 저장량과 Firestore 분할 쓰기 원자성은 별도 위험이다.

`ensureOccurrences`는 명시적 저수준 적용용 호환 API로 남지만 렌더러에서는 호출하지 않는다. 일반 application 경로는 `planOccurrences` → `applyOccurrences` → 저장을 사용한다.

## 자동 생성과 화면

- 등록·수정의 기존 saveState 명령이 자동 배치를 수행한다. `registrationSnapshotV181` 및 `applyEndChoice` 진입점은 유지했다.
- 초기 activate/동기화 및 초기 업로드가 완료된 후 `wm-data-ready` 이벤트로 독립 보충한다. 모듈이 늦게 로드되면 준비 플래그를 확인해 실행한다.
- 이후 한 시간 간격, 화면 복귀(visibilitychange), online 이벤트에서 독립 보충한다. 초기 준비 전에는 보충하지 않는다. 새 회차가 저장된 뒤 화면을 갱신하며, 화면 갱신이 생성을 요청하지 않는다.
- V181의 renderTaskTable 래퍼를 제거했다. 업무·홈·라이브러리 렌더링을 반복해 상태 전체 동일, 새 업무/키 0건, 저장 호출 0회를 검증했다. 이는 합성 일반 반복 업무 상태에 대한 브라우저 검사이며 모든 기존 UI 상태 조합을 검증했다는 뜻은 아니다.
- 브라우저 검사에서 목록 렌더러가 `migrateV8Data()`로 template.owner 기본값을 쓰는 기존 부작용을 발견했다. 업무/라이브러리 목록의 해당 호출을 제거하고 ownerProfileV8을 읽기 전용 기본값 계산으로 바꿨다. 로딩 시 기존 migrateStateV2 초기화와 명시적 담당자 설정 처리는 유지한다. UI 전체나 다른 엔진을 재작성하지 않았다.

## 저장 실패와 복구

상태는 `idle` → `saving` → `saved` 또는 `pending-sync`, 실패 시 `recovery-required`다. `saved`는 기존 saveState Promise가 완료됐다는 뜻이며 모든 서버 쓰기의 원자적 커밋을 뜻하지 않는다. 브라우저 offline이면 전송 대기로 구분한다. 온라인 상태에서 SDK가 내부 오프라인 쓰기로 전환한 경우에는 기존 저장 API만으로 확실한 서버 확인을 판별할 수 없다.

실패하면 호출자에게 reject하고 독립 보충에서는 안내를 표시한다. 메모리 상태가 적용 직후와 같고 업무공간도 같을 때만 실행 전 스냅샷으로 되돌린다. 저장 중 추가 사용자 편집이 있으면 그것을 덮어쓰지 않는다. 이후 자동 재시도는 막고 새로고침/동기화 후 실제 저장 결과를 확인하도록 한다. 이 상태에서는 편집 저장도 거절되므로 사용자에게 결과 확인이 필요하다.

로컬 IndexedDB 저장과 일부 Firestore 쓰기는 이미 성공했을 수 있다. 메모리 복원은 서버/로컬 저장소 복원이 아니며 부분 성공 자료를 자동 삭제하지 않는다. 재접속 후 task.generatedKey, generatedKeys, 예약 키, 수행 기록을 대조해야 한다. 그 복구 절차의 자동화는 5-B② 대상이다.

## 검증과 증거

```sh
node tests/run.cjs --recurrence-only
npm test
```

| 범위 | 총수 | PASS | XFAIL | FAIL | XPASS | NOT_RUN |
|---|---:|---:|---:|---:|---:|---:|
| 수정 전 반복 검사 | 8 | 7 | 1 | 0 | 0 | 0 |
| 수정 후 집중 검사 | 49 | 49 | 0 | 0 | 0 | 0 |
| 기존 검사 유지 | 173 | 169 | 4 | 0 | 0 | 0 |
| 신규 검사 | 20 | 20 | 0 | 0 | 0 | 0 |
| 최종 전체 | 193 | 189 | 4 | 0 | 0 | 0 |

[after-results.json](after-results.json)은 최종 전체 회귀 테스트 한 차례의 결과와 소스 해시다. [baseline-comparison.json](baseline-comparison.json)은 기존 173개 ID 유지, BUG-12만 PASS 전환, 나머지 XFAIL 기대값·관측값 불변을 기록한다. 커밋 전 실행이므로 checkoutHead는 기준 5-A 커밋이다.

신규 IDENT-01~11은 키 결정성/범위/휴일 중첩/기록 보호/호환 매핑/충돌/삭제 잠금/실제 codec 왕복/계획 검증을 검사한다. IDENT-12~17은 실제 V181 저장 어댑터의 등록 자동 배치·초기 준비 이벤트·실패/동시 편집·렌더러 비개입과 실제 controller getter를 격리 실행한다. 저장 및 SDK는 모의 함수다. IDENT-18~19는 밀집 주간 일정 멱등성과 기존 키의 원격 소유권 충돌을 검사한다. IDENT-UI-01은 외부 요청을 차단한 Chromium에서 실제 렌더러를 검사한다. 기존 RULE-12~15의 완료/재개·수동 회차·종료일 변경 보호와 5-A 월별/반기/시간대 검사는 그대로 유지했다.

실제 Google 로그인, Firebase SDK 서버 저장, Drive 파일, 두 기기 동시 실행은 미검증이다. NOT_RUN 0은 등록된 합성/모의/격리 브라우저 검사가 모두 실행됐다는 의미다. 새로운 프레임워크 설치는 없었다.

## 남은 위험과 5-B②

- XFAIL 유지: BUG-01(Tasks 모델 누락), BUG-02(CSS 문법), BUG-08(객체 체크리스트 변환), BUG-09(projectResources 정리).
- 결정적 키와 관측된 잠금만으로 두 기기의 동시 읽기·생성을 원자적으로 막을 수 없다. 서로 다른 task ID가 같은 generatedKey로 저장되는 경쟁은 여전히 가능하다.
- Firestore transaction/보안규칙, 오프라인 잠금 가시성·지연·재연결, 분할 저장의 부분 성공, 예약 키 배열의 다중 기기 갱신 유실, 서버 확인과 대기 상태 구분을 5-B②에서 다뤄야 한다.
- 키 없는 불명확한 과거 회차는 경고 후 보류한다. 자동 정리하거나 수행 기록을 덮어쓰지 않는다. `getDiagnostics()`로 원본별 원인을 확인할 수 있다.
- 기존 sourceRoot/seriesRoot, 원본 완료 시 시리즈 수명, 수동 원본 이동의 anchor 정책은 변경하지 않았다.

## 변경 파일과 롤백

- `js/recurrence-identity.js`: 순수 계획, 안정 키, 호환 매핑, 적용 검증.
- `js/project-ui.js`: 렌더 래퍼 제거, 명시적 저장/독립 보충 및 상태 처리.
- `js/cloud-sync.js`: 준비 상태와 기존 잠금의 읽기 전용 전달만 추가.
- `index.html`: 모듈 로딩/버전, 준비 이벤트, 목록 렌더의 기본값 쓰기 제거.
- `tests/recurrence-identity.test.cjs`, `tests/recurrence.test.cjs`, `tests/helpers.cjs`, `tests/run.cjs`: 신규 20개, BUG-12 정상화/codec 검증, 모의 주입, 결과 기록.
- `docs/refactor/phase5b1/`: 정책과 수정 전후 증거.

결과 커밋을 전용 브랜치에서 `git revert <5-B① 커밋>`하거나 기준 커밋에서 별도 복구 브랜치를 만든다. main reset/force push나 스키마 변환은 필요 없다. revert는 이후 생성한 업무·키·억제 정보를 삭제하지 않는다. 저장 자료는 보존하고 비교 후 별도로 처리한다. 코드를 되돌리면 생성키 누락 및 렌더링 중 생성·저장 동작이 다시 나타난다.
