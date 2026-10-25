# 10단계 검증 기록

기준 9단계 415 PASS는 시작 시 재실행하지 않았다. 신규 검사는 `tests/phase10-integration.test.cjs`에만 추가했으며 실제 SDK/Emulator 검사와 브라우저·순수 테스트를 구분한다.

| 묶음 | 집중 결과 | 실제 범위 |
|---|---|---|
| B 두 클라이언트 | `INTEG-EMU-01` 실제 Firebase SDK/Emulator PASS ([Actions 40156380085](https://github.com/0hoona91-sudo/work-manager-cloud/actions/runs/40156380085)) | 동일 체크리스트 동시 수정 1회 확정, 1회 충돌, 부모 revision·완료 이력 유지. 기존 SAVE-EMU/ATOMIC-EMU/JOURNAL-SDK 계약 재사용 |
| C 백업 | `INTEG-BACKUP-01` PASS, 기존 백업 집중 46 PASS | JSON 구조 백업→완료 이력 추가→미리보기→취소/승인 복원→첨부·프로젝트·ID 대조→ZIP 누락/해시 |
| D 구형 데이터 | `INTEG-LEGACY-01` PASS | schema11·Tasks 유래 메타·이전 JSON·첨부/체크 ID·생성키 왕복. 구형 클라이언트 실제 실행은 미검증 |
| E Gantt | 수정 전 `INTEG-GANTT-01`은 `RangeError: Invalid string length`; 수정 후 PASS. `INTEG-GANTT-02` PASS | 1천 건 전체 표시, 1만 건 20페이지 중 첫·끝 페이지, 페이지 선택, 저장 호출 0 |
| F 화면·자원 | `INTEG-UI-01`, `INTEG-ASSET-01/02` PASS | Chromium 320/390/768/1440px, 키보드 빠른 업무, IME, 취소 후 focus 복귀, Pages 하위경로 WebP 200 |
| G 산출물 | `INTEG-ARTIFACT-01` PASS | 추적 파일명의 credential/debug/source map 후보, 생산 파일의 private-key/OAuth-token 패턴 부재. 기존 Firebase Web API key 2곳은 별도 운영 제한 확인 필요 |

## 같은 fixture 성능 비교

Node 24·Chromium·1440×900·Asia/Seoul, 합성 schema11 업무 1천/1만 건을 `tests/phase9-benchmark.cjs`로 8단계 기준과 현재 코드에서 같은 방식으로 각 1회 실행했다. [performance-results.json](performance-results.json)은 원자료다. 1만 건 기준 코드는 홈·달력·프로젝트 Gantt가 문자열 길이 오류로 실패했다. 현재 코드는 홈 4,228.8ms, 달력 4,851.6ms, 프로젝트 2,391.7ms로 완료됐다. 업무 목록은 기준 26,037.6ms, 현재 24,949.5ms로 여전히 느리다. 모든 읽기 전용 측정에서 저장 호출은 0회다. 단일 실행이므로 정밀한 속도 향상률은 주장하지 않는다.

최종 전체 회귀·Actions 결과는 모든 코드와 문서 묶음을 마친 뒤 채운다. 운영 OAuth/Drive, 운영 규칙, 실제 사용자 데이터는 이 표의 PASS에 포함하지 않는다.
