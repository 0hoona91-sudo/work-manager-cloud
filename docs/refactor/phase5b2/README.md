# 5-B② 반복 회차의 Firestore 생성키 선점

기준: `refactor/phase5b1-recurrence-identity` / `0e7f912fd2b6963adca79b0f88ff530a6e4dcf7a`.
결과 브랜치: `refactor/phase5b2-recurrence-atomicity`.

**클라이언트 저장 경로를 수정하고 모의 검증을 완료했다. 실제 Firestore Emulator 동시성 검증은 실행 파일 다운로드 실패로 미실행이다. 운영 서버에서 검증된 원자성이라고 주장하지 않는다.** main 병합, Pages 배포, 운영 Firebase 접속·쓰기, Drive 파일 변경, Security Rules 배포는 하지 않았다.

## 변경 전후

| 경계 | 5-B① | 5-B② |
|---|---|---|
| 신규 task ID | 적용할 때 랜덤 ID | 새 회차에 한해 `occurrence:<generatedKey>`; 재계획/재시도 시 동일 ID |
| 생성키 확인 | diff의 새 잠금만 확인 | 새 keyed task도 반드시 서버 잠금 확인; 로컬 shadow의 잠금이 우회 수단이 되지 않음 |
| 큰 업무 묶음 | 한 묶음을 청크로 절단 가능 | 신규 업무·체크·링크·잠금 묶음 절단 금지; 한도 초과 시 쓰기 전 오류 |
| 충돌 결과 | 서버 쓰기를 건너뛰고도 로컬 요청을 shadow에 반영 | 서버 소유 업무와 자식 자료를 조회해 해당 임시 회차만 교체/제외 |
| 오프라인 | 생성키도 batch에 포함 가능 | 신규 선점은 batch 및 온라인 실패 후 batch 대체 모두 금지 |
| 미확정/부분 실패 | 일반 저장 큐가 이어서 진행 가능 | 복구 필요 상태, 남은 큐 reject, 자동 재시도 및 전체 상태 교체 중단 |
| 로컬 캐시 | 충돌 전 요청이 남을 수 있음 | 서버 충돌을 조정한 후 현재 메모리의 교정된 캐시를 순서대로 저장 |

5-A 규칙과 WMDateOnly는 그대로 사용한다. 선택 월·요일·휴일 이동 전 회차일·반기·종료일·3개월 rolling, 완료 원본의 수명 정책은 변경하지 않았다. schema11 구조, 기존 업무 ID/생성키/잠금, completionHistory, 완료일, 수동 날짜, 첨부 참조 및 suppression을 일괄 변경하지 않는다. 키 없는 과거 회차의 신뢰 가능한 매핑/불명확한 회차 보류 정책도 유지했다.

## 트랜잭션 계약

저장 공간은 개인 Firebase 프로젝트의 기존 최상위 `tasks`, `checklistItems`, `taskLinks`, `generatedKeys` 컬렉션이다. 생성키는 5-B①의 projectId·원본 ID·휴일 이동 전 날짜 형식을 유지하고, 잠금 문서 ID도 기존 `stableKeyId(key)`를 사용한다. 저장 큐의 업무공간 지문에는 projectId와 현재 개인 Firebase UID를 함께 넣는다.

1. `diffMaps` 결과를 업무 단위로 묶는다. 같은 업무의 키·체크·링크는 한 청크다. 한 묶음이 320 변경을 초과하면 전체 청크 계획 단계에서 오류를 반환해 아직 쓰지 않는다. 신규 선점은 청크당 최대 10묶음으로 제한해 테스트 규칙의 getAfter 접근 예산도 고려한다. 실제 운영 규칙이 더 많은 문서를 읽으면 추가 조정이 필요하다.
2. 트랜잭션은 신규 잠금을 먼저 읽고, 필요한 업무 문서도 읽는다. 모든 읽기는 쓰기 전에 수행한다. 새 keyed task의 잠금이 로컬 shadow에 있어도 서버에서 다시 확인한다.
3. 잠금이 없을 때만 신규 업무와 잠금을 같은 트랜잭션에 쓴다. 업무 없는 단독 잠금 생성은 일반 저장에서 거부한다. 잠금 없는 기존 task ID가 서버에 있으면 덮어쓰지 않고 중단한다. 기존 keyed task의 update 대상이 서버에서 사라진 경우에도 자동 부활시키지 않는다.
4. 잠금이 있으면 소유 task를 트랜잭션에서 읽고 생성키 일치를 확인한다. 요청 task 및 연결된 체크/링크 쓰기를 모두 건너뛴다. 같은 task ID로 재시도해도 완료/수정된 서버 기록을 다시 쓰지 않는다. 소유 task가 없으면 삭제 잠금으로 취급해 새 task를 만들지 않는다. 손상된 잠금은 복구 필요 오류다.
5. 트랜잭션 재실행은 Firebase SDK의 runTransaction에 맡긴다. 콜백의 skip/결과 목록은 매 시도 새로 만든다. 앱에서 무한 재시도 루프를 만들지 않는다. 신규 task ID와 생성키는 시도마다 바뀌지 않는다.
6. 개별 회차 묶음 안의 쓰기는 원자적 트랜잭션 대상이다. 여러 청크 전체는 원자적이지 않다. 실패 시 committedChunks/totalChunks를 전달하며, 성공 여부가 불명확한 실패 청크는 성공 개수에 포함하지 않는다. 크기/규칙/서버 제한 오류를 전체 성공으로 표시하지 않는다.

기존 백업의 별도 검토·원격 기준 비교 계약은 유지했다. 백업 테스트 harness에 새 순수 보조 함수만 주입했으며 기존 ID·assertion은 수정하지 않았다. 일반 저장 엔진을 별도로 교체하지 않았다.

## 충돌 후 메모리·캐시 조정

트랜잭션 결과는 localTaskId, remoteTaskId, 잠금 및 삭제 여부를 반환한다. `reconcileRecurrenceCollisions`는 해당 서버 task/체크/링크/잠금만 서버 강제 읽기로 가져온다. 전체 업무 목록을 무조건 초기화하지 않는다.

- 요청 당시 임시 업무와 현재 메모리/대기 큐의 동일 업무가 같을 때만 서버 자료로 교체한다. 잠금만 남았다면 해당 신규 임시 업무를 제외한다. 기존 업무의 자동 병합·정리가 아니다.
- 임시 업무에 새 편집이 생겼거나 서버 winner ID의 다른 로컬 자료가 이미 있다면 이를 덮어쓰지 않고 복구 필요 상태로 중단한다. 다른 업무의 미저장 편집은 그대로 둔다.
- 수정된 nextMaps를 shadow/recordMaps에 반영하고 `recurrenceReconciled:true`를 반환한다. index의 기존 saveState가 로컬 저장 큐 뒤에 교정된 현재 상태를 다시 저장한다. 이 캐시 쓰기가 실패해도 성공으로 종료하지 않는다.
- 보존한 미저장 편집이 있으면 후속 scheduleRemoteApply의 전체 상태 교체를 보류한다. 이후 명시적 저장으로 해당 편집이 반영되면 해제한다. 복구 필요 상태에서는 새로고침·서버 확인 전 자동 전체 교체를 중단한다.
- 충돌 재조회는 여러 서버 읽기이므로 전체 bundle의 단일 read-time snapshot을 보장하지 않는다. 동시에 계속 수정되는 체크 자료의 일관된 조회는 6단계 대상이다. 잠금/소유 업무가 달라지면 중단하며 서버 기록을 덮어써 해결하지 않는다.

## 오프라인·재연결·상태 정책

클라우드 오프라인에서는 planner 결과만 계산하고 신규 회차/호환 매핑/예약 키를 메모리 업무에 적용하지 않는다. 새 회차는 온라인 상태의 독립 보충에서 다시 계산하고 트랜잭션으로 확인한다. 생성키 선점이 없는 일반업무 수정은 기존 offline batch 경로를 유지한다. 이미 존재하는 업무의 모든 오프라인 충돌을 해결한 것은 아니다.

브라우저가 online이라고 판단해도 실제 연결이 끊겼다면, 선점을 포함한 저장은 offline batch로 바꾸지 않는다. 실패/응답 유실/부분 성공은 복구 필요로 전환하고 자동 추가 생성·저장을 막는다. 메모리 롤백은 서버/IndexedDB 롤백을 뜻하지 않는다. 새로고침 후 서버 잠금을 다시 확인하며 기존 operation의 생성키·결정적 task ID를 유지한다. 삭제 잠금과 suppression은 그대로 남긴다.

상태는 `WMTaskRecurrenceV181.getStatus()`에서 구분한다.

| 상태 | 의미 |
|---|---|
| planned | 순수 생성 계획 산출 |
| saving | 기존 저장 명령 대기 중 |
| pending-online | 오프라인: 신규 회차 적용 없이 온라인 확인 대기 |
| saved | 저장 Promise 완료; 신규 선점은 트랜잭션 경유 |
| conflict-resolved | 중복 임시 요청을 서버 기록으로 조정함; 로컬 생성 건수를 서버 신규 생성 건수로 해석하면 안 됨 |
| recovery-required | 실패·부분 성공·편집 충돌·응답 불명확: 자동 재시도 금지 |

online/visibility/시간 간격 보충은 5-B①의 독립 실행 절차를 유지하며 render는 생성 명령을 호출하지 않는다. 계정/업무공간은 큐 진입, 업로드 전후, 트랜잭션 콜백, 결과 적용 전 검사한다. 이전 공간의 대기 작업을 새 공간에 보내지 않는다. 이미 전송된 이전 공간의 트랜잭션을 계정 전환이 되돌릴 수는 없다.

## 테스트와 Emulator 제약

Firebase SDK `12.18.0`, firebase-tools `15.34.1`을 개발 의존성으로 한 번 설치했다. Java 21은 기존 환경에 있었다. CLI는 `demo-work-manager`, loopback 8089, 테스트 전용 설정으로 실행했으나 `cloud-firestore-emulator-v1.22.0.jar` 다운로드에서 실패했다. 반복 설치/다운로드는 하지 않았다. [emulator-attempt.log](emulator-attempt.log), [emulator-status.json](emulator-status.json)에 근거를 저장했다. 실제 서버 트랜잭션/네트워크 재연결/규칙 실측은 **미검증**이다.

```sh
node tests/run.cjs --atomicity-only
npm test
```

Emulator가 없는 이번 환경에서는 NOT_RUN 때문에 두 명령의 종료 코드는 1이다. 환경 실패를 PASS/XFAIL로 숨기거나 테스트를 삭제하지 않았다. 가능한 환경에서 재현할 명령:

```sh
npx firebase emulators:exec --only firestore --project demo-work-manager \
  --config tests/emulator/firebase.json 'node tests/run.cjs --atomicity-only'
```

테스트 bootstrap은 프로젝트를 demo-work-manager로 고정하고 `FIRESTORE_EMULATOR_HOST`가 127.0.0.1:포트일 때만 실행한다. reset 요청도 해당 가상 프로젝트의 loopback emulator endpoint만 사용한다. 실제 SDK 클라이언트마다 별도 Firebase app/Firestore 인스턴스를 만들고 emulator mockUserToken을 쓴다. 운영 HTML/JS는 테스트 설정이나 Emulator 연결 코드를 import하지 않는다.

| 범위 | 총수 | PASS | XFAIL | FAIL | XPASS | NOT_RUN |
|---|---:|---:|---:|---:|---:|---:|
| 기존 검사 | 193 | 189 | 4 | 0 | 0 | 0 |
| 신규 모의 검사 | 22 | 22 | 0 | 0 | 0 | 0 |
| 신규 실제 SDK/Emulator 검사 | 13 | 0 | 0 | 0 | 0 | 13 |
| 전체 | 228 | 211 | 4 | 0 | 0 | 13 |

[after-results.json](after-results.json)은 전체 회귀 한 차례의 결과와 코드 해시다. [baseline-comparison.json](baseline-comparison.json)은 기존 193개 ID·제목·상태, XFAIL 4건의 기대값/관측값 보존을 확인한다. BUG-01/02/08/09는 이번에도 XFAIL이며 임의 수정하지 않았다. 집중 검사와 마지막 전체 검사에서 사용한 fixture의 체크 owner/dueDate/link 기본 필드를 schema11에 맞췄고 전체 동등성 assertion은 유지했다.

ATOMIC-MOCK-01~12는 2·3 클라이언트 경쟁, 원본/회차 구분, 이력/수동 기록 보호, 지연 및 optimistic retry, 오프라인 batch 차단·재연결, 응답 유실 후 재시도, 묶음 원자성/청크 한도, 삭제 잠금, 충돌 중 편집을 검사한다. 13~22는 부분 저장, 계정 전환, 일반 오프라인 수정, shadow 잠금 우회 방지, 실제 V181 어댑터의 온라인 대기, 기존 ID/삭제 업무 보호, 선택적 메모리 조정, 실제 saveState 캐시 교정, 후속 realtime 교체 차단을 검사한다. 실제 production 함수의 AST를 추출하며 운송 계층만 모의 구현한다. 모의 저장소는 읽기 버전이 바뀌면 callback을 재실행하지만 Firebase SDK/서버와 동일하다는 뜻은 아니다.

ATOMIC-EMU-01~12는 동일 계약을 실제 Firebase SDK와 독립 클라이언트로 수행하도록 작성했고, 13은 다른 UID 접근·다른 workspace key 생성·잠금 변경/삭제 거부를 검사한다. 응답 유실/지연은 SDK 경계에서 합성 주입한다. 13건 모두 이번에는 실행되지 않았다.

## Security Rules와 남은 위험

[security-rules-review.md](security-rules-review.md)에 소스에서 확인한 규칙 생성기, 배포 미확인 범위, 검토안을 기록했다. 운영 규칙을 읽거나 배포하지 않았다. 승인 UID에 전체 쓰기를 허용하는 기존 규칙에서는 오래된 클라이언트나 다른 코드가 잠금을 변경할 수 있다. 업데이트된 클라이언트 경로의 중복 방지와 서버 규칙으로 강제되는 보장은 구분해야 한다.

6단계 우선순위:

1. Emulator 13건을 실제 실행하고 배포된 규칙/인덱스/문서 크기/규칙 접근 예산을 승인된 별도 절차로 확인한다. 구형 클라이언트의 offline 잠금 쓰기 우회도 검토한다.
2. 부분 성공·응답 유실의 영속 operation journal, 서버 확정/로컬 대기 구분, 동일 operation 복구 UI를 설계한다. 현재는 안전하게 중단하고 재동기화한다.
3. 전체 snapshot 저장을 업무 단위 command/change-set으로 점진 분리한다. 일반업무 offline update/delete 경합, suppression 배열의 다중 기기 갱신 유실, 실시간 recordMaps 덮어쓰기 경합은 남아 있다.
4. 서버 task/체크 bundle의 일관된 조회와 미저장 편집 merge, IndexedDB와 Firestore의 이중 저장 복구를 다룬다. 두 저장소 간 원자성은 없다.
5. 신뢰할 수 없는 과거 회차와 과거 잘못 삭제된 잠금은 진단·사용자 검토 대상으로 유지한다. 자동 삭제·병합·일괄 ID 변경은 하지 않는다.

## 변경 파일과 롤백

운영 코드: `js/cloud-sync.js`, `js/recurrence-identity.js`, `js/project-ui.js`, `index.html`.
테스트: 신규 `tests/recurrence-atomicity.test.cjs`, `tests/recurrence-cloud-harness.cjs`, `tests/recurrence-emulator.cjs`, `tests/emulator/` 및 기존 harness/run 주입 변경. 개발 도구: package.json/package-lock.json. 문서: 본 폴더.

전용 브랜치에서 `git revert <5-B② 결과 커밋>`으로 코드·테스트·로딩 버전을 함께 되돌린다. main reset/force push, 데이터 삭제, 스키마 역변환은 필요 없다. 기존/새 task ID와 잠금은 저장된 그대로 남기고 자동 정리하지 않는다. 되돌리면 5-B①의 offline batch 생성과 충돌 후 로컬 불일치 위험이 다시 나타나므로, 복구 시에도 자료를 먼저 보존하고 서버 잠금과 대조해야 한다.
