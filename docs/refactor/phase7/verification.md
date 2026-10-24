# 7단계 검증

## 기준 및 계약

6-F 기준 `3d3f81ac055a32d6951c41eb5c41b0b9da2faad2`: 371건, PASS 367 / XFAIL 4. 기존 371개 ID는 모두 유지한다. A에서 BUG-01을 누락 모델 복구 대신 Google Tasks 실행 경로 부재 PASS로 전환했다. STATIC-02(누락 import 예외 제거), AUTH-12(폐기 토큰 정리·Drive 격리), PROVISION-07(남은 인증 importer)의 변경 이유는 README에 보존했다. 다른 기존 상태 및 XFAIL 기대/관측값은 phase7-ci.cjs가 대조한다.

신규 등록: TASKS-RETIRED-01, DRIVE-AUTH-01~09, ATTACH-01~13, FILE-BACKUP-01~11, ATTACH-UI-01. 총 35건 추가이며 최종 등록 수는 406건이다.

## 중간 검사와 CI 회귀 수정

- B: 31 PASS, 모의 인증. work-b-results.json 보존.
- C: 26 PASS(SEC 16 Chromium + ATTACH 10 모의 계약), 인증 회귀 31 PASS. work-c-results.json 보존. 통합 전 ATTACH-11~13을 추가해 실제 Drive 어댑터의 모의 HTTP 계약과 실제 Chromium IndexedDB 재읽기를 검사했다.
- D: 44 PASS / 2 XFAIL, 신규 실패 0. work-d-results.json 보존. 두 XFAIL은 BUG-08/09이며 기대값 변경 없음. Drive 제한 스트림 연결 뒤 SEC/ATTACH 26 PASS.
- 최초 전체 [40106054949](https://github.com/0hoona91-sudo/work-manager-cloud/actions/runs/40106054949), `fba8ac874288f9e4050465245308dc31569c79a3`: 405건 **PASS 401 / XFAIL 3 / FAIL 1 / XPASS 0 / NOT_RUN 0**. IDENT-17이 `document is not defined`로 실패했다. evidence/ci-40106054949.json에 원본 공개 annotation을 보존한다.
- 원인: 읽기 전용 controller 생성에 첨부 복구 UI DOM 조작이 섞였다. controller를 순수 객체 생성 경로로 되돌리고, 로그인·초기 동기화 후 브라우저 bootstrap에 UI 초기화를 연결했다. IDENT-17은 수정하지 않았다.
- 로그아웃 시 버튼·대화상자를 제거하고 초기화 세대/업무공간/사용자 검사를 통해 이전 계정의 늦은 진단 응답 표시를 차단한다. 중복 초기화·클릭도 한 버튼/진단 요청만 허용한다.
- 수정 후 IDENT 집중 20 PASS, 신규 ATTACH-UI-01 Chromium PASS. evidence/ident-focused.txt 및 attachment-ui-focused.txt. 성공한 C/D 전체 집중 검사를 수정 전에 반복하지 않았다.

## 검증 방식

GitHub Actions는 전용 phase7 push만 실행한다. contents:read, Node 24, Java 21, npm ci, 기존 lockfile, 실제 Chromium, 실제 Firebase SDK/Firestore Emulator를 사용한다. `demo-work-manager`와 loopback을 강제하고 secrets/운영 fallback/배포는 없다. 기존 정책 생성기의 결과를 Emulator에 로드하여 규칙·저장·동시성·복구 검사를 수행한다.

실제 SDK/Emulator 범위는 기존 60건: ATOMIC-EMU 13, SAVE-EMU 8, RULES-EMU-DIAG 2, RULES-EMU 21, JOURNAL-SDK 8, PROVISION-EMU 8. 실제 Chromium은 UI/SEC/journal/첨부·백업 검사 56건이며 JOURNAL-SDK 8건이 두 집계에 중복된다. 나머지는 순수 함수·정적·모의 SDK/HTTP 검사다. 실제 Google OAuth/Drive API는 0건이다. 등록 검사 NOT_RUN 0이라도 실계정 검증 완료를 뜻하지 않는다.

## 재현

```sh
npm ci
export GCLOUD_PROJECT=demo-work-manager
export CHROMIUM_PATH=/usr/bin/google-chrome
node tests/phase6f-prepare.cjs
./node_modules/.bin/firebase emulators:exec --only firestore --project demo-work-manager --config tests/emulator/firebase.json "node tests/phase7-ci.cjs"
```

최종 전체 결과·CI 링크·코드 SHA는 아래와 after-results.json에 기록한다. 전체 상세 로그와 소스 해시는 해당 Actions의 phase7-evidence artifact에 남는다.

## 최종 전체 CI 성공

[Actions 40133113289](https://github.com/0hoona91-sudo/work-manager-cloud/actions/runs/40133113289): **SUCCESS**.
검증 코드 SHA: `6cdf90170cb1451adeea3289152f308f8f765174`.

| 등록 | PASS | XFAIL | FAIL | XPASS | NOT_RUN |
|---:|---:|---:|---:|---:|---:|
| 406 | 403 | 3 | 0 | 0 | 0 |

IDENT-17은 동일 검사로 PASS, 신규 ATTACH-UI-01도 PASS다. 실제 SDK/Emulator **60/60 PASS**, 실제 Chromium **56/56 PASS**(JOURNAL-SDK 8건 중복). 나머지 298건은 순수·정적·모의 검사이며 XFAIL 3건을 포함한다. BUG-02/08/09는 기존 상태를 유지한다. 기준 371개 ID와 승인된 Tasks 계약 변경 외 결과를 보존했다.

공개 Actions annotation과 집계는 evidence/ci-40133113289.json, 구조화 결과는 after-results.json에 보존했다. 공개 per-ID annotation에서는 405개 결과만 제공되며 마지막 TASKS-RETIRED-01 단일 행은 누락됐다. 이 행의 PASS는 최종 등록 순서 및 총 406개/403 PASS 집계의 차이(정확히 1 PASS)로 대조했고 JSON의 evidence 필드에 표시했다. 전체 상세 원본은 Actions artifact에 있다. 현재 환경의 GitHub API artifact 다운로드는 Forbidden으로 제한되어 직접 내려받지 못했다. 이 제한은 검사 미실행이 아니라 결과 파일 다운로드 제한이다. SDK/Chromium의 모든 개별 결과는 공개 annotation에서 직접 확인했다.

이후 변경은 최종 문서·증거 보존뿐이며 성공한 코드 검사를 반복하지 않는다. 문서 커밋은 `[skip ci]`를 사용하고 위 코드 SHA의 성공 결과를 재사용한다.
