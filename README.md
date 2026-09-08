# EasyProject4 (EP4)

**로컬 PC의 Claude CLI에게 일을 시키는 태스크 하네스.**
프로젝트별로 할 일(태스크)을 큐에 쌓아두면 EP4가 순서대로 Claude CLI를 실행하고,
Git 브랜치 격리 → 커밋 → main 머지까지 자동으로 처리합니다.

```
할 일을 적는다 → 실행을 누른다 → 커피를 마신다 → diff 를 확인한다
```

## 주요 기능

- **태스크 하네스** — 태스크 순차 실행, 실행 중 추가 요청은 큐잉 후 이어서 실행, 태스크별 모델/타임아웃/세션 오버라이드
- **Git 자동화** — 태스크마다 `project/{slug}/taskNNN` worktree 브랜치에서 격리 실행, 완료 시 프로젝트 브랜치를 거쳐 main까지 자동 머지 (충돌 시 안전하게 중단)
- **웹 대시보드** — 프로젝트/태스크/실행 로그(diff·커밋 포함)를 한 화면에서, SSE 실시간 갱신
- **Flutter 모바일 앱** — Cloudflare Tunnel로 외부에서 접속, 태스크 지시·실행·로그 확인, 서버에서 APK 자가 업데이트
- **Claude CLI 연동** — MCP 도구(`ep4_create_task` 등)와 훅(UserPromptSubmit/Stop)으로 터미널 대화가 자동으로 태스크·실행 로그로 기록. Gemini CLI(Antigravity)도 동일 훅 재사용
- **멀티 PC(peer)** — 여러 EP4 인스턴스 연결, NAT 뒤 PC는 push 방식으로 프로젝트 공유·원격 태스크 지시
- **플러그인 아키텍처** — pluggy 훅 기반. 화면은 `plugin.json` + `view.js`, 백엔드는 `backend.py` 폴더 하나로 확장. 스킬/에이전트 마켓 공유 지원

## 빠른 시작

요구 사항: Windows, [conda](https://docs.conda.io/), [Claude CLI](https://docs.anthropic.com/claude-code) (또는 Gemini CLI)

```bat
run.bat
```

conda 환경 생성부터 패키지 설치, 서버 기동까지 한 번에 처리합니다.
브라우저에서 `http://localhost:7788` 접속 후 프로젝트를 만들고 `project_root`에
작업할 저장소 경로를 지정하면 준비 끝입니다.

| 스크립트 | 역할 |
|----------|------|
| `run.bat` | EP4 서버 시작 (localhost:7788) |
| `tunnel.bat` | Cloudflare 임시 터널 — 공인 IP 없이 외부/모바일 접속 |
| `mobile.bat` | Flutter 앱 실행 (`mobile.bat chrome` 등 디바이스 지정 가능) |
| `desktop.bat` | Electron 데스크톱 앱 개발 모드 |
| `stop.bat` | 서버 종료 |

## 아키텍처

```
server.py (7788)           ← 메인 서버 + 하네스 실행 엔진 (Python 표준 라이브러리 중심)
  ├─ dist/                 ← 웹 대시보드 정적 파일
  ├─ server/projects.db    ← SQLite DB (projects · project_tasks · task_runs)
  └─ server/worktrees/     ← Git 격리 worktree 작업 공간

mobile/                    ← Flutter 앱 (Android/iOS/Windows)
desktop/                   ← Electron 데스크톱 앱
plugins/                   ← View · Data · Helper · MCP 플러그인
ep4_mcp.py                 ← Claude CLI MCP 서버
ep4_hook_prompt.py / ep4_hook_stop.py  ← CLI 훅 (프롬프트/응답 자동 기록)
```

태스크 실행 흐름:

```
태스크 실행 → worktree 브랜치 생성 → claude CLI 실행 → 결과 기록
  → 커밋 → 프로젝트 브랜치 머지 → main 머지 → SSE 알림
```

## 문서

| 문서 | 내용 |
|------|------|
| [CLAUDE.md](CLAUDE.md) | 코드베이스 구조·규칙 (Claude Code용 가이드 겸 아키텍처 문서) |
| [docs/tunnel_guide.md](docs/guide/tunnel_guide.md) | Cloudflare Tunnel 외부 접속 가이드 |
| [docs/mcp_guide.md](docs/prompt/mcp_guide.md) | Claude CLI MCP·훅 연동 가이드 |
| [docs/mobile_guide.md](docs/prompt/mobile_guide.md) | 모바일 앱 빌드·연결 가이드 |
| [docs/plugin_architecture_design.md](docs/guide/plugin_architecture_design.md) | 플러그인 아키텍처 설계 |
| [docs/examples/backend_plugin/](docs/examples/backend_plugin/) | 백엔드 플러그인 작성 템플릿 |

## 설정 파일

- `conf/ep4.conf` — 포트·바인드 주소 (기본 localhost:7788)
- `conf/ep4.local.conf` — 인증 토큰·Firebase 주소 등 로컬 전용 값 (**커밋 금지**, `.gitignore` 처리됨)
- `conf/ep4.local.conf.example` — 로컬 설정 예시
- `conf/marketplace.conf.example` — 마켓(Firebase) 연동 설정 예시

### 터널 URL 공유 (선택)

`tunnel.bat` 이 발급한 Cloudflare 터널 URL 을 Firebase Realtime DB 에 올려두면,
모바일 앱에서 긴 URL 대신 **EP4 ID** 만으로 접속할 수 있습니다. 쓰지 않아도 무방합니다.

```jsonc
// conf/ep4.local.conf
{ "firebase_db_url": "https://<프로젝트>-default-rtdb.firebaseio.com" }
```

- 값이 없으면 터널 URL 업로드와 앱의 "EP4 ID" 탭 연결만 건너뛰고, 나머지는 그대로 동작합니다.
- 서비스 계정 키는 `conf/*adminsdk*.json` 에 두며 역시 커밋되지 않습니다.
- 앱은 빌드 시점에 값이 필요하므로 `mobile.bat` 이 이 설정을 읽어 `--dart-define` 으로 전달합니다.
- **DB 주소는 저장소에 넣지 마세요.** 인증 없이 읽는 구조라 주소가 알려지면 터널 URL 이 노출됩니다.

## Third-Party

이 프로젝트에 포함된 오픈소스 고지는 [THIRD-PARTY-NOTICES](THIRD-PARTY-NOTICES)를 참조하세요.
