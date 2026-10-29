# 검증 근거

개발 작업트리 전체 실행: `node tests/run.cjs` **457건 / PASS 391 / FAIL 0 / XFAIL 0 / XPASS 0 / NOT_RUN 66**. 원래 440개 ID/기대값 유지. 앞선 명칭 수정 재검사 합산과 달리 이번 값은 단일 전체 실행 결과.

- 기존 SDK/Emulator 64 + 신규 SDK 2 = 66 NOT_RUN (이 실행 환경 다운로드 실패).
- 기존 별도 일정/UI 검사 5건을 정규 runner에 포함. 새 12건(Chromium UI 9, 합성 계약1, SDK2) 추가. 새 Chromium은 실제 화면에 실제 클라우드 저장 함수와 모의 transport 연결.
- 단계 수동 완료 대기, 프로젝트 종료 guard, 라이브러리 오프라인 거짓 성공, 가짜 충돌, 추가 입력 소실은 수정 전 FAIL 근거와 수정 후 PASS 모두 보존.
- 로컬 브랜치 `81d480272a7b9d751b2500e98a15ff77db360af7` 그대로. 운영 main `a8eff0b8b47575bc7ad1db96fb0eda669d27ca96` 그대로.

`after-results.json`의 checkoutHead는 테스트 시작 당시 기준 커밋이며 제품 변경이 있는 작업트리 검사다. 소스별 SHA-256은 보고서에 보존. 코드 커밋 및 CI 결과는 후속 기록에서 별도 명시한다. NOT_RUN을 PASS로 합산하지 않는다.

GitHub API는 403으로 접근 불가. 공개 Actions 실행 페이지에서 성공 여부 및 결과 annotation 확인 예정. 개발 브랜치 전용 workflow에 loopback/demo 검증과 기존 440개 ID/title/expected 보존 게이트 포함.
