# 향후 AI 연결 및 PC 로컬판 사전 준비

현재 GitHub Pages + Firebase Auth + Firestore + Google Drive를 유지한다. Sites identity, Sites 시험판, D1 schema는 재사용 기반에 포함하지 않는다. 새 기능은 공통 업무 엔진과 application ports 위에 연결한다.

## 1. AI 업무비서의 기능 경계

| 예정 기능 | 기존 자산 | 준비할 계약 | 저장 동작 |
|---|---|---|---|
| 업무 검색·요약 | F38/F39 검색 field, tasks/templates/projects | SearchQuery/SearchResult, workspace scope, recordId·출처·현재 revision | 기본 읽기 전용 |
| 문서 분석 | Drive/local AttachmentRef, 수행방법 text | DocumentExtractor, MIME/크기/페이지 한도, text spans·page·hash | 분석 결과 초안; 원본 보존 |
| 법령 조회 | 현재 구현 없음 | LegalSourceProvider, 법령명/조문/시행일/조회시각/공식 URL/인용 위치 | 근거와 버전을 함께 저장 |
| 라이브러리 자동등록 지원 | F17~24 LibraryTemplate·impact preview | LibraryDraftProposal → validate → review → Register/UpdateLibrary command | 사용자 검토 후 명시적 저장 |

AI가 Firestore나 Drive 쓰기를 직접 호출하게 하지 않는다. 제안은 `proposalId`, `workspaceId`, `sourceRevision`, 변경할 필드, 근거, 누락 정보, 영향 범위를 포함한다. 적용 시 current revision과 비교해 오래된 제안을 거절하거나 다시 검토한다. 완료 이력·반복 규칙·첨부 삭제는 일반 텍스트 요약과 다른 권한/확인 경로를 사용한다.

## 2. 연결 방식

Pages는 정적 클라이언트이므로 공용 AI API secret을 JS/Firestore/localStorage에 넣지 않는다. Firebase ID token을 검증하는 별도 최소 서버 endpoint(예: 검증된 Firebase/Cloud Run 계열)를 후보로 두고, 인증·workspace 소유권·사용량 제한을 그 경계에서 집행한다. 호스팅 선택과 비용은 별도 설계 결정이다. Firebase/Firestore를 대체하는 새 DB를 전제하지 않는다.

```text
UI AI panel
  → application assistant service
  → AiProvider port (승인한 endpoint)
  → workspace-scoped 검색/문서 근거
  → 구조화된 proposal
  → 기존 command validation/impact preview
  → StateRepository.commit
```

클라우드 자료를 AI에 보낼 때는 선택한 업무·첨부 범위를 표시하고 필요한 텍스트만 전달한다. 프로필 비밀번호, OAuth token, sessionStorage, 전체 workspace dump는 입력 대상에서 제외한다. 문서 내부 지시는 데이터로 취급하고 tool 권한을 바꾸지 않는다. AI 응답의 HTML/URL은 기존 안전 렌더링 계약을 따른다.

법령은 공식 원문 출처를 우선하며 시행일과 과거 적용일을 구분한다. 검색 결과 제목만으로 조문을 확정하지 않고 원문·조문 번호·개정 상태·조회시점을 보존한다. 외부 링크 fetch는 허용된 출처와 content-type/size 제한을 적용한다. 지금은 법령 API나 AI provider 계정을 연결하지 않았다.

## 3. 검색·문서 데이터 준비

1. tasks/library/project의 안정 ID와 읽기 projection을 만든다. 출처 참조를 이름/배열 index만으로 남기지 않는다.
2. 원본 첨부는 provider ID + content hash + mimeType + byte length로 식별한다. 추출 text에는 extractor version, 원본 hash, 페이지/문단 위치를 저장한다.
3. PDF/DOCX/HWP/HWPX/이미지 OCR은 지원 여부를 실제 도구로 각각 검증한다. 확장자만 보고 text 추출 가능하다고 판단하지 않는다. 실행 파일/매크로를 실행하지 않는다.
4. 문서 index는 재생성 가능한 파생 데이터다. 업무 원본과 별도 schema/lifecycle을 가지며, 첨부 삭제·권한 변경 시 index도 제거/무효화한다.
5. 처음에는 기존 필드 검색을 공통 query로 정리한다. embedding/vector DB는 품질·규모를 측정한 뒤 선택한다. 별도 DB 도입이 AI 연결의 선행 조건은 아니다.
6. 검색 결과마다 근거 record/attachment/page와 권한 scope를 반환한다. 요약·자동등록은 이 근거를 유지한다.

## 4. PC 로컬 독립형의 현실적 선택

“별도 설치 없이 실행”과 “브라우저에서 PC 폴더 지속 저장”은 같은 제약이 아니다. IndexedDB는 브라우저 프로필 저장소이며 사용자 지정 폴더가 아니다. 현재 app에는 외부 Firebase SDK가 필수이고 localCloudShim은 연결되지 않아 그대로 다운로드해 독립형으로 쓸 수 없다.

| 방식 | 설치/실행 | PC 폴더 저장 | 한계와 판단 |
|---|---|---|---|
| Pages + File System Access API | 지원 브라우저에서 실행 | 사용자 선택 directory handle에 쓰기 | secure context·사용자 동작·브라우저 지원/권한 재승인 필요. 서비스워커 캐시 후 offline 가능성 검증 필요; 처음부터 완전 독립형은 아님 |
| 다운로드 HTML/JS 묶음 | 파일 열기 | 브라우저별 file origin·module·파일 API 제약 | 다운로드/파일 선택 대안은 가능하나 자동 폴더 저장을 모든 브라우저에서 보장 못함. 별도 spike 필요 |
| self-contained portable 실행파일 | 압축 해제 후 실행, 설치 절차 없음 | native adapter로 지정 폴더 | 목표에 가장 직접적. 번들 런타임/OS별 빌드·서명·업데이트 검증 필요. 외부 Python/Node 설치를 요구하지 않아야 함 |

**권장**: 공통 엔진 분리 후 브라우저 folder adapter로 빠르게 계약을 검증하고, 최종 독립형 목표는 설치가 필요 없는 self-contained portable 앱을 우선 검토한다. Electron/Tauri/다른 shell은 아직 결정하지 않는다. 시스템 WebView 등 선행 설치가 필요한 조합은 “추가 설치 없음” 조건을 실제 대상 PC에서 확인해야 한다. UI/엔진에 shell API가 직접 퍼지지 않도록 port로 제한한다.

## 5. 로컬 workspace 형식 제안

```text
선택한-업무폴더/
  workspace.json        workspaceId, schemaVersion, engineVersion
  data/                 업무 snapshot 또는 transactional store
  attachments/          내부 ID/hash 기반 원본; 표시 파일명은 metadata
  journal/              commit marker, 미완료 operation, recovery 정보
  backups/              세대별 구조+원본 manifest
  derived/              재생성 가능한 검색·문서 index
```

사용자 원본 폴더를 무조건 재배치하지 않는다. 먼저 새 workspace 폴더를 명시 선택하게 한다. 파일명 정규화, 예약 이름, 경로 탈출, 동일명, 대소문자, 한글, 긴 경로를 테스트한다. 외부 참조 path와 관리되는 attachment path를 구분한다.

metadata 저장은 임시 파일→flush→원자적 교체 또는 검증된 로컬 transactional DB로 구현하고, 파일 업로드와 metadata commit 사이에는 operation journal을 사용한다. 브라우저 API가 제공하는 원자성/flush 범위는 native와 다르므로 동일하다고 가정하지 않는다. 폴더 권한 철회·디스크 부족·손상·중복 실행·파일 수동 변경 후 복구 흐름을 제공한다.

동시 실행은 workspace lock/lease와 expected revision으로 제어한다. 로컬판도 완료 이력·생성키·템플릿 version·휴지통을 동일 command로 처리한다. 클라우드 동기화는 첫 로컬판의 필수 기능으로 섞지 않는다. 이후 교환은 검증 가능한 archive import/export로 시작한다.

## 6. 클라우드→로컬 이동과 보안

- schema11 JSON만 있으면 첨부 원본은 없다. Drive에 접근 가능한 계정에서 사용자가 선택한 파일을 내보내고 manifest에 성공/누락·hash를 남겨야 한다.
- 클라우드 업무 ID는 유지하고 provider 참조만 local attachment mapping으로 추가한다. 기존 driveFileId를 원본 추적용으로 보존할지는 내보내기 privacy 정책에 따른다.
- Google 로그인·workspace auth.password·OAuth token을 로컬 업무 archive에 복사하지 않는다.
- 로컬 기본 실행은 네트워크 없이 가능해야 한다. AI 사용은 별도 선택이며 데이터 전송 범위를 명시한다.
- backup에는 schema·engine version·최소 reader version·hash를 포함한다. 새 버전에서 저장한 폴더를 구버전이 조용히 덮어쓰지 못하게 한다.

## 7. 선행 결정과 검증 순서

공통 엔진/AttachmentStore/codec contract → 테스트 폴더 저장 spike → 장애/복구/두 실행 검증 → 동일 fixture로 cloud/local 결과 비교 → portable 실행·offline 검증 → AI read-only 검색·문서 근거 → 제안 검토·명시적 적용 순서다.

후속 단계에서 결정할 항목: 지원 OS/브라우저, 압축 해제 실행 허용 여부, 예상 데이터/첨부 규모, 개인/공유 PC, AI provider·전송 정책·예산, 지원 문서 형식, 법령 범위. 이 결정들은 이번 분석 문서 완성을 막지 않는다.
