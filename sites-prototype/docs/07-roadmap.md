# 전체 업무관리 기능 이전 설계

기존 데이터는 이전하지 않는다. 기존 앱은 기능/UI 참고로 유지하고, 신규 데이터 모델과 서버 권한 경계 위에 기능을 단계적으로 재구현한다. 운영 GitHub Pages와 새 Sites는 별도의 배포 대상이다.

## 먼저 끝내야 하는 실제 플랫폼 연결

1. 공식 Sites 도구가 있는 환경에서 starter와 실제 runtime/API binding을 확인한다.
2. ChatGPT 플랫폼 신원 → 내부 사용자 UUID → 모든 DB/API owner 검사 연결을 완성한다. 불변 식별자 제공 여부와 이메일 변경/재할당 정책을 확정한다.
3. D1 schema와 Repository 계층을 연결하고 OAuth flow 소비/갱신 경쟁을 원자적으로 처리한다. Python 프로세스 lock은 분산 worker lock으로 가정하지 않는다.
4. Google OAuth 운영자 설정 및 제한된 두 실계정으로 인증·파일 검증을 끝낸다.
5. Sites에 배포 없이 버전을 저장한 후 실제 공개 범위를 확인하고 첫 배포를 진행한다. 기존 GitHub Pages의 브랜치/배포 설정을 바꾸지 않는다.

이 단계를 통과해야 “Sites에서 실제 사용 가능한 1차 시험판”으로 판정한다. 현재 코드는 그 전의 독립 실행 검증판이다.

## 기능별 재구현 순서

| 단계 | 기존 기능 참고 | 신규 데이터/서비스 | 완료 조건 |
|---|---|---|---|
| 2. 기본 업무 | index의 tasks/상태/담당/분류/검색 | tasks 확장, categories, labels, user_settings. 모든 키에 owner 경계 | 등록·수정·완료·삭제/휴지통, 검색/정렬/필터, 재로그인 지속성, 타 사용자 API 차단 |
| 3. 체크리스트·프로젝트 | project-model, project-ui | projects, stages, checklist_items, task_links. 복합 `(id,owner_id)` 관계 | 단계 순서, 완료/재개 규칙, 날짜 검증, 프로젝트와 독립 업무 구분. 일괄 변경 원자성 |
| 4. 업무DB·매뉴얼 | templates, linkedRules, manualBlocks | templates, template_versions, manual_blocks, attachment_links | 템플릿과 수행 이력 분리, 버전별 복원, 첨부 권한/보관 정책 |
| 5. 반복 일정 | generatedKeys, recurrence 확장 | schedule_rules, generated_occurrences, holidays | `(owner_id,rule_id,occurrence_date)` unique로 중복 생성 방지. 사용자의 등록 전 자동 생성 금지, 완료 이력 보존 |
| 6. 달력·간트·대시보드 | index, workflow-reform | 날짜 범위 조회 API, 집계, 레이아웃 설정 | Asia/Seoul 기준 날짜 정책, 휴일·연휴·윤년·역전 날짜·기간 필터 검증. 큰 데이터 pagination |
| 7. 인수인계·백업 | ZIP/export, trash/version | export_jobs, audit_logs, trash, revision | 사용자 범위 내 데이터/파일만 export. 유효기간·파일 정리, 다운로드 재인증. 복원 시 owner 재부여 |
| 8. 외부 연동 | google-tasks-sync | provider_links, sync_cursors, idempotency keys | Google Tasks는 별도 최소 scope와 추가 동의. 충돌 정책/재시도/권한 철회/중복 방지 |

## 모듈 원칙

- UI는 화면 상태와 DOM에 집중하고, 상태 변경을 명시적 API로 보낸다. 전역 함수 monkey patch나 MutationObserver 기반 업무 규칙을 재사용하지 않는다.
- `IdentityProvider`는 검증된 플랫폼 신원만 반환한다. Google 연결은 앱 신원을 대체하지 않는다.
- `TaskRepository`/`AttachmentRepository`의 공개 메서드는 owner context를 필수로 받는다. 임의 user_id를 받아 실행하는 관리자 기능을 일반 API에 노출하지 않는다.
- `DriveProvider`는 server-side token 및 attachment metadata만 받고 remote ID를 외부 입력에서 직접 수락하지 않는다.
- 날짜/반복/단계 계산은 I/O 없는 도메인 함수로 만든다. 기존 `project-model.js`의 사례를 회귀 테스트 참고자료로 쓰되 새 저장소 모델과 분리한다.
- 데이터 충돌은 `revision`을 사용한 optimistic concurrency로 감지한다. 실시간 구독은 필요성과 런타임을 확인한 후 도입하며, Firestore로 되돌아갈 필요는 없다.
- 모든 외부 서비스 작업에는 중복 방지 키, 재시도 정책과 잔여 파일 정리를 설계한다. 현재 작은 시험판의 synchronous Drive 요청을 대용량 백업/장시간 작업에 그대로 사용하지 않는다.

## 운영 준비

운영 전 추가할 항목: 사용자/파일 용량 quota, rate limit, 암호화 키 rotation, 계정 삭제와 Google revoke, DB 백업·복구, 감사 로그의 개인정보 최소화, 보존 기간, 접근성, 오류 안내, DB migration runner, 지원 브라우저 테스트. 새 개인정보 안내에는 ChatGPT 이름/이메일, 업무 데이터, Google 이메일 및 Drive 파일 처리 목적을 설명한다.

사용자별 분리 회귀 테스트는 모든 단계에서 유지한다. 다른 사용자 UUID를 넣은 조회·수정·삭제·첨부·내보내기 공격을 API 수준에서 검사한다. 관리자/편집자의 저장소 접근 권한과 일반 방문자 격리를 구분한다.

팀 공유가 나중에 필요하면 user_id를 무조건 workspace_id로 바꾸지 않는다. `workspaces`, `memberships`, 역할별 권한 모델을 새로 설계하고 개인 공간이 기본 비공개라는 원칙을 유지한다.
