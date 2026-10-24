# 6-C 영속 저장 기록과 재실행 복구

기준 `6b513296bee09da591d084b8eaa8b97389623581` → `refactor/phase6c-recovery-journal`.

6-A/6-B application·필드 충돌 검사와 5-B② 저장 계약을 재사용했다. 실제 연결은 **독립적인 미완료 일반 업무 수정 폼**이다. 신규 등록/삭제, 프로젝트·반복·백업·Drive 전체 저장 경로를 전환하지 않았다. main, 운영 배포·Firebase·Drive·Security Rules는 변경하지 않았다.

## 기록 계약

- `js/operation-journal.js`: 순수 기록 검증/요청 재구성, 기존 IndexedDB adapter, 상태 전이·복구 조율.
- DB `TaskManagerCloud_v1`, 버전 **2 유지**, 기존 `data` store에 `operation-journal:v1:<encoded context>:<operationId>` 키 사용. `files` 및 기존 state 키와 분리한다.
- context는 Firebase 프로젝트·Firebase UID·Google UID를 포함한다. bootstrap에서 인증 후 journal module 준비와 현재 계정의 기록 조회를 기다린다. 이전 계정 기록은 조회·자동 실행하지 않는다. 로그아웃 시 UI/메모리의 참조만 해제하고 영속 기록은 보존한다.
- 기록: version, operationId, type, context/workspace/uid/googleUid, taskId, base, patch, historyHash, phase, createdAt/updatedAt, mayHaveSent, lastResult, integrity.
- base는 한 업무의 수정 가능 필드와 ID·상태·완료일만 포함한다. 전체 state, 업무공간 프로필, 설정, 첨부 원본, 완료 이력 snapshot을 복제하지 않는다. completionHistory는 SHA-256 비교값으로 보존하고, 재확인 시 서버 이력의 해시가 달라지면 충돌 처리한다. 원본 이력은 서버 업무에 그대로 남는다.
- 인증정보 저장 객체를 읽지 않는다. 선택 필드 안의 password/apiKey/accessToken 등 인증정보 형태의 속성은 기록하지 않으며, 제출 내용이 달라질 경우 조용히 제거하여 전송하지 않고 거부한다. 업무명·메모 등 사용자가 직접 입력한 텍스트 자체는 업무 데이터다.
- SHA-256 integrity는 기록 손상 검출용이다. 같은 출처 스크립트 공격자를 막는 서명·암호화·권한 검증은 아니다.

`beforeApply`가 검증된 변경의 **prepared 기록 트랜잭션 완료를 기다린 뒤** 메모리를 변경한다. 준비 중 업무나 계정이 바뀌었으면 다시 검증하고 전송을 중단한다. 저장소 실패 시 전송 0회이며 입력은 폼에 남는다. journal에는 localStorage fallback을 사용하지 않는다.

같은 키 갱신은 이전 integrity를 비교하는 IndexedDB readwrite 트랜잭션으로 처리한다. 여러 탭의 낡은 기록이 조용히 다른 기록을 덮어쓰지 않도록 한다. 이는 Firestore와의 분산 원자성이나 여러 탭의 전역 작업 잠금은 아니다.

## 상태와 재실행

| 상태 | 의미 / 재실행 처리 |
|---|---|
| prepared | 제출 내용 영속화, 아직 전송 시작 확인 없음. 읽기 확인 후 사용자 승인으로 재제출 가능 |
| saving | 전송/확인 진행 중. 비정상 종료 후 성공·실패로 단정하지 않음 |
| pending-sync | 확정되지 않은 입력 보관. 서버 검사 후 재제출 가능한 경우만 승인 버튼 표시 |
| saved | 해당 최종값 서버 확인과 기존 캐시 저장 완료; 기록 확정 후 삭제 |
| conflict | 3방향 필드/완료 이력/체크리스트 충돌. 입력과 비교 결과 보존 |
| recovery-required | 전송 결과 불명확·기록 갱신 실패·확인 불가. 자동 재전송 금지 |
| failed | 명확한 저장 전/권한/검증 실패. 기존 기록이 있으면 보존 |

전송 직전 saving을 기록한다. 응답과 캐시 저장이 끝나면 결과를 기록한다. 서버 성공 뒤 journal 갱신에 실패하면 saving 등 직전 영속 기록이 남고, 다음 실행에서 다시 읽기 확인한다. saved 기록 삭제 전에 종료되었으면 다음 실행에서 검증된 saved 기록만 정리한다. 미확정/손상 기록은 자동 삭제하지 않는다. 기존 명시적 로컬 초기화 함수도 journal 키를 건너뛴다.

서버 최종값 확인은 6-B 읽기 전용 트랜잭션을 사용한다. **같은 값이 서버에 있다는 사실은 해당 operation이 정확히 한 번 실행되었다는 증명이 아니다.** 응답 유실 후 서버값이 일치하면 확정 가능하다. 이미 전송됐을 수 있는데 서버값이 일치하지 않으면 불명확 상태를 유지하며 무작정 재전송하지 않는다. 원래 전송되지 않았다고 안전하게 판단한 기록은 읽기 확인 후 사용자가 승인하면 동일 operationId와 기준으로 재제출한다. 인터넷 online 이벤트는 전송/확정의 근거가 아니다.

## 연결 UI와 입력 보호

- 일반 업무 수정 폼은 기존 6-B 비교 패널과 연결한다.
- 화면 우측 하단 **미확정 저장 복구 N건** 알림에서 업무명·저장 시각·상태, 기준값·보관한 입력·마지막 서버값·충돌 필드를 확인한다.
- **서버 확인 (재전송 없음)**: 서버 읽기 확인. 현재 입력은 캐시에 보관할 수 있다.
- **보관한 입력 재제출**: 서버 확인상 안전한 pending 기록에만 표시하며 confirm 승인 후 재검사한다. 강제 덮어쓰기는 제공하지 않는다.
- **입력 JSON 별도 보관**: 사용자가 요청하면 해당 기록을 JSON 파일로 내려받는다. 업무 내용이 포함되므로 사용자가 보관 위치를 관리해야 한다.
- 손상된 기록은 수동 복구 대상으로 표시하고 실행/수정/삭제하지 않는다. 브라우저 저장소를 보존한 채 별도 점검해야 한다.

복구 중 폼을 새 서버값으로 교체하지 않는다. 서버 반영은 기존 조건부 필드 반영을 사용하여 제출 후 추가 입력을 보존한다. 같은 페이지의 복구 완료는 해당 폼의 다음 수정 세션에 연결한다. 재실행 후 상태와 서버가 다르면 미저장 편집의 전체 snapshot 교체를 보수적으로 보류한다.

journal 조회·미확정 기록·복구 오류가 있는 동안 일반 snapshot 저장, 백업 시작, 초기 자동 업로드와 realtime 전체 교체를 보류한다. 반복 생성키 트랜잭션 정책을 약화하지 않으며, 이 임시 보류 때문에 다른 기능의 저장도 복구 확인 이후로 지연될 수 있다. 영속 기록을 모든 저장 경로에 추가한 것은 아니다.

## 검증과 증거

```sh
node tests/run.cjs --journal-only
node tests/run.cjs --commands-only
node tests/run.cjs --conflicts-only
npm test
```

신규 29개: `JOURNAL-01~24`는 실제 journal/application/cloud 함수 + 메모리 IndexedDB port·모의 Firestore transport 검사다. `JOURNAL-BROWSER-01~05`는 **실제 Chromium과 실제 IndexedDB**를 사용한다. 01~03은 브라우저 프로세스를 닫고 같은 사용자 데이터 디렉터리로 새 프로세스를 실행한다. 응답 유실, 오프라인, 다른 Firebase/Google 계정, 같은 계정 재로그인, prepared 기록, DB v2의 기존 데이터·파일 호환성을 확인한다. 04는 실제 IndexedDB transaction 생성에 quota 오류를 주입하고 전송 차단을 확인한다. 05는 복구 후 같은 폼의 후속 입력 저장을 확인한다. Firestore는 이 브라우저 검사에서도 모의 transport다.

기존 279개 ID·제목·기대값을 유지하고, harness의 새 전역 의존성만 주입했다. 전체 회귀는 집중 검사 후 마지막 한 번 실행한다. 기존 Emulator 13건은 NOT_RUN을 유지한다. SDK 설치/Emulator 다운로드/운영 서버 검증을 수행하지 않았다. **최종 308개: PASS 291 / XFAIL 4 / FAIL 0 / XPASS 0 / NOT_RUN 13. 신규 29개 PASS, 기존 279개 ID·제목·기대/관측값과 결과 분류 유지.** NOT_RUN 때문에 전체 명령 종료 코드는 1이며 이를 성공 종료로 바꾸지 않았다. 최종 수치는 `after-results.json`, 기존 검사 비교는 `baseline-comparison.json`에 저장한다.

## 복구 한계와 다음 통합 검증

1. **브라우저 저장소 삭제·프로필 유실·디스크 손상으로 journal이 없어지면 이 기능으로 복구할 수 없다.** 저장 버튼을 누르기 전 폼 입력, 전송 후 계속 타이핑한 미제출 초안 전체는 자동 영속화 대상이 아니다.
2. IndexedDB와 Firestore는 원자적으로 묶이지 않는다. prepared/saving 기록과 서버 재확인으로 불확실성을 유지한다. 로컬 업무 캐시의 기존 localStorage fallback도 제거하지 않았다.
3. 확인 불가능하거나 동일 필드 충돌이 있는 기록의 강제 해결/폐기 기능은 없다. 입력 내보내기와 수동 비교가 필요하다. 매우 큰 기록/저장 용량 부족은 전송을 차단한다.
4. journal은 같은 브라우저에서 읽을 수 있는 평문 업무자료다. 같은 출처 XSS, 사용자 프로필 탈취, 공유 PC 접근을 막는 암호화 저장소가 아니다. 계정 분리는 앱의 조회·실행 범위다.
5. 구형 클라이언트의 무조건 저장, 부모 revision을 올리지 않는 체크 추가의 phantom, 여러 청크 부분 성공은 6-B/5-B②의 남은 위험이다. 구형 페이지로 롤백하면 journal guard도 적용되지 않는다.
6. 여러 탭의 동일 operation 기록은 CAS로 보호하지만, 서로 다른 operation/여러 미확정 기록의 통합 충돌 해결 UI나 전역 영속 lease는 없다. 서버의 기존 필드 검사와 수동 복구 보류를 사용한다.
7. 다음 통합 검증: 실제 demo Emulator/SDK 동시성 및 기존 13건, 실제 브라우저 강제 종료·스토리지 eviction·모바일 종료, multi-tab/계정 전환 중 복구, 대용량·quota·캐시와 서버 불일치, 운영 Security Rules의 필요한 접근 권한을 배포 없이 검토한다. 이번 검사는 프로세스 종료/재실행이며 OS 전원 차단/fsync 보장을 측정하지 않았다.

## 롤백

전용 브랜치에서 `git revert <6-C 결과 커밋>`으로 코드·script 연결·테스트를 함께 되돌린다. DB 버전/schema11 역변환은 필요 없다. journal 키를 삭제하지 않는다. **미확정 입력을 JSON으로 보관하고 서버 상태를 확인한 뒤** 롤백해야 한다. 6-B 코드는 남은 journal을 읽지 않아 재실행 복구/자동 저장 보류를 제공하지 않는다. 이미 저장된 서버 업무를 revert로 되돌렸다고 간주하지 않는다.

변경 파일: `index.html`, `js/cloud-sync.js`, `js/save-command.js`, `js/save-command-adapter.js`, 신규 `js/operation-journal.js`·`js/recovery-ui.js`; `tests/recurrence-atomicity.test.cjs`, `tests/recurrence-cloud-harness.cjs`, `tests/save-conflicts.test.cjs`, `tests/run.cjs`, 신규 `tests/journal.test.cjs`·`tests/journal-browser.cjs`; 본 README와 `after-results.json`, `baseline-comparison.json`.
