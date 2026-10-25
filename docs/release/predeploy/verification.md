# 집중 검증과 성능

수정 전 실제 증거: 프로젝트 저장의 두 오래된 화면이 같은 프로젝트 이름을 각각 저장하면 두 번째가 첫 번째를 덮어썼다(`RELEASE-PROJECT-01` 작성 직후 FAIL). 첫 Emulator CI `40169161053`에서 체크리스트 변경 후 오래된 단계 편집이 거부되지 않았다(`RELEASE-PROJECT-EMU-02` FAIL). 연결 단계·체크 항목 전체를 트랜잭션 안에서 기준값 대조하도록 보완했다. 두 번째 CI `40169261509`에서는 체크·완료 보호가 PASS였고, 독립 단계 메모까지 과도하게 거부해 `RELEASE-PROJECT-EMU-01`이 FAIL이었다. 독립 메모만 조건부 허용하도록 좁혔다. 실제 SDK 최종 결과는 마지막 CI 결과를 기준으로 별도 기입한다.

기존 Rules의 `PROVISION-EMU-08`은 부모 revision 없는 구형 체크 쓰기 거부를 보여준다. 새 모듈과 옛 HTML 혼합은 `RELEASE-CACHE-01`에서 서버 쓰기 0으로 확인했다. 실제 오래된 탭·서비스워커·오프라인 큐의 운영 조합은 미검증이다.

동일 로컬 Chromium 1440×900, 합성 업무와 같은 코드 경로를 각 규모·버전당 한 번 측정한 `list-benchmark.json`:

| 업무 수 | 10단계 기준 | 이번 브랜치 | 화면 행 | 저장 호출 |
|---:|---:|---:|---:|---:|
| 1,000 | 451.4ms | 409.9ms | 양쪽 1,000 | 0 |
| 10,000 | 14,576.2ms | 271.1ms | 기존 10,000 / 새 화면 500×20페이지 | 0 |

10단계 기존 성능 문서의 약 25초는 다른 전체 화면 측정 절차였다. 위 숫자는 목록 표시만 같은 fixture·브라우저·하드웨어에서 비교한 한 번의 실행이며, 운영 사용자 데이터나 저사양 기기의 성능을 뜻하지 않는다. 페이지 밖 업무는 검색·선택·업무 원본에서 유지됨을 `RELEASE-LIST-01/02` Chromium으로 확인했다.

## 최종 통합 게이트

[GitHub Actions 40169551148](https://github.com/0hoona91-sudo/work-manager-cloud/actions/runs/40169551148)은 코드 SHA `9db50988fee4e7620501c9689d16d7952fa82613`에서 성공했다. **431 PASS / 0 XFAIL / 0 FAIL / 0 XPASS / 0 NOT_RUN**. `tests/release-ci.cjs`가 10단계의 424개 ID와 기대 상태를 모두 대조했으며 신규 7건이 통과했다. 실제 Firebase SDK/Emulator는 64건(기존 61+신규 프로젝트 3), 실제 Chromium은 69건(기존 67+신규 목록 2)이다. 검증 프로젝트는 `demo-work-manager`이고 Firebase 운영 프로젝트·Google 실계정·Drive 운영 파일은 사용하지 않았다.

공개 Actions 주석의 SHA·집계와 기준 결과를 조합한 개별 ID 목록은 [after-results.json](after-results.json)에 보존했다. 아티팩트를 직접 내려받지 못한 환경이므로 개별 결과의 재구성 출처를 JSON에 명시했다. 이 최종 문서만 추가한 SHA와 위 코드 검증 SHA는 구분한다.
