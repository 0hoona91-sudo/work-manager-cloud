# 현재 브랜치별 변경 사항과 배포 기준

2026-10-23에 기존 HTTPS Git 인증으로 `git ls-remote --heads --tags origin`과 전체 원격 브랜치 fetch를 수행했다. 원격에 쓴 작업은 없다. 아래 ahead/behind는 `main` 기준이며, 분석 브랜치는 원격 main 추적을 해제해 두었다.

## 1. 전체 원격 브랜치

| 브랜치 | HEAD | main에만 / 브랜치에만 | 관계와 판단 |
|---|---|---:|---|
| main | `091dbecd701153e7e1880bd6bb84a277b789c58f` | 0 / 0 | 분석 기준, 최신 확인 Pages 성공 실행과 일치 |
| fix/project-library-relative-stage-dates-20261022 | `f1cfafb3b76099eb66751e3679513bb601de5352` | 6 / 6 | 공통 조상 `7b8aec1`; 커밋은 미병합이나 주요 파일 내용은 main에 반영됨 |
| fix/project-library-schedule-20261022 | `7b8aec11044d96fb08b9f43fdebfe9f722e9f87e` | 6 / 0 | main의 조상; 독자 후속 변경 없음 |
| revamp/01-baseline | `4d7d9f914b4683e05d540d4a732e3576816d37e9` | 22 / 0 | main의 조상; 기준으로 되돌리면 후속 기능 손실 |
| dev/sites-phase1 | `39c0c1a3685b6146176ba5e752d0832012dffe45` | 0 / 1 | main에 시험판 37파일, 3,291줄 추가. 운영 앱 파일 변화 없음; 참고 전용 |

원격 tag는 조회 결과 없었다. Git 커밋 시각이 더 늦다는 이유만으로 기능상 더 최신이라고 판단하지 않는다.

## 2. 상대일정 브랜치의 6개 커밋

| 커밋 | 의도 | 최종 main과의 내용 비교 |
|---|---|---|
| ff8d995 | 앞 단계 종료일 기준 상대 offset | `project-model.js`가 main과 동일 |
| 51e3c8b | 단계 offset 입력 노출 | main에도 해당 입력·바인딩 존재 |
| fe99e63 | 조건부 schedule markup 정정 | main에도 반영된 형태 |
| 9fd0bbf | 라이브러리 프로젝트 상세와 수행방법 | workflow 파일 동일; main UI는 V181 상세 화면으로 확장 |
| dddffc3 | editor lifecycle에 상대 계산 연결 | main의 openEditor/updateDateField/saveEditor에 연결 존재 |
| f1cfafb | 담당자 편집 중 offset 재초기화 억제 | main에도 반영된 형태 |

`git cherry`는 여섯 커밋 모두 `+`로 표시한다. 그러나 이는 commit patch-id 단위 판단이다. 이후 파일 전체 업로드로 동일 내용이 들어간 경우와 구분해야 한다. **Git 이력 미병합 ≠ 기능 미반영**.

두 브랜치 tip 간 차이는 7파일: nav 아이콘 6개와 `js/project-ui.js`뿐이다. main 방향으로 JS 619줄 추가/7줄 삭제다. `index.html`, `project-model.js`, `workflow-reform-v17.js`, 나머지 클라우드 모듈은 같다.

### main이 더 보유한 내용

- `$p('[data-stage-field]').forEach`를 `$$p(...).forEach`로 수정. 상대일정 브랜치에는 단일 요소 querySelector 결과에 forEach를 부르는 오류가 남아 있다.
- `installLibraryAndProjectEnhancementsV181`: 프로젝트 라이브러리 상세, 수행방법·첨부 보기, 폼 보정, 휴일 처리 옵션.
- `installRollingRecurrencesV181`: 명시 등록 업무의 반복 종료일·3개월 보충. 새 동작과 함께 TD-03의 결함도 포함한다.
- `installNavAndHomeHolidayEnhancementsV182`: 아이콘/홈 휴일 표시 개선. main 최신 코드의 996행 주석은 이전 document-wide observer/style 재수정의 무한 반복을 고쳤다고 설명한다. 현재 코드에는 그 전역 observer 대신 값 변경 guard가 있어, 과거 문제를 현재도 확정 발생한다고 보고하지 않는다.
- 상대일정 브랜치의 단계 모달 `prjLibraryViewV175` 직접 버튼은 main에 그 형태로는 없다. main에는 프로젝트 카드·라이브러리 상세의 대체 수행방법 진입점이 있다. 같은 클릭 동선까지 보존되는지는 후속 UI 특성화에서 확정한다. 버튼 부재만으로 기능 전체 누락이라 단정하지 않는다.

main 자체의 후속 커밋은 `8792430`, `d6803d2`, `6c4a7df`, `0e3572a`, `2128120`, `091dbec`이다. 메시지가 대부분 “Add files via upload”라서 메시지보다 파일 diff·브라우저 동작을 기준으로 추적해야 한다.

## 3. 실제 Pages 근거

| 확인 대상 | 결과 | 확인 수준 |
|---|---|---|
| 공개 저장소 HTML | defaultBranch=`main`, pagesUrl 확인 | 직접 확인 |
| [Actions 목록](https://github.com/0hoona91-sudo/work-manager-cloud/actions) | 최신 표시 Pages 실행 #68 | 직접 확인 |
| [실행 #68](https://github.com/0hoona91-sudo/work-manager-cloud/actions/runs/39765908194) | `main@091dbec`, Status Success, build/report/deploy 성공 표시, 배포 URL 일치 | 배포 실행 기준 확인 |
| [이전 실행 #67](https://github.com/0hoona91-sudo/work-manager-cloud/actions/runs/39764489418) | `main@2128120`, Success | 이전 기준 확인 |
| Pages source 설정 API / builds API | proxy CONNECT 403 | 미확인; 권한 부재나 사이트 장애로 단정하지 않음 |
| 운영 `https://0hoona91-sudo.github.io/work-manager-cloud/` | proxy CONNECT 403 | 현재 제공 바이트·캐시 상태 미확인 |
| `.github/workflows`, CNAME, .nojekyll | main 트리에 없음 | 동적 Pages 실행과 일치하나 source 디렉터리 설정을 대신 증명하지 않음 |

#68 트리거 시각은 2026-10-22 10:48 UTC, 한국시간 19:48이다. main 커밋 시각은 19:48:53 +09:00. 현재 운영 응답과 artifact를 직접 해시 비교한 것은 아니다.

## 4. 기준선 결정과 후속 절차

1. 현재 분석 SHA를 리팩터링 특성화 기준으로 사용한다. 기존 Pages 성공 이력과 가장 직접적으로 연결된다.
2. 수정 브랜치 전체 merge/cherry-pick은 하지 않는다. 위 차이 중 필요한 사용자 동작을 테스트로 표현하고 개별 반영한다.
3. `revamp/01-baseline`은 과거 데이터/스크린샷 비교용으로만 사용한다.
4. `sites-prototype`의 인증 경계·테스트 fixture 사고방식만 참고할 수 있다. 코드·DB schema·Sites identity·D1 migration은 가져오지 않는다.
5. 다음 단계 시작 시 `git ls-remote`와 Pages 최신 성공 실행을 다시 확인한다. main이 바뀌었다면 새 diff를 먼저 분석해 기준 SHA를 명시적으로 갱신한다.
6. 실제 배포 전에는 네트워크가 허용된 환경에서 Pages source branch/path, 배포 artifact SHA, 운영 파일 응답을 함께 검증한다. 이번 문서 변경만으로 배포하지 않는다.
