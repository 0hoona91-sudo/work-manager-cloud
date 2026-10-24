# 7단계 진행 기록 — 아직 미완료

기준 6-F: 3d3f81ac055a32d6951c41eb5c41b0b9da2faad2. 브랜치 refactor/phase7-google-file-adapters.

A: Google Tasks 전용 모듈, UI/CSS, 앱 브리지, saveState 이벤트 래퍼, OAuth scope·인증 함수를 제거했다. 누락 모델은 만들지 않았다. 과거 session token만 지우며 업무/설정/원격 자료를 삭제하지 않는다. Tasks legacy 업무·체크·완료 이력·설정의 JSON/Firestore codec 보존 검사를 추가했다.

계약 변경: BUG-01은 이전 missing import false/expected true XFAIL에서 활성 Tasks 참조 부재 PASS로 전환한다. 이전 관측은 phase6f/after-results.json 및 phase2 문서에 보존되어 있다. STATIC-02는 누락 Tasks 모델 예외 없이 모든 import를 검사한다. AUTH-12는 Tasks 인증을 호출하지 않고 Drive 토큰 격리와 폐기된 credential 정리를 검사한다. PROVISION-07은 남은 단일 auth importer와 Tasks 모듈 부재를 확인한다. 나머지 계약은 유지한다.

남은 작업: B Drive 인증, C 첨부 업로드/실패 복구, D ZIP·백업·인수인계 안정화. 최종 phase7 Actions와 baseline guard(위 네 계약 변경 명시), 전체 회귀 및 필수 최종 문서는 아직 미완료다. 기존 6-F workflow는 이 브랜치에서 실행되지 않는다. 7단계 종료/8단계 착수 판정은 아직 할 수 없다.

재개 시 이 중간 커밋의 A 변경을 보존하고 B부터 진행한다. 기존 성공한 전체 371개를 시작 시 반복하지 않는다. 운영 접근/배포/원격 Tasks 삭제는 수행하지 않았다.

## 작업 B 완료 — Drive 인증 안정화

작업 A 커밋 f76181cabf4db8eb9e5dd44c940d58986096b7fd를 유지했다. B에서 Tasks 실행/제거 경로는 변경하지 않았다.

확인·수정한 결함:
- 중복 Drive/legacy 재승인 요청을 각각 하나의 진행 중 promise로 공유한다. 취소/실패 후에는 잠금을 해제하여 명시적 다음 요청을 허용한다.
- logout/계정 정리 후 같은 계정으로 돌아오는 경우에도 이전 OAuth 응답을 설치하지 않도록 인증 세대를 검사한다. 정상 만료 검사/저장소 차단과 세대 무효화를 분리했다.
- cloud 인증 대기·401 재승인·업로드 인증 재시도에서 업무공간 변경을 검사하여 이전 작업을 새 업무공간에서 다시 보내지 않는다. 이미 전송된 HTTP 요청을 취소/되돌렸다는 보장은 없다.
- legacy 토큰 메모리/session 복원은 Google UID/email뿐 아니라 프로젝트 범위도 비교한다. 범위 없는 과거 legacy 캐시는 현재 프로젝트에서 재승인이 필요할 수 있다.
- 기존 45분 보수적 만료와 정확한 만료 경계, UID 연결, 로그아웃 정리, 401 한정 재승인/403 비자동재승인 정책을 유지한다. 현재 Drive 토큰은 Google 계정 권한이며 Firebase 비밀번호와 분리된다. 같은 Google 사용자의 새 작업은 정상 재사용하되 이전 업무공간의 진행 중 명령은 차단한다.

검증: `node tests/run.cjs --credentials-only` 최종 **31 PASS / 0 FAIL / 0 XFAIL / 0 XPASS / 0 NOT_RUN**. 기존 AUTH-01~22 및 신규 DRIVE-AUTH-01~09. work-b-results.json에 코드 해시와 결과를 보존한다. 실행 당시 HEAD는 작업 A이며 미커밋 B 소스 해시가 검증 대상을 나타낸다. 초기 AUTH-22 저장소 차단 회귀는 세대 갱신을 실제 자격증명 무효화로 한정하여 수정했다. 업로드 인증 검사도 실제 workspace 오류를 요구하도록 확인했다.

모두 로컬 모의 Auth/Google API 및 함수 검사다. 독립 Actions, 실제 Google OAuth/Drive 파일 요청, Emulator를 이번 B에서 실행하지 않았다. 따라서 이 31건을 실계정 성공으로 해석하지 않는다. 전체 회귀는 C/D 통합 후 실행한다. 업로드 성공 후 저장 실패/고아 파일/취소 복구는 C 범위이며 이번에는 구현하지 않았다.

B 완료. 다음 진행 지점은 **작업 C 첨부파일 안정화**다. 전체 7단계 완료 판정은 보류한다. 운영 main/Firestore/Drive/Rules/배포, schema11 및 사용자 자료는 변경하지 않았다.
