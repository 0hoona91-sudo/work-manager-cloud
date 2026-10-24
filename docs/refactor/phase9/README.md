# 9단계 진행 기록

기준 phase8 `daa15a100837ad4f3aeca2e31136041bf48ad10f`. 전용 브랜치 `refactor/phase9-style-assets-performance`.

A: `#app-v21-navy-dashboard-style`의 style 내부 197행 여분 `}` 한 문자만 제거했다. 전후 index.html 비교에서 다른 텍스트 변경은 없다. PostCSS STATIC-03은 모든 inline/외부 CSS를 검사하며 BUG-02는 정상 PASS로 전환했다. 기존 XFAIL 관측 `Unexpected }`, 197행은 8단계 결과와 2단계 분석에 보존한다. 로컬 집중 2 PASS. 실제 Chromium 320/390/768/1440px의 홈·업무·라이브러리·프로젝트·설정 20개 장면을 양 버전에서 캡처했다. 6개 스크린샷 바이트가 일치했고 14개는 홈 위젯 높이·아이콘 로딩 등의 차이가 있었다. 차이의 일부는 비동기 안정화 시점일 수 있으며 시각 동일성을 아직 판정하지 않았다. 후속 시각 검증을 수행한다.

다음: 동일 바이트 자원 후보 중 영향이 확인된 것만 추출하고, 호출·coverage 근거가 없는 코드는 유지한다. 1k/10k 성능 전후 측정과 최종 CI는 아직 미완료다. 운영 main·데이터·배포는 변경하지 않았다.

B: 동일 data URL SHA-256 `68137d65…`가 index.html의 Hello Kitty CSS 6곳에 반복된 것을 확인했다. 하나의 WebP 원본(334,682B, SHA-256 `5b5d3ba3…`)을 `assets/shared-hello-kitty-bg-68137d.webp`로 추출하고 상대 URL `./assets/…?v=phase9`로 6곳만 교체했다. 본문+asset 총량은 2,342,614B 감소했다. 같은 이미지의 요청은 브라우저 캐시를 통해 0(인라인)→1(외부)이며 404는 0이다. 실제 Hello Kitty 테마 홈 화면을 320/390/768/1440px에서 동일 날짜·fixture로 비교한 PNG SHA-256이 네 폭 모두 전후 일치했다. STYLE-ASSET-01/02 PASS. 다른 대형 이미지들은 해시가 다르므로 추출/병합하지 않았다. 로컬 파일과 GitHub Pages 서브경로에서 상대 URL을 유지한다.

C: `docs/refactor/evidence/css-candidates.json`의 후보와 실제 소스 참조, Chromium 주요 5개 화면 DOM을 교차 확인했다. `.holiday-stripe`는 정의 1곳 외 생산 코드 참조가 없고 홈·업무·라이브러리·프로젝트·설정 DOM에서 0개라서 CSS 규칙 한 개만 제거했다. 달력의 휴일 표시는 별도 `.cal-cell.holiday` 경로이며 `REACH-01`에서 확인했다. 정적 참조만으로 판단할 수 없는 21개 후보와 `purgeRetiredTasksCredential`(현재 인증 경로 호출 4곳)은 유지했다. CDP CSS rule usage는 이 환경에서 639개 모두 사용으로 보고되어 삭제 근거로 사용하지 않았다. `--styles-only` 집중 검사 8 PASS. 중간 커밋 이후 전체 회귀는 최종 통합에서 실행한다.
