# 10단계 진행 기록

기준 `dbddb734f67de15e9d125f5a8837be1c97afa8de`; 최신 원격 main은 `091dbecd701153e7e1880bd6bb84a277b789c58f`로 기준 이력의 조상이며, main 변경은 없다. 전용 브랜치 `refactor/phase10-integration-preflight`에서만 작업한다.

A: [feature-matrix.md](feature-matrix.md)에 F01~F70 전체를 대표 자동 계약, 수동 동선, 외부 서비스, 기존 한계로 나눴다. 70개 ID 중복·누락 0. F56 Google Tasks는 제거 상태를 유지한다. 기능 존재를 검증 성공으로 간주하지 않았다.

진행 순서: 두 클라이언트·복구, 백업 라운드트립, 구형 호환, 1만 건 Gantt 원인/최소 조치, 모바일·자원, 운영 전 체크리스트. 기존 415개는 최종 통합에서 한 번만 재검증한다. 실제 배포·운영 데이터 접근은 하지 않는다.

B: 기존 `SAVE-EMU-01~08`, `ATOMIC-EMU-01~13`, `JOURNAL-SDK` 계약을 재사용한다. 신규 `INTEG-EMU-01`은 두 독립 Firebase SDK 클라이언트가 동일 체크리스트를 동시에 수정할 때 한 건만 확정되고 상대 요청이 `conflict`가 되며 부모 revision·완료 이력이 유지되는지 확인한다. 실제 Emulator 검사는 전용 CI에서 수행한다. 프로젝트 단계 전체 저장의 다중 기기 원자성은 기존 일반 업무 명령과 범위가 달라 운영 전 미검증으로 남긴다.

B 집중 CI: [Actions 40156380085](https://github.com/0hoona91-sudo/work-manager-cloud/actions/runs/40156380085)에서 `INTEG-EMU-01` 실제 SDK/Emulator PASS. 이는 두 독립 SDK 클라이언트 검증이며 실제 두 물리 기기·실계정 검증은 아니다.

C: `INTEG-BACKUP-01`에서 구조 JSON 백업 → 현재 업무 완료·재개 이력 추가 → 충돌 미리보기 → 취소 0쓰기 → 명시적 복원 → ID/이력/첨부/프로젝트 확인 → 원본 포함/누락 ZIP 분리까지 한 합성 흐름을 검증했다. 테스트 작성 직후 정상 JSON 백업의 `backupMeta.attachments`가 실제 첨부 참조로 잘못 해석되어 복원 전 거부되는 오류를 재현했다. `js/backup-safety.js`에서 최상위 backupMeta 인벤토리만 실제 참조 순회에서 제외했다. 실제 업무·프로젝트·라이브러리 첨부 검증은 유지된다. 수정 후 신규 1 PASS 및 기존 백업 집중 46 PASS. 실제 운영 데이터·Drive는 사용하지 않았다.

D: `INTEG-LEGACY-01`에서 예전 schema11 업무·체크·첨부 ID, generatedKey, 완료 이력, Google Tasks 유래 메타데이터와 설정의 cloud codec 왕복 및 JSON 백업 검증이 PASS. schema 표시 없는 이전 JSON은 경고와 함께 구조 검증 후 수용한다. 구형 클라이언트가 새 규칙에서 부모 revision 계약 없이 저장할 때 거부되는 기존 `PROVISION-EMU-08` 결과를 배포 전환 위험으로 분리했다. 자세한 경계는 `compatibility.md`에 기록했다.

E: 기존 stack에서 `renderGantt`가 각 행에 날짜 격자 HTML을 반복해 연결할 때 1만 건에서 V8 문자열 길이 오류가 나는 것을 확인했다. 실제 Gantt 데이터는 건드리지 않고 1천 건 초과일 때 500건씩 명시적 페이지 선택을 제공한다. 전체 건수·현재 범위를 표시하고 마지막 페이지까지 접근 가능하다. `INTEG-GANTT-01`은 수정 전 FAIL→후 PASS, `INTEG-GANTT-02`는 1천 건 전체 표시 PASS. 같은 1만 fixture에서 홈 4.23초·달력 4.85초·프로젝트 2.39초로 완료됐지만 업무 목록 24.95초는 남은 성능 위험이다. 읽기 중 저장 호출 0.

F: `INTEG-UI-01`은 Chromium 320/390/768/1440px에서 홈 넘침 0, 키보드 빠른 업무·한글 IME·취소 시 업무 변경 0을 확인했다. `INTEG-ASSET-01`은 `/work-manager-cloud/` 경로의 WebP 응답 200을 네 너비에서 확인했다. 실제 Pages 배포 검증과 모든 모달 접근성 감사는 하지 않았다.

G: `INTEG-ARTIFACT-01`은 추적된 비밀 설정·source map·debug 파일과 생산 파일의 private key/OAuth 토큰 패턴이 없음을 확인했다. 기존 Firebase Web API key 문자열 2곳은 브라우저 구성으로 유지되며 운영 제한 설정은 확인되지 않았다. `security-preflight.md`, `deployment-plan.md`, `rollback-plan.md`, `known-limitations.md`에 승인·차단 사유를 정리했다. 운영 배포는 하지 않았다.
