# 8단계 진행 기록

기준: phase7 `1b834ca7230f1478f9778898c226329c6384001b`. 전용 브랜치 `refactor/phase8-feature-ui`.

8a 일부: 홈 렌더러의 직접 `saveState()` 호출을 제거했다. 검색/필터의 입력 상태와 한글 IME 결과를 실제 Chromium 320·390·768·1440px에서 확인했다. FEATURE-UI-01/02 모두 PASS. 현재 8a 전체 목표(다중 래퍼와 이벤트 수명 정리)는 아직 완료 판정하지 않는다.

다음: 8a 나머지 UI 책임 정리, 8b 업무·체크리스트, 8c 라이브러리·프로젝트, 8d 설정·이력·테마. 기존 406건 전체 및 Actions는 최종 통합에서 한 번 실행한다. 현재 운영 main/데이터/배포를 변경하지 않았다.

8b 일부: BUG-08의 checklist 객체를 `[object Object]`로 저장하던 template/linkedStep 직렬화 표현식만 수정했다. 기존 BUG-08 기대값 `['First']`를 그대로 단정하는 정상 PASS로 전환했다. 백업/데이터 집중 46건: PASS 45 / XFAIL 1(BUG-09) / FAIL 0. 체크리스트 객체 자체의 광범위한 저장 스키마 변경은 하지 않았다. 업무 폼 초안·원격 snapshot 및 이벤트 소유권 정리는 미완료다.

8c 일부: BUG-09에서 일반 업무 `projectResources`의 data/objectUrl/blobUrl/previewUrl를 Firestore 직렬화 직전에 제거한다. 기존 첨부 ID와 메타데이터는 유지하고, 원래 해당 필드가 없는 업무에는 빈 필드를 추가하지 않는다. 후자가 첫 집중 검사에서 DATA-01 회귀로 확인되어 즉시 수정했고, 재검사 46 PASS / FAIL·XFAIL 0이다. 프로젝트 UI 모달·렌더러 수명 정리는 미완료다.

8d 설정·이력·테마는 미착수. 최종 406개 기준 검사와 Actions는 아직 수행하지 않았다. 8단계 완료 판정은 보류한다.

재개 8a: 홈 위젯의 resize/orientationchange 리스너를 key별 mount/dispose가 가능한 작은 `WMFeatureViewport` 경계에 연결했다. 같은 프레임의 두 이벤트는 한 번만 처리한다. 기존 홈·검색 Chromium 2건과 mount/dispose 계약 1건 모두 PASS. 다른 홈 wrapper들은 종전 기능을 보존하기 위해 일괄 제거하지 않았다.
