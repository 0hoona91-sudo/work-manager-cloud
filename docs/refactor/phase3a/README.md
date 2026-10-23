# 3-A 첨부파일 미리보기 보안 수정

- 기준: `refactor/phase2-test-baseline`, `748db8132cfd24a5963c6f0187b9b0be628a3544`
- 결과 브랜치: `refactor/phase3a-attachment-security`
- 범위: TD-01의 Drive 첨부 열기·다운로드·미리보기 Blob 캐시 경로만 수정.
- 기존 분석과 테스트를 재사용했다. 업무·프로젝트·반복일정·인증/OAuth·Firestore 스키마·workspace-profile 자격증명 저장·배포 설정은 변경하지 않았다.

## 문제와 변경

기존 `openDriveFile`은 `text/*`, `image/*` 또는 PDF/TXT/CSV 확장자만으로 원본 Blob URL을 새 창에서 열었다. HTML/SVG는 `opener = null`이어도 앱과 같은 출처의 localStorage를 읽을 수 있었다. 합성 HTML/SVG의 스크립트가 `SYNTHETIC_STORAGE_MARKER`를 읽는 현상을 수정 전에 실제 Chromium에서 확인했다. 실제 저장정보나 운영 Drive 파일을 사용하지 않았다.

`js/cloud-sync.js`의 변경 내용:

1. 파일명의 마지막 확장자와 허용 MIME을 대응시킨다. 저장된 MIME이 있다면 함께 일치해야 한다. 저장 MIME이 누락된 과거 첨부도 파일명과 실제 응답이 검증되면 열 수 있다.
2. `readDriveFileBlob`의 실제 응답 Blob MIME과 첫 16바이트의 형식 헤더를 검사한다. 파일명 또는 저장 메타데이터로 응답 MIME을 덮어써 신뢰하지 않는다. MIME/확장자/헤더 중 하나라도 맞지 않으면 다운로드한다.
3. 미리보기는 PNG/JPEG/GIF/WebP/BMP/ICO/PDF만 허용한다. HTML/SVG/XHTML/XML, 텍스트, CSV, 확장자 없는 파일, 불명확한 MIME 및 나머지 형식은 다운로드한다. AVIF/TIFF 등 허용목록 밖 이미지도 보수적으로 다운로드한다.
4. 다운로드는 별도의 `application/octet-stream` Blob URL과 `download` 속성을 사용한다. 원본 이름과 바이트를 유지하고 임시 다운로드 URL은 60초 후 해제한다. 실제 파일·Drive 메타데이터에는 쓰지 않는다.
5. 미리보기는 다운로드 응답을 다시 검증하므로 오래된 캐시를 신뢰하지 않는다. 불일치가 발견되거나 팝업이 차단되면 이미 읽은 Blob을 다운로드에 전달해 중복 요청을 피한다. 실패 시 빈 창을 닫고 오류를 전달한다.
6. `getDriveObjectUrl`과 업로드 직후 `createDriveBlock`의 **로컬 표시 URL 생성 한 줄**에도 같은 MIME/헤더 검증을 적용한다. 능동 파일 캐시를 브라우저의 ‘이미지를 새 탭에서 열기’ 등으로 직접 열 수 없도록 비능동 다운로드 MIME으로 만든다. 업로드·삭제·OAuth 코드 및 원본 파일의 바이트는 변경하지 않았다. SVG의 기존 인라인 사진 표시는 제한되지만 첨부 열기/다운로드 경로로 원본을 받을 수 있다.

`readDriveFileBlob`의 인증·legacy fallback·네트워크 처리는 그대로 사용한다. 새 저장 필드, 라이브러리, 프레임워크, 서비스는 추가하지 않았다. 새 창 URL은 검증된 MIME을 명시해 브라우저의 기본 이미지/PDF 표시 기능으로 연다.

## 실행

2단계에서 설치한 개발 의존성과 시스템 Chromium을 그대로 사용한다.

```sh
# 보안 테스트만 (16개)
node tests/run.cjs --attachments-only

# 기존 33개 + 보안 16개
npm test
```

결과 파일은 각각 `test-results/attachment-results.json`, `test-results/phase3a-results.json`이다. `npm run test:strict`의 기존 분류 정책은 유지되며, 2단계 알려진 오류가 남아 있는 동안 종료 1을 반환한다. 보안 테스트를 XFAIL로 완화하지 않았다.

## 검증 결과

| 실행 | 총수 | PASS | FAIL | XFAIL | XPASS | NOT_RUN |
|---|---:|---:|---:|---:|---:|---:|
| 수정 전 보안 검사 | 16 | 6 | 10 | 0 | 0 | 0 |
| 수정 후 보안 검사 | 16 | 16 | 0 | 0 | 0 | 0 |
| 수정 후 기존 2단계 검사 | 33 | 21 | 0 | 12 | 0 | 0 |
| 수정 후 전체 | 49 | 37 | 0 | 12 | 0 | 0 |

수정 전 10개 실패는 저장정보 접근 4건(HTML, SVG, PDF로 위장한 HTML, PNG로 위장한 SVG), XML/위조 헤더/타입 불일치 미리보기 허용 3건, MIME 누락 이미지의 미리보기 불가 1건, 능동 MIME의 캐시 URL 2건이다. 처음에는 브라우저 이벤트 대기와 테스트용 업로드 의존 스텁을 보완했다. **운영 코드 수정 전에** 보완된 같은 16개 검사를 실행해 6 PASS / 10 FAIL 결과를 보존했다.

- [before-security-results.json](before-security-results.json): 원본 운영 코드에서 실행한 실패와 스택. HEAD는 2단계 기준 커밋이다.
- [after-results.json](after-results.json): 수정 후 전체 결과, 실제 `cloud-sync.js` SHA-256, Node 버전, 실행시각. 커밋 전 작업 트리에서 실행했으므로 checkoutHead는 테스트 당시 부모 커밋이다.
- 2단계의 12 XFAIL은 그대로 남은 별도 결함이며 정상 통과가 아니다. 신규 예상 밖 실패나 실행 불가 검사는 없다.

## 합성 보안 테스트 범위

`tests/attachment.test.cjs`는 기존 AST 도구로 실제 첨부 함수만 추출한다. `readDriveFileBlob`, 열기, 다운로드, 캐시 생성 함수를 그대로 실행하고 인증·Drive 전송 경계만 합성 응답으로 교체한다. 매 검사마다 새로운 Chromium 컨텍스트와 loopback origin을 만들며 외부 요청은 차단한다. Chromium 내장 PDF viewer의 로컬 확장 리소스만 허용한다. 원본 저장소와 실제 앱 프로필은 로드하지 않는다.

| ID | 검사 |
|---|---|
| SEC-01~02 | 실제 HTML/SVG 스크립트의 합성 localStorage 읽기 차단 및 다운로드 |
| SEC-03~04 | XHTML/XML 다운로드 |
| SEC-05~06 | PDF/이미지 확장자·저장 MIME으로 위장한 능동 응답 차단 |
| SEC-07~08 | 위조 MIME의 HTML 바이트, MIME/확장자 불일치 다운로드 |
| SEC-09~10 | PNG의 실제 픽셀 렌더링, PDF의 기본 viewer 열기 경로 유지 |
| SEC-11~13 | 일반 파일 다운로드, 명시적 HTML 다운로드, 팝업 차단 fallback |
| SEC-14 | MIME 메타데이터가 비어 있는 기존 이미지 열기 |
| SEC-15~16 | 로드된 HTML 캐시와 업로드 직후 SVG 캐시의 능동 MIME 제거 |

다운로드 파일명·바이트 일치, 원본 첨부 ID 유지, 실제 읽기 1회도 검사한다. PDF 검사는 Blob의 MIME 및 기본 viewer로의 이동을 검사하며 문서 모든 페이지의 시각 품질을 보증하지 않는다. 캐시 검사는 원본 바이트와 다운로드 MIME을 직접 검사한다. 업로드 캐시 검사의 파일 생성·전송은 스텁이며 실제 Drive 쓰기는 없다.

## 남은 범위와 제한

- 자격증명 localStorage 캐시 자체는 이번에 수정하지 않았다. 3-B에서 별도 처리해야 한다.
- MIME/헤더 허용목록은 파일 전체의 무해함을 증명하는 바이러스 검사나 브라우저 디코더 취약점 방어가 아니다. 허용 형식은 브라우저의 기본 이미지/PDF 구현을 사용한다.
- 사용자가 내려받은 능동 문서를 PC에서 직접 실행하는 행위까지 통제하지 않는다. 이 변경은 앱 출처의 능동 미리보기 경로를 차단한다.
- Chromium에서 합성 경로를 검증했다. 실제 Drive 인증/legacy 재인증, 다른 브라우저와 모바일 OS 다운로드 동작은 실사용 검증하지 않았다.
- 원본 읽기 함수의 외부 호출, 다른 UI 전반의 XSS, CSP, 토큰 저장·수명 정책은 별도 범위다. 기존 main이나 운영 배포에는 반영하지 않았다.
