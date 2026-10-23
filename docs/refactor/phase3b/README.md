# 3-B 인증정보 저장 보안 개선

기준은 `refactor/phase3a-attachment-security`의 `468bf5a11ea807586c2ae0a1c6c234def6f43590`이며 결과 브랜치는 `refactor/phase3b-credential-security`다. 전체 시스템 분석을 반복하지 않고 업무공간 연결과 인증정보 저장 경로만 변경했다. 운영 API 호출, 배포, main 병합은 수행하지 않았다.

## 기존 흐름과 변경 후 흐름

기존 호출 순서는 `bootstrapCloud → authenticateBuildingAndWorkspace → initBuildingIdentity → Google 로그인/서버 allowedUsers 확인 → loadCachedWorkspaceProfile → connectPrivateWorkspace`다. 캐시 연결이 불가능하면 `ensureBuildingDriveAccess → loadWorkspaceProfile → connectPrivateWorkspace`로 진행한다. 이 순서와 Drive의 기존 프로필 파일을 유지했다.

| 항목 | 기존 | 변경 후 |
|---|---|---|
| localStorage 업무공간 캐시 | Drive 프로필 전체 복제. 개인 Firebase 비밀번호 및 임의 추가 필드 포함 가능 | app/schemaVersion, Google UID/email, 허용된 Firebase 설정 필드, 개인 Firebase UID/email만 저장. 비밀번호·임의 token 필드 제외 |
| 과거 비밀번호 캐시 | 로그인하지 않아도 장기 잔존 | 모듈 로드 즉시 최소 메타데이터로 변환. 잘못된 값은 캐시 키만 제거. Drive 원본 프로필은 변경하지 않음 |
| 새로고침 연결 | 캐시의 비밀번호 또는 이미 로그인된 privateAuth 사용 | Firebase SDK의 기존 Auth 복원을 기다리고 기대 UID가 맞으면 재사용. 세션이 없으면 기존 Drive 프로필을 읽어 비밀번호 인증 후 다시 최소 메타데이터만 보관 |
| Google Drive 토큰 | building/cloud 두 sessionStorage 키에 중복 저장, UID 누락/잘못된 expiry 검사 약함 | building 캐시를 기준으로 사용하고 cloud 중복 키 제거. 정확한 현재 Google UID 및 유효한 숫자 만료시각을 요구 |
| legacy Drive 토큰 | 메모리 토큰은 만료·계정 재검사 없이 반환, session은 email 비교만 수행 | 메모리/session 모두 현재 Google UID/email/만료를 검사. 기존 UID 없는 캐시는 재사용하지 않음 |
| Google Tasks 토큰 | 별도 sessionStorage 캐시 | 별도 권한 구조 유지. 현재 사용자·expiry 타입 검사 강화, 계정 전환/로그아웃 시 제거 |
| 로그아웃/계정 변경 | 전체 프로필 캐시 잔존 가능, private/legacy 세션 정리 경로 분산 | 프로필·로그인 힌트·앱 토큰 캐시 제거, private/legacy SDK Auth signOut, cloud 메모리 참조·구독 정리. Google Auth observer로 다른 탭의 계정 변경도 감지 |
| 오류 로그 | 일부 인증/Drive 경로에서 원본 오류 객체 출력 | 해당 경로는 고정 진단 문구만 기록. 프로필·토큰·SDK 오류 객체를 덤프하지 않음 |

Firebase의 `apiKey`는 클라이언트 프로젝트 연결 설정으로 최소 캐시에 남는다. 비밀번호나 OAuth bearer token과 같은 비밀 인증정보로 취급해 제거하면 프로젝트 연결이 깨진다. 값을 새로 만들거나 콘솔에 출력하지 않았다. 데이터 접근은 기존 Firebase Authentication과 서버 보안규칙에 계속 의존한다.

## 인증과 저장의 경계

- `rememberWorkspaceProfileCache`/`readWorkspaceProfileCache`는 허용목록으로 새 객체를 만들며 비밀번호를 반환·저장하지 않는다. 소유 Google UID/email과 현재 검증된 Google 계정의 일치를 요구한다.
- `validateWorkspaceProfile`은 필수 필드의 문자열 타입과 소유자 정보를 검사한다. Drive 원본은 비밀번호가 필요한 기존 schemaVersion 1을 유지한다. 로컬 복원용 메타데이터만 명시적으로 비밀번호 부재를 허용한다. Firestore/원격 프로필 스키마 변경은 없다.
- `connectPrivateWorkspace`는 SDK 세션 복원 완료를 기다린다. 비밀번호 없는 캐시에서 새 로그인을 시도하지 않고 `app/workspace-reauth-required`를 반환해 기존 Drive fallback을 사용한다. 다른 private UID는 로그아웃하며, 로그인 전후 Google 계정도 다시 검사한다.
- Google 로그인, Drive 권한 요청, Tasks 권한 요청의 기존 Firebase SDK 및 OAuth scope를 유지했다. 재인증 팝업 결과가 다른 계정이면 token 저장을 거부한다. legacy Firebase의 UID는 lobby UID와 다를 수 있으므로 팝업 결과의 Google email과 진행 전후 lobby UID를 확인한다.
- 계정 변경 정리는 비동기 SDK 로그아웃 완료를 기다린다. cloud adapter는 정리 이벤트를 받아 이전 토큰·프로필·현재 사용자 참조를 해제하고 Firestore 실시간 구독을 중단한다. 화면은 기존 로그인 안내로 돌아가며 재로그인 후 새로고침한다.
- SDK 로그아웃 실패도 앱 캐시 정리를 막지 않으며 성공으로 숨기지 않는다. SDK 세션까지 반드시 제거됐다고 주장하지 않는다. 오류가 지속되면 새로고침 후 로그아웃을 재시도해야 한다.
- 현재 Drive token의 원래 만료시간을 cloud 복사본에서 다시 45분 연장하는 구조를 없앴다. 현재 token은 45분, legacy는 50분의 기존 보수적 TTL을 유지하며 만료/비정상 값/다른 계정의 값은 제거한다. 서버가 더 일찍 철회한 토큰의 유효성을 로컬 시각만으로 보증할 수는 없다.

## 테스트와 결과

새 설치나 프레임워크 없이 기존 도구를 사용한다.

```sh
node tests/run.cjs --credentials-only  # 인증 모의 테스트 22개
npm test                             # 기존 49개 + 신규 22개
```

결과는 `test-results/credential-results.json`, `test-results/phase3b-results.json`에 기록된다. 기존 `--attachments-only`와 strict 모드의 분류 기준도 유지한다.

| 실행 | 총수 | PASS | FAIL | XFAIL | XPASS | NOT_RUN |
|---|---:|---:|---:|---:|---:|---:|
| 수정 전 최초 인증 검사 | 18 | 3 | 15 | 0 | 0 | 0 |
| 수정 후 인증 검사 | 22 | 22 | 0 | 0 | 0 | 0 |
| 수정 후 기존 검사 | 49 | 37 | 0 | 12 | 0 | 0 |
| 수정 후 전체 | 71 | 59 | 0 | 12 | 0 | 0 |

처음 18개 테스트를 운영 코드 수정 전에 작성하고 [before-results.json](before-results.json)에 실패를 보존했다. 이후 SDK 비동기 복원·외부 계정 변경·cloud 정리 이벤트·저장소 사용 불가에 대한 4개 검사를 보강했다. 수정 후 전체 결과는 [after-results.json](after-results.json)에 있다. 신규 보안 검사에 XFAIL을 사용하지 않았다. 기존 XFAIL 12개는 정상 통과와 별도이며 수정하거나 삭제하지 않았다.

**AUTH-01~22는 실제 함수 코드를 실행하지만 인증 SDK, Google OAuth, Firestore, Drive 전송, 브라우저 저장소를 대체한 모의 테스트다.** 실제 Firebase SDK의 IndexedDB persistence나 Google 팝업을 검증한 결과가 아니다. `testPrivateFirestore`도 합성 DB에만 읽고 쓴다. 가상의 시간·UID·비밀번호·토큰만 사용하고 실제 계정·키·토큰을 주입하지 않았다. 기존 첨부 보안/핵심 UI 검사는 격리된 Chromium에서 실행한다.

| ID | 검증 |
|---|---|
| AUTH-01~03 | 정상 Google/Drive/개인 Firebase 연결, DB 바인딩, 새로고침 세션 재사용, 세션 만료 시 Drive fallback |
| AUTH-04~05 | 캐시 허용목록, 기존 비밀번호 제거, 임의 token 필드 배제 |
| AUTH-06~09 | 로그아웃/재로그인, 계정 전환, 소유자 불일치/부재, 잘못된 타입 거부 |
| AUTH-10~13 | 만료/잘못된 만료시각/UID 부재, Drive/Tasks/Firebase 정보 분리, 다른 계정 재인증 거부 |
| AUTH-14~18 | 로그아웃 실패 시 캐시 정리, 민감 오류 로그 차단, legacy 메모리 만료/계정 분리, 중복 토큰 저장 제거 |
| AUTH-19~22 | 지연된 SDK 세션 복원, 다른 탭 계정 변경 observer, cloud 구독/자격 참조 해제, 저장소가 막힌 환경 |

## 실제 계정으로 별도 검증할 사항

배포 전에 별도의 승인된 테스트 Firebase 프로젝트·Google 테스트 계정·합성 문서로 다음을 확인해야 한다. 이번 작업에서는 실행하지 않았다.

1. 기존 schema1 Drive 프로필과 SDK 로그인 상태가 있는 브라우저에서 최초 진입/새로고침한다. 비밀번호가 캐시에서 제거되고 불필요한 권한 팝업 없이 업무공간이 복원되는지 확인한다.
2. private Firebase 세션만 만료/로그아웃된 상황에서 Drive 권한을 요청하고 기존 프로필로 자동 연결되는지 확인한다. Drive 팝업이 브라우저에 차단되면 기존 권한 안내와 사용자 재시도 경로를 확인한다.
3. 테스트 문서를 Firestore에 저장·다시 읽고, 테스트 사진·첨부를 열어 본다. SDK 세션과 Firestore 보안규칙이 기대하는 개인 UID가 동일한지 확인한다.
4. Google A→B 전환, 다른 탭의 로그인 변경/로그아웃, 재인증 팝업에서 다른 계정 선택, 일반/legacy Drive 권한 복구를 확인한다. 이전 계정의 구독·토큰·private Auth가 남지 않아야 한다.
5. 정상 로그아웃/재로그인, 네트워크/SDK 로그아웃 실패를 각각 확인한다. 실패가 화면에 표시되고 앱 캐시는 제거되며, 실패 후 새로고침·재시도가 가능한지 확인한다.
6. Chrome/Safari/모바일의 실제 SDK persistence와 저장소 제한을 확인한다. DevTools 검사는 값 자체를 공유하거나 로그에 복사하지 말고 키 존재 여부와 비밀번호 필드 부재만 기록한다.

## 기존 사용자에게 미칠 수 있는 영향

- 정상적인 Google/개인 Firebase SDK 로그인 상태는 강제 초기화하지 않는다. 같은 계정의 새로고침은 비밀번호 없이 SDK 세션을 복원한다.
- private 세션이 없거나 캐시가 손상된 경우에는 Drive 접근이 필요하다. 기존처럼 캐시 비밀번호만으로 오프라인에서 새 private 로그인을 수행할 수는 없다. 필요한 권한 팝업이 한 번 더 나타날 수 있다.
- UID가 없는 과거 legacy token은 안전하게 계정에 묶을 수 없어 폐기한다. 이전 첨부를 열 때 기존 계정으로 Drive 재인증이 필요할 수 있다. 파일 ID·원본·프로필은 변경하지 않는다.
- 생성된 기존 정상 프로필은 Google UID/email을 포함한다. 그 필드가 누락되거나 변조된 비표준 프로필은 거부한다. 잘못된 프로필을 자동 생성/초기화하거나 운영 설정을 덮어쓰지 않는다. 해당 경우는 기존 Drive 백업과 소유자 확인이 별도로 필요하다.
- 계정 전환 시 이전 계정에 속한 앱 Auth 세션을 정리한다. 다른 탭에서 같은 업무공간을 사용 중이었다면 SDK의 정상 signOut 전파로 다시 로그인이 필요할 수 있다.

## 남은 보안 위험과 별도 개선안

- 기존 인증 구조는 Drive appDataFolder의 프로필에 개인 Firebase 비밀번호를 저장한다. private 세션이 없을 때 그 비밀번호를 클라이언트가 읽고 Firebase에 전달해야 한다. 이번에는 로컬 영구 사본과 불필요한 장기 참조를 줄였으며 **브라우저 메모리·네트워크에서 비밀번호를 완전히 제거한 것이 아니다**. 원격 비밀번호를 삭제/회전하지 않았다.
- Google/개인 Firebase의 SDK refresh/session 정보는 로그인 복원을 위해 SDK 관리 저장소에 남는다. Drive/Tasks bearer token도 짧은 수명의 탭 sessionStorage에 남는다. 같은 출처의 XSS/악성 확장이 있으면 여전히 노출될 수 있다. 임의 클라이언트 암호화로 이 문제가 해결된다고 주장하지 않는다.
- 연결 메타데이터의 UID/email과 공개 Firebase 설정은 여전히 localStorage에 있으며 로그아웃 시 제거한다. 이전 브라우저 백업이나 열린 구버전 탭의 메모리까지 이 코드로 소급 삭제할 수 없다.
- 로컬 TTL은 서버 token 철회 여부의 증명이 아니다. 실제 OAuth/SDK의 예외 처리와 브라우저별 동작은 위 실사용 검증이 필요하다. 이미 전송 중이던 요청까지 소급 취소하지 않는다.
- 비밀번호를 클라이언트에서 완전히 제거하려면 Google 사용자와 개인 Firebase 사용자 사이의 신뢰 가능한 서버측 연결 또는 인증방식 재설계가 필요하다. SDK persistence를 모두 memory/session으로 바꾸거나 Drive token을 메모리 전용으로 바꾸는 변경도 로그인/새로고침 UX에 영향을 준다. 이러한 변경은 이번에 수행하지 않고 별도 설계 대상으로 남긴다.

## 변경 파일과 롤백

- `js/workspace-profile.js`: 최소 캐시, 기존 캐시 정제, 소유자/타입 검증, SDK 복원, 계정·토큰 정리.
- `js/cloud-sync.js`: 중복 token 저장 제거, legacy token 검증, 자격 참조/구독 정리 이벤트, 인증/Drive 로그 축소.
- `tests/credential-harness.cjs`, `tests/credential.test.cjs`, `tests/run.cjs`: 모의 SDK/저장소·합성 계정, 신규 22개 검사, 전체 실행 및 결과 파일.
- `docs/refactor/phase3b/`: 이 문서와 수정 전후 실행 결과.

운영 배포하지 않았으므로 현재 운영 사이트에는 롤백 작업이 필요하지 않다. 코드 롤백은 별도 브랜치에서 이 3-B 변경 커밋을 `git revert <3-B-변경-커밋>`으로 되돌리거나 3-A 기준 `468bf5a`에서 검토용 브랜치를 만들면 된다. main을 reset하거나 Force Push하지 않는다. Firestore·Drive 원본을 복원/삭제할 필요도 없다.

로컬 캐시는 비밀번호가 없는 형태로 남으므로 구버전 코드가 캐시를 거부하고 기존 Drive fallback으로 다시 연결할 수 있다. 돌아간 구버전은 다시 비밀번호를 영구 캐시할 수 있다는 위험이 있다. 롤백 시 실제 로그인 경로를 먼저 검증하고, 캐시 삭제가 필요하면 해당 앱의 `workManagerWorkspaceProfileCacheV2` 키만 지운다. Firebase SDK 전체 저장소나 업무 데이터는 일괄 삭제하지 않는다.
