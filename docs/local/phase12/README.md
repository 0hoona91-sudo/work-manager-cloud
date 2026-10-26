> **12-B① 집중 연결 검증:** LOCAL-B-08 fixture 정상화 후 로컬 계약 검사 9 PASS. hotfix1 HTML 재빌드 및 inline script 57개 문법검사 통과. Chromium loopback + 모의 FSA에서 연결 전 저장 차단, 폴더 연결/상태 로드, 파일 저장, 저장 실패 표시 확인. Windows 실제 file://·네이티브 폴더 검증과 전체 UI 검증은 미실시. [구조화 결과](12b1-results.json). 독립형 완성판은 아직 아니다.

> **2026-10-26 현재: 12-B WIP 체크포인트, 완성판 아님.** Windows Edge 153의 12-A 성공은 사용자 확인으로 기록하며, 아래 12-A Cloud 환경 제약 기록은 과거 증거로 유지한다. 12-B 소스 구현이 진행됐으나 통합 검증은 미완료다. 현재 상태와 정확한 재개 위치는 [12b-handoff.md](12b-handoff.md)를 참조한다.

# 12단계 진행 상태 — 12-A 검증 보류

- 기준: `a8eff0b8b47575bc7ad1db96fb0eda669d27ca96` (`hotfix1`).
- 개발 브랜치: `local/phase12-standalone-html`.
- 완성된 독립형 업무관리 HTML은 아직 만들지 않았다. 12-B/C/D는 시작하지 않았다.
- 운영 main, Pages, Firebase, Drive, 기존 업무·첨부·journal은 변경하지 않았다.

## 확인한 제약

Codex Cloud의 실제 Chromium 154.0.8037.57에서 `file://` 페이지를 열면 `net::ERR_BLOCKED_BY_ADMINISTRATOR`가 발생한다. API 호출 전 탐색 자체가 차단된다.

관리 정책을 읽기 전용으로 확인했다.

- `/etc/chromium/policies/managed/urls.json`: URLBlocklist `*`; 허용 목록에 `file://` 없음.
- `/etc/chromium/policies/managed/misc.json`: DefaultFileSystemReadGuardSetting `2`, DefaultFileSystemWriteGuardSetting `2` (차단).

정책을 변경하거나 다른 실행 경로로 우회하지 않았다. HTTP 서버, IndexedDB/OPFS, 가짜 directory handle을 PC 폴더 저장 증거로 대체하지 않았다. **이 결과는 Windows Edge·Chrome의 file:// 지원 불가 판정이 아니라, 현재 검증 환경의 관리자 정책 제약이다.**

## 결과와 재개 지점

`12a-results.json`: PASS 0 / FAIL 0 / NOT_RUN 4. 파일 실행, 폴더 선택, 실제 쓰기·읽기, 재실행 재연결 모두 필수 조건 미검증이다. 제품 회귀검사는 재실행하지 않았다.

`node tests/local/file-access-probe.cjs`로 동일 환경 제약을 재현할 수 있다. 미검증 게이트는 종료 코드 2를 반환한다. 환경 정책이 그대로라면 반복 실행할 필요가 없다.

`local/12a-folder-probe.html`은 외부 의존성이 없는 최소 실험 도구다. 최신 클라우드 앱의 대체판이 아니다. Windows 검증 결과가 확보되면 **12-A 성공 여부부터 판단하고**, 성공할 때 최신 hotfix1 기반 12-B 이식을 시작한다. 공휴일 공식 자료 수집·로컬 첨부·백업 이관 기능도 그 이후이며 이번 결과로 구현됐다고 주장하지 않는다.

Windows 실행 안내는 `local/12a-README.txt`를 참조한다. 배포용 `local/phase12a-folder-probe.zip`에는 실험 HTML과 안내문만 들어 있다. 완성판 배포 ZIP이 아니다.
