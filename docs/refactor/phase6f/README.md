# 6-F 규칙 생성기 통합과 사전점검

기준은 원격 6-E `b1f448ec0620b0ccba4f3614d6335e04726e07a0`이다. 시작 시 원격 ref를 조회·fetch했고 새 `refactor/phase6f-rules-provisioning-preflight`를 정확히 이 SHA에서 생성했다. `git merge-base`도 같은 SHA를 반환한다. 기존 커밋/자료를 초기화하거나 main을 변경하지 않았다.

## 통합

`js/firestore-rules-policy.js`가 6-E에서 검증한 정책의 유일한 원본이다. 포괄적 recursive allow를 제거한 `workspace-profile.js:firestoreRulesForWorkspaceUid(uid, extraUids, projectId)`와 설정 안내 UI, Emulator 규칙 파일 모두 이 정책을 사용한다. projectId는 명시적으로 필요하며 누락 시 오류다. 기존 UID/추가 UID 인자 순서를 유지한다. 이전 두 인자 호출에 임의 프로젝트를 추정하지 않는다.

승인 UID는 1~128자의 영문/숫자/`._:@+-`만 허용한다. 빈 값·공백·따옴표·슬래시·제어 문자와 기타 사용자 정의 UID는 명시적으로 거부한다. Firebase가 허용하는 모든 custom UID 문자를 지원한다는 뜻은 아니다. 기본 UID와 추가 UID 19개까지 지원하며 중복은 제거한다. 프로젝트 ID는 Firebase 형식의 6~30자 소문자/숫자/하이픈을 검증한다. 허용되지 않은 입력을 필터링해 계속 진행하거나 전체 허용으로 대체하지 않는다. 문자열 인젝션은 입력 문법 제한과 JSON 문자열 생성으로 방지한다. 운영용 생성 경로에 테스트 UID/프로젝트 기본값은 없다.

생성기와 정책 검증은 DOM·Firebase·통신·저장소를 사용하지 않는다. 6-E의 canonical lock ID 계산, task/lock 상호 참조, tombstone, key 불변성, 부모 revision, 컬렉션별 allow 분리를 그대로 유지한다. 권한 ACL 외에 테스트 규칙의 데이터 보호 본문은 6-E와 같다.

## 실제 연결

- `provisionPrivateWorkspace`는 프로젝트 ID를 인증 요청 전에 검증하고 생성 결과에 일회성 `rulesGuidance`를 반환한다. `finalizeWorkspaceProvision`이 저장하는 profile schema는 그대로이며 규칙 텍스트를 프로필에 캐시하지 않는다.
- `workspaceRulesGuidance`는 최초 생성 객체와 기존 workspace profile에서 프로젝트/개인 Firebase UID만 골라 같은 안내를 만든다. 인증 UID/자격증명 UID가 다르면 거부한다. API 키·비밀번호·OAuth 토큰을 안내에 복사하지 않는다.
- 로그인된 앱 계정 영역에 **보안 규칙 안내** 버튼을 연결했다. 현재 개인 Firebase UID·프로젝트로 생성하며 추가 UID를 한 줄씩 입력할 수 있다. 결과는 읽기 전용 textarea로 표시하고, 오류 시 이전 출력을 비운다. 인증정보 정리 이벤트나 로그아웃 시 안내를 닫는다. 배포/복사 자동 전송 기능은 없다.
- 기준 저장소에는 신규 사용자 등록 페이지가 없고 provisioning 함수만 있었다. 신규 등록 흐름 전체를 새로 만들지 않았다. 기존 로그인·재연결·Firestore·Drive 흐름은 보존한다. 설정 함수와 실제 연결 화면의 안내 생성만 통합했다.
- cloud-sync, workspace-profile, Google Tasks importer의 URL 버전을 함께 맞춰 같은 페이지에서 인증 singleton이 두 번 로드되지 않게 했다. index의 관련 URL도 갱신했다. Google Tasks 모델 누락 BUG-01을 복구한 것은 아니다.

## 사전점검

`js/workspace-preflight.js:inspect({projectId, records, context})`는 승인된 별도 추출 자료나 합성 fixture를 **읽기만** 한다. `records`는 tasks/generatedKeys/checklistItems/templates/linkedRules 각각의 `{id, data}` 배열이며 원시 revision이 있어야 한다. serializeState 결과는 revision을 잃을 수 있으므로 이를 운영 원본 검증으로 쓰지 않는다.

점검 대상은 누락/소유권 불일치/비표준 잠금, 중복 key, tombstone 충돌, 부모 없는 체크, 비정상/누락 revision이다. 정상 tombstone은 보존할 정보로 분류한다. 캐시 정책 버전, offline 대기, 미확정 journal, 백업 충돌, snapshot 완전성은 호출자가 확인해 전달하며 불명확하면 검토 필요다. `ready`는 제공된 자료 범위의 결과일 뿐 배포 승인·운영 원본 무결성 증명이 아니다. 출력은 코드/심각도/컬렉션/문서 ID이며 비밀 필드를 덤프하지 않는다.

```js
const audit = require('./js/workspace-preflight.js');
const result = audit.inspect({projectId: 'demo-work-manager', records: syntheticRecords,
  context: {complete:true, clientPolicyVersion:'phase6f-rules-v1', hasPendingWrites:false,
    unresolvedJournal:0, backupConflicts:0}});
```

실제 자료 조회, 자동 수정/병합, 잠금 재발급, journal 삭제 기능은 없다. 앱이 자동으로 운영 자료를 스캔하지 않는다.

## 변경 파일

- 정책·안내·사전점검: `js/firestore-rules-policy.js`, `js/workspace-rules-ui.js`, `js/workspace-preflight.js`
- 기존 연결: `js/workspace-profile.js`, `js/cloud-sync.js`, `js/google-tasks-sync.js`, `index.html`
- 테스트: `tests/provisioning.test.cjs`, `tests/provisioning-browser.cjs`, `tests/credential-harness.cjs`, `tests/recurrence-emulator.cjs`, `tests/emulator/firestore.rules`, `tests/run.cjs`
- CI: `.github/workflows/phase6f-provisioning.yml`, `tests/phase6f-{prepare,ci,summary}.cjs`
- 결과: `docs/refactor/phase6f/`

저장 엔진, transaction 재평가, schema11, 업무/단계/생성키 ID, 완료 이력, backup/journal 보호 정책은 변경하지 않았다. 검증 결과는 [verification.md](verification.md), 승인 조건과 분류는 [deployment.md](deployment.md)에 기록한다.

## 최종 완료 판정

**6-F 완료 / 6단계 종료 가능 / 7단계 착수 가능.** 전체 371건은 PASS 367 / XFAIL 4 / FAIL 0 / XPASS 0 / NOT_RUN 0이며 실제 SDK/Emulator 60건이 PASS했다. [최종 Actions](https://github.com/0hoona91-sudo/work-manager-cloud/actions/runs/40101724617)의 성공 결과를 재사용했다. 중단 후 남아 있던 본 문서들을 보존·완성했으며 구현 변경이나 테스트 재실행은 하지 않았다.

검증 SHA `aad679222640b42f0cc4d39d9ce718826014b009`는 기준 6-E SHA의 후손이다. 최종 문서 커밋도 같은 브랜치에 추가하며 기존 커밋 재작성/force push는 하지 않는다. 운영 main은 `091dbecd701153e7e1880bd6bb84a277b789c58f`를 유지한다.

운영 실계정·실제 규칙·legacy 자료·구형 캐시/대기 쓰기는 승인 후 운영 전 통합검증 사항이다. 누락 잠금 보정, 자료 정리·마이그레이션, 실제 배포는 수행하지 않았다. 다음 예정 개발은 7단계 Google Drive·첨부파일·백업·Google Tasks 구조 정리이며 자동으로 추가 6단계를 만들지 않는다.
