# 8단계 진행 기록

기준: phase7 `1b834ca7230f1478f9778898c226329c6384001b`. 전용 브랜치 `refactor/phase8-feature-ui`.

8a 일부: 홈 렌더러의 직접 `saveState()` 호출을 제거했다. 검색/필터의 입력 상태와 한글 IME 결과를 실제 Chromium 320·390·768·1440px에서 확인했다. FEATURE-UI-01/02 모두 PASS. 현재 8a 전체 목표(다중 래퍼와 이벤트 수명 정리)는 아직 완료 판정하지 않는다.

다음: 8a 나머지 UI 책임 정리, 8b 업무·체크리스트, 8c 라이브러리·프로젝트, 8d 설정·이력·테마. 기존 406건 전체 및 Actions는 최종 통합에서 한 번 실행한다. 현재 운영 main/데이터/배포를 변경하지 않았다.

8b 일부: BUG-08의 checklist 객체를 `[object Object]`로 저장하던 template/linkedStep 직렬화 표현식만 수정했다. 기존 BUG-08 기대값 `['First']`를 그대로 단정하는 정상 PASS로 전환했다. 백업/데이터 집중 46건: PASS 45 / XFAIL 1(BUG-09) / FAIL 0. 체크리스트 객체 자체의 광범위한 저장 스키마 변경은 하지 않았다. 업무 폼 초안·원격 snapshot 및 이벤트 소유권 정리는 미완료다.

8c 일부: BUG-09에서 일반 업무 `projectResources`의 data/objectUrl/blobUrl/previewUrl를 Firestore 직렬화 직전에 제거한다. 기존 첨부 ID와 메타데이터는 유지하고, 원래 해당 필드가 없는 업무에는 빈 필드를 추가하지 않는다. 후자가 첫 집중 검사에서 DATA-01 회귀로 확인되어 즉시 수정했고, 재검사 46 PASS / FAIL·XFAIL 0이다. 프로젝트 UI 모달·렌더러 수명 정리는 미완료다.

8d 설정·이력·테마는 미착수. 최종 406개 기준 검사와 Actions는 아직 수행하지 않았다. 8단계 완료 판정은 보류한다.

재개 8a: 홈 위젯의 resize/orientationchange 리스너를 key별 mount/dispose가 가능한 작은 `WMFeatureViewport` 경계에 연결했다. 같은 프레임의 두 이벤트는 한 번만 처리한다. 기존 홈·검색 Chromium 2건과 mount/dispose 계약 1건 모두 PASS. 다른 홈 wrapper들은 종전 기능을 보존하기 위해 일괄 제거하지 않았다.

재개 8b: 기존 save-command/journal/충돌 UI의 초안 보호·중복 제출·실패 표시·완료 읽기 전용 검사를 재사용해 CMD-UI-01/02, CONFLICT-UI-01/03, HIST-UI-02 = 5 PASS를 확인했다. 관련 저장 계층은 재작성하지 않았다. 업무 메뉴의 중복 resize/orientationchange 핸들러 두 쌍을 최종 메뉴 표시가 소유하는 viewport mount 한 곳으로 연결했다. PC↔모바일 회전 시 표시와 검색 필터 유지 집중 Chromium 검사가 PASS. 모달 전반의 이벤트 생명주기와 원격 snapshot 경쟁은 최종 통합 회귀 및 후속 UI 검증 범위로 남는다.

재개 8c: 프로젝트 목록 조회 헬퍼가 렌더 중 `state.projects=[]`를 생성하지 않도록 읽기 전용 fallback으로 바꿨다. FEATURE-UI-05와 기존 UI-02, SCHED-UI-01~03, HIST-UI-01 총 6건 PASS. 프로젝트 편집기는 기존 editor clone/취소 시 pendingFiles 정리와 현재 단계 날짜 엔진을 유지한다. `project-ui.js`의 넓은 MutationObserver는 동적으로 재생성되는 라이브러리 편집 DOM의 버튼·입력을 보정하는 실제 역할이 있어 무리하게 제거하지 않았다. 이 경로의 전체 수명/비동기 경쟁은 최종 회귀 외 실계정에서 추가 확인이 필요하다.

재개 8d: Hello Kitty·짱구 테마의 각 resize/orientationchange 리스너 두 쌍을 viewport mount에 연결했다. 설정된 테마 자체/저장값은 변경하지 않았고 UI-02 및 HIST-UI-03 실제 Chromium 2건 PASS. 이력 렌더는 기존 동기 조회이며 저장 호출을 추가하지 않았다. 휴지통·복원 승인 흐름은 기존 백업/이력 경로를 유지했다. BUG-02 CSS 구문은 범위 밖으로 남긴다.
