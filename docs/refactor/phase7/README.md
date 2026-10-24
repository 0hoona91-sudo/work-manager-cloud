# 7단계 구현 및 검증 기록

아래 A~D 중간 기록의 미완료/다음 작업 문구는 각 커밋 당시 상태를 보존한 것이다. 최종 판정과 CI 결과는 문서 마지막 및 verification.md를 기준으로 한다.

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

## 작업 C — 첨부 업로드와 참조 저장 분리

`attachment-store.js`를 실제 cloud createDriveBlock에 연결했다. 기존 IndexedDB data store에 계정/개인 Firebase 업무공간/파일 SHA-256별 기록을 먼저 확정하고, Drive generateIds로 받은 파일 ID를 전송 전에 보관한다. 불명확한 응답의 재시도는 같은 ID를 조회하며 신규 ID를 만들지 않는다. 업로드 실패 자동 DELETE를 제거했다. 업로드 완료(uploaded)와 Firestore 서버 확정 뒤 참조 연결(linked)을 분리한다. 실패/취소/계정 변경 기록과 원본은 남긴다. 일반 로컬 초기화도 이 기록을 보존한다.

상단 **첨부 저장 확인**에서 현재 계정의 파일 ID·상태·현재 참조를 확인할 수 있다. 같은 원본 파일을 다시 선택하면 동일 ID로 확인·재시도한다. 자동 고아 파일 삭제, 다른 계정 기록 노출, 원격 삭제는 없다. 이미지 캐시는 계정 정리 시 해제하고 늦은 응답의 이전 업무공간 URL 설치를 차단했다. 기존 HTML/SVG 다운로드 정책은 유지했다.

집중 결과: 26 PASS(기존 SEC-01~16 실제 Chromium + 신규 ATTACH-01~10 모의 저장/Drive 계약). 변경된 캐시 정리 경로의 AUTH/DRIVE-AUTH 31 PASS도 확인했다. 실제 Drive generateIds/권한/업로드는 미검증이다. 동일 브라우저 동시 요청과 재실행 기록을 보호하나 여러 탭/기기의 업로드 원자성을 보장하지 않는다. Drive와 Firestore 전역 트랜잭션은 없다. 서버 크기 확인은 내용 전체 해시 검증이 아니며, journal이 삭제된 브라우저는 이 복구를 사용할 수 없다. 초기 참조 없는 파일도 자동 삭제하지 않는다. 작업 D와 최종 통합 검증은 다음 순서로 진행한다.

## 작업 D — 원본 포함 여부·무결성·용량 제한

`backup-files.js`를 기존 JSON 내보내기, 인수인계 ZIP, Drive 원본 읽기에 연결했다. JSON은 모든 기존 첨부 ID(과거에는 일부 localFileId 삭제), schema11 업무/완료/생성키/Tasks legacy 필드를 보존하며 backupMeta에 **외부 원본 미포함**과 참조 목록을 표시한다. JSON 내부에 이미 있던 인라인 데이터는 그대로 보존한다. 기존 JSON 가져오기/충돌 UI와 완료 이력 보호 정책은 변경하지 않았다.

인수인계 ZIP은 실제 파일 경로·원본 ID·크기·MIME·SHA-256·누락 사유를 manifest.json에 넣는다. 다른 ID의 동명 파일은 순번 경로로 구분하고 같은 ID는 한 번만 읽는다. 일반 업무·프로젝트·단계·라이브러리 참조를 수집한다. 원본 누락 시 파일명/화면/문서에 **부분 백업**을 표시한다. 인수인계 ZIP은 읽기 전용 배포 자료이며 자동 복원 포맷이 아니다. 데이터 복원에는 JSON과 기존 명시적 충돌 확인을 사용한다. ZIP 파일을 서버에 자동 업로드하거나 파일 ID를 재발급하지 않는다.

파일 50MiB/ZIP 총량 200MiB/1000개 제한, 잘못된 경로·정규화 중복 이름·ZIP 한도를 버퍼 생성 전에 검사한다. Drive는 Content-Length를 신뢰하지 않고 스트림 누적 한도도 적용한다. 이미 읽은 원본을 보유한 상태에서는 추가 읽기를 보수적으로 제한한다. 취소 버튼은 다음 처리·최종 다운로드를 중단하며 이미 전송된 HTTP를 되돌린다고 주장하지 않는다. 계정 변경 후 결과 다운로드를 차단한다. 이전 독립 토큰 fallback 대신 검증된 cloud provider만 사용한다.

집중 검사: 기존 백업/데이터 검사 + FILE-BACKUP-01~11 = **44 PASS / 2 XFAIL / FAIL·XPASS·NOT_RUN 0**. XFAIL은 범위 밖 BUG-08/09 그대로다. 실제 Chromium UI 1건과 ZIP 바이트/CRC/한글 경로 검사 포함, Drive는 모의 호출이다. 제한된 Drive 읽기를 연결한 뒤 기존 SEC/ATTACH 26건도 PASS. 원본 hash는 사용자가 압축 해제 후 대조할 수 있으며 자동 ZIP 원본 복원/검증기는 만들지 않았다. 전체 통합 Actions는 다음 작업이다.

## 최종 완료 판정

A Google Tasks 제거, B Drive 인증, C 첨부 복구·참조 보호, D JSON/ZIP·인수인계 개선을 보존했다. 중간 커밋 A `f76181c`, B `2e2f30d`, C `d74ce77`, D `2c27c9b`는 재작성하지 않았다.

최종 CI에서 발견된 IDENT-17 회귀는 `6cdf90170cb1451adeea3289152f308f8f765174`에서 수정했다. controller의 DOM 초기화를 브라우저 bootstrap으로 분리하고 첨부 복구 UI 중복/로그아웃/늦은 계정 응답 보호를 추가했다. 기존 IDENT-17의 ID·기대값은 그대로다.

[최종 Actions 40133113289](https://github.com/0hoona91-sudo/work-manager-cloud/actions/runs/40133113289) 성공: **406건 / PASS 403 / XFAIL 3 / FAIL 0 / XPASS 0 / NOT_RUN 0**. 신규 UI 검사 1건 때문에 이전 405건보다 하나 증가했다. SDK/Emulator 60 PASS, Chromium 56 PASS(8건 중복). 실계정 OAuth·Drive 요청은 실행하지 않았다.

주요 변경 파일: index.html, js/cloud-sync.js, js/workspace-profile.js, 신규 js/attachment-store.js·backup-files.js, Google Tasks 전용 모듈 삭제, 관련 테스트 및 .github/workflows/phase7-files.yml. 이번 CI 복구의 코드 변경은 cloud-sync.js UI 초기화 경계와 신규 UI 검사/등록에 한정했다. 기존 완료·반복·백업·journal·ID 계약과 371개 기준 검사 ID를 유지했다.

6-F 기준 `3d3f81ac055a32d6951c41eb5c41b0b9da2faad2`는 결과 브랜치의 조상이다. 원격 main은 `091dbecd701153e7e1880bd6bb84a277b789c58f`를 유지한다. 운영 데이터/Drive/Rules/Pages는 변경하지 않았다.

**7단계 개발 완료, 8단계 개발 착수 가능**으로 판정한다. 운영 반영 승인을 뜻하지 않는다. 실제 OAuth·Drive API, 구형 캐시/대기 쓰기 및 운영 규칙 적용은 별도 승인·검증 대상이다. 위험과 롤백은 deployment.md, 검사별 결과와 증거 한계는 verification.md 및 after-results.json에 기록했다. B/C/D의 기존 집중 결과 파일을 보존했다.
