# 6-D 실제 SDK/Emulator 검증

기준 `2798b08e80b52f85545c0551dfebcdcff337ad82`; 결과 `refactor/phase6d-emulator-verification`.

## 실행 환경과 운영 격리

`.github/workflows/phase6d-emulator.yml`은 해당 결과 브랜치 push에만 반응한다. `contents: read`, checkout 인증정보 잔류 금지, Node 24, Java 21, 기존 lockfile의 `npm ci`, runner의 기존 Chrome을 사용한다. 사용자/Firebase secrets, 배포 명령, 운영 프로젝트, Cloud Functions를 사용하지 않는다. 테스트 드라이버는 `GCLOUD_PROJECT=demo-work-manager` 및 loopback Emulator 주소가 아니면 중단한다.

Codex 환경에서 JAR 다운로드를 재시도하지 않았다. GitHub API는 프록시 CONNECT 403으로 조회할 수 없지만 공개 Actions 웹 페이지에서 워크플로 실행은 확인할 수 있다. 로그인 없는 상세 로그/아티팩트 다운로드가 제한되어, 검사별 상태와 실패 원문을 job annotation에도 게시한다. GitHub Actions에는 전체 로그/JSON 결과를 artifact로 보관한다.

## 검사 구분

- 기존 308개 ID·기대값 유지. ATOMIC-EMU-01~13은 기존 실제 Firebase SDK 계약을 그대로 실행한다.
- `SAVE-EMU-01~08`: 실제 SDK + 실제 Emulator, 생산 함수의 주입 harness. 동일/독립 필드 동시 변경, revision 경합/재실행, 체크 배열 충돌, 응답 유실 주입과 읽기 확인, 동일 최종값, 완료 이력, 계정 변경.
- `RULES-EMU-DIAG-01~02`: **보호 성공 검사가 아닌 규칙 허점 관측 검사**. 잠금 없는 task 생성과 부모 revision 없는 체크 쓰기가 허용되는지 확인한다. 이 항목의 PASS는 허점이 관측됐다는 뜻이며 운영 보안 통과가 아니다.
- `JOURNAL-SDK-01~08`: 실제 Chromium/IndexedDB와 Node 프로세스의 실제 Firebase SDK를 Playwright binding으로 연결한다. 브라우저 auth/bootstrap만 합성 대체한다. 실제 SDK가 브라우저 안에서 실행되는 E2E OAuth 검사는 아니다. 서버 반영 후 응답 전달 보류·브라우저 재실행, 오프라인 정책·계정 격리, prepared 기록·기존 DB 호환, quota 오류 주입, 복구 후 수정, 충돌 후 추가 입력, 두 탭, 서버 성공/캐시 실패를 검사한다.
- 기존 MOCK 검사는 계속 모의 transport를 사용한다. acknowledgement loss/quota/일부 offline 조건은 명시적 장애 주입이다. ATOMIC-EMU-07은 실제 SDK 네트워크 disable/enable도 실행한다. OS 전원 차단이나 저장소 삭제 복구를 실측했다고 주장하지 않는다.

## 개발 PC 재현

Node 24, Java 21, Chromium/Chrome이 설치된 격리된 개발 PC에서:

```sh
npm ci
export CHROMIUM_PATH=/usr/bin/google-chrome
export GCLOUD_PROJECT=demo-work-manager
export PHASE6D_SCOPE=focused
./node_modules/.bin/firebase emulators:exec --only firestore --project demo-work-manager --config tests/emulator/firebase.json "node tests/phase6d-ci.cjs"
```

`PHASE6D_SCOPE=full`은 기존 검사와 새 검사를 함께 실행한다. 기존 13개만 집중하려면 Emulator 안에서 `node tests/run.cjs --atomicity-only`를 실행한다. 테스트 설정 `tests/emulator/firebase.json`과 `firestore.rules`만 사용한다. Emulator 접속 실패 시 운영 Firebase로 fallback하지 않는다.

## 규칙과 운영 전 필수 검토

테스트 규칙은 synthetic-owner 이외 UID를 거부하고 generatedKeys를 wildcard 허용 대상에서 제외한다. 잠금 생성은 demo-work-manager 범위와 같은 commit의 소유 task를 확인하며 수정/삭제는 거부한다. 기존 13개에 108회차/11청크 검사도 포함되어 현재 규칙의 문서 접근 예산을 검증한다.

반대 방향 task→lock 강제, 체크 문서→부모 revision 강제는 현 테스트 규칙에 없다. 구형 무조건 쓰기 경로를 계속 허용한 채 클라이언트 트랜잭션만으로 모든 접근을 보호할 수 없다. 기존 키 ID 변환/삭제 suppression/백업 호환성을 고려한 규칙 및 클라이언트 전환 계약이 운영 배포 전에 필요하다. 이번에 전체 허용으로 규칙을 바꾸거나 실제 운영 규칙을 읽고 배포하지 않았다. 운영 보안 검증 완료로 해석하면 안 된다.

## 롤백

6-D 커밋들을 전용 브랜치에서 revert하면 테스트/워크플로 연결을 되돌릴 수 있다. main reset·force push·운영 데이터 삭제·schema11 변환은 필요 없다. Actions 결과와 로그는 증거로 보존한다. 전용 workflow를 main에 병합하거나 Pages 배포를 실행하지 않는다.

## 중단 지점 및 집중 검사에서 발견한 문제

- `7098aa8`, [run 40074126023](https://github.com/0hoona91-sudo/work-manager-cloud/actions/runs/40074126023): 53건 중 PASS 28 / FAIL 25. Node VM의 plain object가 Firebase SDK 실행 영역과 달라 `custom Object object`로 거부되었다. `sdk-realm.cjs`에서 plain object/배열만 SDK 실행 영역으로 복사하고 FieldValue 등 SDK 객체는 유지했다. 실제 SDK의 트랜잭션/재시도/규칙을 모의로 대체하지 않았다.
- `97ba4eb`, [run 40074464596](https://github.com/0hoona91-sudo/work-manager-cloud/actions/runs/40074464596): 54건 중 PASS 52 / FAIL 2. 기존 ATOMIC-EMU 13건과 SAVE-EMU 8건은 모두 PASS. Playwright binding의 rejected Error 전달이 `code`/`conflicts` 등 부가 속성을 잃어 브라우저 충돌 검사 2건이 시간 초과했다. 테스트 binding에 구조화된 오류 envelope를 추가했다. 실제 UI의 오류 처리와 assertion은 변경하지 않았다.
- 최초 설정 실행 [run 40073810518](https://github.com/0hoona91-sudo/work-manager-cloud/actions/runs/40073810518)은 실패했다. 공개 상세 로그 접근 제한 때문에 그 실행의 개별 검사 결과는 확인되지 않았으며 PASS로 계산하지 않는다.

위 실패 원문과 검사별 상태는 `focused-attempt-*.json`에 보존한다. 테스트 환경 연결부만 수정했으며 운영 소스·Security Rules·package-lock은 기준 커밋과 동일하다.

## 최종 결과

[전체 CI run 40093759252](https://github.com/0hoona91-sudo/work-manager-cloud/actions/runs/40093759252) 성공. 검증 코드 커밋은 `f132432ce87d3113c3edc1c6d9656542317ddf33`이다. 이후 문서만 보존하는 커밋은 `[skip ci]`로 중복 전체 실행을 피한다.

| 구분 | 등록 | PASS | XFAIL | FAIL | XPASS | NOT_RUN |
|---|---:|---:|---:|---:|---:|---:|
| 6-C 기준 | 308 | 291 | 4 | 0 | 0 | 13 |
| 6-D 집중 최종 | 54 | 54 | 0 | 0 | 0 | 0 |
| 6-D 전체 최종 | 327 | 323 | 4 | 0 | 0 | 0 |

기존 13개 Emulator 검사는 실제 실행하여 모두 PASS로 전환했다. 기존 308개 ID·제목·기대값 및 XFAIL 4건(BUG-01/02/08/09)의 관측값 보존을 CI에서 별도로 확인했다. 새 19건은 SDK 연결부 1건, 일반 업무 실제 SDK 8건, 규칙 허점 관측 2건, 실제 브라우저/SDK 복구 8건이다. 모의 검사는 기존 분류를 유지한다. NOT_RUN 0은 등록된 327건에 대한 수치이며 운영 로그인·운영 규칙 검증까지 끝났다는 뜻은 아니다.

검사별 범위는 [verification.md](verification.md), 집중 성공 원문은 [focused-success.json](focused-success.json), 전체 결과 집계는 [after-summary.json](after-summary.json), 공개 CI annotation 원문은 [final-ci-annotations.json](final-ci-annotations.json)에 있다. 전체 결과 annotation은 GitHub에서 4,096자로 잘려 내려오지만 집계와 커밋은 온전하다. 잘린 부분을 만들어 채우지 않았다. 전체 개별 JSON·로그·기준 보존 결과는 해당 CI의 `phase6d-evidence-f132432ce87d3113c3edc1c6d9656542317ddf33` artifact에 있다.

변경 파일은 전용 workflow, 테스트/SDK 연결부(`emulator-integration.test.cjs`, `journal-browser.cjs`, `recurrence-emulator.cjs`, `sdk-realm.cjs`, `phase6d-ci.cjs`, `phase6d-summary.cjs`, `run.cjs`), 본 문서뿐이다. `index.html`, `js/`, 테스트 규칙, package-lock은 변경하지 않았다. 원격 main은 `091dbecd701153e7e1880bd6bb84a277b789c58f` 그대로이며 운영 데이터 접속·수정·배포를 수행하지 않았다.
