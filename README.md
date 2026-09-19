# 업무관리시스템 Cloud v2 RC2

이 패키지는 Local v1.11 Test11을 기준으로 만든 Cloud v2 독립형 후보입니다.

- Google 로그인: Firebase Authentication
- 업무 데이터: 기존 Firestore 프로젝트/스키마 유지
- 실시간 동기화 및 오프라인 캐시: Firestore
- 첨부파일 원본: 기존 Google Drive 연결 유지
- 인수인계 ZIP: Drive 원본 파일 포함 지원
- 기존 `work-manager-cloud-v10` 저장소는 수정하지 않음
- Cloud v2는 이 저장소 안의 `js/cloud-sync.js`와 `js/firebase-config.js`를 직접 사용하므로 구 Cloud Pages에 런타임 의존하지 않음

## GitHub Pages 업로드 구조

저장소 루트에 아래처럼 보여야 합니다.

```text
index.html
README.md
js/
  cloud-sync.js
  firebase-config.js
```

## 현재 검증 범위

정적 코드/문법 및 패키지 구조 검사를 통과했습니다. 실제 Google 로그인, Firestore 읽기·쓰기, 실시간 동기화, Drive 업로드/열기, 인수인계 ZIP은 GitHub Pages 배포 후 실사용 테스트가 필요합니다.
