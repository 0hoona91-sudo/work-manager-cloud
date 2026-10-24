# 7단계 진행 기록 — 아직 미완료

기준 6-F: 3d3f81ac055a32d6951c41eb5c41b0b9da2faad2. 브랜치 refactor/phase7-google-file-adapters.

A: Google Tasks 전용 모듈, UI/CSS, 앱 브리지, saveState 이벤트 래퍼, OAuth scope·인증 함수를 제거했다. 누락 모델은 만들지 않았다. 과거 session token만 지우며 업무/설정/원격 자료를 삭제하지 않는다. Tasks legacy 업무·체크·완료 이력·설정의 JSON/Firestore codec 보존 검사를 추가했다.

계약 변경: BUG-01은 이전 missing import false/expected true XFAIL에서 활성 Tasks 참조 부재 PASS로 전환한다. 이전 관측은 phase6f/after-results.json 및 phase2 문서에 보존되어 있다. STATIC-02는 누락 Tasks 모델 예외 없이 모든 import를 검사한다. AUTH-12는 Tasks 인증을 호출하지 않고 Drive 토큰 격리와 폐기된 credential 정리를 검사한다. PROVISION-07은 남은 단일 auth importer와 Tasks 모듈 부재를 확인한다. 나머지 계약은 유지한다.

남은 작업: B Drive 인증, C 첨부 업로드/실패 복구, D ZIP·백업·인수인계 안정화. 최종 phase7 Actions와 baseline guard(위 네 계약 변경 명시), 전체 회귀 및 필수 최종 문서는 아직 미완료다. 기존 6-F workflow는 이 브랜치에서 실행되지 않는다. 7단계 종료/8단계 착수 판정은 아직 할 수 없다.

재개 시 이 중간 커밋의 A 변경을 보존하고 B부터 진행한다. 기존 성공한 전체 371개를 시작 시 반복하지 않는다. 운영 접근/배포/원격 Tasks 삭제는 수행하지 않았다.
