# 2단계 자동 테스트 기반

기준 소스: 최신 main `091dbecd701153e7e1880bd6bb84a277b789c58f` (2026-10-23 확인).
작업 브랜치: `refactor/phase2-test-baseline`.
1단계 분석 브랜치 `ab702de`의 `docs/refactor/` 문서와 증거를 그대로 가져왔다. 기존 보고서를 재작성하지 않았으며 운영 JS·HTML·CSS와 스키마, 배포 설정은 변경하지 않았다.

## 실행

Node.js 22 이상과 Chromium/Chrome이 필요하다. 검증 환경은 Node 24.19.0, npm 11.9.0, Linux 시스템 Chromium이다. 브라우저나 Firebase SDK를 npm 설치 과정에서 내려받지 않는다.

```sh
cd /workspace/work-manager-cloud
npm ci --ignore-scripts --no-audit --no-fund --cache /tmp/work-manager-npm-cache
npm test
```

의존성 설치 후 핵심 검사는 **`npm test` 한 명령**으로 실행한다. 다른 경로에 설치된 브라우저는 `CHROMIUM_PATH=/absolute/path/to/chromium npm test`로 지정한다. Windows에서는 해당 환경의 환경변수 설정 방식으로 Chrome 실행 파일 경로를 지정한다. 이 단계에서 Windows 실행을 검증하지는 않았다.

`npm run test:strict`는 같은 assertion을 실행하되 알려진 오류가 하나라도 남으면 종료 코드 1을 반환한다. 기본 `npm test`는 정확히 등록된 예상 실패만 허용한다. 모든 검사는 순차 실행되며 결과는 무시된 경로 `test-results/phase2-results.json`에 새로 기록된다. 커밋한 실행 결과는 [results.json](results.json), 목록과 범위는 [results.md](results.md), 수정 순서는 [phase3-priorities.md](phase3-priorities.md)에 있다.

## 결과 분류 및 종료 정책

| 상태 | 의미 | 기본 명령 실패 여부 |
|---|---|---|
| PASS | 기대 동작의 assertion 통과 | 아니오 |
| XFAIL | 기대 동작의 assertion 실패 + 실제 관측값이 등록한 기존 오류와 정확히 일치 | 아니오, 명시적으로 별도 집계 |
| FAIL | 새 오류, 다른 실패 양상, 테스트 구성 문제 | 예 |
| XPASS | 알려진 오류가 사라짐. 리뷰 후 정상 테스트로 승격 필요 | 예 |
| NOT_RUN | 브라우저 실행 파일이 없어 해당 UI 검사 실행 불가 | 예 |

XFAIL은 정상 통과가 아니다. ‘기존 오류 재현’은 XFAIL 12건의 별도 설명이며 총 테스트 수에 다시 더하지 않는다. 오류 함수 호출 자체의 예외는 예상 실패로 덮지 않는다. assertion 삭제, `skip`, `todo`, 실행 결과에 따라 테스트를 빼는 처리는 없다. 브라우저가 존재하지만 실행이 실패하면 FAIL로 보고한다. HARNESS-01은 오분류와 예상 밖 통과를 검사한다.

## 격리 방식과 유지보수

- `tests/helpers.cjs`: 운영 프로젝트 모델을 VM에서 로드한다. cloud-sync는 AST로 지정한 serializer/merge 함수와 의존 정의만 추출하며, 재귀 일정은 실제 `installRollingRecurrencesV181`을 추출한다. 구현을 테스트에 복제하지 않는다. 함수 이름·추출 계약이 바뀌면 검사 실패 후 어댑터를 갱신한다.
- Firebase import, 인증 초기화, Firestore 요청, Drive 요청을 실행하지 않는다. 합성 상태 객체만 메모리에서 사용한다. 직접 serializer를 검사하므로 Firebase의 트랜잭션·동시성·권한까지 검증한 것은 아니다.
- 기준 시각 `2026-10-23T03:00:00Z`, 고정 fixture ID, 결정적 ID 생성기·난수, 기본 UTC를 사용한다. 날짜 시간대 오류 한 건은 별도 Node 프로세스에서 UTC+14로 실행한다. 브라우저 시간대는 Asia/Seoul이다.
- UI 테스트는 임의 포트의 loopback HTTP 서버와 매번 새 브라우저 프로필을 사용한다. 동일 origin의 GET만 허용하고 외부 요청 및 service worker를 차단한다. 실제 운영 사이트에 접속하지 않는다. 생성된 업무·IndexedDB는 폐기되는 브라우저 컨텍스트에만 있다.
- 외부 SDK 차단에 따른 시작 오류와 누락된 Tasks 모듈은 별도 정적 검사/예상 실패로 다룬다. UI PASS는 오프라인 화면과 빠른 입력 경로의 결과이며 인증을 포함한 전체 시작 성공이나 클라우드 저장 성공을 뜻하지 않는다.
- 향후 실제 모듈 추출 시 어댑터를 모듈 import로 교체하되 같은 fixture와 동작 assertion을 유지한다. 버그 수정 후 XFAIL의 기대값을 약화하지 말고 정상 test로 승격한다.

## 파일 구성

| 파일 | 역할 |
|---|---|
| `package.json`, `package-lock.json`, `.gitignore` | 3개 개발 의존성 고정, 실행 명령, 로컬 산출물 제외 |
| `tests/run.cjs` | 순차 실행, 결과 분류, JSON 보고, 종료 코드 |
| `tests/helpers.cjs`, `tests/fixtures.cjs` | 실제 코드 추출·격리, 합성 schema11/프로젝트/반복 fixture |
| `tests/static.test.cjs` | classic/module JS 문법, 로컬 import·script/link 경로, CSS 문법 |
| `tests/model.test.cjs` | 날짜, 단계 연동, 완료 이력, UTC+14 |
| `tests/data.test.cjs` | schema11 왕복, 생성 잠금, 첨부 메타데이터, 백업 병합 |
| `tests/recurrence.test.cjs` | 월말·윤년·월별·반기별·종료일·재실행·완료 보존 |
| `tests/browser.test.cjs` | 데스크톱 등록·빈 이름 검증, 모바일 입력·취소 |

AI, PC 로컬판, 운영 API 실사용, 대규모 브라우저 회귀 검사는 이번 단계 범위 밖이다. 모든 기능을 테스트했다고 해석하지 않는다. CI/Pages workflow를 추가하거나 배포를 수행하지 않았다.
