# 분석 증거·재현 절차·검증 한계

분석일 2026-10-23, 기준 `091dbecd701153e7e1880bd6bb84a277b789c58f`. 제품 코드와 운영 데이터는 수정하지 않았다. 진단은 임시 디렉터리와 새 브라우저 context에서 실행했고, 결과만 이 문서 폴더에 보관한다.

## 1. 수행 범위

| 수행 | 결과 | 증거 |
|---|---|---|
| Git 원격 전체 heads/tags 조회, fetch, ancestor/tip diff | 원격 브랜치 5개, tags 없음 | [branches.json](evidence/branches.json), [04](04-branch-comparison.md) |
| GitHub 공개 저장소/Actions/실행 #68/#67 읽기 | main Pages 성공 이력 확인 | [deployment-evidence.json](evidence/deployment-evidence.json) |
| 전체 JS 구조 parse | inline42+외부7=49개 모두 parse 성공 | [metrics.json](evidence/metrics.json), script/function/callsite CSV |
| HTML inline/external CSS parse | 64블록 중 63 성공, 1실패 | index.html:1228 여분 `}`; CSS 집계는 실패 블록 제외 |
| 없는 local import 탐색 | google-tasks-model.js 누락 | G:2 및 browser HTTP 404 |
| Chromium 1440×1000,390×844 | title·quick task form 확인, 최종 no-op 5개 확인, 1초 idle observer delta=0 | [browser-results.json](evidence/browser-results.json) |
| 동일 브라우저 합성 반복 fixture | 월 설정 무시/half 미인식/생성키 부재, 단일 context 두 번째 호출 0 | 같은 JSON |
| 모델/직렬화 probe 9개 | 2개 정상 계약, 7개 위험 동작 관찰; 아래 구분 참조 | [model-results.json](evidence/model-results.json) |
| UTC+14 음수 offset | 기대 1/9, 관찰 1/8 | [timezone-result.json](evidence/timezone-result.json) |
| HTML Blob origin 합성 표식 | 같은 origin localStorage 읽기 가능 | [blob-result.json](evidence/blob-result.json) |
| 정적 CSS token 참조 후보 | 22개 | [css-candidates.json](evidence/css-candidates.json) |

모델 probe는 formal test suite의 pass/fail 수가 아니다. 정상 관찰 2개는 유효/무효 날짜 parser와 삭제 후 generated lock 보존이다. 나머지 7개는 완료 anchor/완료 체크 변경/완료 단계 삭제/영업일 무상한/템플릿 체크 타입/첨부 정제/동일 ID import 덮어쓰기의 관찰이다. 위험으로 보고한 결과가 “테스트를 통과했다”는 뜻은 아니다.

브라우저에서는 **외부 요청을 의도적으로 차단**했다. cloud-sync SDK import가 완료되지 않아 로그인·초기 데이터 로딩은 검증하지 않았다. 초기 UI 표시와 순수 함수 fixture만 관찰했다. pageerror가 없었다는 결과를 전체 앱 성공으로 해석하면 안 된다. 이전 환경 설정 작업에서도 실제 SDK 접속은 proxy CONNECT 403이었다.

## 2. 증거 파일 해석

- `source-manifest.json`: 기준 commit의 tracked 원본 파일 SHA-256/bytes. 문서 작성 후 원본 불변 검증에 사용한다.
- `script-blocks.csv`: HTML script block과 외부 JS의 구분·행. 외부 파일은 endLine이 비어 있을 수 있다.
- `functions.csv`: named declaration 또는 함수 값 변수의 위치·scope 단서. `valueReferenceCount`는 Acorn Identifier 방문 수를 이름별로 집계한 값이며 scope/동적 property 호출을 완전히 해석하지 않는다.
- `function-assignments.csv`: 함수 값 대입 전체. event handler 대입도 포함하므로 모두 전역 patch가 아니다.
- `callsites.csv`: 12,297개 정적 호출 위치. owner는 가장 가까운 **이름 있는 함수 선언** 기준이고 anonymous callback 경계는 완전하지 않다. 긴 callee는 160자로 줄이고 expressionTruncated를 표시했다. call graph의 완전한 동적 해석 결과가 아니다.
- `event-listeners.csv`, `timers.csv`, `observers.json`: 등록/생성 코드 위치. 같은 사이트가 실행될 때 여러 listener를 만들 수 있고, 반대로 비활성 경로라 실행되지 않을 수도 있다.
- `css-candidates.json`: selector 토큰이 style을 제외한 HTML/JS 문자열에 없는 후보. 동적 조합과 실패한 CSS 블록은 완전 분석하지 못한다.
- 브라우저/모델 결과의 fixture는 합성 업무·담당자뿐이다. OAuth token, 프로필 비밀번호, 운영 문서 내용은 포함하지 않는다.

## 3. 재현 가능한 핵심 명령

읽기 전용 branch 비교:

```sh
git ls-remote --heads --tags origin
git rev-list --left-right --count origin/main...origin/fix/project-library-relative-stage-dates-20261022
git diff origin/main origin/fix/project-library-relative-stage-dates-20261022 -- js/project-model.js js/workflow-reform-v17.js
git diff --numstat origin/main origin/fix/project-library-relative-stage-dates-20261022
```

두 핵심 파일 diff가 비어 있음을 확인한다. 원격 ref가 이후 변경되면 보고서에 기록한 full SHA로 비교해야 한다.

모델의 완료 단계 삭제 관찰(저장/네트워크 없음, 저장소 루트에서 실행):

```js
const M = require('./js/project-model.js');
const p = { id:'p', name:'fixture', category:'c', manager:'owner',
  start:'2026-01-01', end:'', stages:['a','b'].map(id => ({
    id, taskId:'task-'+id, title:id, participants:['owner'],
    start:'2026-01-01', endType:'same', holidayShift:'keep',
    checklist:[], resources:[]
  })) };
const tasks = p.stages.map((s,i) => M.buildStageTask(p,s,i,null));
tasks[1].status='done'; tasks[1].actualComplete='2026-01-01';
const draft=M.clone(p); M.removeStep(draft,1);
console.log(M.reconcile({projects:[p],tasks},draft).deletedTaskIds);
// 관찰: ['task-b']。완료 task도 제거된다.
```

반복 필드 관찰은 새 브라우저 context와 로컬 서버에서 외부 요청을 모두 차단한 뒤 다음 합성 값으로 수행했다. 실제 앱 사용자 콘솔/운영 사이트에서 실행하면 안 된다.

```js
state.templates=[{id:'fixture-template',name:'분석 반복',cycle:'monthly',
  cycleMonths:[1,4,7,10],checklist:[]}];
state.tasks=[{id:'fixture-task',name:'분석 반복',start:'2026-10-01',
  end:'2026-10-01',status:'planned',dbManualRootTemplateId:'fixture-template',
  checklist:[]}];
WMTaskRecurrenceV181.configuredMonths(state.templates[0]); // null
WMTaskRecurrenceV181.scheduleKind({}, {cycle:'half'}); // ''
WMTaskRecurrenceV181.ensureOccurrences();
// 기준일 2026-10-23: 11/1,12/1,2027/1/1 추가; 재호출은 0.
```

브라우저 설정: Python Playwright, `/usr/bin/chromium`, headless, Asia/Seoul, localhost HTTP server. 외부 route는 abort했고, 앱 인증 우회 경로를 소스에 추가하지 않았다. 실제 호출 시점이 달라지면 반복 horizon 결과가 바뀌므로 후속 정식 테스트에서는 Clock을 고정해야 한다.

직렬화 probe는 Acorn으로 cloud-sync 모듈의 **최상위 변수/함수 정의만** 추출해 Node vm에서 평가했다. import·최상위 window listener·bootstrap을 실행하지 않았다. `serializeState`, `deserializeState`, `mergeById`를 합성 state에 호출했다. SDK transaction/rules 검증은 이 방법으로 대체되지 않는다.

## 4. 미검증·차단 범위

1. 운영 Pages 바이트, 배포 artifact 다운로드, Settings의 source branch/path: 직접 확인 못함. 공개 성공 실행의 main SHA만 확인했다.
2. Firebase 로그인·private workspace 연결·운영 보안규칙·실시간 두 기기·offline server commit: 인증/접근 및 테스트 fixture 환경이 없어 실행하지 않음.
3. Drive 실제 upload/download/legacy repair, Google Tasks API: 운영 데이터 무변경 원칙으로 실행하지 않음. Google Tasks는 local model 누락도 먼저 해결해야 한다.
4. 인증 후 모든 모달·모바일·테마 경로의 visual coverage, 대규모 성능 수치, observer 장시간 안정성: 다음 단계 자동 테스트 대상.
5. 앱에 내장된 local shim은 UI에 연결되지 않는다. PC 폴더 저장과 완전 offline 실행은 현 기능이 아니다.
6. Sites/D1은 읽기 참고만 했다. 시험판 실행·DB 연결·배포를 하지 않았다.

## 5. 결과 검토 방법

README → branch comparison → risk 목록 → feature inventory → engine/module/test/work-order 순서로 읽는다. 위험 항목의 fixture 결과와 실제 UI 도달 조건을 구분한다. 후속 작업자는 새로운 분석 기준 SHA, 새롭게 검증한 서비스, 이전 known failure의 해결 여부를 이 문서에 이어 기록한다.

최종 문서 검증: Markdown 11개와 증거 파일 16개, 기능 ID 70개·위험 ID 28개의 중복/누락, 내부 문서 링크, JSON/CSV 구문 및 소스 행 범위를 검사했다. 오류 0개이며, 기준 commit의 원본 파일 25개 SHA-256이 모두 동일했다. 분석용 8001 서버는 검증 후 종료했다. 기존 환경 설정 작업의 8000 서버에는 종료 명령을 보내지 않았다.
