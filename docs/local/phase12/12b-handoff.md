# 12-B WIP 인계 — 2026-10-26

이번 체크포인트는 **작업 보존만** 수행했다. 제품 코드 수정, 실패 테스트 수정, 새 기능 개발, 전체 회귀검사 및 배포는 하지 않았다.

## 기준과 보존 범위

- 작업 디렉터리: `/workspace/work-manager-cloud`
- 브랜치: `local/phase12-standalone-html`
- 재개 전 HEAD 및 원격 개발 브랜치: `9b7ef62e4102bf9f18870db34a77cb434699182f`
- 최신 클라우드 원본/운영 기준: `a8eff0b8b47575bc7ad1db96fb0eda669d27ca96`
- 체크포인트 전 기존 추적 파일 변경은 없었고, 아래 12-B 파일은 모두 미추적 상태로 남아 있었다. 유실되지 않았다.
- main, 운영 Pages, Firebase/Rules, Drive 및 운영 데이터에는 접근·변경하지 않았다. Git main SHA 조회만 수행했다.

## 보존 파일

| 파일 | 현재 상태 |
|---|---|
| `local/build.cjs` | 정확한 hotfix1 Git 객체에서 최신 UI/엔진을 읽어 로컬 어댑터를 연결하는 빌더 |
| `local/src/folder-store.js` | PC 폴더 스냅샷, HEAD 해시 대조, 쓰기 전 journal, 큐·권한·배타 잠금 검사 초안 |
| `local/src/local-ui.js` | 폴더 선택/재연결, 저장 상태, 미확정 입력 보관 및 확정본 선택 UI 초안 |
| `tests/local/fs-fixture.cjs` | Node 임시 디스크를 쓰는 모의 FSA 핸들 |
| `tests/local/run.cjs` | 로컬 저장 및 백업 계약 검사 9개 |
| `docs/local/phase12/12b-contract-results.json` | 실제 검사 결과, 실패 포함 |
| `docs/local/phase12/12b-wip-checks.json` | 체크포인트 문법검사 및 제외 산출물 정보 |
| `local/.gitignore` | 미완성 생성물 `dist/`의 커밋 제외 |

기존 `local/dist/업무관리.html`(8,600,892 bytes)과 `build.json`은 **작업 디스크에 그대로 보존**했으나 임시 생성물이므로 커밋에서 제외했다. 해당 HTML은 최신 `folder-store.js`를 포함하지 않는 오래된 빌드다. 완성판으로 배포하거나 테스트 증거로 사용하면 안 된다. 다시 빌드 가능한 소스를 커밋했다. 새 ZIP은 제작하지 않았다. 검토한 체크포인트 소스/증거에는 실제 비밀번호·토큰·개인자료를 발견하지 않았다. 테스트의 업무/Drive ID는 합성 문자열이다.

## 실제 구현된 범위와 검증 수준

- 최신 hotfix1 HTML/CSS/JS/이미지를 묶는 빌더와 저장 경계 치환 코드가 존재한다. 운영 소스 자체는 변경하지 않았다.
- `data`, `attachments`, `holidays`, `backups`, `journal` 디렉터리 구성 코드, 실제 파일 쓰기 후 재읽기, SHA-256 대조, 이전 스냅샷 보존 코드가 있다.
- 모의 FSA + 실제 Node 임시 디스크에서 재연결/ID·참조 보존, 두 번째 작성자 거부, 권한 상실, 스냅샷 실패, receipt 응답 실패 후 복구 확인, 손상 HEAD 거부, 저장 큐/외부 변경 차단, schema/중복 ID 거부를 확인했다.
- 폴더 연결 UI, handle 전용 IndexedDB, 저장 상태/복구 안내 UI는 구현 초안이며 **브라우저 실행 검증 전**이다. 전체 업무 기능 이식 완료를 의미하지 않는다.
- 첨부 원본 저장/공식 공휴일 갱신은 12-C 미구현으로 명시하고 신규 첨부 저장을 거부하는 어댑터를 작성했다. 기존 첨부 참조를 지우는 코드는 추가하지 않았다.

## 검사 결과와 현재 오류

체크포인트에서 소스 5개 `node --check` 통과. 기존 임시 HTML의 inline script 57개도 Acorn 파싱 통과했다. 이는 동작 검증이 아니다.

`node tests/local/run.cjs`: **PASS 8 / FAIL 1 / XFAIL 0 / XPASS 0 / NOT_RUN 0**, 종료 코드 1. NOT_RUN 0은 이 명령에 등록한 9개에 한정하며 아래 미실시 검사까지 완료했다는 뜻이 아니다.

실패: `tests/local/run.cjs:14`, `LOCAL-B-08`.

- `completionHistory: [{id:'history'}]` fixture에 유효한 `reopenedAt`, 완료 원본 `snapshot`이 없다.
- `js/backup-safety.js:77–78`에서 `재개 시각이 잘못되었습니다`, `완료 이력 원본이 잘못되었습니다`를 반환한다.
- 이번 보존 작업에서는 fixture나 assertion을 수정하지 않았다. 정상 완료 이력 fixture로 다시 검증하기 전 백업 통합을 PASS로 볼 수 없다.
- LOCAL-B-01도 단순 이력 문자열의 저장·재읽기 검사다. 유효한 완료 이력 구조에 대한 전체 보호 검사로 확대 해석하지 않는다.
- 앞선 receipt 실패 처리 변경(`.review.json` 확인/기록)은 현재 소스에 남아 있고 LOCAL-B-05는 PASS다. 오래된 dist HTML에는 이 변경이 반영되지 않았다.

## 정확한 재개 위치와 최소 우선순위

1. `tests/local/run.cjs`, LOCAL-B-08의 합성 완료 이력을 기존 schema11 계약에 맞게 구성한다. `js/backup-safety.js` 검증을 완화하지 않는다. 해당 검사를 다시 수행하고 다른 오류가 드러나면 먼저 원인을 확인한다.
2. `local/build.cjs`로 재빌드하고 생성된 HTML이 현재 어댑터를 포함하는지 대조한다. `local/src/local-ui.js`의 `connect` → `finish` → `wm-data-ready` 및 빌더의 `loadState`/`saveState` 연결을 실제 Chromium에서 집중 검사한다.
3. 브라우저 폼 저장/취소, 휴지통·설정 보조 기록, 백업 미리보기/승인, 실패 시 안내, 반복 생성과 프로젝트 계산 연결을 검증한다. 저장 operationId 전달·중복 억제 계약도 연결 수준에서 아직 미검증이다.
4. 모의 transport 검사와 Windows 네이티브 FSA 검사를 분리한다. Windows에서 새 저장 모듈의 exclusive 잠금, HTML 재실행, 권한 재요청, 디스크 오류·강제 종료 복구, 다중 창 충돌을 검증한다.
5. 필요한 공통 엔진 회귀검사 후 실행 안내·기능 비교·제약 문서와 배포 ZIP을 완성한다. 12-C 첨부 원본/공식 공휴일 기능은 이번 체크포인트에 없다.

## 미실시·제약

- 현재 12-B 번들의 실제 Chromium UI 통합, 네트워크 차단 동작, CRUD·검색·달력·프로젝트·반복·휴지통·백업 사용자 흐름은 미실시.
- 새 폴더 저장 구현의 네이티브 Windows Edge/Chrome FSA, 배타 writer 동작, 전체 브라우저 종료 후 재연결, 디스크 부족/전원 차단은 미검증.
- 사용자 확인: Windows Edge 153에서 **12-A 실험**의 file 실행, 폴더 쓰기/읽기, HTML 재실행 재연결 성공. 이것은 새 12-B 전체의 PASS가 아니다. Chrome 및 브라우저 프로세스 전체 종료는 미검증이다.
- Cloud의 기존 file:// 관리자 정책 차단 실험은 반복하지 않았다. HTTP/모의 FSA 검사를 네이티브 PC 폴더 저장 성공으로 보고하면 안 된다.
- journal/snapshot은 누적되며 자동 정리는 없다. 파일시스템 전체 원자성·fsync·전원 장애 복구는 보장하지 않는다. 최초 저장의 미확정 상태 및 손상 HEAD는 수동 복구가 필요하다.
- 기존 클라우드 440개 회귀검사는 이번에 재실행하지 않았다. 클라우드 성공 결과를 로컬판 성공으로 간주하지 않는다.

## 안전한 재개

기존 브랜치에서 `git status`, 최신 체크포인트 로그와 이 문서부터 확인한다. 미커밋 변경을 보존하고 reset/force push를 하지 않는다. 실패 fixture의 최소 수정부터 진행하며 전체 앱 재분석을 반복하지 않는다. 합성 임시 폴더만 사용하고 운영 JSON/Drive/Firebase에 쓰지 않는다. 현재 WIP는 사용자 업무를 맡길 완성판이 아니다.
