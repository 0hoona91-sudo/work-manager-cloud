# 프로젝트 직접 일정 / UI 개발 결과

- 단계 `scheduleMode: manual`은 시작/종료 절대 날짜를 보존한다. 기존 필드 없는 단계는 기존 상대 계산 유지. manual 종료일은 휴일 이동으로 바꾸지 않는다. 날짜 오류 시 부분 계산을 원본에 적용하지 않는다.
- 프로젝트 편집의 2단계 이후 모드 선택 및 YYYY-MM-DD 입력/기존 달력 버튼 사용. 저장·재열기, 하위 상대 단계 연쇄, JSON/Firestore 직렬화 모드 보존 검사.
- 라이브러리 linkedSteps에는 모드만 보존. 등록 모달에서 직접 단계 날짜를 필수 입력받아 검증 후 저장. 라이브러리 자체에 절대 날짜를 저장하지 않는다.
- 세 프로젝트 버튼 규격 통일. 390/1440px 실제 Chromium 검사. 라이브러리 변경 확인창이 모바일 모달 뒤에 가려지는 z-index 결함 수정.
- 완료 단계는 기존 보호 유지. 완료 날짜 수정 경로는 **미구현**. 완료 단계의 예정일은 완료 task와 다음 단계의 기준일을 겸한다. 임의 잠금 해제 대신 정정 기록·표시·저장 및 충돌 계약을 함께 설계해야 한다. actualComplete/completionHistory/snapshot을 이번 변경에서 수정하지 않는다.

검사: 기존 전체 440건 최초 실행 375 PASS / 1 FAIL / 64 NOT_RUN. CONFLICT-24는 표시 명칭 변경으로 기존 `/일반 업무 저장 확인/`과 불일치. 요청 명칭의 `/단일 업무 저장 확인/`으로 변경 후 해당 1건 PASS. 차단 동작과 예외 assertion은 유지했다. 두 실행을 합쳐 기존 계약의 최신 결과는 376 PASS / 0 FAIL / 64 NOT_RUN이다. 전체 재실행 성공으로 표현하지 않는다.

별도 신규 집중 시나리오: MANUAL-MODEL, MANUAL-UI, LIBRARY-AND-BUTTONS(390/1440), SINGLE-UI-01 총 5 PASS. 기존 schedule-only 28 PASS, completion-only 25 PASS는 전체 검사와 중복이므로 합산하지 않는다.

`full-run-before-label-expectation.json`, `conflict-24-recheck.json`에 실제 결과 보존. 64개 SDK/Emulator 검사는 미실행. 실제 계정/API 및 Windows file://는 미검증. main/운영 배포/운영 데이터 변경 없음.

재현: `node tests/manual-schedule.cjs`, `node tests/single-task-ui.cjs`, `node tests/run.cjs` (기존 의존성/Chromium 사용). 클라우드 main에 병합하지 않는다. 롤백은 이번 커밋 revert; 기존 데이터의 manual 모드가 생긴 후 구버전으로 되돌리면 상대일수로 다시 계산될 수 있으므로 이전 코드로 해당 프로젝트를 편집하지 않는다.
