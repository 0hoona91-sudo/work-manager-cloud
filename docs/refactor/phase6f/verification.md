# 6-F 검증 근거

집중 CI [40101420844](https://github.com/0hoona91-sudo/work-manager-cloud/actions/runs/40101420844), 커밋 `0d3498328cae37e7d0e79008949a52a777b0a6c0`: **98건 전부 PASS**. 기존 6-E 집중 75건 + 신규 23건이다. 기존 52건을 포함해 실제 SDK/Emulator 60건이 모두 실행됐다.

## 생성 규칙 실행 방식

`.github/workflows/phase6f-provisioning.yml`은 전용 브랜치 push에서만 실행한다. Node 24/Java 21/npm ci/실제 Chrome/기존 Firebase SDK와 Emulator cache를 재사용한다. contents:read만 사용하고 secrets·배포 명령은 없다.

Emulator 실행 직전에 `phase6f-prepare.cjs`가 **실제 runtime policy.generate()**를 호출한다. 커밋된 tests/emulator/firestore.rules와 byte 단위로 같은지 검증하고 생성 결과를 파일에 쓴다. firebase-tools가 그 파일을 컴파일하여 실행한다. 문구 비교만 하고 보호 검증을 생략한 것이 아니다. multi UID가 포함된 생성 ACL에서 전체 기존/신규 서버 검사를 실행한다. demo-work-manager 이외 프로젝트나 비-loopback 서버로 fallback하지 않는다.

## 신규 검사 구분

| ID | 방식 | 내용 |
|---|---|---|
| PROVISION-01~03 | 순수/정적 | 단일 정책/artifact 일치, UID·프로젝트 인젝션/잘못된 입력 거부, 비-demo 설정 생성과 다중 UID |
| PROVISION-04~06 | 모의 Auth SDK | 최초/기존 profile 안내 일치, 최초 생성 전 검증, 인증 오류 안내, 재연결·비밀정보 제외 |
| PROVISION-07 | 정적 | auth singleton import URL/캐시 버전 정합성 |
| PREFLIGHT-01~05 | 합성 순수 계산 | 원본/ID/완료 이력 보존, 잠금/tombstone/orphan/revision 및 캐시·offline·journal·backup 불확실성 |
| PROVISION-EMU-01 | 실제 SDK/Emulator | 생성 규칙 컴파일 및 정상 task/check/lock 저장 |
| PROVISION-EMU-02~03 | 실제 SDK/Emulator | 미인증/미승인 UID, whitelist 밖 컬렉션 우회 거부 |
| PROVISION-EMU-04 | 실제 SDK/Emulator | 승인 다중 UID 생성·수정 |
| PROVISION-EMU-05 | 실제 SDK/Emulator | 실제 testPrivateFirestore 함수의 setup marker 쓰기·읽기 |
| PROVISION-EMU-06 | 실제 SDK/Emulator | 잠금 없는 task/부모 revision 없는 check/다른 업무공간 key 거부 |
| PROVISION-EMU-07 | 실제 SDK/Emulator | 원시 서버 자료의 읽기 전용 preflight, 삭제 후 orphan 진단, 변경 0 |
| PROVISION-EMU-08 | 실제 SDK/Emulator | 구형 revision 없는 쓰기 거부, 정상 부모/check batch, 완료 이력·첨부 참조 유지 |
| PROVISION-UI-01~03 | 실제 Chromium, 합성 로그인 상태 | 실제 ensureShell/안내 버튼/표시 내용, 오래된 캐시 무시, 오류 시 출력 제거, 계정 해제 시 닫기 |

일반 업무·프로젝트·반복·백업·journal·offline·재제출 보호는 기존 회귀검사를 생성된 규칙 아래서 재사용한다. 실제 SDK 검사의 인증은 Emulator mockUserToken이고, 미인증 검사는 token 없이 실행한다. 실제 Google OAuth/Firebase Auth 계정·운영 규칙 검증이 아니다. 실제 Chromium 안내 검사는 서버 인증을 모의로 주입하며 운영 네트워크 요청을 차단한다. 기존 JOURNAL-SDK는 실제 IndexedDB/브라우저 재실행과 Node SDK를 연결한 검사이며 전체 브라우저 OAuth E2E가 아니다.

## 로컬 준비 중 발견한 테스트 환경 문제

첫 로컬 신규 집중 실행은 Emulator 제외 15건 중 PASS 11 / FAIL 4였다. 모의 provisioning의 이메일 난수 생성에 crypto가 주입되지 않았고, 합성 UI가 연결 준비 gate를 닫지 않아 세 클릭 검사가 시간 초과했다. 합성 이메일을 고정하고 로그인/초기 동기화가 끝난 UI 상태를 재현한 뒤 해당 4건 모두 PASS를 확인했다. 운영 코드의 assertion/보호 규칙은 완화하지 않았다. 이 로컬 오류를 Emulator 보호 실패나 실계정 검증으로 분류하지 않는다.

## 재현

```sh
npm ci
export GCLOUD_PROJECT=demo-work-manager
export CHROMIUM_PATH=/usr/bin/google-chrome
export PHASE6D_SCOPE=full
node tests/phase6f-prepare.cjs
./node_modules/.bin/firebase emulators:exec --only firestore --project demo-work-manager --config tests/emulator/firebase.json "node tests/phase6f-ci.cjs"
```

`PHASE6D_SCOPE=focused`이면 집중 검사만 수행한다. Codex에서 실패한 JAR 다운로드를 반복하지 않았다. 전체 JSON/로그/hash/baseline 보존 결과는 CI artifact, 공개 annotation과 검사별 상태는 본 폴더에 보존한다. 실제 운영 자료 점검은 별도 승인 후 진행한다.

## 최종 전체 결과 — 재개 시 기존 성공 증거 보존

[Actions 40101724617](https://github.com/0hoona91-sudo/work-manager-cloud/actions/runs/40101724617) 성공. 검증 커밋은 `aad679222640b42f0cc4d39d9ce718826014b009`이다. 재개 후 코드를 수정하거나 371건을 다시 실행하지 않았다.

| 구분 | 등록 | PASS | XFAIL | FAIL | XPASS | NOT_RUN |
|---|---:|---:|---:|---:|---:|---:|
| 기존 6-E | 348 | 344 | 4 | 0 | 0 | 0 |
| 신규 6-F | 23 | 23 | 0 | 0 | 0 | 0 |
| 전체 | 371 | 367 | 4 | 0 | 0 | 0 |

실제 SDK/Emulator 60건(기존 52 + 신규 8)은 전부 PASS다. 모의 Auth 검사 PROVISION-04~06은 실제 로그인 검증으로 합산하지 않는다. 실제 Chromium 규칙 안내 검사 3건도 별도로 PASS했다. 미실행 0은 등록된 검사에 한정되며 운영 실계정/실제 규칙의 검증 완료를 의미하지 않는다. BUG-01/02/08/09의 기존 XFAIL은 그대로다.

[after-results.json](after-results.json)에 371개 전체 ID·상태·집계·검증 SHA를 저장했다. 기존 348개 ID/상태를 6-E 결과와 대조하여 일치함을 확인했고 CI의 known 기대값/XFAIL 관측값 보존 검사도 성공했다. 공개 원문은 [final-ci-annotations.json](final-ci-annotations.json)에 보존했다. 상세 오류/로그/source hash/baseline-preservation.json은 해당 run의 `phase6f-evidence-aad679222640b42f0cc4d39d9ce718826014b009` artifact에 있다. GitHub API 프록시 제한으로 상세 artifact를 로컬 재다운로드하지 않았으며 공개 annotation에 없는 상세 로그를 만들어 넣지 않았다.

최종 문서 커밋에는 `[skip ci]`를 사용하여 이미 성공한 전체 검사를 중복 실행하지 않는다. 문서 커밋과 검증 SHA 사이에는 구현/테스트/규칙 변경이 없다.

## 6-F 완료 조건 판정

| 조건 | 판정과 근거 |
|---|---|
| 강화 규칙과 생성기 일치 | 충족: 단일 정책, 생성 artifact 일치 검사 |
| 생성된 규칙의 실제 Emulator 실행 | 충족: prepare 후 컴파일, 실제 SDK 60건 PASS |
| 두 보안 허점 차단 유지 | 충족: 기존 거부 회귀 + PROVISION-EMU-06 |
| 정상 저장·충돌·복구 회귀 | 충족: 기존 348건 결과 유지 |
| 기존 검사 기대 계약 유지 | 충족: 기존 assertion 변경 없음, CI baseline guard 성공 |
| 신규 검사 통과 | 충족: 23건 PASS |
| 미승인 UID 및 우회 차단 | 충족: 미인증/미승인/다중 UID/whitelist 검사 |
| legacy·캐시·offline 위험 분류 | 충족: preflight와 deployment.md에 운영 승인 항목 분리 |
| 운영 환경 무변경 | 충족: main 미병합, 운영 API/데이터/규칙/배포 미사용 |
| Actions 및 근거 보존 | 충족: 성공 run URL, 전체 결과 및 원문 문서화 |

**6-F 개발 완료로 판정한다. 6단계 종료가 가능하며, 다음 예정 개발인 7단계에 착수할 수 있다.** 6-G/6-H를 추가하지 않는다. 7단계 구현이나 운영 배포를 이번에 시작한 것은 아니다. 운영 반영은 deployment.md의 검증과 별도 사용자 승인을 거쳐야 한다.
