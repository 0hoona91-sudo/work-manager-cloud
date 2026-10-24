# 검증 결과와 호환성 표

첫 강화 규칙 CI [40094816639](https://github.com/0hoona91-sudo/work-manager-cloud/actions/runs/40094816639): PASS 65 / FAIL 7 / XFAIL 0 / XPASS 0 / NOT_RUN 0 (총 72).
실패는 ATOMIC-EMU-01/02/06, SAVE-EMU-01/02/03, JOURNAL-SDK-07이다. Rules 경합 시 SDK가 permission-denied를 반환하는 차이를 기존 3-way/잠금 검사로 재평가하도록 수정했다. 기대값이나 규칙을 완화하지 않았다.

보완 집중 CI [40095140222](https://github.com/0hoona91-sudo/work-manager-cloud/actions/runs/40095140222): **PASS 74 / FAIL 0 / XFAIL 0 / XPASS 0 / NOT_RUN 0**. 커밋 `fb7465b982bb9efe946ccd901886643cf81a6c48`.

로컬에서는 기존 ATOMIC-MOCK 22건이 통과했다. 백업 집중 35건의 첫 실행은 PASS 32 / XFAIL 2 / FAIL 1이었다. BACKUP-CLOUD-04의 분할 mock이 실제 atomic bundler로 바뀌면서 실패 주입할 두 번째 청크가 없어졌기 때문이다. 독립 claim 6개로 실제 두 번째 청크를 만들고 동일한 부분 실패 assertion이 PASS함을 확인했다. 이 로컬 검사를 실제 Emulator 검증으로 집계하지 않는다.

## 허점 수정 전후

| 요청 | 6-D 테스트 규칙 | 6-E 테스트 규칙 |
|---|---|---|
| key가 있는데 lock 없는 신규 task | 허용(진단 PASS) | 거부(permission-denied) |
| 부모 revision 없는 체크 create/update/delete | 허용(생성 진단 PASS) | 거부(permission-denied) |
| 정상 key/task/lock 동일 commit | 허용 | 허용 |
| 위조 lock ID/키 불일치 | 역방향 검증 없음 | 거부 |
| tombstone을 남긴 task의 직접 재생성 | 우회 가능 | 거부 |
| 구형 클라이언트의 revision 없는 부모 update | 허용 | 거부 |
| 새 adapter의 부모/체크 동시 변경 | 허용 | 허용 |
| 기존 키·ID를 유지하는 정상 수정 | 허용 | 허용 |

6-D 허점 진단 PASS는 당시 우회 허용을 관측했다는 뜻이며 보호 성공 수에 합산하지 않는다. 기존 ID 두 개는 이번에는 거부를 요구하는 회귀 검사로 강화했다.

## 신규 검사

| ID | 실제 SDK/Emulator 검사 |
|---|---|
| RULES-EMU-01 | canonical pair creation permits Unicode origins and old arbitrary task IDs |
| RULES-EMU-02 | forged lock ID or key mismatch is rejected atomically |
| RULES-EMU-03 | lock tombstone prevents direct resurrection including same task ID |
| RULES-EMU-04 | existing generatedKey cannot be removed or changed; normal completed edit survives |
| RULES-EMU-05 | legacy check create/update/delete without parent revision is denied |
| RULES-EMU-06 | general save supports checklist create toggle edit delete with parent fences |
| RULES-EMU-07 | check parent cannot be reassigned even with both parent revisions |
| RULES-EMU-08 | task deletion and checklist deletion remain one allowed bundle |
| RULES-EMU-09 | project stage checklist and project metadata use compatible general save |
| RULES-EMU-10 | template and linked rule checklists participate in revision fences |
| RULES-EMU-11 | offline batch with parent increment reconnects without permitting unfenced writes |
| RULES-EMU-12 | parent-only stale revisions and unsupported collections fail closed |
| RULES-EMU-13 | legacy existing keyed task lacking a lock is editable without rekeying |
| RULES-EMU-14 | trusted mapping of an existing keyless occurrence creates its lock atomically |
| RULES-EMU-15 | backup transaction preserves completed history and same IDs with fenced check changes |
| RULES-EMU-16 | oversized child-parent bundle is rejected without partial state |
| RULES-EMU-17 | other UID cannot access tasks/checks or claim another workspace |
| RULES-EMU-18 | large general checklist save respects access budget and preserves grouping |
| RULES-EMU-19 | legacy generated keys retain their canonical lock IDs for new paired saves |
| RULES-EMU-20 | unchanged forbidden write is not retried as a race |
| RULES-EMU-21 | stale general checklist edit cannot resurrect a deleted parent |

기존 13개 원자성, 8개 SDK 충돌, 8개 Chromium/IndexedDB 복구 검사는 그대로 실행한다. 모의 transport 검사는 기존과 동일하게 MOCK으로 구분한다. IndexedDB 복구 검사는 실제 Chromium과 Node SDK를 binding으로 연결하며 실제 OAuth 전체 E2E는 아니다. OS 전원 차단, 운영 Rules/로그인, 보안규칙 강화 후의 모든 구형 캐시·오프라인 대기 조합은 미검증이다.

## 저장 경로별 영향

| 경로 | 처리 |
|---|---|
| 6-B 미완료 일반 업무 명령 | 기존 revision/3-way 검사 유지, Rules 경합 시 변경 확인 후 bounded 재평가 |
| 구형 일반 saveState·프로젝트 단계·반복 회차 체크 | 부모 revision-only 쓰기 추가, 동일 묶음 저장 |
| 템플릿/linkedRule 체크 | 각 부모 revision fence, template bundle 유지 |
| 오프라인 기존 업무 체크 | 부모 increment와 child batch, 서버 승인 전 확정 아님 |
| 오프라인 신규 반복 | 기존대로 온라인 claim 필요, batch fallback 금지 |
| 백업 병합/복원 | 기존 preview/완료 이력/서버 기준 검사 유지, 묶음 예산 준수 |
| 삭제 잠금과 충돌하는 복원 | 재생성 거부, 자동 우회/삭제 없음 |
| 과거 키만 있고 잠금 없는 task | Rules의 동일 키 수정은 허용(legacy fixture 실측). 실제 앱의 누락 잠금 자동 보충은 보류될 수 있으므로 승인된 사전 검토가 필요 |
| 이전 캐시 클라이언트 | revision 누락/lock 없는 쓰기는 명시적 거부; 먼저 앱 전환 필요 |

## 최종 전체 회귀

[GitHub Actions 40095322243](https://github.com/0hoona91-sudo/work-manager-cloud/actions/runs/40095322243), 검증 커밋 `2bdc00f267c03c29ba464785e88d0fbe90f012d9`, 성공.

| 구분 | 등록 | PASS | XFAIL | FAIL | XPASS | NOT_RUN |
|---|---:|---:|---:|---:|---:|---:|
| 기존 327개(허점 진단 2개는 거부 계약으로 강화) | 327 | 323 | 4 | 0 | 0 | 0 |
| 신규 규칙·호환성 실제 SDK | 21 | 21 | 0 | 0 | 0 | 0 |
| 전체 | 348 | 344 | 4 | 0 | 0 | 0 |

실제 Emulator 검사는 기존 ATOMIC 13 + SAVE 8 + JOURNAL-SDK 8 + DIAG 거부 회귀 2 + 신규 RULES 21 = **52건 PASS**다. 다른 모의 transport 검사를 실제 서버 실측으로 합산하지 않았다. 기존 XFAIL BUG-01/02/08/09는 그대로다. CI는 기존 327개 ID 존재, 기존 known 기대값 및 XFAIL 관측값 보존을 확인했다. 문서에 설명한 청크/진단 assertion 계약 변경은 명시적이며 기대값을 숨기지 않았다.

전체 348개 ID·상태를 [after-results.json](after-results.json)에 저장했다. 원문은 [final-ci-annotations.json](final-ci-annotations.json), 이전 실패/집중 성공은 `focused-before-retry.json`, `focused-success.json`이다. 이번에는 annotation을 45개씩 분할해 6-D의 공개 페이지 4KiB 절단 문제를 피했다. 원본 상세 로그·source hash·전체 report·baseline-preservation.json은 Actions의 `phase6e-evidence-2bdc00f267c03c29ba464785e88d0fbe90f012d9` artifact에 보존된다. Codex의 GitHub API 프록시 제한으로 artifact를 로컬 재다운로드하지는 않았다.

최종 결과 보존 커밋은 문서만 추가하며 `[skip ci]`로 성공한 전체 검사를 불필요하게 반복하지 않는다. 테스트 규칙과 클라이언트는 위 검증 커밋과 동일하다.
