# Harness Engineering System

## 구조

```
trm-harness/
├── harness.bat           ← 실행 진입점
└── harness/
    ├── harness.py        ← 메인 서버 + 실행 엔진
    ├── todo_list.md      ← 태스크 목록 (CRUD 로 편집됨)
    ├── output/           ← 태스크 출력 저장 (자동 생성)
    └── README.md
```

## 사용법

1. `harness.bat` 더블클릭 또는 터미널에서 실행
2. 브라우저에서 `http://localhost:7788` 자동 오픈
3. 대시보드에서 **▶ 시작** 버튼 클릭 → 태스크 순차 실행

## todo_list.md 형식

```markdown
- [ ] 태스크 설명 (실행할 명령어)
- [x] 완료된 태스크
- [ ] 명령어 없는 태스크 (echo 처리됨)
```

괄호 `()` 안에 실행할 명령어를 적습니다.

## 대시보드 기능

| 기능 | 설명 |
|------|------|
| ▶ 시작 | 미완료 태스크 순차 실행 |
| ■ 중지 | 다음 태스크부터 중지 |
| ↺ 초기화 | pending 상태로 재설정 |
| 수정 | 태스크 텍스트/명령어 수정 |
| 삭제 | 태스크 제거 |
| 태스크 추가 | 새 태스크 + 명령어 등록 |

## Harness Engineering 개념

- **격리 실행**: 각 태스크는 독립 subprocess 로 실행
- **상태 추적**: pending → running → done/error
- **실시간 피드백**: SSE(Server-Sent Events) 로 브라우저 push
- **영속성**: 실행 결과를 todo_list.md 에 즉시 반영
- **제어 흐름**: Start/Stop/Reset 으로 실행 생명주기 관리
