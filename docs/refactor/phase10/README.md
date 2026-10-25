# 10단계 진행 기록

기준 `dbddb734f67de15e9d125f5a8837be1c97afa8de`; 최신 원격 main은 `091dbecd701153e7e1880bd6bb84a277b789c58f`로 기준 이력의 조상이며, main 변경은 없다. 전용 브랜치 `refactor/phase10-integration-preflight`에서만 작업한다.

A: [feature-matrix.md](feature-matrix.md)에 F01~F70 전체를 대표 자동 계약, 수동 동선, 외부 서비스, 기존 한계로 나눴다. 70개 ID 중복·누락 0. F56 Google Tasks는 제거 상태를 유지한다. 기능 존재를 검증 성공으로 간주하지 않았다.

진행 순서: 두 클라이언트·복구, 백업 라운드트립, 구형 호환, 1만 건 Gantt 원인/최소 조치, 모바일·자원, 운영 전 체크리스트. 기존 415개는 최종 통합에서 한 번만 재검증한다. 실제 배포·운영 데이터 접근은 하지 않는다.

B: 기존 `SAVE-EMU-01~08`, `ATOMIC-EMU-01~13`, `JOURNAL-SDK` 계약을 재사용한다. 신규 `INTEG-EMU-01`은 두 독립 Firebase SDK 클라이언트가 동일 체크리스트를 동시에 수정할 때 한 건만 확정되고 상대 요청이 `conflict`가 되며 부모 revision·완료 이력이 유지되는지 확인한다. 실제 Emulator 검사는 전용 CI에서 수행한다. 프로젝트 단계 전체 저장의 다중 기기 원자성은 기존 일반 업무 명령과 범위가 달라 운영 전 미검증으로 남긴다.
