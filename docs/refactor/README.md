# 업무관리시스템 전면 리팩터링 — 1단계 분석

분석일: 2026-10-23 (Asia/Seoul). 분석 기준: `main`의 **`091dbecd701153e7e1880bd6bb84a277b789c58f`**. 문서 작업 브랜치: `analysis/refactor-phase1-20261023`.

## 결론

GitHub Pages + Firebase Authentication + Firestore + Google Drive를 유지한다. 현재 main을 기준으로 테스트와 경계를 먼저 만들고, 업무 엔진 → 저장 → UI 순으로 점진 전환한다. ChatGPT Sites, FastAPI 시험판, SQLite/D1은 개발 기반에 포함하지 않는다.

공개 GitHub Actions의 [Pages 실행 #68](https://github.com/0hoona91-sudo/work-manager-cloud/actions/runs/39765908194)에서 `main@091dbec`, `Success`, 배포 URL을 확인했다. 실제 운영 URL의 응답 바이트와 Pages 설정의 source directory는 네트워크/API 접근 제한으로 확인하지 못했다. **성공한 배포 기록과 현재 서비스 응답 검증은 별개**다.

상대일정 수정 브랜치는 Git 이력상 미병합 6개 커밋이 있으나, `project-model.js`와 `workflow-reform-v17.js`의 최종 내용은 main과 같다. main에는 이후 UI·반복일정 개선이 추가되어 있다. 해당 브랜치를 통째로 기준으로 바꾸거나 일괄 cherry-pick하지 않는다.

## 문서 안내

| 문서 | 내용 |
|---|---|
| [01-system-analysis.md](01-system-analysis.md) | 실행 순서, 전역 의존, 저장 구조, 인증·첨부 흐름 |
| [02-technical-debt.md](02-technical-debt.md) | 위험도, 재현 결과, 근거, 해결 우선순위 |
| [03-feature-inventory.md](03-feature-inventory.md) | 기능별 위치·호출 관계·데이터·위험 및 활성 여부 |
| [04-branch-comparison.md](04-branch-comparison.md) | 전체 원격 브랜치, 배포 근거, 안전한 기준선 |
| [05-common-engine-design.md](05-common-engine-design.md) | 공통 모델, 날짜·반복·프로젝트 엔진, 호환 계약 |
| [06-module-separation.md](06-module-separation.md) | 모듈 책임과 의존 방향, 전역 래퍼 제거 방법 |
| [07-test-plan.md](07-test-plan.md) | 변경 전 특성화 테스트, 회귀·저장·브라우저 검증 |
| [08-refactor-work-orders.md](08-refactor-work-orders.md) | 여러 차례로 나눈 후속 작업지시서와 종료 조건 |
| [09-ai-local-preparation.md](09-ai-local-preparation.md) | AI 업무비서 및 설치 없는 로컬판 준비 |
| [10-evidence-and-limits.md](10-evidence-and-limits.md) | 이번 분석의 실행 결과·재현 방법·미검증 범위 |
| [evidence/](evidence/) | 함수/대입/호출/이벤트 인덱스, 브라우저·모델 진단 결과 |

## 다음 단계 우선순위

1. 첨부 HTML/SVG 미리보기와 브라우저 저장 자격증명의 신뢰 경계 검증·보호(TD-01).
2. 완료 이력 보호, 백업 병합, 반복일정의 현 동작을 자동 테스트로 고정(TD-02~04).
3. 누락 Google Tasks 모델의 원본·지원 의도를 확인하고 복구 계획 확정(TD-05).
4. 렌더링 중 데이터 변경·저장을 제거할 command 경계 확립(TD-06).
5. Firestore 충돌·부분 저장·오프라인 의미를 검증한 뒤 저장 계층 분리(TD-07~09).

이번 단계는 문서와 진단 증거 작성만 수행했다. 앱 소스, 운영 데이터, 원격 main, 배포 설정을 변경하지 않았다. 다음 단계의 코드 수정·테스트 기반 도입·배포는 별도 지시 후 진행한다.

## 판정 용어

- **확인**: 소스·Git·배포 실행 기록에서 직접 확인.
- **격리 재현**: 임의 fixture와 외부 통신이 차단된 브라우저/Node에서 관찰. 운영에서 발생했다는 뜻은 아니다.
- **위험/추정**: 도달 조건 또는 실제 서비스 환경에서 추가 검증 필요.
- **비활성/미사용 후보**: 코드가 있지만 최종 덮어쓰기·현재 호출 경로 때문에 사용되지 않음. 바로 삭제할 근거로 쓰지 않는다.

문서의 소스 행 번호는 위 기준 SHA에 고정된다. 전체 함수 인덱스는 정적 발견 목록이며, 동적 전역 대입·문자열 생성 코드까지 완전한 호출 그래프로 증명하지는 않는다.
