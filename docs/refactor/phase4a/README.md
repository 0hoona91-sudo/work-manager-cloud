# 4-A 공통 DateOnly 계산 엔진

기준: `refactor/phase3d-backup-safety` / `975dc630d97aa07b27ea6b0a4e9319f7afd249c4`
결과: `refactor/phase4a-date-engine`

기존 05·07·08 분석 문서와 3-C/3-D 결과를 재사용했다. 날짜 산술과 프로젝트 모델의 연결부만 변경했다. main 병합, 운영 배포, Firebase/Firestore/Drive 운영 API 호출, 데이터 마이그레이션, 패키지 설치는 수행하지 않았다.

## 모듈과 호출 경계

`js/date-only.js`는 Gregorian 달력의 날짜를 UTC 기준 정수 일수로 계산한다. 날짜를 로컬 시각으로 해석한 뒤 ISO 문자열로 되돌리는 경로가 없다. 내부의 `Date` 사용은 명시한 UTC 날짜/일수와 UTC getter에 한정한다. 현재 시각·난수·DOM·저장소·SDK·통신을 사용하지 않으며 입력 데이터를 수정하지 않는다.

브라우저는 `date-only.js → project-model.js → project-ui.js` 순서로 로드한다. 공개 이름은 `WMDateOnly`다. Node에서는 `require('./js/date-only.js')`로 사용한다. 프로젝트 모델은 Node에서 직접 require하고 브라우저에서 이미 로드된 모듈을 받는다. 엔진 누락 시 명확한 오류를 낸다. UI가 호출하는 기존 `WMProjectModel` 함수 이름과 인자는 유지했다.

| API | 계약 |
|---|---|
| `normalize(input)` / `isValid(input)` | 실제 날짜 검증과 YYYY-MM-DD 정규화 / 유효 여부. 1000~9999년 범위. 문자열과 숫자 입력 지원. |
| `isLeapYear(year)` / `daysInMonth(year, month)` / `endOfMonth(date)` | Gregorian 윤년·월 길이·월말 날짜. year/month는 정수. |
| `addDays(date, offset)` | 시작일에 양수/음수/0 정수 일수 더하기. 루프 없이 계산. |
| `difference(from, to)` | `to - from`의 부호 있는 일수. 시각과 DST 영향을 받지 않음. |
| `weekday(date)` / `isWeekend(date)` | 일요일=0~토요일=6 / 토·일 여부. |
| `isHoliday(date, calendar)` | 주말·등록 휴일·주입한 휴일 판정의 합집합. |
| `addBusinessDays(date, offset, calendar, options)` | 시작일 제외, 이동한 영업일만 계산. 0이면 시작일 유지. 음수는 역방향. |
| `shiftBusinessDay(date, direction, calendar, options)` | `prev`/`next`는 시작일 포함 탐색. 이미 영업일이면 유지. `keep`은 이동하지 않음. |

구분자 `-`, `.`, `/`와 기존 6~8자리 입력을 지원한다. 기존 규칙대로 `2026101`은 10월 1일을 우선한다. timestamp는 DateOnly 입력으로 받지 않는다. 엔진은 빈 날짜를 거부하되 프로젝트 모델의 `date('')` 및 선택적 빈 필드는 기존대로 `''`를 반환한다.

```js
const D = require('./js/date-only.js');
const calendar = { holidays: ['2026-10-26', '2026-10-27'] };
D.addDays('2026-01-10', -1);                        // '2026-01-09'
D.addBusinessDays('2026-10-23', 1, calendar);        // '2026-10-28'
D.shiftBusinessDay('2026-10-25', 'prev', calendar);  // '2026-10-23'
```

`calendar.holidays`는 날짜 문자열 배열, `weekendDays`는 기본 `[0, 6]`이다. 선택적인 `isHoliday(canonicalDate)`는 동기 순수 함수여야 한다. 같은 달력 입력에 같은 판정을 반환하는 책임은 호출자에게 있다. 국가 공휴일 다운로드나 workspace 상태 조회를 엔진이 수행하지 않는다. 향후 로컬판도 같은 함수에 공휴일 배열을 전달하면 된다.

기존 프로젝트 UI의 `holidayCheck(Date)` 계약은 모델의 어댑터에서 유지한다. 어댑터만 로컬 정오 Date를 만들어 전달하고, 실제 계산은 엔진에서 수행한다. 기존 콜백이 주말도 판단하므로 어댑터 달력의 `weekendDays`는 빈 배열로 한다. 콜백이 없는 기존 모델 호출은 이전처럼 달력일을 센다. 새 엔진의 기본 영업일 계산과 이 호환 동작은 의도적으로 구분한다. 공휴일 state를 읽는 UI 콜백은 순수 엔진의 일부가 아니다.

## 안전 한도와 동작 변경

| 상황 | 이전 | 변경 후 |
|---|---|---|
| UTC+14, 기준 2026-01-10, offset -1 | 2026-01-08 | **2026-01-09**. 시작·종료 offset 모두 같은 산술 사용. |
| 정상 양수 offset, 윤년·월말·등록 휴일 | 기존 프로젝트 규칙 | 기존 정상 사례 유지. |
| 영업일 계산에서 모든 날이 휴일 | 종료되지 않을 수 있음 | 기본 36,600회 날짜 이동 후 `ITERATION_LIMIT`. |
| 휴일 이동 40회를 초과하는 프로젝트 날짜 | 휴일인 결과도 정상처럼 반환 | 모델의 기존 40회 한도를 유지하되 초과 시 오류. |
| 소수·비유한 `afterDays` | 올림·상한 보정·0 대체 가능 | 정수 입력 요구, 오류로 중단. |
| 큰 offset / 음수 `afterDays` | 양수 9,999 상한 절삭, 음수는 0으로 절삭 | 부호 있는 정수로 계산. 날짜 범위/영업일 탐색 한도를 초과하면 오류. UI의 0~9,999 입력 범위는 변경하지 않음. |
| 완료 업무와 완료 이력 | 3-C 보호 정책 | 동일. 완료일·ID·이력·첨부 참조 유지. |

공통 영업일 API의 `options.maxIterations`는 1~100,000 정수, 기본 36,600이다. 계산 한도를 0, Infinity 등으로 무력화할 수 없다. 휴일 이동에서 시작일 확인은 이동 횟수에 포함하지 않는다. 달력일 더하기는 반복하지 않으며 계산 결과가 1000~9999년을 벗어나면 `DATE_RANGE` 오류다. 전체 공휴일 목록의 실제 정확성이나 사용자 제공 콜백 내부의 무한 실행까지 보장하지는 않는다.

오류는 `name: 'DateOnlyError'`, `code`, 한국어 `message`를 가진 예외다. `INVALID_DATE`, `INVALID_YEAR`, `INVALID_MONTH`, `INVALID_OFFSET`, `INVALID_CALENDAR`, `INVALID_DIRECTION`, `INVALID_LIMIT`, `DATE_RANGE`, `ITERATION_LIMIT`를 구분한다. `isValid`만 잘못된 날짜를 false로 반환한다. 정규 프로젝트 저장은 기존 catch 경로에서 실패를 안내하며 잘못 계산한 값을 저장하지 않는다. `normalizeProject`는 복제본을 계산하므로 실패해도 입력 원본을 바꾸지 않는다. 기존 `applyRelativeDates`의 편집 초안 직접 수정 방식은 그대로다.

## 검증 결과

```sh
npm test                          # 기존 114개 + 신규 19개
node tests/run.cjs --dates-only    # 모델 9개 + 날짜 19개
```

전체 결과는 `test-results/phase4a-results.json`, 집중 검사는 `test-results/date-results.json`에 기록된다. FAIL/XPASS/NOT_RUN이 있으면 오류 종료하며 `--strict`는 남은 XFAIL도 오류로 취급한다.

| 검사 | 총수 | PASS | XFAIL | XPASS | FAIL | NOT_RUN |
|---|---:|---:|---:|---:|---:|---:|
| 재사용한 3-D 기준 결과 | 114 | 105 | 9 | 0 | 0 | 0 |
| 수정 전 BUG-06 단독 재현 | 1 | 0 | 1 | 0 | 0 | 0 |
| 수정 후 기존 검사 | 114 | 106 | 8 | 0 | 0 | 0 |
| 신규 날짜 검사 | 19 | 19 | 0 | 0 | 0 | 0 |
| 수정 후 전체 | 133 | 125 | 8 | 0 | 0 | 0 |
| 날짜 집중 검사 | 28 | 27 | 1 | 0 | 0 | 0 |

[before-results.json](before-results.json)은 운영 코드 변경 전 BUG-06을 실제 프로젝트 모델에서 재현한 기록이다. 기존 기대 날짜 `2026-01-09`를 유지해 같은 검사를 정상 PASS로 전환했다. [after-results.json](after-results.json)은 최종 전체 실행 결과와 소스 해시다. 커밋 전에 실행하므로 `checkoutHead`는 3-D 기준 커밋이다. [baseline-comparison.json](baseline-comparison.json)은 기존 114개 ID의 유지와 남은 XFAIL의 기대값·관측값 동일성을 확인한다.

| 신규 검사 | 내용 |
|---|---|
| DATE-01~05 | 입력 정규화/거부, 윤년과 월말, 양수·음수·0, 역연산, 범위/offset 오류 |
| DATE-06~10 | 주말·등록 휴일·연속 휴일, 양방향 영업일, 이전/다음 이동, 정확한 탐색 한도와 오류 |
| DATE-TZ-01~04 | 별도 Node 프로세스의 UTC, Asia/Seoul, Pacific/Kiritimati(UTC+14), America/New_York(DST) golden 결과 |
| DATE-11~13 | 브라우저/암묵적 시계·난수 없는 실행, 기존 Date 콜백/빈 콜백 호환, 탐색 실패 시 원본 보존 |
| DATE-14 | schema11 실제 codec 왕복, 프로젝트 생성·수정, ID·완료일·completionHistory·첨부 참조 유지 |
| DATE-UI-01 | 실제 Chromium에서 script 로딩, 프로젝트 등록·날짜 수정·업무 ID 유지 |

새 데이터는 합성 fixture만 사용했다. 브라우저 검사는 외부 요청을 차단하고 saveState를 모의 구현으로 대체했다. 실제 UI 이벤트와 모델은 실행했으나 실제 OAuth/Firebase SDK/Firestore 저장/Drive 파일은 검증하지 않았다. NOT_RUN 0은 등록된 테스트의 미실행이 없다는 뜻이며 운영 API 검증 완료를 뜻하지 않는다.

남은 XFAIL은 BUG-01(Tasks 모델 누락), BUG-02(CSS 문법), **BUG-03(완료 단계 기준의 후속 계산)**, BUG-08(템플릿 체크리스트 변환), BUG-09(일반 저장의 첨부 임시 데이터), BUG-10(cycleMonths), BUG-11(half 주기), BUG-12(반복 생성키)다. 기대값과 실패 서명을 변경하지 않았다.

## 4-B에서 연결할 함수와 남은 위험

1. `project-model.js: initializeRelativeDates`, `applyRelativeDates`: 완료 단계의 확정 날짜를 입력으로 고정한 다음 후속 단계 기준일을 선택해야 한다. 지금은 이전 단계의 draft 종료일을 그대로 사용한다.
2. `normalizeProject`, `reconcile`: 현재 normalize의 날짜 계산 이후 reconcile이 완료 원본을 복구한다. 이 순서로 인한 BUG-03을 4-B에서 해결해야 한다. 완료 보호 함수 자체를 이번에 바꾸지 않았다.
3. `stageEnd`, 내부 `dateAfter`/`dayDifference`: 이번 공통 산술을 재사용하고 계산 기준일의 의미를 별도로 명시한다. 예정 종료일과 실제 완료일을 임의로 교환하지 않는다.
4. `project-ui.js: openEditor`, `updateDateField`, 상대일 입력 처리, `saveEditor`: 같은 완료 단계 기준을 사용하도록 모델 계약에 연결할 대상이다. 휴일 콜백은 후속 단계에서 문자열/명시적 달력 입력으로 전환할 수 있다.

`index.html`의 일반 업무 일정·연계 계산과 `project-ui.js` 반복 생성기/라이브러리의 별도 날짜 함수는 이번에 교체하지 않았다. 앱 전체의 모든 날짜 문제가 해결됐다는 뜻은 아니다. 특히 완료 timestamp를 만드는 기존 시계 경로와 BUG-03은 남아 있다. 구버전에서 저장된 잘못된 날짜를 자동 수정하지 않으며, 이후 편집 시 상대 offset 재계산 결과가 달라질 수 있다. 잘못된 소수 간격이나 과도한 휴일 설정은 기존보다 엄격하게 오류를 낸다.

UTC+14와 DST를 포함한 지정 시간대는 검증했으나, 기존 UI Date 콜백은 여전히 호스트의 로컬 날짜를 사용한다. 역사적으로 특정 날짜 전체가 생략된 시간대 등까지 그 호환 콜백의 동일성을 보장하지 않는다. 순수 공통 엔진에 문자열 달력을 직접 전달하는 경로에는 이 제약이 없다.

## 변경 파일과 롤백

- `js/date-only.js`: 순수 날짜 API.
- `js/project-model.js`: 날짜 정규화·산술·휴일 이동의 최소 어댑터와 의존성 로딩.
- `index.html`: 엔진 선행 로딩과 모델 캐시 버전 갱신만 변경.
- `tests/date.test.cjs`: 신규 19개 검사.
- `tests/helpers.cjs`, `tests/model.test.cjs`, `tests/run.cjs`: Node 의존성 주입, BUG-06 PASS 전환, 신규 suite/결과 해시 등록.
- `docs/refactor/phase4a/`: 정책·결과·비교 증거.

전용 브랜치에서 `git revert <4-A 변경 커밋>`으로 코드·로딩·테스트를 함께 되돌리거나, 기준 `975dc630d97aa07b27ea6b0a4e9319f7afd249c4`에서 별도 복구 브랜치를 만든다. main reset/force push 및 데이터 일괄 변경은 필요 없다. 스키마나 ID 변환이 없어 데이터 역마이그레이션도 없다. revert 시 BUG-06과 휴일 탐색의 이전 위험이 다시 생긴다. 추후 테스트 환경에서 저장한 값은 코드 revert만으로 되돌아가지 않으므로 현재 상태를 보존하고 별도로 비교해야 한다.
