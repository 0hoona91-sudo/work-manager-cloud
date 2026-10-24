# 6-A 저장 명령과 상태 경계

기준: `94316408ccc2492542cf092beb80aa05183f296f` / `refactor/phase5b2-recurrence-atomicity`.
결과: `refactor/phase6a-save-command`.

기존 05·06·08 설계 및 5-B①/② 결과를 재사용했다. 운영 Firebase/Drive 접근, main 변경, 배포, 규칙 변경, 스키마 변환, 새 도구 설치, Emulator 다운로드 재시도는 하지 않았다.

## 실제 연결 범위

기존 `openTaskForm(id)`의 **독립적인 미완료 일반 업무 수정 → 저장 버튼**을 연결했다. 기존 폼의 날짜/체크 입력 수집은 유지하되, 직접 Object.assign과 saveState 래퍼 체인으로 들어가기 전에 명령 계층으로 전달한다. 프로젝트, 반복·라이브러리 원본/회차, 연계·그룹 업무, 완료 업무는 선택 대상에서 제외한다. 수정 중 반복/연계를 선택하면 기존 전용 경로를 사용한다.

`task.create`, `task.update`, `task.delete` 명령 계약과 단위 검사는 구현했다. **등록·삭제 UI는 이번에 전환하지 않았다.** 기존 빠른 등록, 삭제, 프로젝트 편집, 명시적 재개, 백업 복원, 반복 생성, 첨부 업로드는 이전 진입점을 유지한다.

| 책임 | 기존 경로 | 이번에 연결한 경로 |
|---|---|---|
| 입력 | 폼이 공유 state를 수정 | 폼의 draft와 명령 객체 |
| 검증 | 각 handler에 분산 | 작업 유형·현재 업무·보호 필드·날짜·ID 검사 |
| 비교 | 저장 codec의 전체 snapshot diff | application ChangeSet + 기존 codec diff |
| 중복 | 반복/일반 저장 래퍼 각각 처리 | operationId별 같은 Promise 및 버튼 비활성화 |
| 저장 | V181/Google Tasks/workflow 래퍼를 통과 | 원래 saveState 저장 구현을 캡처한 포트 1회 |
| 오류 | 호출부마다 다른 처리 | failed/conflict/recovery-required, 입력 유지 |
| 완료 | 저장 Promise 종료에 의존 | 해당 요청 버전의 서버 트랜잭션 확인 여부 |

`saveState(meta)` API와 기존 래퍼는 호환 경로로 남아 있다. `persistStateV6A`는 원래 saveState 구현을 래퍼 설치 전에 캡처한다. `save-command-adapter.js`는 이 포트로 IndexedDB/Firestore 저장을 호출한다. 새 전역 saveState 덮어쓰기는 추가하지 않았다. 선택한 수정 경로는 다른 업무의 반복 보충이나 프로젝트 종료 보정 래퍼를 실행하지 않는다. 반복 보충은 기존 등록 저장 및 초기 동기화/online/visibility/시간 간격 절차에서 계속 실행된다.

## 모듈과 ChangeSet

- `js/save-command.js`: DOM/SDK/내부 시계/난수 없는 application 계층. 날짜 유효성은 기존 WMDateOnly를 사용한다. CommonJS와 브라우저 로딩을 지원한다.
- `js/save-command-adapter.js`: state, 현재 업무공간/UID, 기존 저장 포트, 상태 이벤트를 주입하는 composition 코드. 추가 저장 큐나 SDK 연결을 소유하지 않는다.
- 명령: `{operationId, type, context?, taskId?, expected?, patch?, task?}`. UI는 폼을 열 때 operationId, 업무공간, 기대 업무를 캡처한다. ID 발급은 기존 uid 함수를 사용한다.
- ChangeSet: `{operationId, type, baseVersion, before, after, changes, taskIds}`. 항목별 collection/ID, add/update/delete, 변경 필드, 이전/이후 자료를 포함한다. ID 배열의 순서 변화도 별도 order 변경으로 기록한다. 미해석 필드는 그대로 보존한다.
- baseVersion은 정렬된 JSON 표현이다. 해시 충돌이 없는 비교 토큰이지만 큰 자료에서 비용이 크다. 이 snapshot과 본문은 로그나 Firestore metadata로 전송하지 않는다. 현재 기대 업무 검사는 로컬의 stale draft 차단이며 서버 revision 검증을 대신하지 않는다.
- 같은 operationId·같은 입력은 진행 중/완료/실패 후에도 같은 Promise를 반환한다. 같은 ID의 다른 명령은 거부한다. 작업 간 실행 순서는 application queue가 보장한다. 기존 로컬 저장 큐와 cloud queue는 전송 책임을 유지하며 새 코드에서 복제하지 않는다.
- 변경이 없으면 mutation/persist를 호출하지 않는다. 신규 task ID는 호출자가 제공하며 중복 ID를 거부한다. update는 허용 필드만 변경하며 완료일, history, generatedKey, 첨부 참조, ID 등을 덮어쓰지 못한다. 완료 업무는 일반 수정 대상이 아니며 이력 있는 업무의 일반 삭제도 차단한다.

명령 ID 중복 억제는 **현재 application 인스턴스/페이지 세션 범위**다. 영속 operation journal이나 여러 기기의 일반 업무 명령 중복 방지는 도입하지 않았다. 반복 생성의 서버 잠금은 기존 5-B② 계약을 그대로 사용한다.

## 저장 상태와 서버 확인

| 상태 | 의미 |
|---|---|
| idle | 대기 또는 변경 없는 명령; 기존 미확정 변경이 있으면 idle로 바꾸지 않음 |
| validating | 업무/명령/현재 계정/기대 업무 및 ChangeSet 검증 |
| saving | 대상 업무만 적용한 뒤 기존 포트의 완료 대기 |
| pending-sync | 로컬 저장, offline 대체, 합쳐져 대체된 요청, 확인 없는 응답 |
| saved | 같은 operationId·요청 버전의 온라인 transaction 저장 완료 응답 |
| conflict | stale draft, 서버 충돌 응답, 작업/업무공간 충돌 |
| recovery-required | 저장 이후 오류·부분 성공·저장 중 계정 전환·응답 불명확 |
| failed | 검증 실패 등 저장 적용 전 오류 |

cloud `queuedResolvers`에 operationId를 보존하고, flushQueue가 receipt를 반환한다. 모든 온라인 청크의 runTransaction Promise가 완료됐고 해당 resolver의 targetVersion이 실제 저장 snapshotVersion과 같으며 중복 회차 조정이 없을 때만 `persistence:'server-confirmed'`다. 합쳐져 대체된 오래된 요청은 새 snapshot이 저장됐어도 별도의 정확한 명령 확인으로 취급하지 않는다. online 표시만으로 확인하지 않으며, online 실패 후 offline batch 전환과 diff가 없는 경우도 보수적으로 pending-sync다. 동기화 표시 문구도 확인 근거가 없으면 “동기화 확인 대기”로 표시한다.

이는 **그 명령의 전송 완료**에 관한 정보다. 여러 청크 전체의 원자성, 다른 사용자의 동시 편집과의 무충돌, 모든 미저장 입력의 저장 완료를 뜻하지 않는다. 실제 SDK의 운영 동작은 이번에 원격 검증하지 않았다.

## 실패·편집·실시간 반영 보호

명령은 검증 후 대상 task만 적용한다. 저장 이후 실패해도 전체 메모리를 과거 snapshot으로 되돌리지 않는다. 저장 중 추가된 다른 업무 편집과 제출한 입력을 유지하고, 불명확한 저장 이후에는 후속 명령을 자동 재시도하지 않는다. 새로고침/서버 확인 전에 서버 및 로컬 캐시에 일부 변경이 남을 수 있다.

계정/업무공간을 enqueue 시점과 실행 직전, 완료 직후에 확인한다. 명시적으로 인증되지 않은 폼 context가 나중 계정으로 대체되지 않도록 한다. 이미 전송된 이전 계정의 쓰기를 되돌리는 보장은 없다.

미저장/미확정 편집 또는 복구 필요 상태에서는 기존 scheduleRemoteApply가 전체 state를 교체하지 않도록 application의 `blocksRemoteApply`를 확인한다. 확정 저장 후에도 그사이 추가 편집이 있으면 전체 교체를 보류한다. 이후 명시적 저장으로 반영되면 해제한다. offline 응답의 후속 서버 확인/영속 재시도 UI는 아직 없어 pending-sync가 유지될 수 있다. 서버 상태와 로컬 입력을 보존·비교한 후 확인해야 하며, 이 제한을 자동 저장 성공으로 숨기지 않는다.

폼의 중복 제출은 한 operation으로 처리한다. 저장 중 입력값이 달라졌다면 모달을 닫지 않고 추가 입력을 유지하며 다음 편집 세션을 준비한다. 서버 충돌/실패 시에도 폼을 닫지 않는다.

## 검증

```sh
node tests/run.cjs --commands-only
node tests/run.cjs --atomicity-only
npm test
```

| 범위 | 총수 | PASS | XFAIL | FAIL | XPASS | NOT_RUN |
|---|---:|---:|---:|---:|---:|---:|
| 기존 등록 검사 | 228 | 211 | 4 | 0 | 0 | 13 |
| 신규 command 검사 | 22 | 22 | 0 | 0 | 0 | 0 |
| 최종 전체 | 250 | 233 | 4 | 0 | 0 | 13 |

전체 회귀는 집중 검사 후 한 차례 실행했다. 기존 228개 ID·제목·상태 및 XFAIL의 기대/관측값을 [baseline-comparison.json](baseline-comparison.json)에 비교한다. [after-results.json](after-results.json)은 코드 해시와 최종 결과다. 커밋 전 검사이므로 checkoutHead는 기준 5-B② 커밋이다. NOT_RUN 때문에 전체 명령 종료 코드는 1이며 이를 성공 종료로 바꾸지 않았다.

CMD-01~15는 등록/수정/삭제, operationId 중복/충돌, 실행 순서, ChangeSet, no-op, 추가 편집/실패 보존, stale/서버 충돌, 저장 확인 구분, 계정 전환, 이력/키/체크/첨부 보호와 검증을 검사한다. CMD-16~18은 **실제 cloud 함수 + 모의 transport**로 transaction 확인, queue coalescing, offline fallback receipt를 검사한다. CMD-19~20은 인증 없는 폼 context와 부분 성공/미확정 상태 보존이다. CMD-UI-01~02는 **격리 Chromium의 실제 수정 폼 + 모의 저장 포트**로 중복 제출 1회 저장과 저장 중 입력 보존을 검사한다. UI fixture는 이미 초기화된 화면 설정을 유지한다. 설정 전체를 불완전한 fixture로 바꿔 발생한 기존 홈 레이아웃 초기화 저장은 명령 중복과 구분했으며 저장 1회 assertion을 유지했다.

5-B② 모의 transaction 22개, 프로젝트/날짜/반복, 완료 이력, 3-D 백업 정책 검사는 기존 suite를 그대로 사용했다. BUG-01/02/08/09 XFAIL은 유지했다. 기존 Emulator 검사 13개는 원래 다운로드 실패에 따른 NOT_RUN을 유지하며 설치/다운로드를 재시도하지 않았다. 실제 Firebase/OAuth/Drive 검증 또는 Emulator 실측 성공을 주장하지 않는다.

## 6-B 전환 순서와 남은 위험

1. 일반 업무 등록/삭제 UI 및 `deleteTasksByIdsV2`의 휴지통·suppression을 command로 옮기기 전에 각각의 효과를 계약화한다. 이번 command의 create/delete 단위 테스트를 UI 전환 완료로 해석하지 않는다.
2. `saveState` V181 래퍼의 등록/종료일/보충, workflow의 프로젝트 종료 보정, Google Tasks 저장 이벤트를 명시적 command/hook으로 이전한다. 이번에는 일반 수정 경로만 이를 우회했다.
3. `flushQueue`의 snapshot 병합·resolver·metadata, shadowMaps/recordMaps의 서버 revision을 명령별 ChangeSet과 연결한다. 현재 서버의 동시 필드 수정은 기존 patch 저장 정책이므로 일반 편집의 lost update 위험이 남는다.
4. `subscribeRealtime`/`scheduleRemoteApply`의 draft·로컬 dirty·서버 확인 상태를 통합한다. 전체 snapshot 교체, pending-sync 후 확정, 미저장 입력 재조정, 취소/복구 UI가 우선 대상이다.
5. operationId journal을 영속·한도 관리하고, 부분 저장/IndexedDB·Firestore 이중 저장을 복구 가능하게 한다. 현재 operation 결과와 전체 ChangeSet을 세션 메모리에 보관하므로 대량 데이터/장시간 세션 비용도 남는다.
6. 프로젝트 저장, 백업 전체 복원, Drive 업로드, 여러 청크는 기존 전용 계약을 포트로 연결하되 한 번에 교체하지 않는다. Emulator 13건과 운영 규칙/구형 클라이언트 검토는 별도 검증이 필요하다.

## 변경 파일과 롤백

`js/save-command.js`, `js/save-command-adapter.js`, `index.html`, `js/cloud-sync.js`, `tests/save-command.test.cjs`, `tests/run.cjs`, `docs/refactor/phase6a/`.

전용 브랜치에서 `git revert <6-A 결과 커밋>`으로 모듈/연결/receipt/테스트를 함께 되돌린다. main reset/force push나 데이터 마이그레이션은 필요 없다. 저장된 업무/ID/이력/생성키는 삭제하지 않는다. revert는 이후 실제 저장을 취소하지 않으므로, 부분 저장이 의심되면 로컬 입력과 서버 기록을 보존·대조한 뒤 별도로 복구한다.
