# 코드 문제점 및 기술부채 목록

기준은 `091dbec`. P0는 데이터·자격증명 손실 경로를 먼저 검증하고 차단할 항목, P1은 기능 오류/정합성, P2는 구조·유지보수·성능이다. 현재 운영 사고가 발생했다는 의미가 아니다. 이번에는 수정하지 않았다.

## 1. 우선순위 목록

| ID / 우선순위 | 문제와 근거 위치 | 판정·영향 | 먼저 만들 검증 / 개선 방향 |
|---|---|---|---|
| TD-01 / P0 | `cloud-sync.js:1655`의 `text/*`·image 미리보기 + `workspace-profile.js:199`의 전체 프로필 localStorage 캐시 | HTML Blob은 앱 origin 저장소에 접근 가능. 합성 표식 읽기 재현. 실제 악성 첨부·운영 자격증명 접근은 실행하지 않음 | T-SEC-01. HTML/SVG 등 능동 문서는 다운로드/격리 viewer, MIME 허용목록. 프로필 자격증명 노출면·로그아웃·CSP 별도 설계 |
| TD-02 / P0 | `project-model.js:162,182,219`, `project-ui.js:389,412` | 완료 단계 제거 시 task도 제거, 체크리스트 추가 시 done→progress. 모델 fixture 재현. 일반 업무 휴지통과 프로젝트 삭제 정책 불일치 | T-PRJ-03~05. 완료 이력 immutable snapshot, 명시적 재개 command, 프로젝트 폐기에도 archive |
| TD-03 / P1 | `project-ui.js:733~992` 새 반복 엔진 | `cycleMonths` 누락, `half` 미인식, 랜덤 ID 및 generatedKey 부재. 월 선택 무시를 격리 브라우저에서 재현 | T-REC-01~07. 기존 schema 해석 어댑터, 안정된 occurrence key, 엔진 단일화 |
| TD-04 / P0 | `index.html:2175`, `cloud-sync.js:1367,1389` | 배열 유무만 검사, 병합은 같은 ID의 incoming 우선. done가 planned로 바뀌는 merge 재현. 실제 저장은 미실행 | T-IO-01~06. schema/참조 검증, dry-run diff, 완료 보존·충돌 선택, 복원 전 snapshot |
| TD-05 / P1 | `google-tasks-sync.js:2` | `google-tasks-model.js`가 main/조회된 브랜치 이력에 없음. HTTP 404, 모듈 전체 부팅 불가 | T-BOOT-02. 원본 또는 명세 확보 후 별도 복구. 임의 stub으로 성공 처리 금지 |
| TD-06 / P1 | `project-ui.js:958,979`, `index.html:5047`, `workflow-reform-v17.js:382` | save/render가 반복생성·상태 수선·프로젝트 재개를 함. 원격 반영→render→save 피드백 가능 | T-UI-03, T-SYNC-05. UI는 읽기 전용 projection, command에서만 mutation |
| TD-07 / P1 | `cloud-sync.js:1260,1327` | online은 remote field와 new value만 비교; base revision 충돌 거부 없음. offline은 generated key transaction 검증 없이 batch | T-SYNC-02~04. 동일 필드 충돌·오프라인 재접속·두 기기 동시 생성 검증 |
| TD-08 / P1 | `cloud-sync.js:1224~1259`, `project-ui.js:399` | 320 write 분할. projects와 tasks는 다른 bundle; 큰 aggregate 중간 실패 시 부분 반영 가능 | T-SYNC-06. aggregate 원자성 범위·재시도 ID·실패 복구 계약 |
| TD-09 / P1 | `cloud-sync.js:1108,1131,910`, `index.html:2252` | 모달 동안 120ms 재예약, flush 25ms 폴링, 초기 snapshot timeout 없음. 시작 실패는 console 위주 | T-BOOT-03/04, T-SYNC-07. 취소·timeout·재시도 상태 머신, 모달 draft merge |
| TD-10 / P1 | `project-model.js:98,129,182` | 상대 계산 후 완료 날짜를 원복하므로 후속 단계가 잘못된 anchor를 유지할 수 있음 | T-DATE-05. 완료 단계 확정→위상 순서 계산. 모델 재현 결과 B=1/12, 보존된 A=1/1·offset=2 |
| TD-11 / P1 | `index.html:3002,3051,4105`, `project-model.js:65` | 구 DB cascade는 앞 단계 anchor, 일반 link는 자식 시작 anchor, library→project는 자식 시작+limit. 같은 숫자라도 의미가 다름 | T-DATE-01~04. legacy ruleKind를 유지해 명시적 anchor를 모델링; 일괄 규칙 변경 금지 |
| TD-12 / P1 | `project-model.js:59,105`, `index.html:1752` | 영업일 루프 상한 없음, 음수 offset에 local Date→UTC 문자열 혼용 | T-DATE-06/07. 모든 날 휴일 callback 10,000회 후 진단 중단; UTC+14에서 하루 오차 재현 |
| TD-13 / P1 | `cloud-sync.js:379~456` | template checklist는 string[]로 가정; object는 `[object Object]`. task.projectResources와 stage.methodBlocks의 정제 범위 불균일 | T-MODEL-02/03. 객체 타입·첨부 전용 schema, 직렬화 경계에서 오류 반환/명시 변환 |
| TD-14 / P1 | `workspace-profile.js:380,439,562` | 형식 검사는 일부 필드 존재만 확인. 프로필 password가 Drive·localStorage에 지속. 중앙 allowlist 재조회는 긍정적이나 운영 rules 미확인 | T-AUTH-01~04. actor/workspace 경계·계정전환·분실/revoke 테스트; 실제 rules 별도 확인 |
| TD-15 / P1 | `cloud-sync.js:125,179,1395`, `workspace-profile.js:113,619` | Drive/중앙 Drive/legacy Drive/Tasks 토큰 상태 중복. legacy 메모리 token은 복원 시 만료 재검사 없음; 로그아웃은 일반 token 위주 | T-AUTH-05. scope별 단일 TokenProvider, UID·workspace·expiry 기반 캐시, 전부 revoke/clear |
| TD-16 / P1 | `cloud-sync.js:1523`, `project-ui.js:368,389` | 파일 업로드 성공 후 app 저장 실패/취소 시 고아 파일 가능. 업로드 중 실패 cleanup과 다른 문제 | T-FILE-02. 업로드 상태·참조 commit·실패 정리 큐; 사용 중 파일 즉시 삭제 금지 |
| TD-17 / P2 | `cloud-sync.js:1635`, `index.html:1713` | object URL Map 크기 제한/전역 종료 정리 부족. 같은 파일 동시 조회 요청 합치기 없음 | T-FILE-03. inflight promise 공유, 참조계수/TTL, workspace 종료 dispose |
| TD-18 / P1 | `index.html:1890,9487,9549` | JSON은 원본 파일을 포함하지 않음. 프로젝트·task 첨부까지 동일하게 strip하지 않음. ZIP은 메모리에 전체 파일 수집·전체 buffer CRC, 합계 offset 32bit 제한 검사 부족 | T-IO-04~08. 구조 백업과 원본 백업 구분, manifest/hash/누락 보고, 총량 제한/streaming |
| TD-19 / P2 | `index.html:1674~6061` 및 후속 script | 같은 script 안 전역 선언 중복과 다층 래퍼. 선언 hoisting 때문에 이름·행 순서만으로 실제 구현 판단 불가 | T-BOOT-01, T-UI-01. 최종 함수/캡처 체인 특성화 후 facade를 하나씩 대체 |
| TD-20 / P2 | `project-ui.js:522,718`, `workflow-reform-v17.js:93,199,583` | observer로 다른 renderer 결과를 뒤늦게 수정. disconnect/lifecycle 소유권 불명확 | T-UI-04. 단일 view model, mount/dispose, render 후 재수정 제거. 무한 루프는 미재현 |
| TD-21 / P2 | `index.html:5293,6491,8509,9936,10417` 등 | 모바일/데스크톱 조건·라벨·테마 이벤트 중복; 720/760/1100 등 기준 불일치 | T-UI-05~08. 하나의 breakpoint 정책·CSS tokens, 뷰포트별 snapshot |
| TD-22 / P2 | `index.html:1228`, `7502` 등 | CSS 여분 `}`를 PostCSS가 거부. 브라우저는 복구해 렌더하므로 외형 정상만으로 문법 통과 아님. 중복 data 이미지와 !important 누적 | T-STYLE-01~03. 구문 정리·이미지 추출 전후 시각 비교; 스타일 계층 재설계 |
| TD-23 / P2 | `index.html:1709,1723,2165~2168`, `workspace-profile.js:448~598` | local shim·신규 setup·온라인 공휴일 코드가 남아 있지만 진입이 없거나 stub | T-REACH-01. 활성/비활성/외부 export를 구분해 삭제 승인 목록 작성 |
| TD-24 / P2 | `index.html:5500,5657~5889` | 진단·휴지통·버전은 존재하지만 프로젝트 경로·새 recurrence에는 적용 범위가 다름 | T-HIST-01~04. 공통 archive/impact preview 정책, 보존기간·snapshot 범위 명시 |
| TD-25 / P2 | `index.html:5323~5453,7036~7129` | 검색이 task와 template 참조를 매번 재계산. 대규모 문자열 검색/DOM 전체 교체; 파일 본문 검색 아님 | T-SEARCH-01~03. 읽기 모델/증분 인덱스, 문서 추출은 별도 모듈 |
| TD-26 / P2 | `index.html:1893,11457` | CSV export는 남아 있으나 UI에서 숨김. 셀 따옴표 이스케이프만 하고 formula prefix는 별도 처리하지 않음 | T-IO-09. 의도적 숨김과 제거 구분; 외부 스프레드시트 해석 정책 |
| TD-27 / P1 | `cloud-sync.js:543` | cloudHasData가 projects를 검사하지 않음. project만 있는 비정상/부분 데이터에서 empty workspace 판단 위험 | T-SYNC-08. aggregate 무결성 검사와 빈 상태 판정 통일 |
| TD-28 / P2 | 전체 저장소 | 운영 rules·schema fixture·자동 테스트·배포 검증 없음. 업로드형 커밋, 버전 명칭 불일치 | T-BASE-01. 테스트 기반·release manifest·정확한 코드 SHA와 배포 artifact 연결 |

## 2. 중요한 재현과 해석

### 반복업무: 기존 데이터 필드와 새 엔진이 다름

`cycle:'monthly', cycleMonths:[1,4,7,10]` 템플릿에서 2026-10-01 업무를 만들고 `WMTaskRecurrenceV181.ensureOccurrences()`를 호출했다. 11/1, 12/1, 다음 해 1/1이 추가되었고 `configuredMonths(template)`는 null이었다. `cycle:'half'`는 scheduleKind가 빈 문자열을 반환한다. 이 둘은 레거시 필드명/열거형 불일치다.

같은 메모리 상태에서 두 번째 호출은 0건 생성해 단일 세션의 중복 억제는 작동했다. 하지만 생성된 세 업무에는 `generatedKey`가 없고 랜덤 ID가 붙는다. **두 기기 동시 생성 중복은 아직 미재현**이며 emulator 회귀 대상이다. 완료 root는 origins에서 제외되므로 향후 rolling 연장의 기준 root 수명도 검증해야 한다.

### 완료이력: UI 잠금만으로 충분하지 않음

완료 단계 날짜 입력은 observer가 disable한다. 그러나 모델에서는 다음 동작이 가능하다.

- 완료 단계를 removeStep 후 reconcile하면 해당 완료 task가 deletedTaskIds에 포함된다.
- 완료 단계에 새 unchecked 체크리스트를 넣으면 status가 progress로 바뀐다.
- 완료 A의 날짜를 바꾼 draft를 normalize하고 reconcile하면 A는 옛날 날짜로 복원되지만 B는 바뀐 A 기준 날짜에 남는다.

첫 두 동작의 정책이 의도적일 수는 있으나, “완료 이력 보호”를 요구한 새 설계에는 archive/reopen command를 통한 명시적 경로가 필요하다. 세 번째는 모델 계산 순서 문제이며 일반 UI의 정확한 도달 조합을 추가 검증한다.

### 동일 origin 첨부 미리보기

`openDriveFile`은 `text/html`도 previewable로 보고 생성한 Blob URL을 새 창에 연다. `opener=null`은 원래 창의 객체 접근을 줄이지만 같은 origin의 localStorage 접근을 차단하지 않는다. 실제 앱 origin에 합성 표식 하나만 넣은 뒤 HTML Blob에서 읽는 실험은 성공했다. Drive 파일을 업로드하거나 프로필 값을 읽은 실험은 하지 않았다. 이 경로는 사용자가 열게 되는 악성/변조된 첨부가 있을 때 위험해진다.

### Firestore 중복 I/O 판정

현재 구현에는 구독 Promise 재사용, pending writes 필터, diff 저장, 로그 lazy-load가 있다. 이를 제거하면 오히려 읽기 비용·race가 늘 수 있다. 문제는 `renderDbTable`의 상속 복구 저장, 반복 생성의 save wrapper, 폼 저장 후 휴일 옵션의 추가 save 등 서로 다른 변경이 한 UI 동작에 겹친다는 점이다. 실제 청구 read/write 수는 SDK/emulator 계측 없이 수치로 단정하지 않았다.

## 3. 삭제 후보와 보류 목록

**정적 참조 없음 후보**: `readLocalState`, `localCloudShim`, `koreanHolidayNameV2`, `fetchKasiHolidaysV2`, `fetchNagerHolidaysV2`, `taskBelongsToTemplateV29`, `homeWidgetVisibleDesktopV114`, `restoreDriveAccessToken`, `validFirebaseConfig`, `configureAuthPersistence`. 문자열 호출·외부 콘솔 사용 가능성과 이전 저장 데이터 의존을 확인한 뒤 제거한다.

**export됐지만 main UI에서 연결되지 않은 기능**: `deleteWorkspaceProfile`, `parseFirebaseConfigText`, `provisionPrivateWorkspace`, `firestoreRulesForWorkspaceUid`, `testPrivateFirestore`, `finalizeWorkspaceProvision`, `verifyExistingWorkspace`. `bootstrapCloud`는 동적 import 결과의 property로 호출되므로 단순 Identifier 검색의 “참조 없음” 판정을 적용하면 안 된다.

**활성 종료점에서 비활성화된 구형 기능**: V5/V24 자동생성, V14 과거 보충, V16 horizon pruning. 저장 데이터의 관련 필드는 여전히 남으므로 코드 비활성과 데이터 폐기를 동일시하지 않는다.

**CSS 후보**: 파싱 성공한 selector의 class/id 토큰 중 HTML/JS 문자열에서 정확한 이름이 발견되지 않은 22개를 [css-candidates.json](evidence/css-candidates.json)에 기록했다. 예: `.homegrid`, `.viewtabs`, `.holiday-stripe`, `.drop-menu`, `.urgent-dot`, `.db-detail-rule`, `.mobile-signout-v17`, `.library-row-project-v176`. 동적 문자열 조합·인수인계 HTML·외부 플러그인 사용은 정적 검사로 배제하지 못한다. 제거 전 모든 화면·모달·테마·모바일 coverage를 비교한다.

## 4. 해결 순서

먼저 TD-01~05의 재현 테스트와 사용자 보호 규칙을 만든다. 다음 TD-06의 command 경계를 만들어 문제 해결이 화면 패치로 누적되지 않게 한다. TD-07~18 저장·날짜·첨부 계약을 엔진/adapter 테스트로 고정하고, 마지막에 전역 래퍼·observer·CSS를 줄인다. 미사용 후보 삭제는 기능 이동과 별도 변경으로 검토한다. 상세 작업 단위는 [08](08-refactor-work-orders.md)에 있다.
