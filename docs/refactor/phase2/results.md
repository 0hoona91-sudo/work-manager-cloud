# 2단계 실행 결과

- 실행일: 2026-10-23T02:54:04.910Z
- 기준 main: `091dbecd701153e7e1880bd6bb84a277b789c58f`
- 환경: v24.19.0, Chromium 154.0.8037.57 built on Debian GNU/Linux 13 (trixie)
- 총 33개: **PASS 21 / FAIL 0 / XFAIL 12 / XPASS 0 / NOT_RUN 0**
- 기존 오류 재현 12건은 XFAIL 12건과 동일한 집합이다. 정상 통과와 합산해 33개 모두 정상이라고 표현하지 않는다.
- `npm test` 종료 0, lockfile 재설치 후 `npm run test:strict` 종료 1을 각각 확인했다. strict의 종료 1은 알려진 오류 12건에 따른 의도된 결과다.
- 첫 실행에서 VM의 TextEncoder/btoa 제공 누락을 수정했다. 테스트 어댑터만 수정했으며 그 실패를 XFAIL로 처리하지 않았다.
- 마지막 strict 실행의 전체 관측값/기대값은 [results.json](results.json)에 보존했다. checkoutHead는 테스트 당시 main 커밋이며 작업 트리의 신규 테스트로 실행한 결과다.
- 1단계 증거에 기록된 기존 파일 25개의 SHA-256이 모두 일치한다. 운영 소스 변경 없음.

## 전체 검사 목록

| ID | 결과 | 검사 |
|---|---|---|
| HARNESS-01 | PASS | Outcome gate rejects changed failure signatures and unexpected passes |
| STATIC-01 | PASS | All production classic/module JavaScript parses in its actual mode |
| STATIC-02 | PASS | Local imports and script/stylesheet references resolve except the tracked Tasks model |
| BUG-01 | XFAIL | Google Tasks model import must resolve |
| STATIC-03 | PASS | All other inline and external CSS parses |
| BUG-02 | XFAIL | Dashboard style block must have valid CSS syntax |
| MODEL-01 | PASS | Date normalization accepts compact dates and leap day, rejects invalid day |
| MODEL-02 | PASS | Stage end counts working days and shifts holiday deadlines |
| MODEL-03 | PASS | Legacy absolute stage dates become stable relative offsets |
| MODEL-04 | PASS | Unchanged completed stage retains its dates and completion history |
| MODEL-05 | PASS | Explicit checklist completion and reopen update only the target task |
| BUG-03 | XFAIL | Dependent stage dates must use the preserved completed stage anchor |
| BUG-04 | XFAIL | Adding a new checklist item must not silently reopen completed history |
| BUG-05 | XFAIL | Deleting a stage must retain its completed task history |
| BUG-06 | XFAIL | Negative stage offsets must be timezone independent (UTC+14) |
| DATA-01 | PASS | Schema11 roundtrip preserves tasks, history, templates, rules, projects and settings |
| DATA-02 | PASS | Removed recurrence retains its stored generation lock |
| DATA-03 | PASS | Project and template attachments exclude inline data and transient URLs |
| DATA-04 | PASS | Local-only holiday setting is excluded from cloud records |
| DATA-05 | PASS | Backup merges disjoint IDs and identical records without duplication or mutation |
| BUG-07 | XFAIL | Backup conflict must not silently overwrite completed history |
| BUG-08 | XFAIL | Object-form template checklist must retain text instead of string coercion |
| BUG-09 | XFAIL | Task projectResources must exclude inline bytes and transient URLs too |
| REPEAT-01 | PASS | Month end clamps correctly across short months and leap years |
| REPEAT-02 | PASS | Monthly generation has stable dates, fresh checklist IDs and is idempotent |
| REPEAT-03 | PASS | Canonical semiannual schedule generates every six months |
| REPEAT-04 | PASS | Recurrence end is inclusive and completed roots remain unchanged |
| REPEAT-05 | PASS | Supported selectedMonths filters dates and holiday shifts preserve weekends |
| BUG-10 | XFAIL | Schema11 cycleMonths must filter actual generated occurrences |
| BUG-11 | XFAIL | Legacy half cycle must generate the semiannual occurrence |
| BUG-12 | XFAIL | Generated recurrence must carry a durable deduplication key |
| UI-01 | PASS | Desktop quick-task validates blank name and registers one synthetic task |
| UI-02 | PASS | Mobile quick-task opens, accepts input and cancels without mutation |

## 재현된 기존 오류의 관측값

| ID | 기대 동작 | 실제 관측 |
|---|---|---|
| BUG-01 | `true` | `false` |
| BUG-02 | `null` | `{"reason": "Unexpected }", "line": 197}` |
| BUG-03 | `["2026-01-01", "2026-01-03"]` | `["2026-01-01", "2026-01-12"]` |
| BUG-04 | `["done", "2026-10-23"]` | `["progress", null]` |
| BUG-05 | `{"retained": true, "deleted": []}` | `{"retained": false, "deleted": ["task-b"]}` |
| BUG-06 | `"2026-01-09"` | `"2026-01-08"` |
| BUG-07 | `["done", "2026-10-01"]` | `["planned", null]` |
| BUG-08 | `["First"]` | `["[object Object]"]` |
| BUG-09 | `[{"id": "fixture-file"}]` | `[{"id": "fixture-file", "data": "SYNTHETIC_INLINE_DATA", "previewUrl": "blob:fixture"}]` |
| BUG-10 | `["2026-10-01", "2027-01-01"]` | `["2026-10-01", "2026-11-01", "2026-12-01", "2027-01-01"]` |
| BUG-11 | `["2026-01-31", "2026-07-31"]` | `["2026-01-31"]` |
| BUG-12 | `[true, true, true]` | `[false, false, false]` |

## 범위와 한계

- 브라우저 두 경로는 실제 Chromium에서 실행했다. NOT_RUN 0은 이번 환경의 결과이며 Chromium이 없는 환경에서는 두 건이 NOT_RUN으로 보고되고 명령이 실패한다.
- JS 검사는 classic/module 모드를 구분한다. import 검사는 로컬 대상 존재 여부이며 외부 SDK 다운로드/모든 export 계약 검증은 범위 밖이다. CSS는 PostCSS 구문 검사이며 브라우저별 시각 동등성을 보증하지 않는다.
- VM 테스트는 선택한 실제 운영 함수를 검사하며 전역 패치의 전체 실행 순서와 렌더링 루프를 검증하지 않는다.
- schema11은 합성 fixture의 작업/완료이력/체크리스트/링크/프로젝트/문자열 템플릿/연계단계/문서블록/첨부 메타데이터/설정/휴일/생성잠금 왕복을 검사한다. 모든 과거 백업 변형을 포괄하지 않는다.
- 백업 충돌은 실제 `mergeById`의 동일 ID 병합을 재현한다. Drive 업로드가 포함된 복원 전체 흐름은 실행하지 않는다.
- BUG-12는 생성 키 누락을 직접 검출한다. 이 결과만으로 실 운영 환경의 중복 발생 빈도나 트랜잭션 보호 유무를 단정하지 않는다.
- 외부 API 실사용, 로그인, Firestore 동시성, Drive 파일 동작, AI/로컬판은 처음부터 범위 밖이며 미실행 테스트 수에 가상으로 더하지 않았다.

## 환경 재사용

`install_script`와 `start_skill`을 클라우드 환경 초안에 저장했다. 현재 인스턴스에서 설치·실행을 확인했으며 환경 게시나 새 인스턴스 복원 검증은 하지 않았다. 재사용 환경에 적용하려면 환경 설정에서 검토·저장 후 환경을 게시한다. 이는 운영 GitHub Pages 배포와 별개다.
