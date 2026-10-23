# Firestore 규칙 검토 범위

운영 Firebase 프로젝트에 접속하지 않았으므로 **현재 배포된 규칙은 미확인**이다. 확인한 것은 저장소 `js/workspace-profile.js`의 `firestoreRulesForWorkspaceUid(uid, extraUids)` 생성기다. 이 함수는 승인 UID 목록에 대해 `match /{document=**}`에서 read/write를 허용한다. 인증 사용자를 제한하지만 generatedKeys의 변경/삭제 불변성이나 업무와 잠금의 동시 생성을 강제하지 않는다. 이 함수 및 인증 구조는 이번에 수정하지 않았다.

`tests/emulator/firestore.rules`는 실행되지 않은 테스트용 검토안이다. synthetic-owner만 접근할 수 있고, 잠금 create는 demo-work-manager 키 및 같은 commit 후 존재하는 소유 task의 키 일치를 검사한다. 잠금 update/delete는 거부한다. 다른 컬렉션 허용 경로에서 generatedKeys를 제외하므로 wildcard가 잠금 제한을 무효화하지 않는다. 전체 허용 규칙으로 테스트를 우회하지 않았다. 실제 Emulator 실행은 다운로드 실패로 NOT_RUN이다.

운영 규칙 변경 전 확인할 사항:

1. 실제 개인 Firebase UID/공동 승인 UID와 Firestore 경로를 확인한다. 테스트 UID/프로젝트명을 운영 규칙에 복사하지 않는다. 다른 개인 프로젝트의 독립 인증/규칙도 각각 검토해야 한다.
2. 잠금은 승인 사용자 read, 검증된 create만 허용하고 update/delete를 거부한다. 과거 잠금 복원이나 백업 복원 시에도 기존 소유권을 바꾸지 않는지 확인한다.
3. 기존 재귀 wildcard allow와 좁은 match는 OR로 평가된다. 좁은 generatedKeys 제한만 추가하고 기존 전체 write 허용을 그대로 두면 잠금 제한이 작동하지 않는다. 승인 UID 정책은 유지하면서 겹치는 allow 범위를 분리해야 한다.
4. task → lock 역방향 강제도 필요하다. 현재 task ID와 잠금 ID는 기존 계약상 서로 다를 수 있고 Rules에서 stableKeyId의 base64url 변환을 재현할 수 없다. 이번 테스트 규칙은 lock → task의 getAfter만 검사하므로 승인 클라이언트가 잠금 없이 task를 쓰는 우회까지 막지 못한다. 향후 검증 가능한 lock 문서 참조 또는 별도의 제한 정책이 필요하며, 이번에는 기존 schema/ID를 일괄 변경하지 않았다.
5. 신규 규칙은 5-B① 등 오래된 앱의 offline batch 생성과 충돌할 수 있다. 배포된 클라이언트 버전/캐시 전환 정책을 먼저 검토한다. 이번에는 규칙이나 사이트를 배포하지 않았다.
6. get/getAfter 문서 접근 예산은 transaction 전체와 각 쓰기에 모두 적용된다. 현재 신규 선점은 청크당 최대 10묶음이고 320 변경 초과 묶음은 거부한다. 추가 운영 규칙 조회가 있다면 더 작은 한도를 검증해야 한다.
7. 합성 테스트에서 다른 UID의 잠금 read, 다른 workspace key create, 기존 잠금 update/delete 거부를 실제 Emulator로 확인한 후 운영 검토로 넘긴다. 이번 결과에 해당 보안 보장이 실측됐다고 표시하지 않는다.

규칙 검토·테스트 파일은 운영 설정과 분리되어 있으며 자동 배포 스크립트나 Cloud Functions는 추가하지 않았다.
