# 보안·운영 환경 사전점검

이번 브랜치에서는 운영 Firebase/Firestore, Security Rules, Google 계정, Drive 원본에 접근하지 않았다. Actions는 `demo-work-manager`와 loopback Emulator에만 연결하며 저장소 읽기 권한으로 실행한다.

정적 생산 파일 36개와 추적 파일명을 점검했다. 추적된 `.env`/PEM/P12/서비스 계정 JSON/source map/debug log는 없고, 사설 키 헤더와 `ya29.` 형식 OAuth 토큰 패턴은 발견되지 않았다. 기존 `js/firebase-config.js`와 `js/workspace-profile.js`에는 브라우저용 Firebase Web API key 문자열이 있다. 이는 브라우저에 제공되는 구성값이므로 비밀번호로 취급할 수 없지만, 실제 프로젝트의 API 제한·허용 도메인·승인 UID 규칙이 맞는지는 **운영 환경 확인 전 미검증**이다. 패턴 검색은 모든 비밀정보·개인정보 부재를 증명하지 않는다.

테스트 규칙과 6-F 규칙 생성기는 잠금 없는 반복 업무, 부모 revision 없는 체크리스트, 미승인 UID 접근을 Emulator에서 거부했다. 운영 규칙의 실제 내용은 조회하지 않았으며 이 결과를 운영 보안 검증으로 간주하지 않는다. 규칙 전환 전에는 승인 UID 목록, 생성키 잠금·부모 revision, wildcard 허용, getAfter 접근 예산, 실제 구형 클라이언트 저장 요청을 별도 승인 하에 점검해야 한다.

Google Tasks scope는 재도입하지 않았다. 남은 Drive scope는 `drive.file`과 프로필 복구용 `drive.appdata`다. 실제 OAuth 승인 도메인, 토큰 만료·재승인, 계정 전환, 401/403, 파일 열기·업로드는 합성/모의 계약만 확인했다. 별도 테스트 계정과 테스트 폴더 승인이 없다면 실제 연결 검사는 대기한다.
