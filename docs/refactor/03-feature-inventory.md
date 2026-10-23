# 기존 기능 전체 목록

기준 SHA: `091dbec`. 함수 단위 원본 목록은 [functions.csv](evidence/functions.csv), 대입/이벤트/호출 위치는 같은 폴더의 CSV에 있다. 아래는 사용자 기능과 내부 운영 기능으로 묶은 보존 목록이다. 문서의 “활성”은 코드 연결이 있다는 의미이며 실제 계정으로 끝까지 검증했다는 뜻이 아니다.

위치 약어: **I**=`index.html`, **C**=`js/cloud-sync.js`, **W**=`js/workspace-profile.js`, **M**=`js/project-model.js`, **P**=`js/project-ui.js`, **R**=`js/workflow-reform-v17.js`, **G**=`js/google-tasks-sync.js`. 데이터 약어: T=tasks, L=templates, Pj=projects, S=settings, H=holidays. TD는 [기술부채](02-technical-debt.md)의 ID다.

## 홈·업무 화면

| 기능 ID / 기능 | 구현 위치 및 주요 호출 관계 | 관련 데이터 | 상태 / 위험 |
|---|---|---|---|
| F01 홈 오늘/이번 달 요약·완료율 | I:4976 renderHomeOverviewV21 → renderHome 래퍼; I:11994 renderMonthlyAllTasksV12 | T.status/start/end/deadline/actualComplete, H | 활성. 여러 renderHome 래퍼·전체 순회(TD-06/19) |
| F02 오늘·기한초과·이번 주·긴급 필터 | I:5166 taskMatchesHomeFocusV25 → homeFocusTasksV25 → openHomeFocusV25 → task table | T.urgent, 일정, S | 활성. 홈과 업무 목록 필터 의미 보존 필요 |
| F03 달력 월 이동·업무·휴일 표시 | I:2916 renderCalendar, I:12107 테마/달력, P:996 홈 휴일 개선 | T, H, S.calendarMonth | 활성. 테마·모바일 재수정(TD-21/22) |
| F04 간트차트 기간/주·월·분기·반기·유형 필터 | I:2257 ganttWindowV4, 2731 renderGantt, 4369~4418 필터 | T, S.gantt*, 선택 대분류 | 활성. 기간 계산·모바일 fold 중첩 |
| F05 홈 위젯 표시·이동·크기·기본 배치·복원 | I:10202~11340 layout/editor/visibility 함수군 → saveState | S.homeWidgetLayoutV113 및 visibility 계열 | 활성. V113~117 교체 체인, pointer lifecycle(TD-19/21) |
| F06 진행/완료 목록 전환·프로젝트 통합 | I:6158 currentTaskViewV35 → R:434 updateSplit → R:292 renderProjectCards | T, Pj.workflowClosedAtV174, S.taskListViewV35 | 활성. 원래 projectPage는 숨김; 통합 화면 보존 |
| F07 정렬·대분류/상태 필터·선택/전체선택 | I:2868/3668/5363 visible rows, I:8141 정렬, R:147/410 | T, 선택 ID Set, S, 검색 값 | 활성. 보이는 행과 선택 대상 불일치 회귀 주의 |
| F08 일반 업무 상세 등록·수정 | I:2031 openTaskForm → 저장 handler → saveState/recalcLinks; I:6059,12201 최종 보정 | T, checklist, link, repeat, notes, owner | 활성. 전역 폼 래퍼 14곳, UI DOM에서 값 수집 |
| F09 빠른 업무 등록 | I:11548 openQuickTaskV119 → collectQuickTask → state.tasks.push → saveState | T name/category/owner/start/end/urgent | 활성. 격리 폼 표시·메모리 등록 관찰; 인증 저장 E2E 미검증 |
| F10 업무 복제 | I:11634 cloneManualTaskV119 → duplicateTaskV119 → 저장/렌더 | T, 새 ID/체크리스트, 참조 flag | 활성. 반복·project 소속 해제 범위 검증 필요 |
| F11 단일·선택·시리즈 삭제 | I:1963 deleteTasksByIdsV2, 5758/5778 휴지통 wrapper | T, generatedKey, suppressedAutoKeys, trash snapshot | 활성. 프로젝트 삭제와 정책 불일치(TD-02/24) |
| F12 완료·진행·보류·준비·예정 상태 | I:1918 effectiveStatus → I:4675 persistTaskStatusV18; 체크 완료 gate | T.status/actualComplete/checklist | 활성. 표시 상태와 저장 상태 구분 필요 |
| F13 완료업무 재개·과거 날짜 보존 | I:7399 reopenCompletedTaskLocalV18 → 저장/목록 갱신 | T.status/actualComplete/일정 | 활성. 프로젝트 별도 재개 경로와 통일 필요 |
| F14 체크리스트 편집·체크·진행률·모달 즉시 저장 | I:1817 openChecklist + I:4430/4754/6466/7448/11676 wrapper; P:424 projectTaskModal | task checklist{id,text,done,owner,dueDate} | 활성. stale 객체·IME·중복 handler(TD-06/09) |
| F15 업무 공문 제목·메모·수행자료 | I:4422 scheduleRelatedDocumentSaveV15, 6456 flushRelatedDocumentLocalV1, 6548 draft capture | T.relatedDocumentTitle/notes, 문서명 검색 | 활성. 공문 본문 서버 보관/분석 기능은 아님 |
| F16 날짜 입력 축약·달력 입력·종료일 유형 | I:4810 normalizeCompactDateV20, 6037 setupTaskEndUiV32; M:13 date | start/end/deadline, end rule | 활성. I/M 날짜 parser 차이(TD-11/12) |

## 라이브러리·일정·프로젝트

| 기능 ID / 기능 | 구현 위치 및 주요 호출 관계 | 관련 데이터 | 상태 / 위험 |
|---|---|---|---|
| F17 라이브러리 일반/프로젝트 구분·목록·검색 | I:3115 openDbForm, R:612 type filter → dbVisibleRowsV10 → renderDbTable | L.libraryKindV175/linkedSteps, selection | 활성. flatten legacy row와 root-only 통합(TD-19) |
| F18 라이브러리 등록·수정·삭제·복제 | I:3115/4284/5769/5926; P:684 editor wrapper | L, 변경 영향/버전, 관련 T | 활성. 삭제 시 이력 연결 해제·휴지통 보호 범위 |
| F19 라이브러리 상세·수행방법·자료·연계 단계 | I:3296 openDbDetailV6 → P:571 showProjectLibraryV181 → R:684 최종 wrapper | L.methodBlocks/attachments/linkedSteps/checklist | 활성. 여러 상세 renderer가 겹침; 직접 단계 링크 일부 차이 |
| F20 라이브러리 선택 등록·시작 단계 선택 | I:4059 openDbRegisterModalV10 → createManualDbChainV10 또는 createProjectFromLibraryV175 | L→T/Pj, groupId, dbManualRootTemplateId | 활성. 저장만으로 등록되지 않는 정책 보존 |
| F21 텍스트/사진/파일 형태 수행방법 편집 | I:2152 renderMethodBlocksViewV2, 3169 rblocks → makeMethodImageBlock/makeMethodFileBlock | methodBlocks{text/image/file}, Drive/local ref | 활성. 빈 파일·권한·XSS·직렬화(TD-01/13/16) |
| F22 라이브러리 첨부 양식·사진 열기/다운로드 | I:5891~5941 → C:createFileBlock/openDriveFile | L.attachments, name/mimeType/size/fileId | 활성. 원본 포함 여부와 metadata 구분 |
| F23 라이브러리 수정 영향 미리보기 | I:5703 previewTemplateImpactV29 → showTemplateImpactV29 → save | L schedule signature, 기존 T | 활성. 신규 project recurrence까지 일관 적용 여부 검증 |
| F24 템플릿 최근 버전 보기·복원 | I:5727/5828/5843 → C:1036/1077 | meta stage7TemplateVersion, snapshot 최대 10 | 활성. 복원도 새 변경, 보존 테스트 필요 |
| F25 일반 수동 반복 시리즈·종료일 | I:2007 recurrenceDatesV2 → I:2214 rebuildRepeatSeriesV3; P:816 종료일 선택 | T.repeat/seriesId/repeatRawDate, repeatUntilV181 | 활성 경로 혼재. 새 엔진과 종료·기간 규칙 차이 |
| F26 명시 등록 라이브러리 rolling 반복 보충 | P:882 ensureOccurrences → saveState/renderTaskTable wrapper | repeatOriginV181/repeatScheduledDateV181, L.cycle | 활성. 월/반기 필드 누락·중복 위험(TD-03) |
| F27 주/월/분기/반기/연간·선택 월·휴일 처리 규칙 | I:1882/2501/6798~6887, P:658/733 | L.cycle/cycleMonths, 분기·반기 편집행, weekday, holidayShift* | 활성 입력과 일부 불완전 실행. 설정 보존과 버그 수정 구분 |
| F28 DB 자동생성/과거 누락 보충/3·6·9·12개월 정리 | I:5123,6917,7201 → R:36~40 no-op | autoSchedule/activeFrom/autoGeneratedThrough/suppressedAutoKeys | 최종 비활성. 필드는 legacy 호환용; 기능 복구를 임의로 하지 않음 |
| F29 자동생성 중복방지·생성키 | I:1879/2531/3750, C:generatedKeys/commitTransaction | generatedKey, stableTaskId, lock/tombstone | 구형 canonical 경로 보유. V181에는 동일 보호가 없음 |
| F30 연계 업무 자동 날짜 cascade | I:3002 linkedStageDatesV152 /3051 recalcLinks → I:4223 changeTaskStartV5 | task.link, parentId, basis, offset, override | 활성 legacy 경로. anchor 의미 차이, 20 pass 제한(TD-11) |
| F31 프로젝트 생성·편집·총괄·대분류·기간 | P:211 openEditor → P:389 saveEditor → M.normalizeProject/reconcile | Pj, stage.taskId ↔ T.projectStageId | 활성. 전역 state·객체 참조·업로드 coupling |
| F32 단계 추가·삭제·순서·상대 시작/끝 | P:302/316/360 → M.addStep/removeStep/moveStep/applyRelativeDates | stages, relativeStartDays/relativeEndDays | 활성. 완료 제거·일정 순서·음수 offset(TD-02/10/12) |
| F33 단계 참여자·체크 담당자·기한 | P:226/233/316 → M.normalizeProject/buildStageTask | participants, checks.owner/dueDate/done | 활성. owner는 이름 기반, checklist mirror 정합성 |
| F34 단계 체크 자동완료·수동완료 | P:424 projectTaskModal → M.setCheck → saveState | T.checklist/status/actualComplete, Pj | 활성. 체크 없는 단계 수동완료 및 전체완료 조건 |
| F35 프로젝트 종료·완료목록·재개 확인 | R:328 closeProjectV174,350 completedProjectCheckGuardV174 | workflowClosedAtV174, 모든 단계 상태 | 활성. 폼 수정 경로에서는 조용한 재개 가능(TD-02) |
| F36 프로젝트/단계 첨부와 수행방법 보기 | P:361/368/424/616; I:4105 library 등록 | stage.resources/methodBlocks, task.projectResources | 활성. 정보 중복·원본 열기·고아 업로드(TD-13/16) |
| F37 프로젝트 폐기 | P:412 deleteProject → M.removeProject → saveState | Pj와 연결 T 전체 제거 | 활성. 확인창은 있으나 일반 휴지통과 다름(TD-02) |

## 검색·이력·인수인계

| 기능 ID / 기능 | 구현 위치 및 주요 호출 관계 | 관련 데이터 | 상태 / 위험 |
|---|---|---|---|
| F38 통합 업무·라이브러리 검색·필드 필터 | I:5323/5347 → I:7036/7053/7110 | 업무명·담당자·메모·공문명·체크리스트·방법 text·분류 | 활성. 원본 PDF/HWP/OCR 검색은 미구현(TD-25) |
| F39 검색 결과 더보기·한글 IME 입력 안정화 | I:5391/7110,7132 bindImeSafeSearchLocalV151 | batch limit, localStorage 검색 preference | 활성. handler 중복과 필터 임시 변경 주의 |
| F40 완료/과거 목록과 DB별 수행 이력 | I:5421/5426/5440 → openDbDetailV6 | T.actualComplete, L/source refs, history batch | 활성. 삭제·복원 후 참조와 완료일 정렬 검증 |
| F41 변경이력 조회 | I:1802 renderHistory → C:959 loadChangeLogs | changeLogs 최근 300, actor/reason/fields | 활성. 최근 변경 로그이지 완전 감사원장 아님 |
| F42 휴지통 보기·업무/템플릿 복원 | I:5753~5824 → C:1005~1035 | meta stage7Trash, T/L snapshot, suppressed keys | 활성. restore 후 보조문서 삭제 실패 처리 존재 |
| F43 라이브러리 건강 진단·누락 업무 복구 | I:5500 inspectDbHealthV28 → 5614/5630 → schedule/repair | L/T/H/expected specs | UI/코드 존재. 일부 생성 함수 no-op으로 실제 효과 축소; 종속 호출 특성화 필요 |
| F44 연간 업무 계획 월별/분류별/행렬 | I:5948 annualPlanEntriesV31 → 6007 renderAnnualPlanV31 → 6003 drilldown | L 주기·월, T/owner, H | 활성. 실제 생성 일정과 계획 규칙의 불일치 검사 |
| F45 인수인계 데이터 및 HTML 다운로드 | I:8741 buildHandoverDataV110 → 8852 buildHandoverHtmlV110 → 9335 export | L/Pj, 완료 tasks, allTasks, categories, file metadata | 생성기는 ZIP에서 활성; 독립 HTML 다운로드 버튼은 I:11448에서 숨김. 읽기전용 문서 |
| F46 인수인계 문서 내 검색·분류·상세·인쇄 | I:8852~9333 생성 HTML 내부 script/style | export된 snapshot, 검색 UI | 활성. 별도 코드 사본이므로 앱 검색과 자동 동기화 안 됨 |
| F47 첨부 원본 포함 ZIP·누락 보고 | I:9429 resolver →9487 prepare→9549 ZIP→9609 export; I:11946 provider | Drive/local blob, archivePath, missing count | 활성. 원본 접근 권한·대용량 메모리(TD-18) |

## 연결·설정·보조 기능

| 기능 ID / 기능 | 구현 위치 및 주요 호출 관계 | 관련 데이터 | 상태 / 위험 |
|---|---|---|---|
| F48 Google 로그인·허용 사용자 판별 | W:250/263/294 → C:642 authentication gate | 중앙 Auth user, allowedUsers enabled | 활성. 서버 rules 실제 적용은 미검증(TD-14) |
| F49 개인 업무공간 자동 연결/캐시 | W:389/592 load profile →562 private sign-in → C:642 | Drive profile schema1, 개인 Auth credentials, projectId | 활성. 프로필 없으면 중단; 새 사용자 등록 UI 없음 |
| F50 로그아웃·계정 전환 | C:794 onclick → stopRealtime/signOut → W:346 | Auth, profile cache, token caches, IndexedDB | 활성. legacy token/object URL/cache 잔존 검증(TD-15) |
| F51 Firestore 실시간·오프라인 캐시·연결 표시 | W:59 persistent Firestore → C:910 snapshots → C:1108 apply | recordMaps/shadowMaps, S, state | 활성. offline batching과 UI readiness를 분리해야 함 |
| F52 저장 큐·충돌 완화·변경 로그 | I:1736 → C:1118/1136 → transaction/batch → makeLog | serialized maps, revision, generatedKeys | 활성. 완전한 optimistic conflict detector는 아님 |
| F53 Google Drive 권한·폴더·업로드 | W:323 → C:1395/1404/1523 | drive.file/appdata scope, folder marker, file metadata | 활성. 재시도·50MB 제한은 보존 |
| F54 Drive 이미지 표시·열기·다운로드 | C:1603/1635/1643/1655 | driveFileId, object URL cache | 활성. 능동 문서와 세션 cleanup(TD-01/17) |
| F55 구 Cloud Drive 원본 연결·복구 | C:174/208/247/1672 → I:12117 설정 버튼 | legacy Firebase project match, legacy token, old file IDs | 활성 조건부. 복구는 파일 생성/메타 변경하므로 분석 중 실행하지 않음 |
| F56 Google Tasks 연결·목록 선택·양방향 merge·해제 | G:237/148/267/311 → W:642 token; I:12176 bridge | settings googleTasksV15, task link/fingerprints, checklist Google IDs | **로딩 실패**. 모델 누락. 의도는 보존하되 정상 기능으로 표기 금지 |
| F57 대분류·색상·담당자 프로필·이름 변경 | I:3387,3517,3533,3570,3582 | categories/owners, categoryColors/ownerProfiles, T/L 참조 | 활성. 이름 기반 식별자 변경 ripple |
| F58 휴일 직접 등록·수정·삭제·기본 seed | I:1690 seed,2164 renderHolidays,3416 add; P:996 홈 휴일 | H.date/type/reason/source, 주말 | 활성. 2026년 seed이며 향후 연도 자동 보장 안 됨 |
| F59 온라인 공휴일 불러오기 | I:2166~2168 →2173 버튼 연결 | holiday API 설정 잔재 | **stub**. 로컬 버전 사용 안 함 안내만 출력 |
| F60 메뉴 표시·홈 통계/진행률·위젯 설정 | I:6067/6281/6608/7283, R:42 메뉴 재수정 | S visibility/layout 계열 | 활성. 숨긴 화면 접근 fallback과 project toggle 잔재 |
| F61 테마·Kitty·Shinchan·모바일 카드 | I:3353,7625~8012,8460,9907; P:144, R/CSS | S.theme 및 data-v7-theme, assets | 활성. data URI 중복과 조건·색상 일관성 |
| F62 PC 표 정렬·모바일 입력/필터/작은 화면 | I:4489/4539/6385/8092/10075, R:166 board | DOM viewport, sort state | 활성. 320~1440px/키보드/회전 회귀 필요 |
| F63 JSON 구조 백업 | I:1890 exportJson → download | schema11 state, backupMeta, 일부 file ref scrub | 활성. 첨부 원본·비밀 프로필 백업이 아님; 라벨 Local Beta 잔재 |
| F64 JSON 복원/클라우드 병합 | I:2175 → C:1367 importState,1389 mergeById | T/L/Pj/H/S + migration | 활성. schema/완료·참조 검증 부족(TD-04) |
| F65 CSV 업무/DB 내보내기 | I:1893,2175 bind → I:11457 hideCsvExportV118 | T/L 텍스트 | 코드/handler 잔존, UI 숨김. 삭제는 별도 판단 |
| F66 설치 안내/PWA metadata | I:4253 beforeinstallprompt, manifest.webmanifest | icon/start_url/display, browser install prompt | 조건부. 서비스워커/완전 오프라인 실행 미구현 |
| F67 IndexedDB 캐시·파일·fallback | I:1703~1723 | data/files stores, state:projectId, localStorage fallback | 저장 보조 경로 활성; 독립 localCloudShim과 readLocalState는 미호출 후보 |
| F68 개인정보 안내 | privacy.html, C:593 안내 링크 | 정적 설명 | 활성 정적 문서. 구현과 정책 일치 별도 확인 |
| F69 신규 개인 Firebase 생성·rules 문자열·연결 시험 | W:462~598 export 함수군 | generated credentials, meta/workspaceSetup | 현재 UI 진입 없음. 참고/legacy 기능; 운영 시험 호출 금지 |
| F70 자동 migration·구형 손상/상속 복구 | I:1901/2372/2809/3470/3773/5013, migrateState wrappers | legacy T/L/S flags·반복/linked 필드 | 초기화·일부 render에서 실행. 사용자 명령 없이 상태 수정 가능 |

## 호출 관계를 검증할 때의 주의점

1. `renderSettings`가 21회 대입된다는 사실과 21번 같은 저장이 수행된다는 주장은 다르다. wrapper가 base를 호출하는지, 완전 교체인지 확인한다.
2. `bind()`의 초기 선언 중 일부는 같은 script의 후속 선언에 가려진다. 최종 wrapper를 통한 handler 연결로 판단한다.
3. no-op으로 바뀐 함수라도 먼저 캡처된 참조가 있을 수 있다. 이번 다섯 함수의 최종 값은 확인했지만 전체 callsite의 실행 도달성을 증명한 것은 아니다.
4. 인수인계 HTML 내부 JavaScript는 문자열 생성 코드다. 앱 AST 호출표만으로 포함된다고 주장하지 않는다. F46은 생성 템플릿을 직접 읽고 분류했다.
5. 이 목록의 활성 기능에 테스트 ID를 연결하는 것이 다음 단계의 보존 계약이다. 숨김/비활성 기능은 사용자 의도 확인 없이 다시 활성화하거나 삭제하지 않는다.
