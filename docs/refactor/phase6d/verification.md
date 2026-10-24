# 실제 검사 범위와 판정 근거

집중 성공: [Actions 40093590653](https://github.com/0hoona91-sudo/work-manager-cloud/actions/runs/40093590653), `f2389bf772e8536c12b2b2e1d1b449ca6f0a85c3`. PASS 54 / XFAIL 0 / FAIL 0 / XPASS 0 / NOT_RUN 0.

기존 13건의 ID·기대값을 그대로 사용했다. Firebase SDK 12.18.0, firebase-tools 15.34.1, `demo-work-manager`, 테스트 규칙만 사용했다. 체크는 production 함수의 추출 harness를 통해 실제 SDK transaction을 실행한다. 운영 앱 OAuth 부트스트랩 전체 E2E가 아니다.

| 기존 검사 | 내용 | 실제 Emulator 결과 |
|---|---|---|
| ATOMIC-EMU-01 | Two independent clients create only one task and both reconcile to server winner | PASS |
| ATOMIC-EMU-02 | Three clients racing on the same key leave one server task | PASS |
| ATOMIC-EMU-03 | Different roots on the same date remain separate | PASS |
| ATOMIC-EMU-04 | Different raw dates in the same series remain separate | PASS |
| ATOMIC-EMU-05 | Existing lock protects completion/history/manual dates/checks/files and replaces only the candidate | PASS |
| ATOMIC-EMU-06 | Delayed transactions retry lock reads and do not overwrite the winner | PASS |
| ATOMIC-EMU-07 | Offline claim is refused before batch writes; reconnect creates once | PASS |
| ATOMIC-EMU-08 | Lost acknowledgement then reload/retry with the same operation never duplicates or overwrites | PASS |
| ATOMIC-EMU-09 | Task, checklist and key commit together; oversized bundle is rejected before any write | PASS |
| ATOMIC-EMU-10 | Chunk boundaries keep every task and lock together | PASS |
| ATOMIC-EMU-11 | Deleting a task preserves its key tombstone and rejects resurrection | PASS |
| ATOMIC-EMU-12 | Concurrent edits during collision reconciliation are retained and reported as recovery-required | PASS |
| ATOMIC-EMU-13 | EMULATOR owner-only access, workspace-key scope and immutable locks | PASS |

## 신규 실제 SDK 검사

| ID | 검사 | 결과 |
|---|---|---|
| SAVE-EMU-01 | 두 클라이언트 동일 필드 경합: 한쪽 저장, 다른 쪽 충돌 | PASS |
| SAVE-EMU-02 | 독립 필드 병합, revision 경합 | PASS |
| SAVE-EMU-03 | 트랜잭션 콜백 재실행 시 최신 값 재검사 | PASS |
| SAVE-EMU-04 | 체크리스트 하위 문서 의미적 충돌 | PASS |
| SAVE-EMU-05 | 실제 commit 후 응답 유실 주입 및 읽기 전용 재확인 | PASS |
| SAVE-EMU-06 | 동일 최종값 재확인 시 revision 추가 변경 없음 | PASS |
| SAVE-EMU-07 | 다른 기기의 완료 처리 이후 오래된 폼 저장 차단 | PASS |
| SAVE-EMU-08 | 계정 전환 후 이전 명령 전송 차단 | PASS |

## Chromium + IndexedDB + 실제 SDK/Emulator

| ID | 검사 | 결과 |
|---|---|---|
| JOURNAL-SDK-01 | 실제 서버 commit 후 응답 보류, 브라우저 프로세스 종료/재실행, 읽기 확인 | PASS |
| JOURNAL-SDK-02 | 오프라인 의도 보관/재실행, Firebase·Google 계정 격리, 서버 확인 후 승인 재제출 | PASS |
| JOURNAL-SDK-03 | 전송 전 prepared 기록, IndexedDB v2 기존 자료/파일 보존, 재실행 | PASS |
| JOURNAL-SDK-04 | journal quota 오류 주입 시 입력 보존, 전송 0회 | PASS |
| JOURNAL-SDK-05 | 복구 UI 서버 확인·명시적 재제출 이후 추가 편집 | PASS |
| JOURNAL-SDK-06 | 같은 필드 서버 충돌, 제출값·추가 입력 모두 보존 | PASS |
| JOURNAL-SDK-07 | 두 탭 동시 저장, 성공과 충돌 분리, 미확정 기록 보존 | PASS |
| JOURNAL-SDK-08 | 서버 commit/로컬 캐시 실패 불일치, 읽기 확인 후 복구 | PASS |

실제 Chromium과 IndexedDB가 사용되며 Firebase SDK는 Playwright binding 건너편 Node 프로세스에서 실행된다. 계정/부트스트랩과 일부 오프라인 조건은 합성 제어다. 응답 유실·quota는 명시적 장애 주입이다. ATOMIC-EMU-07은 SDK disableNetwork/enableNetwork를 사용한다. OS 강제 전원 차단, 디스크 물리 고장, 저장소 삭제 후 복원, 실제 Google/Firebase 로그인·브라우저 SDK 전체 연결은 실측하지 않았다.

## Security Rules

ATOMIC-EMU-13에서 다른 UID 읽기 거부, 다른 업무공간 키 쓰기 거부, 잠금 수정·삭제 거부를 실제 측정했다. generatedKeys를 wildcard allow 대상에서 제외한 현재 규칙에서만 성립한다. 다중 청크 검사로 현 규칙의 접근 예산 내 성공은 확인했으나 향후 강화할 규칙의 비용까지 검증한 것은 아니다.

- RULES-EMU-DIAG-01 PASS: **잠금 없이 task를 생성하는 우회가 허용됨을 관측**.
- RULES-EMU-DIAG-02 PASS: **부모 revision 변경 없이 체크 하위 문서를 쓰는 우회가 허용됨을 관측**.

두 PASS는 보호 성공이 아니다. 잠금/부모 revision 계약을 양방향으로 강제하는 규칙과 구형 쓰기 경로의 호환 전환이 배포 전 필수다. 운영 규칙은 조회·배포하지 않았으므로 운영 규칙이 같은지, 다른 wildcard allow가 제한을 무효화하는지, 실제 사용자/업무공간 소유권과 접근 예산이 적합한지는 미검증이다.

## 남은 위험

여러 청크 전체, IndexedDB와 Firestore 사이의 전역 원자성은 없다. 구형 저장 경로 전체가 journal/필드 충돌 검사로 전환되지 않았다. 제출 최종값의 서버 확인은 해당 operation의 정확히 한 번 실행 증명이 아니다. 브라우저 저장소 삭제 시 journal 복구는 불가능하다. 이 제약은 본 검사 통과로 해소되지 않는다.
