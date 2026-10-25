# 운영 배포 절차 — 승인 후에만 실행

현재 릴리스 브랜치는 검증 후보이며 이 문서의 명령을 이번 작업에서 실행하지 않는다. 시작 전 `release/phase10-predeploy-fixes`의 최종 성공 CI SHA를 고정하고 원격 `main`의 새 커밋·차이를 다시 확인한다.

1. 운영 담당자에게 별도 테스트 계정/Drive 폴더/개인 Firebase 프로젝트와 현재 Rules 원본을 받는다. 기존 자료는 읽기 전용 preflight로 점검하고 승인 UID·잠금 불일치·부모 revision·미확정 journal·오프라인 작업을 분류한다. JSON 구조 백업과 첨부 원본 포함 ZIP의 manifest·누락 목록을 각각 검증한다.
2. 승인된 격리 환경에서 해당 SHA의 정적 파일을 `/work-manager-cloud/`로 제공해 OAuth·Drive·인증·프로젝트 동시 저장·반복 잠금·백업·로그아웃 및 모바일 동선을 실측한다. 운영 Rules는 아직 바꾸지 않는다.
3. 사용자에게 편집 중지/모든 탭 새로고침/오프라인 대기·journal 확인 시간을 안내한다. 새 HTML의 `wm-release=predeploy1`과 버전 쿼리로 새 JS·WebP를 불러오는지 확인한다. 옛 HTML+새 클라우드 모듈의 쓰기 거부는 예상 동작이며, 옛 HTML+옛 JS가 남은 사용자는 규칙 전환 전에 갱신해야 한다.
4. 명시적 승인 뒤 고정 SHA를 `main`에 병합한다. 예시: `git fetch origin && git switch main && git pull --ff-only origin main && git merge --ff-only origin/release/phase10-predeploy-fixes && git push origin main`. `--ff-only`가 거부되면 멈추고 현재 `main`과 diff를 다시 검토한다. Pages 배포 SHA와 자원 요청/404를 확인한다.
5. 새 클라이언트의 실계정/실제 테스트 자료 저장·백업·복구 UI를 확인하고, 구형 탭과 미확정 명령의 전환 완료를 확인한다. 그 후에만 실제 기존 Rules diff·롤백본·승인 UID를 검토해 강화 Rules 적용을 별도로 승인받는다. 테스트 규칙의 `demo-work-manager`/`synthetic-owner`를 운영에 그대로 배포하지 않는다.
6. 배포 직후 완료 이력, 반복 생성키, 프로젝트 단계, 체크리스트, Drive 원본, JSON/ZIP, 충돌·복구 상태, 계정 전환을 모니터링한다. `blockers.md`의 전환 조건이 남으면 Rules 적용을 보류한다.

Pages 코드·Firestore Rules·Drive 파일은 하나의 원자적 배포가 아니다. 성공 확인 전 사용자 편집을 재개하거나 미확정 저장을 성공으로 표시하지 않는다.
