# 5-A 반복업무 주기 계산 정상화

기준: `refactor/phase4b-project-schedule` / `ea37aecb90d565bc0c791b63624b1834dfd16e99`

결과: `refactor/phase5a-recurrence-rules`

02·05·07 분석, 4-A/4-B 문서와 기존 recurrence 검사를 재사용했다. V181 반복 생성기의 주기 해석·날짜 계획과 기존 회차 보존 경계만 변경했다. 공통 DateOnly·프로젝트 모델·인증·백업·첨부 보안·Firestore 저장 엔진은 변경하지 않았다. main 병합, 배포, 실제 Firebase/Firestore/Drive API 작업, 설치·데이터 마이그레이션은 수행하지 않았다.

## 오류 수정 전후

| 검사 | 수정 전 실제 관측값 | 수정 후 / 기존 기대값 |
|---|---|---|
| BUG-10: monthly, cycleMonths=[1,4,7,10], 원본 2026-10-01 | 10/1, 11/1, 12/1, 2027-1/1 | **10/1, 2027-1/1** |
| BUG-11: half, 원본 2026-01-31 | 1/31만 존재 | **1/31, 7/31** |
| BUG-12: 생성 회차 3개의 generatedKey 존재 여부 | false, false, false | **동일 XFAIL**, 기대값 true 3개 유지 |

[before-results.json](before-results.json)은 코드 변경 전에 기존 반복 검사 8개를 실제로 실행한 결과다. BUG-10·11은 fixture와 기대값을 바꾸지 않고 PASS assertion으로 전환했다. BUG-12와 나머지 기존 XFAIL은 수정하지 않았다.

## 순수 모듈과 어댑터

`js/recurrence-rules.js`는 `WMDateOnly`만 의존한다. 브라우저는 `date-only.js → recurrence-rules.js → project-ui.js`, Node는 CommonJS require를 사용한다. DOM, state, SDK, 저장소, 통신, 난수, 현재 시각을 사용하지 않는다. `interpret(task, template)`가 규칙을 만들고 `plan({rule, anchor, today, until, duration, holidays})`이 `{horizon, occurrences}`를 반환한다. 각 회차는 `{scheduled, start, end}`이며 입력을 변경하지 않는다.

`freqFrom`, `scheduleKind`, `configuredMonths`, `configuredWeekDay`, `configuredWeekDays`, `addMonths`, `until`도 모듈에서 제공한다. 기존 `WMTaskRecurrenceV181`의 공개 함수와 `ensureOccurrences()`의 생성 개수 반환 방식은 유지했다. `configuredWeekDay`는 호환용 첫 요일을 반환하고, 실제 계획은 `configuredWeekDays`의 모든 요일을 사용한다.

V181 어댑터가 기존 UTC 기준 오늘 날짜와 workspace 공휴일을 입력으로 전달한다. 날짜 계획 전체가 성공한 뒤에만 새 회차를 기존 생성 경로로 추가한다. 잘못된 원본 한 건은 변경하지 않고 진단을 남기며 다른 정상 원본은 처리할 수 있다. 기존 세션 내 known 날짜 집합, 원본별 신규 40개/호출당 100개 제한, save/render wrapper는 유지한다. 이를 서버 간 원자성이나 다중 기기 중복 방지로 설명하지 않는다.

## 기존 필드 호환 및 충돌 정책

| 설정 | 해석 / 우선순위 |
|---|---|
| 주기 | weekly, monthly, quarterly, semiannual, yearly. `half`는 semiannual의 별칭. 기존 week/month/quarter/year, half-year, semi-annual, 관련 한국어 이름도 지원. 저장 문자열을 바꾸지 않음. |
| 주기 필드 | repeatFrequency/frequency/freq/cycle/cycleType/repeatType/period/interval/repeatUnit, 중첩 repeat/recurrence/schedule의 frequency/freq/type/unit/cycle 등을 읽음. 명시한 주요 주기 필드의 알 수 없는 값은 오류. 자유 형식 period/interval/type/unit의 비주기 설명은 무시. |
| 실행 월 | cycleMonths, executionMonths, scheduledMonths, selectedMonths, monthlyMonths, monthList, repeatMonths, months, runMonths. 숫자 배열 또는 쉼표/공백 문자열을 읽고 1~12 정수 검증. 빈 배열은 추가 제한 없음/다른 명시 설정 사용이라는 기존 의미 유지. |
| 요일 | weekday/weekDay/weekDays/**weekdays**/dayOfWeek/repeatWeekday/scheduledWeekday/daysOfWeek/repeatDays. 일=0~토=6, 관련 한글·영문 이름. 복수 선택 모두 유지. 생략하면 원본 기준일의 요일 사용. |
| 같은 자료의 동의어 필드 충돌 | 빈 설정을 제외한 주기·월·요일 값들이 서로 다르면 오류로 그 원본 생성을 보류. 같은 집합의 순서 차이/중복 원소는 충돌이 아님. 잘못된 원소를 조용히 제거하지 않음. |
| template와 task의 차이 | 기존 template 우선 정책 유지. 해당 필드가 template에 없으면 task(중첩 repeat 포함) 사용. 서로 다른 정상 값이 있으면 template를 선택하고 `TEMPLATE_*_PRECEDENCE` 경고. 잘못된 값은 우선순위로 숨기지 않고 오류. |
| 휴일 이동 | 명시적인 holidayShiftV181이 holidayShift보다 우선. 같은 이름이면 바깥 객체가 중첩 객체보다 우선. 값이 다르면 경고. template가 task보다 우선. keep/prev/next 외의 값은 오류. |
| 종료일 | repeatUntilV181이 있으면 우선. 빈 문자열/null은 사용자가 종료일 없음을 선택한 것으로 처리. 없으면 repeat.until/repeat.endDate/repeatEndDate/recurrenceEndDate를 읽으며 상충하는 날짜는 오류. |

정규화는 계산 결과 안에서만 한다. 기존 cycle, half, cycleMonths, selectedMonths, weekdays 등을 삭제하거나 일괄 변환하지 않는다. 분기·반기의 기존 selector 보조 필드 quarter/half를 실행월로 새롭게 추정하지 않는다. 실제 월 지정은 저장된 month 배열을 사용하고, 월 배열이 없으면 원본 기준 월의 주기 간격을 유지한다.

진단은 `WMTaskRecurrenceV181.getDiagnostics()`에서 `{rootId, code, message}` 배열로 조회한다. 각 ensure 호출의 결과를 나타내며 동일 원본/진단의 콘솔 경고는 한 세션에서 중복 출력하지 않는다. 콘솔에는 규칙 오류 코드·안내만 출력하고 업무 객체·인증정보를 출력하지 않는다. 주기 설정 UI 전체를 새로 만들지는 않았다.

## 날짜 계획 규칙

- 월 단위 이동은 원본의 일을 계속 기준으로 쓰고 짧은 달에서만 월말로 제한한다. 1월 31일→2월 28/29일→3월 31일이며, 매년 2월 29일도 윤년에 다시 29일을 사용한다. 달 이동을 고정 일수로 대체하지 않았다.
- monthly/quarterly/semiannual/yearly의 간격은 각각 1/3/6/12개월이다. 선택 월이 있으면 최초 기준을 다음 허용 월로 맞춘 뒤 해당 간격의 날짜를 월 목록으로 필터링한다. 선택 목록을 추가 회차로 모두 확장하거나 주기 간격을 무시하지 않는다. 예를 들어 반기 [6,12]는 6월과 12월의 말일을 정확히 만든다. 주기와 불규칙한 월 목록의 교집합에 없는 월은 생성되지 않는다.
- weekly는 모든 선택 요일을 열거한다. 원본 업무 날짜 자체가 다른 요일이거나 미선택 월이어도 원본을 옮기지 않고, 이후 허용되는 새 회차만 추가한다.
- horizon은 기존 의미대로 `max(today+3개월, anchor+3개월)`이며 종료일이 더 빠르면 그 날짜로 줄인다. 종료일이 멀어도 한 번에 끝까지 생성하지 않는다. 미래 원본은 원본 기준 3개월 범위를 가진다. today는 어댑터에서 명시적으로 주입한다.
- 종료일은 포함한다. raw scheduled date뿐 아니라 휴일 이동 후 표시 시작/종료일이 명시 종료일을 넘는 회차도 추가하지 않는다. 종료일을 다시 늘리면 기존 same-session known 검사에 따라 필요한 회차만 추가할 수 있다.
- 실행월 필터는 **휴일 이동 전 scheduled 날짜**에 적용한다. 휴일 이동이 다음 달로 넘어갈 수 있으며 이것을 다른 월의 원래 회차로 바꾸지 않는다. 실제 날짜와 원래 회차 날짜는 별도로 유지한다.
- 휴일 이동은 WMDateOnly의 토·일/등록 공휴일 계산을 사용한다. 기존 방식대로 종료일을 이동하고, 하루짜리 업무는 시작일도 함께 이동한다. 이동 결과가 시작일보다 이르면 오류로 보류한다. 탐색 한도는 365회다.
- 날짜 열거의 안전 한도는 주간 36,600일, 월 주기 최대 n=1,200이다. 초과 시 부분 계획을 정상으로 확정하지 않고 오류를 반환한다. 정상 rolling 구간은 이 한도보다 작다.

기존 원본은 다시 휴일 이동하거나 선택 월·요일에 맞춰 수정하지 않는다. 원본에 repeatAnchorDateV181이 있으면 그 날짜를 사용하고, 없으면 현재 시작일을 사용한다. 새 회차에는 기존 V181 필드인 repeatScheduledDateV181에 원래 날짜, repeatAnchorDateV181에 기준일을 넣는다. 이미 저장된 날짜·필드를 다시 발급하지 않는다.

## 기존 회차 보호와 과거 오류 후보

ensureOccurrences는 기존 tasks 객체를 수정하지 않고 새 회차만 추가한다. 완료 상태·완료일·completionHistory·체크 ID·첨부 참조·사용자 수정 날짜·기존 반복 정보가 그대로 유지된다. 재개한 원본에서 새 회차를 만들 때는 3-C 정책대로 새 회차에 과거 completionHistory를 복사하지 않는다. 원본의 holidayAppliedV181 표식을 새 회차의 계산 완료로 오인하지 않도록 새 회차에 한해 별도로 판단한다.

반복 종료일 선택은 사용자가 선택한 원본의 종료일만 갱신하고, 기존 생성 회차들을 일괄 수정/삭제하지 않는다. 범위 밖에 남은 과거 회차의 정리는 별도 검토 대상이다. 등록 직후 새 업무의 기존 휴일 처리 경로는 유지하지만 완료·재개 이력 있는 자료는 해당 보정에서도 제외한다. 완료 원본에서 새로운 시리즈를 계속 생성할지에 대한 수명 정책은 기존대로이며 이번에 변경하지 않았다.

BUG-10의 합성 재현에서는 원본 2026-10-01, 선택 월 [1,4,7,10]에 대해 잘못 생성된 **2026-11-01, 2026-12-01**이 검토 후보다. 운영 자료는 조회하지 않았으므로 실제 삭제 후보 ID나 건수를 산출하지 않았다. 향후 별도 승인을 받기 전에는 다음을 비교해 검토 목록만 준비해야 한다.

1. 원본 ID·repeatScheduledDateV181·등록 당시 규칙과 현재 규칙을 대조한다. 현재 규칙과 다르다는 사실만으로 과거 생성이 오류였다고 단정하지 않는다.
2. 완료/재개 이력, 수동 이동 여부, 개별 체크 기록, 첨부 참조, 연결된 업무를 함께 표시한다. 완료·수정된 항목은 삭제 대상으로 자동 선정하지 않는다.
3. 삭제 시 재생성 방지 키와 다른 기기 동기화에 미치는 영향을 함께 검토한다. BUG-12가 남아 있으므로 단순 삭제 후 재생성이 일어날 수 있다.

이번 코드와 테스트에서는 규칙 변경·종료일 축소 후에도 기존 합성 회차 전체가 그대로 남음을 확인했다. 운영 삭제·자동 정리 코드는 추가하지 않았다.

## 검증

```sh
npm test                            # 기존 152개 + 신규 21개
node tests/run.cjs --recurrence-only # 기존 반복 8개 + 신규 21개
```

| 검사 | 총수 | PASS | XFAIL | XPASS | FAIL | NOT_RUN |
|---|---:|---:|---:|---:|---:|---:|
| 재사용한 4-B 결과 | 152 | 145 | 7 | 0 | 0 | 0 |
| 수정 전 기존 반복 검사 | 8 | 5 | 3 | 0 | 0 | 0 |
| 수정 후 기존 검사 | 152 | 147 | 5 | 0 | 0 | 0 |
| 신규 검사 | 21 | 21 | 0 | 0 | 0 | 0 |
| 최종 전체 | 173 | 168 | 5 | 0 | 0 | 0 |
| 최종 집중 검사 | 29 | 28 | 1 | 0 | 0 | 0 |

[after-results.json](after-results.json)은 마지막 전체 회귀 테스트 한 차례의 결과와 코드 SHA-256이다. [baseline-comparison.json](baseline-comparison.json)은 기존 152개 ID의 유지, BUG-10·11만 PASS 전환, 다른 XFAIL 기대값·관측값 동일성을 확인한다. 커밋 전에 실행하므로 checkoutHead는 4-B 기준 커밋이다. 신규 테스트 중 불완전한 fixture에 codec의 기본 필드가 추가되는 차이가 발견되어 fixture 자체에 원래 schema11 기본 필드를 채웠다. 전체 객체 동일성 assertion은 유지했으며 집중 검사를 통과한 뒤 전체 검사를 한 차례 실행했다.

| 신규 검사 | 내용 |
|---|---|
| RULE-01~04 | alias, cycleMonths/selectedMonths, 동일·충돌 필드, template 우선 및 중첩 fallback |
| RULE-05~09 | 복수 요일·기본 요일, half/semiannual, 월말/윤년, 분기·연간 |
| RULE-10~11 | 종료일/rolling, 휴일 이동 전 raw 날짜와 이동 후 종료일 경계 |
| RULE-12~15 | 완료·재개·수동 수정 보존, 새 회차 휴일 표식, 오류 진단·무변경, 실제 종료일 선택 함수의 기존 회차 보존 |
| RULE-16~17 | 실제 schema11 codec 왕복, 시계·DOM·난수 없는 순수 계획과 입력 불변 |
| RULE-TZ-01~03 | UTC·서울·UTC+14에서 동일한 raw/휴일 이동 날짜 |
| RULE-UI-01 | Chromium script 로딩과 반복 렌더 후 완료 이력·원본 날짜 보존 |

합성 fixture와 격리 브라우저만 사용했다. 브라우저 외부 요청은 차단하고 저장은 모의 함수로 대체했다. 실제 OAuth/Firebase SDK/Firestore 원격 transaction/Drive 파일은 검증하지 않았다. NOT_RUN 0은 등록된 검사에 미실행이 없다는 뜻이다.

## 남은 위험과 5-B 대상

남은 XFAIL은 BUG-01, BUG-02, BUG-08, BUG-09, **BUG-12**다. BUG-12 관측값은 변경되지 않았다. 새 영구 generatedKey, 서버 잠금, 다중 사용자 충돌 방지는 이번에 도입하지 않았다. 같은 세션에서는 scheduled 날짜와 기존 업무를 대조하지만 기기 둘이 동시에 생성하면 다른 ID의 같은 회차가 생길 수 있다. 기존 원본에 생성키가 있을 때 복제 의미도 5-B에서 검토해야 한다.

화면 render 중 ensure/save가 호출되는 구조는 유지했다. 기존 이력을 변경하지 않는 것과 조회 시 신규 생성·저장이 전혀 없다는 것은 다르다. 설정 충돌은 진단 후 생성을 보류하므로 이전보다 예정 업무가 적게 보일 수 있다. 과거 원본에 anchor/scheduled 날짜가 없고 수동으로 이동했다면 원래 회차를 완전히 복원할 정보가 없으며, 이를 임의 추정해 기존 데이터를 고치지 않는다.

5-B에서는 다음 경계를 우선 다룬다.

- `ensureOccurrences`: known 집합과 동일 template의 native 회차 인식, 신규 40/100개 제한, 계획과 저장 명령 분리.
- `sourceRoot`, `seriesRoot`, repeatAnchorDateV181/repeatScheduledDateV181: 원본 수명, 수동 이동, 삭제 억제, raw 회차 식별과 호환 매핑.
- `saveState`/`renderTaskTable` V181 wrapper, registrationSnapshotV181, `applyEndChoice`: 조회 시 저장 제거, 명시적 생성/종료일 명령과 영향 미리보기.
- Firestore `serializeState` 및 generatedKeys/transaction 경계: 결정적 회차 키, 두 기기 경쟁, offline/부분 저장·재시도. 기존 키 일괄 재발급 없이 설계해야 한다.

## 변경 파일과 롤백

- `js/recurrence-rules.js`: 순수 해석·월 이동·반복 계획.
- `js/project-ui.js`: V181 어댑터 연결, 기존 회차 무변경, 진단, 종료일 축소 시 자동 삭제 제거.
- `index.html`: 새 모듈 로딩과 UI cache 버전 갱신.
- `tests/recurrence-rules.test.cjs`, `tests/recurrence.test.cjs`, `tests/helpers.cjs`, `tests/run.cjs`: 신규 검사, BUG-10·11 PASS, 의존성 주입과 실행/증거 등록.
- `docs/refactor/phase5a/`: 호환 정책·보존 정책·수정 전후 증거.

전용 브랜치에서 `git revert <5-A 변경 커밋>`으로 코드·로딩·테스트를 함께 되돌리거나 기준 `ea37aecb90d565bc0c791b63624b1834dfd16e99`에서 별도 복구 브랜치를 만든다. main reset/force push, 스키마 역변환은 필요 없다. 코드 revert는 이후 생성한 회차를 삭제하지 않는다. 저장된 자료는 먼저 보존하고 별도 승인·비교로 정리해야 한다. 되돌리면 BUG-10·11과 기존 원본 날짜 정렬/종료일 이후 회차 삭제 동작이 다시 나타날 수 있다.
