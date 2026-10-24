# 8단계 UI 검증

기준: phase7 `1b834ca7230f1478f9778898c226329c6384001b`, 406건(PASS 403 / XFAIL 3). 기존 ID는 모두 보존한다. BUG-08/09는 같은 기대값을 단정하는 PASS 검사로 전환했다. BUG-02 CSS XFAIL 기대·관측값은 그대로 둔다. 신규 FEATURE-UI-01~05를 등록했다.

## 기능별 집중 검사

- 8a: FEATURE-UI-01/02 실제 Chromium, 03 순수 mount/dispose 계약. 3 PASS. 렌더링 저장 0, 검색 필터/IME·4개 화면 폭 유지, resize·orientationchange 공동 예약 검증.
- 8b: 기존 CMD-UI-01/02, CONFLICT-UI-01/03, HIST-UI-02 실제 Chromium 5 PASS. 추가 FEATURE-UI-04와 FEATURE-UI-02는 모바일 회전·PC 복귀 메뉴 명칭 및 검색 상태 PASS.
- 8c: 기존 SCHED-UI-01~03, HIST-UI-01, UI-02와 신규 FEATURE-UI-05 실제 Chromium 6 PASS. 프로젝트 날짜·완료 UI와 렌더 읽기 전용 fallback.
- 8d: UI-02, HIST-UI-03 실제 Chromium 2 PASS. 테마/이력 기존 계약을 보존.
- 이전 단계에서 BUG-08/09 수정 후 백업·데이터 집중 46 PASS. 전체 406건은 시작 시 재실행하지 않았다.

## 최종 게이트

`.github/workflows/phase8-ui.yml`은 phase8 브랜치 push에서만 실행한다. Node 24, Java 21, npm ci, 실제 Chromium, Firebase SDK/Firestore Emulator의 demo-work-manager만 사용한다. `phase8-ci.cjs`는 운영 프로젝트로 연결되지 않으며 기존 406 ID/상태를 비교한다. 기준에서 허용한 상태 변경은 BUG-08/09의 정상 PASS뿐이다. 새 검사에 XFAIL을 추가하지 않는다.

최종 결과와 Actions URL은 성공한 코드 SHA를 기준으로 아래 및 after-results.json에 기록한다. 실제 Google OAuth/Drive API와 운영 Firestore/Rules는 검사 대상이 아니다.

## 첫 전체 CI 관측 및 게이트 수정

[Actions 40138259731](https://github.com/0hoona91-sudo/work-manager-cloud/actions/runs/40138259731)의 실제 검사 집계는 411건, PASS 410 / XFAIL 1(BUG-02) / FAIL·XPASS·NOT_RUN 0이다. 그러나 최종 게이트가 상세 expected/observed를 포함하지 않는 7단계 공개 요약 JSON에서 BUG-02 관측값을 읽어 CI 결론은 FAILURE였다. 상세 기록이 있는 `phase6c/after-results.json`으로 비교 근거만 변경했다. 테스트 기대값·관측값·운영 코드는 수정하지 않았다. 해당 기록의 기존 관측값 `Unexpected }`, 197행을 별도 확인했다. 성공 결과가 나올 때까지 8단계 완료로 표시하지 않는다.

## 최종 성공

[Actions 40138555043](https://github.com/0hoona91-sudo/work-manager-cloud/actions/runs/40138555043) **SUCCESS**. 검증 코드 SHA `a8790fa1c49da7e30f6bf30d2d05546310195d4d`.

| 등록 | PASS | XFAIL | FAIL | XPASS | NOT_RUN |
|---:|---:|---:|---:|---:|---:|
| 411 | 410 | 1 | 0 | 0 | 0 |

기존 406개 ID를 유지했고 BUG-08/09는 PASS, BUG-02는 동일 XFAIL이다. 신규 FEATURE-UI-01~05 모두 PASS. 실제 Firebase SDK/Firestore Emulator 60건 PASS, 실제 Chromium 60건 PASS이며 JOURNAL-SDK 8건은 두 집계에 중복된다. FEATURE-UI-03은 순수 mount/dispose 검사로 Chromium에 합산하지 않았다. 모의·순수·정적 검사와 실제 Google OAuth/Drive API 검증은 구분한다.

공개 Actions annotation은 405개 개별 결과까지만 보여 준다. PROVISION-EMU-07/08, PROVISION-UI-01~03, TASKS-RETIRED-01의 개별 공개 행은 빠졌지만, 유일한 등록 ID와 전체 집계에서 남은 6건 모두 PASS임을 대조했다. `after-results.json`의 해당 행에는 집계 추론 출처를 표시했다. 원본 전체 결과와 소스 해시는 Actions artifact에 보존된다. 공개 annotation 원본은 `evidence/ci-40138555043.json`에 보존했다. 이 한계는 실제 검사를 건너뛴 것이 아니다.

최종 문서 커밋은 코드 SHA의 성공 검증을 재사용하며 전체 CI를 다시 실행하지 않는다.
