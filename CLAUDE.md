# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

**EasyProject4(EP4)** — 로컬 PC에서 Claude CLI를 이용해 프로젝트/태스크를 관리하고 순차 실행하는 하네스 시스템.  
웹 대시보드(dist/)와 Flutter 모바일 앱(mobile/)으로 구성된다.

## 실행 명령

```bat
run.bat            # EP4 서버 시작 (localhost:7788)
tunnel.bat         # Cloudflare 임시 터널 (기본 포트 7788)
tunnel.bat 8080    # 포트 직접 지정
mobile.bat         # Flutter 앱 (Windows 데스크톱, 기본)
mobile.bat chrome  # 특정 디바이스 지정
desktop.bat        # Electron 데스크톱 앱 개발 모드 (서버 자동 기동 + 대시보드 창)
```

데스크톱 앱 빌드(`desktop/release/ep4.exe`): `cd desktop && npm run dist` — 자세한 내용은 `desktop/README.md`.

Python 의존성 설치:
```
pip install -r requirements.txt
```

## 아키텍처

### 전체 구조

```
server.py (7788)           ← 메인 서버 + 하네스 실행 엔진
  ├─ dist/                 ← 웹 대시보드 정적 파일 (server.py가 직접 서빙)
  ├─ server/projects.db    ← 주 SQLite DB (projects, project_tasks, task_runs)
  └─ server/workspace/     ← git 격리 worktree 작업 공간

mobile/                    ← Flutter 앱 (Cloudflare Tunnel 경유 접속)

ep4_mcp.py                 ← Claude CLI MCP 서버 (글로벌 설정 등록)
ep4_hook_prompt.py         ← UserPromptSubmit 훅: 입력 → EP4 태스크 자동 등록
ep4_hook_stop.py           ← Stop 훅: 응답 완료 → EP4 run log 저장
```

### server.py 핵심 레이어

| 레이어 | 위치 | 역할 |
|--------|------|------|
| HTTP 서버 | `ThreadedHTTPServer` | `do_GET` / `do_POST` / `do_DELETE` 핸들러 |
| 하네스 실행 | `harness_runner()` | 태스크 순차 실행, Git worktree 격리, claude CLI subprocess |
| 세션 관리 | `session_create()` 외 | 대화형 PTY/subprocess 세션 (pywinpty or Popen) |
| 실시간 알림 | `emit()` → SSE | 브라우저/모바일에 상태 푸시 |
| Gate 동기화 | `_gate_*` 함수군 | op-log LWW 방식 gate 동기화 클라이언트 (레거시 — manager_server 제거로 현재 미사용) |

### 데이터 모델

- **projects** — `id, name, description, model, project_root, session_name, ...`
- **project_tasks** — `id, project_id, title, prompt, status, output, uid, trigger_type, ...`
- **task_runs** — `id, task_id, project_id, status, output, log_lines, trace_id, span_id, git_*`

### 태스크 실행 흐름

```
POST /api/projects/{id}/tasks/{tid}/run
  → harness_runner(project_id, single_task_id)
    → Git worktree 생성 (project_root 기반, git 있을 때)
    → claude CLI subprocess (--dangerously-skip-permissions 또는 tool_perms)
    → task_runs INSERT
    → Git 커밋 → 프로젝트 브랜치 머지
    → SSE emit("run_done")
```

`project_root`가 설정되고 해당 디렉토리에 git이 있으면 태스크마다 `project/{slug}/task001` 형태의 worktree 브랜치를 자동 생성한다.  
세션(`session_name`)이 설정된 프로젝트는 subprocess 대신 활성 PTY 세션으로 프롬프트를 전달한다.

### 플러그인 프레임워크 (pluggy)

백엔드 플러그인 시스템은 [pluggy](https://pluggy.readthedocs.io) 훅 기반이며 `ep4_plugins.py`에 정의된다.

| 구성 | 역할 |
|------|------|
| `EP4Spec` | 훅 명세(hookspec) — 확장 지점 정의 |
| `CorePlugin` | 기본 구현 — `plugins/` 카테고리 폴더 스캔, Helper 에이전트 파일 로드 |
| `get_plugin_manager()` | 매니저 싱글톤. `CorePlugin` + 각 플러그인 `backend.py` 자동 등록 |
| `dispatch_route()` | 플러그인이 등록한 HTTP 라우트를 do_GET/do_POST 폴백에서 디스패치 |
| `invalidate_route_cache()` | 라우트 캐시 무효화 — 플러그인 토글·설치 후 호출 |
| `register_enabled_checker(fn)` | 활성 플러그인 id 집합 반환 함수 주입 — 비활성 라우트 필터링에 사용 |
| `get_plugin_load_errors()` | backend.py 로드 실패 플러그인 `{pid: error}` 반환 |

훅 종류: `ep4_collect_manifests`, `ep4_collect_agents`, `ep4_register_routes`,
`ep4_on_task_done`, `ep4_on_plugin_toggle`.

server.py는 `EP4_PM = get_plugin_manager()`로 매니저를 잡고,
`_scan_plugin_manifests()` · `/api/agents` · 플러그인 토글 · 태스크 완료 · 백엔드 라우트 디스패치를
모두 이 훅들에 위임한다. 프론트엔드 뷰 플러그인(`plugin.json` + `view.js`)은 그대로 동작한다.

#### 플러그인 폴더 구조

```
plugins/
├── View/      ← UI 화면 플러그인 (plugin.json + view.js)
│   ├── dashboard/
│   ├── projects/
│   ├── tasks/
│   ├── runlog/
│   └── sessions/
├── MCP/       ← MCP 커넥터 플러그인 (비어 있음, 추후 추가)
├── Data/      ← 데이터 관리 플러그인 (비어 있음, 추후 추가)
└── Helper/    ← 에이전트(도우미) 플러그인 (type: "agent")
    ├── octopus/
    ├── penguin/
    ├── cat/
    └── dog/
```

- 각 플러그인 폴더에는 `plugin.json`이 필수이며, View 플러그인은 `view.js`도 포함한다.
- 백엔드 로직이 있는 플러그인은 `backend.py`를 추가한다 (`ep4_plugins.py` 훅 구현).
- `_iter_plugin_dirs(base_dir)`가 카테고리 하위 구조와 플랫 구조를 모두 투명하게 스캔한다.
- `dist/plugins/`는 번들드 플러그인(빌드 산출물)으로 직접 편집하지 않는다.

백엔드 플러그인 작성법과 템플릿: `docs/examples/backend_plugin/`.

### Claude CLI MCP 통합

`~/.claude/settings.json`에 `mcpServers.ep4` 와 `hooks`가 등록되어 있다.

- **ep4_find_project** — CWD와 `project_root` 매칭
- **ep4_create_task** — 태스크 등록 (`trigger_type: "claude_cli"`)
- **ep4_log_result** — `POST /api/projects/{pid}/tasks/{tid}/log-result` 호출
- **ep4_list_projects** — 전체 프로젝트 목록

훅은 EP4 서버가 없으면 조용히 종료하므로 서버가 꺼져 있어도 Claude CLI 동작에는 영향이 없다.

#### Antigravity(Gemini) CLI 훅

Gemini CLI(Antigravity 엔진)도 Claude와 호환되는 훅 페이로드(`prompt`·`session_id`·`cwd`)를 쓰므로 동일한 스크립트를 재사용한다. `~/.gemini/settings.json` 의 `hooks` 에 등록하되, 트리거 구분을 위해 인자로 `antigravity_cli` 를 넘긴다.

```jsonc
// ~/.gemini/settings.json
"hooks": {
  "UserPromptSubmit": [{"matcher":"","hooks":[{"type":"command","command":"python \"…/ep4_hook_prompt.py\" antigravity_cli"}]}],
  "Stop":             [{"matcher":"","hooks":[{"type":"command","command":"python \"…/ep4_hook_stop.py\" antigravity_cli"}]}]
}
```

- `ep4_hook_prompt.py` / `ep4_hook_stop.py` 는 첫 번째 인자(또는 `EP4_TRIGGER_TYPE` 환경변수)로 trigger_type 을 받는다(기본 `claude_cli`).
- `log-result` 엔드포인트는 body 의 `trigger_type` 을 그대로 기록하므로, Gemini 입력은 `antigravity_cli` 트리거로 EP4 태스크에 등록된다(UI 에 "Antigravity" 라벨 표시).

### Flutter 앱 (mobile/)

- 상태 관리: `Provider` → `AppState` (연결, API 클라이언트, SSE 이벤트 스트림 보유)
- 서버 연결: `ConnectScreen` — `EP4_DEFAULT_URL` dart-define으로 기본값 주입 (`mobile.bat` 참고)
- SSE: `SseClient`가 `/api/events` 구독, 실시간 상태 반영

## 주요 파일 위치

| 목적 | 경로 |
|------|------|
| 메인 서버 | `server.py` |
| 데스크톱 앱 | `desktop/` (Electron — main.js, splash.html), `desktop.bat` |
| 플러그인 프레임워크 | `ep4_plugins.py` (pluggy 훅), `plugins/` (View·MCP·Data·Helper), `docs/examples/backend_plugin/` |
| 웹 대시보드 | `dist/index.html`, `dist/app.js` |
| 주 DB | `server/projects.db` |
| 세션 로그 | `log/` |
| Git 격리 작업 | `server/worktrees/` |
| MCP 서버 | `ep4_mcp.py` |
| 훅 스크립트 | `ep4_hook_prompt.py`, `ep4_hook_stop.py` |
| 터널 가이드 | `docs/tunnel_guide.md` |
| 로컬 전용 설정 | `conf/ep4.local.conf` (커밋 금지 — 인증 토큰, `firebase_db_url`) |

## UI 규칙

- **모든 팝업은 커스텀 모달을 사용한다.** `window.alert()`, `window.confirm()`, `window.prompt()` 등 브라우저 네이티브 다이얼로그는 절대 사용하지 않는다.
  - 알림: `showAlert(msg, {title, type})` — type: `'info' | 'success' | 'warning' | 'error'`
  - 확인: `showConfirm(msg, {title, type, ok, cancel})` — type: `'confirm' | 'delete' | 'warning'`
  - 입력: `showInput(msg, {title, ok, cancel, defaultValue, placeholder})` — 텍스트 입력 포함 모달

## 주의 사항

- `dist/`는 빌드 산출물이므로 직접 편집하지 않는다.  
- `server/projects.db`는 WAL 모드 SQLite이므로 서버 실행 중에는 직접 수정을 피한다.  
- `project_root` 경로가 설정된 프로젝트에서 태스크를 실행하면 git worktree가 자동 생성된다. git이 없는 경로이면 worktree 없이 직접 실행된다.  
- **Firebase Realtime DB 주소(`firebase_db_url`)는 코드에 하드코딩하지 않는다.** `conf/ep4.local.conf` 에서만 읽으며(`server.py` `main()`, `ep4_firebase_push.py`, `mobile.bat` → `--dart-define=EP4_FIREBASE_DB`), 값이 없으면 터널 URL 공유 기능만 조용히 비활성화된다. 이 DB 는 인증 없이 읽히므로 주소가 공개되면 터널 URL 이 노출된다.
- EP4 서버는 기본적으로 `localhost`만 바인드한다. LAN/외부 접속이 필요하면 `run.bat` 내 `--bind 0.0.0.0` 옵션을 추가하거나 `tunnel.bat`을 사용한다.
