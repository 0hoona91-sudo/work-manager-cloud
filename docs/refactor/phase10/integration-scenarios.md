# 합성 통합 시나리오와 검증 경계

## 두 클라이언트·저장

`INTEG-EMU-01`은 실제 Firebase SDK/Firestore Emulator의 독립 client 객체 두 개가 같은 체크 항목을 동시에 바꾸는 경우를 검사했다. 한 요청은 확정되고 다른 요청은 `conflict`이며, 서버 부모 revision은 2, 체크 항목은 1개, 완료 이력은 원본 그대로다. 기존 실제 SDK `SAVE-EMU-01~08`은 동일/독립 필드 수정, 트랜잭션 재실행, 체크 의미 충돌, 응답 유실 후 읽기 확인, 완료 업무에 대한 오래된 편집, 업무공간 전환 차단을 검증한다. `ATOMIC-EMU-01~13`은 반복 생성키 잠금과 동시 생성을, `JOURNAL-SDK`는 실제 Chromium IndexedDB와 Emulator를 이용한 재시작·확인 경로를 검사한다.

이는 두 **SDK client**와 합성 사용자에 대한 검증이다. 실제 두 물리 기기·장기 오프라인·Google 재로그인을 입증하지 않는다. 프로젝트 단계 전체 저장의 동시 편집은 일반 업무 `task.update` 서버 3방향 검사 적용 대상이 아니므로 미검증/배포 위험으로 남긴다. 새 규칙이 구형 체크리스트 저장을 거부하는 경우는 `PROVISION-EMU-08`에서 재현했다.

## 백업→복원→인수인계

`INTEG-BACKUP-01`은 schema11 초기 업무·프로젝트·첨부 참조에서 JSON 구조 백업을 만든 뒤 현재 업무의 완료·재개 이력을 늘리고 과거 백업을 복원 미리보기한다. 취소 시 저장 호출 0, 명시 승인 후 복구 스냅샷→write→publish 각 1회, 현재 완료일·이력·업무/프로젝트/첨부 ID 및 generatedKey 보존을 확인한다. ZIP은 합성 원본 하나의 SHA-256과 누락 원본 하나의 이유를 manifest에 기록하고 `complete=false`를 유지한다. JSON의 `externalOriginalsIncluded=false`와 구분한다. 실제 Drive 파일은 읽지 않는다.

이번 테스트에서 정상 JSON의 `backupMeta.attachments`를 실제 첨부로 오인해 거부하던 결함을 재현·수정했다. 실제 첨부 참조의 ID/메타 충돌 검사는 유지하며 기존 백업 집중 46건이 통과했다. ZIP은 자동 복원 형식이 아니다. 실제 대용량 파일·운영 계정 권한은 검증하지 않았다.

## 모바일·자원·산출물

`INTEG-UI-01`은 실제 Chromium 320/390/768/1440px 홈 문서 넘침, 키보드 빠른 업무 열기, 입력 focus 이동, 한글 조합 입력, 취소 시 원래 버튼 focus 복귀·업무 불변을 확인한다. `INTEG-ASSET-01`은 Pages `/work-manager-cloud/` 하위 경로에서 Hello Kitty WebP를 네 너비 모두 200으로 읽는다. `INTEG-ASSET-02`는 정적 HTML/CSS의 로컬 상대 경로 파일 존재를 확인한다. `INTEG-ARTIFACT-01`은 비밀 설정·토큰·private key 및 debug/source-map의 흔한 패턴을 검사한다. 다른 브라우저, 실제 Pages CDN/캐시, 전체 스크린리더 동선은 미검증이다.
