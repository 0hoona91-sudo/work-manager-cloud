# 6-E Firestore 규칙·저장 호환성

기준 `9df82ae93f521b010f9bd9bdf31b25ff525cfb4f`; 결과 브랜치 `refactor/phase6e-firestore-rules-hardening`.

## 계약

6-D 규칙은 generatedKeys→task만 확인했고 task→generatedKeys 확인이 없었다. checklistItems는 wildcard write로 부모 revision 없이 변경할 수 있었다. 이번 테스트 규칙은 tasks/generatedKeys/checklistItems를 일반 allow와 분리하고, 나머지 컬렉션도 명시적으로 열거한다. synthetic-owner만 접근한다. 운영 규칙은 읽거나 배포하지 않았다.

- 규칙의 `String.toUtf8().toBase64()`와 치환으로 기존 `stableKeyId`와 같은 ID를 계산한다. 클라이언트가 제시하는 임의 잠금 경로를 신뢰하지 않는다. 기존 업무 ID, key 및 lock ID를 변경하지 않는다. Unicode 원본 ID를 포함한 실제 Emulator 검사로 연결을 확인한다.
- 신규 keyed task는 commit 이전에 잠금이 없어야 하고 commit 이후의 canonical lock이 해당 taskId·generatedKey를 가리켜야 한다. 새 lock도 canonical ID 및 commit 이후 task의 동일 키를 검사한다. task가 이미 존재하면 기존 키 없는 task에 키를 붙이는 신뢰 매핑만 허용한다.
- lock update/delete는 거부한다. 기존 잠금이 남은 task ID의 재생성도 거부한다. 기존 task의 nonempty generatedKey는 삭제·변경할 수 없다. 이미 있던 legacy keyed task의 일반 수정은 키를 유지한다.
- v1 키는 실제 테스트 업무공간 demo-work-manager 범위만 허용한다. 이전 `series:date` 등 비-v1 키도 기존 canonical lock과 atomic pair 계약으로 지원한다. 이런 키의 범위는 Firebase 프로젝트 자체이며 다른 프로젝트의 같은 legacy 문자열을 같은 회차라고 추정하지 않는다.
- checklistItems create/update/delete는 부모의 같은 commit revision 증가(+1), 부모와 동시 생성(revision 1), 또는 부모와 동시 삭제(체크 삭제만)를 요구한다. parentType/parentId 변경은 거부한다. task/template/linkedRule 부모 모두 적용한다. 부모 업데이트 자체도 revision +1만 허용하므로 구형 클라이언트가 revision 없이 값을 바꾸는 우회를 막는다.

Rules는 atomic commit 결과를 검사한다. 승인된 batch와 transaction을 규칙에서 구분할 수는 없다. 신규 반복 회차 application은 기존 온라인 transaction을 유지하고 offline claim은 계속 거부한다.

## 저장 호환성

`js/cloud-sync.js`의 `withChecklistParents`가 기존 일반 저장 diff에 필요한 부모 revision-only 변경을 추가한다. 부모·체크·잠금을 같은 청크에 묶는다. 온라인은 부모를 먼저 읽고 서버 revision +1, 오프라인은 같은 batch에 increment(1)을 포함한다. 부모가 삭제됐으면 update가 실패하여 부분 부모를 되살리지 않는다. 일반 업무, 프로젝트 단계 task, 반복 회차, 템플릿·연결 단계 체크를 같은 계약으로 처리한다. 6-B 독립 업무 명령 경로의 기존 revision 보호는 그대로 사용한다.

문서 조회 예산은 부모/잠금의 before·after를 각각 보수적으로 계산하여 한 청크 20 이내로 제한한다. 반복 claim은 최대 5개, 일반 체크 부모는 최대 10개다. 쓰기 최대 320에 로그 1개를 더해 500 write 한도보다 작게 유지한다. 한 부모 묶음이 한도를 넘으면 나누어 부분 저장하지 않고 명시적으로 거부한다. Firestore 10MiB 요청 크기는 SDK/서버 제한이 적용되며 이 변경은 payload 바이트 예측기를 구현하지 않는다. 여러 청크 전체의 원자성은 보장하지 않는다.

schema11 업무 필드 변환은 없고 revision은 기존 Firestore 저장 메타데이터다. 백업 preview/완료 이력 보호 정책은 유지한다. 기존 키·잠금·완료 이력을 자동 삭제하거나 보정하지 않는다. tombstone과 충돌하는 전체 복원은 규칙상 거부되어야 한다. 크기가 큰 단일 묶음과 legacy 데이터 불일치는 사용자 검토 대상으로 남긴다.

## 테스트 계약 변경 이력

- 기존 327개 ID 유지. RULES-EMU-DIAG-01/02의 6-D 허점 관측 PASS는 `../phase6d/`에 보존하고, 이번에는 동일 시도에 대한 `permission-denied` 검증으로 전환한다. 허점 관측을 보호 성공으로 재계산하지 않는다.
- ATOMIC-MOCK-10/ATOMIC-EMU-10의 108회차 청크 기대값은 11→22. 양방향 잠금·부모 검증의 접근 예산 증가 때문에 묶음을 더 작게 한 것으로 atomic pair 검사·최종 task/lock 개수 assertion은 그대로다.
- BACKUP-CLOUD-04는 같은 부모를 여러 청크로 쪼개던 mock을 제거하고 실제 bundler로 6개의 독립 claim을 생성해 두 번째 청크 실패를 주입한다. 부분 저장·복구 필요·입력 보존 assertion은 유지한다.
- 실제 SDK/브라우저 fixture 준비는 부모/체크를 같은 batch로 저장한다. 보호 규칙을 비활성화하여 정상 검사를 통과시키지 않는다. 한 legacy 호환 검사는 강화 이전 데이터를 재현하기 위해 loopback demo Emulator admin REST로만 사전 자료를 삽입하고, 이후의 검사는 owner SDK/규칙을 사용한다.

## 실행

전용 `.github/workflows/phase6e-rules.yml`은 결과 브랜치 push만 실행한다. 6-D의 Node 24/Java 21/npm ci/Chrome/Emulator cache를 재사용하며 contents:read만 사용한다. 운영 secrets나 인증을 사용하지 않는다. Codex에서 JAR 다운로드를 재시도하지 않는다.

```sh
npm ci
export CHROMIUM_PATH=/usr/bin/google-chrome
export GCLOUD_PROJECT=demo-work-manager
export PHASE6D_SCOPE=full
./node_modules/.bin/firebase emulators:exec --only firestore --project demo-work-manager --config tests/emulator/firebase.json "node tests/phase6e-ci.cjs"
```

`PHASE6D_SCOPE=focused`로 기존 원자성/SDK/브라우저 및 새 규칙 검사만 실행한다. SDK·IndexedDB 연결의 모의 bootstrap/오류 주입 구분은 6-D와 동일하다.

## 실제 SDK 경합 처리

첫 강화 규칙 실행에서 두 신규 우회 거부 검사는 PASS했지만 원래 동시성 7건이 실패했다. Web SDK transaction은 강화 Rules가 먼저 stale revision/잠금 조건을 평가하면 ABORTED 대신 permission-denied를 받을 수 있었다. 규칙을 완화하지 않고 `runRulesAwareTransaction`으로 해당 단일 transaction의 읽기 결과를 보관한다. permission-denied일 때에만 같은 서버 문서를 읽어 실제 변경이 확인되면 최대 3회 내에서 다시 평가한다. 읽기 실패·실제 변화 없음·재시도 한도 도달이면 원래 오류를 반환한다. callback은 기존 작업/계정 검사와 3-way 비교를 다시 수행한다. unavailable/응답 유실은 이 경로로 재전송하지 않는다. 이미 성공한 청크를 다시 보내지 않는다.

## 완료 결과

전체 **348건: PASS 344 / XFAIL 4 / FAIL 0 / XPASS 0 / NOT_RUN 0**. 실제 SDK/Emulator 52건 PASS. [실행 결과](https://github.com/0hoona91-sudo/work-manager-cloud/actions/runs/40095322243), [상세 검증](verification.md), [운영 전환·남은 위험](deployment.md)을 참고한다.

변경한 운영 코드 파일은 `js/cloud-sync.js` 하나이며, 나머지는 테스트 규칙/하네스/CI 및 본 문서다. `workspace-profile.js`, 인증 구조, index.html, 데이터 schema11, package-lock 및 기존 6-D workflow는 변경하지 않았다. main 및 운영 사이트·규칙·데이터에 접근하거나 배포하지 않았다. 운영 배포 가능 판정은 별도 규칙 생성기 전환과 legacy 자료/캐시 검토를 완료한 뒤 내려야 한다.
