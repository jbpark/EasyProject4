"""
EasyProject4 Server
- todo_list.md 에서 task 를 읽어 순차 실행
- 웹 대시보드로 진행 상황 실시간 표시
- Task CRUD (추가/수정/삭제) 지원
- dist/ 폴더의 정적 파일(index.html, app.js)을 서빙
"""

import os
import re
import io
import sys
import json
import time
import queue
import shutil
import secrets
import socket
import sqlite3
import threading
import subprocess
from pathlib import Path
from datetime import datetime
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn

class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True

    def handle_error(self, request, client_address):
        # 클라이언트가 먼저 연결을 끊을 때 발생하는 정상적인 네트워크 오류는 무시한다.
        import sys as _sys
        exc = _sys.exc_info()[1]
        if isinstance(exc, (ConnectionAbortedError, ConnectionResetError, BrokenPipeError)):
            return
        super().handle_error(request, client_address)
from urllib.parse import urlparse, parse_qs

BASE_DIR  = Path(__file__).parent / "server"  # (Git 실행 로그 표시 테스트용 주석)
DIST_DIR  = Path(__file__).parent / "dist"
PLUGINS_DIR           = DIST_DIR / "plugins"           # 번들드 플러그인 (dist/)
INSTALLED_PLUGINS_DIR = Path(__file__).parent / "plugins"  # 설치된 플러그인 (프로젝트 루트)
MARKETPLACE_CONF      = Path(__file__).parent / "conf" / "marketplace.conf"
TODO_FILE = BASE_DIR / "todo_list.md"
SERVER_START_TIME = datetime.now().isoformat()
_BOOT_VER = int(time.time())
_seen_remote_ips_lock = threading.Lock()
# 수신 연결 기록 {key: {kind, ip, client, hostname, local_ip, via, first, last, count}}
# 서버 재시작 시 초기화. 최초 1회만 콘솔 출력, 이후엔 last/count 만 갱신.
_conn_seen: dict = {}
# 발신 peer 연결 기록 {url: {url, host, ok, error, first, last, count}}
_peer_out_seen: dict = {}
# 수신 접촉으로 촉발되는 발신 재확인의 마지막 시각 {url: epoch} — 과도한 재시도 방지
_peer_out_retry_ts: dict = {}
_PEER_OUT_RETRY_GAP = 60   # 초 — 발신 재확인 최소 간격
# peer 별 마지막으로 확인한 부팅 인스턴스 ID {url: iid} — 변경되면 상대 재시작으로 판정
_peer_instance_seen: dict = {}
_PEER_RECONNECT_GAP = 90   # 초 — EP4 peer 가 이 시간 이상 무소식 후 재수신되면 재연결로 표시
# 인바운드 API 인증 토큰. 빈 문자열이면 인증 비활성(하위호환). main()에서 설정.
_AUTH_TOKEN = ""
# MCP(claude_cli) log-result 시 사용자 워킹트리의 미커밋 변경을 자동 커밋할지 여부.
# 기본 False — 사용자가 작업 중인 브랜치에 무단 커밋하지 않는다. conf 로 옵트인.
_CLI_AUTO_COMMIT = False
OUTPUT_DIR = BASE_DIR / "output"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
WORKSPACE  = BASE_DIR / "workspace"
MAIN_BRANCH = "main"
WEBDOCS_DIR = BASE_DIR / "webdocs"   # 태스크 프롬프트·답변 웹 문서 (프로젝트별 JSON)


def _webdoc_path(pid: int) -> Path:
    WEBDOCS_DIR.mkdir(parents=True, exist_ok=True)
    return WEBDOCS_DIR / f"{pid}.json"


def _webdoc_load(pid: int) -> dict:
    try:
        return json.loads(_webdoc_path(pid).read_text(encoding="utf-8"))
    except Exception:
        return {"project_id": pid, "project_name": "", "entries": []}


def _webdoc_save(pid: int, doc: dict):
    _webdoc_path(pid).write_text(
        json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")

# ── 플러그인 프레임워크 (pluggy) ───────────────────────────
from ep4_plugins import (
    get_plugin_manager, dispatch_route,
    invalidate_route_cache, get_plugin_load_errors, register_enabled_checker,
)
EP4_PM = get_plugin_manager()

# ── 진입점 ─────────────────────────────────────────────
state = {
    "status": "idle",
    "tasks": [],
    "current": -1,
    "log": [],
}
state_lock = threading.Lock()
sse_clients: list[queue.Queue] = []
sse_lock = threading.Lock()


# ── todo_list.md 파서 ──────────────────────────────────
def parse_command(text: str) -> str:
    m = re.search(r'\(([^)]+)\)$', text.strip())
    if m:
        cmd = m.group(1).strip()
        if re.match(r'^[\w./\\-]+\.\w+$', cmd):
            return f'type "{cmd}" 2>nul || echo (?뚯씪 ?놁쓬: {cmd})'
        return cmd
    return f'echo {text.strip()}'


def _dedent(lines: list) -> str:
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    if not lines:
        return ""
    indents = [len(l) - len(l.lstrip()) for l in lines if l.strip()]
    common = min(indents) if indents else 0
    return "\n".join(l[common:] if len(l) >= common else l for l in lines)


def _split_meta(body: str) -> tuple[str, str, str]:
    keep, test, branch = [], "", ""
    for line in body.splitlines():
        mt = re.match(r'\s*-?\s*테스트\s*[:：]\s*(.*)', line)
        mb = re.match(r'\s*-?\s*브랜치\s*[:：]\s*(.*)', line)
        if mt and not test:
            test = mt.group(1).strip()
        elif mb and not branch:
            branch = mb.group(1).strip()
        else:
            keep.append(line)
    return "\n".join(keep).strip("\n"), test, branch


def load_todos() -> list:
    if not TODO_FILE.exists():
        return []
    tasks = []
    tid = 0
    raw_lines = TODO_FILE.read_text(encoding="utf-8").splitlines()
    cur = None
    body_buf: list = []

    def flush_body():
        if cur is not None:
            body, test, branch = _split_meta(_dedent(body_buf))
            cur["body"] = body
            cur["test"] = test
            cur["branch"] = branch

    for line in raw_lines:
        m = re.match(r'\s*-\s*\[([ xX])\]\s*(.+)', line)
        if m:
            flush_body()
            body_buf = []
            done = m.group(1).lower() == 'x'
            text = m.group(2).strip()
            cur = {
                "id": tid, "text": text, "body": "", "test": "", "branch": "",
                "command": parse_command(text),
                "status": "done" if done else "pending",
                "output": "", "started_at": None, "ended_at": None,
            }
            tasks.append(cur)
            tid += 1
        elif re.match(r'\s*#', line):
            flush_body()
            body_buf = []
            cur = None
        elif cur is not None:
            body_buf.append(line)

    flush_body()
    return tasks


def save_todos(tasks: list):
    lines = ["# Harness Todo List\n", "\n## Tasks\n"]
    for t in tasks:
        mark = "x" if t["status"] == "done" else " "
        lines.append(f"- [{mark}] {t['text']}\n")
        body = (t.get("body") or "").strip("\n")
        if body:
            lines.append("\n")
            for bl in body.splitlines():
                lines.append(f"  {bl}\n" if bl.strip() else "\n")
        test = (t.get("test") or "").strip()
        if test:
            lines.append("\n")
            lines.append(f"  ?뚯뒪?? {test}\n")
        branch = (t.get("branch") or "").strip()
        if branch:
            lines.append("\n")
            lines.append(f"  브랜치: {branch}\n")
        lines.append("\n")
    TODO_FILE.write_text("".join(lines), encoding="utf-8")


# ── Task 실행 엔진 ─────────────────────────────────────
def run_command(cmd: str, timeout: int = 30, cwd: str = None) -> tuple[int, str]:
    try:
        if sys.platform == "win32":
            cmd = f"chcp 65001 > nul 2>&1 & {cmd}"
        result = subprocess.run(
            cmd, shell=True, capture_output=True, text=True,
            timeout=timeout, cwd=cwd or str(WORKSPACE),
            encoding="utf-8", errors="replace"
        )
        out = (result.stdout + result.stderr).strip()
        return result.returncode, out
    except subprocess.TimeoutExpired:
        return -1, "TIMEOUT"
    except Exception as e:
        return -2, str(e)


def git(args: str, timeout: int = 30) -> tuple[int, str]:
    return run_command(f"git {args}", timeout=timeout, cwd=str(WORKSPACE))


def git_available() -> bool:
    rc, _ = run_command("git --version", cwd=str(WORKSPACE))
    return rc == 0


def ensure_workspace():
    WORKSPACE.mkdir(parents=True, exist_ok=True)
    if not (WORKSPACE / ".git").exists():
        git("init")
        git('config user.name "Harness Runner"')
        git('config user.email "harness@local"')
        (WORKSPACE / "README.md").write_text(
            "# Harness Workspace\n\n각 태스크는 별도 브랜치에서 작업 후 main 으로 머지됩니다.\n",
            encoding="utf-8",
        )
        git("add -A")
        git(f'commit -m "chore: 워크스페이스 초기화"')
        git(f"branch -M {MAIN_BRANCH}")


def make_branch_name(task: dict) -> str:
    base = task["text"].strip().lower()
    base = re.sub(r'\s+', '-', base)
    base = re.sub(r'[~^:?*\[\]\\()"\'@{}.]+', '', base)
    base = re.sub(r'-{2,}', '-', base).strip('-')
    if not base:
        base = "task"
    return f"task/{task['id'] + 1:02d}-{base}"


def emit(event: str, data: dict):
    msg = {"event": event, "data": data}
    with sse_lock:
        for q in sse_clients:
            try:
                q.put_nowait(msg)
            except queue.Full:
                pass


def log(msg: str):
    entry = f"[{datetime.now().strftime('%H:%M:%S')}] {msg}"
    with state_lock:
        state["log"].append(entry)


def run_task_with_git(task: dict) -> tuple[int, str]:
    use_git = git_available()
    branch = make_branch_name(task)
    parts = []

    if use_git:
        ensure_workspace()
        git(f"checkout {MAIN_BRANCH}")
        git(f"branch -D {branch}")
        rc_b, out_b = git(f"checkout -b {branch}")
        if rc_b != 0:
            return -3, f"브랜치 생성 실패: {out_b}"
        log(f"  ↳ 브랜치 생성: {branch}")
        parts.append(f"branch={branch}")

    rc, output = run_command(task["command"])
    parts.append(f"work rc={rc}")
    if rc != 0:
        return rc, " | ".join(parts) + f"\n{output}"

    if use_git:
        git("add -A")
        git(f'commit --allow-empty -m "feat: {task["text"]}"')

    test_desc = (task.get("test") or "").strip()
    if test_desc:
        log(f"  테스트케이스: {test_desc}")
        parts.append("test=pass")

    if use_git:
        git(f"checkout {MAIN_BRANCH}")
        rc_m, out_m = git(f'merge --no-ff {branch} -m "merge {branch}"')
        if rc_m != 0:
            return -4, " | ".join(parts) + f"\nmerge ?ㅽ뙣: {out_m}"
        log(f"  ↳ main 머지 완료: {branch}")
        parts.append("merged?뭢ain")
        task["branch"] = branch

    return 0, " | ".join(parts) + (f"\n{output}" if output else "")


project_states: dict = {}   # { project_id: {"status": "idle"/"running"/"done"/"error", "current_task": None} }
project_states_lock = threading.Lock()


# ── Session Manager ────────────────────────────────────────────
import uuid as _uuid_mod

_sessions: dict = {}        # { session_id: session_dict }
_sessions_lock = threading.Lock()

# Windows PTY support (pywinpty)
try:
    from winpty import PtyProcess as _PtyProcess
    _HAS_WINPTY = True
except ImportError:
    _HAS_WINPTY = False

_ANSI_ESC = re.compile(r'\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*\x07)')

def _strip_ansi(text: str) -> str:
    return _ANSI_ESC.sub('', text)


# ── 터미널 에뮬레이터 (pyte 기반: 2D 화면·CR·커서이동·SGR 색상) ──────
import html as _htmllib
try:
    import pyte
    from pyte.screens import Margins as _PyteMargins
    _HAS_PYTE = True
except ImportError:
    _HAS_PYTE = False

# pyte 색상명 → CSS (VS Code 다크 팔레트). 256/truecolor는 6자리 hex 문자열.
_PYTE_COLORS = {
    'black':'#1e1e1e','red':'#cd3131','green':'#0dbc79','brown':'#e5e510',
    'blue':'#2472c8','magenta':'#bc3fbc','cyan':'#11a8cd','white':'#e5e5e5',
    'brightblack':'#666666','brightred':'#f14c4c','brightgreen':'#23d18b',
    'brightbrown':'#f5f543','brightyellow':'#f5f543','brightblue':'#3b8eea',
    'brightmagenta':'#d670d6','brightcyan':'#29b8db','brightwhite':'#ffffff',
}

def _pyte_color(v):
    if not v or v == 'default':
        return None
    if v in _PYTE_COLORS:
        return _PYTE_COLORS[v]
    if len(v) == 6:
        try:
            int(v, 16); return '#' + v
        except ValueError:
            return None
    return None


if _HAS_PYTE:
    class _LogScreen(pyte.HistoryScreen):
        """화면 밖으로 스크롤되어 나간 라인을 캡처하는 HistoryScreen."""
        def __init__(self, columns, lines, history=4000):
            super().__init__(columns, lines, history=history, ratio=0.5)


        def index(self):
            top, bottom = self.margins or _PyteMargins(0, self.lines - 1)
            if self.cursor.y == bottom:
                self._scrolled.append(self._row(self.buffer[top]))
            super().index()

        def drain(self):
            r = self._scrolled
            self._scrolled = []
            return r

        def _style(self, ch):
            fg, bg = _pyte_color(ch.fg), _pyte_color(ch.bg)
            if ch.reverse:
                fg, bg = (bg or '#1e1e1e'), (fg or '#d4d4d4')
            p = []
            if fg: p.append('color:' + fg)
            if bg: p.append('background:' + bg)
            if ch.bold: p.append('font-weight:600')
            if ch.italics: p.append('font-style:italic')
            if ch.underscore: p.append('text-decoration:underline')
            return ';'.join(p)

        def _row(self, row):
            """한 행을 (평문, html) 로 렌더. 전각문자 연속 셀은 건너뜀."""
            maxx = -1
            for x in range(self.columns):
                c = row[x]
                if (c.data not in ('', ' ')) or c.bg != 'default':
                    maxx = x
            text, parts, cur, buf = [], [], None, []
            def flush():
                if buf:
                    seg = _htmllib.escape(''.join(buf))
                    parts.append(f'<span style="{cur}">{seg}</span>' if cur else seg)
            for x in range(maxx + 1):
                c = row[x]
                if c.data == '':       # 전각문자 연속(continuation) 셀
                    continue
                st = self._style(c); d = c.data or ' '
                text.append(d)
                if st != cur:
                    flush(); buf.clear(); cur = st
                buf.append(d)
            flush()
            return (''.join(text).rstrip(), ''.join(parts))

        def render(self):
            """현재 화면 전체를 (text, html)로 렌더. 끝의 빈 줄 제거."""
            rows, last = [], -1
            for y in range(self.lines):
                rows.append(self._row(self.buffer[y]))
                if rows[y][0].strip():
                    last = y
            text = '\n'.join(r[0] for r in rows[:last + 1])
            html = ''.join(f'<div class="sess-line">{rows[y][1]}</div>'
                           for y in range(last + 1))
            return text, html


class _PyteEmu:
    """pyte 화면 에뮬레이터. feed() → (scrolled, live_html, live_text)."""
    def __init__(self, cols=220, rows=40):
        self.screen = _LogScreen(cols, rows)
        self.stream = pyte.Stream(self.screen)

    def feed(self, text):
        self.stream.feed(text)
        scrolled = self.screen.drain()
        live_text, live_html = self.screen.render()
        return scrolled, live_html, live_text

    def flush_visible(self):
        return self.screen.render()[0]


class _LineEmu:
    """pyte 미설치 시 폴백: 단순 라인 분리(\\r은 마지막 세그먼트만 유지)."""
    def __init__(self, *a, **k):
        self._buf = ''

    def feed(self, text):
        self._buf += text
        scrolled = []
        while '\n' in self._buf:
            line, self._buf = self._buf.split('\n', 1)
            line = _strip_ansi(line).split('\r')[-1]
            scrolled.append((line, _htmllib.escape(line)))
        live = _strip_ansi(self._buf).split('\r')[-1]
        live_html = f'<div class="sess-line">{_htmllib.escape(live)}</div>' if live else ''
        return scrolled, live_html, live

    def flush_visible(self):
        return _strip_ansi(self._buf).split('\r')[-1]


def _make_emu():
    return _PyteEmu() if _HAS_PYTE else _LineEmu()


def _sess_feed(sid: str, text: str):
    """청크를 세션 에뮬레이터에 입력하고, 스크롤된 라인은 확정(로그+영구),
    현재 화면은 live 'screen' 이벤트로 전송한다."""
    emu = flock = None
    with _sessions_lock:
        s = _sessions.get(sid)
        if s is None:
            return
        emu = s.get("emu")
        if emu is None:
            emu = _make_emu(); s["emu"] = emu
        flock = s.get("feed_lock")
        if flock is None:
            flock = threading.Lock(); s["feed_lock"] = flock

    with flock:
        scrolled, live_html, live_text = emu.feed(text)

    log_file = None
    with _sessions_lock:
        s = _sessions.get(sid)
        if s is None:
            return
        for t, h in scrolled:
            s["output"].append({"type": "stdout", "text": t, "html": h,
                                "ts": datetime.now().isoformat()})
        if scrolled:
            mb = s.get("max_buffer", 2000)
            if len(s["output"]) > mb:
                s["output"] = s["output"][-mb:]
        s["screen_html"] = live_html
        s["screen_text"] = live_text
        s["activity"] = s.get("activity", 0) + 1
        prev = [p for p in live_text.split('\n') if p.strip()]
        if prev:
            s["last_output"] = prev[-1].strip()
        elif scrolled and scrolled[-1][0].strip():
            s["last_output"] = scrolled[-1][0].strip()
        log_file = s.get("log_file")

    for t, h in scrolled:                         # 확정된 라인만 로그 기록
        _sess_write_log(log_file, t + "\n")
        emit("session_output", {"session_id": sid, "kind": "commit",
                                "entry": {"type": "stdout", "text": t, "html": h}})
    emit("session_output", {"session_id": sid, "kind": "screen",
                            "html": live_html, "text": live_text})


def _sess_write_log(log_file: str, text: str):
    if not log_file or not text:
        return
    try:
        with open(log_file, 'a', encoding='utf-8') as f:
            f.write(text)
    except Exception:
        pass


def _sess_finalize(sid: str):
    """리더 종료: 화면에 남은 내용을 로그에 기록 + 종료 마커 + 상태 갱신."""
    log_file, vis = None, ""
    with _sessions_lock:
        s = _sessions.get(sid)
        if s:
            if s["status"] == "running":
                s["status"] = "dead"
            log_file = s.get("log_file")
            emu = s.get("emu")
            if emu:
                vis = emu.flush_visible()
    if vis.strip():
        _sess_write_log(log_file, vis.rstrip('\n') + "\n")
    _sess_write_log(log_file, f"=== 세션 종료 · {datetime.now().isoformat()} ===\n")
    emit("session_status", {"session_id": sid, "status": "dead", "action": "dead"})


def _sess_reader(sid: str, stream, stype: str):
    """일반 파이프 리더 (PTY 미사용 fallback)."""
    try:
        while True:
            line = stream.readline()
            if not line:
                break
            _sess_feed(sid, line)
    except Exception:
        pass
    finally:
        _sess_finalize(sid)


def _sess_pty_reader(sid: str, proc):
    """Windows PTY 리더 — 청크를 pyte 터미널 에뮬레이터로 처리."""
    _err_count = 0
    try:
        while True:
            try:
                chunk = proc.read(4096)
                _err_count = 0
            except EOFError:
                break
            except Exception:
                _err_count += 1
                if _err_count >= 5:
                    break          # 연속 5회 실패 시만 종료
                time.sleep(0.1)
                continue
            if not chunk:
                break
            _sess_feed(sid, chunk)
    except Exception:
        pass
    finally:
        _sess_finalize(sid)


def session_create(name: str, cwd: str = None, command: str = None) -> dict:
    import shlex as _shlex
    if command and command.strip():
        parts = _shlex.split(command.strip())
        if parts and parts[0] == "claude":
            parts[0] = shutil.which("claude") or "claude"
        if not parts:
            raise RuntimeError("커맨드가 비어 있습니다.")
        cmd = parts
    else:
        claude_bin = shutil.which("claude") or ""
        if not claude_bin:
            raise RuntimeError("claude CLI를 찾을 수 없습니다.")
        cmd = [claude_bin, "--dangerously-skip-permissions"]
    sid = "sess_" + _uuid_mod.uuid4().hex[:8]

    # 기본 로그 파일 경로 (프로젝트 루트\log, YYMMDD_HHMMSS 형식)
    _log_dir = BASE_DIR.parent / "log"
    _log_dir.mkdir(parents=True, exist_ok=True)
    _safe_name = re.sub(r'[^\w\-]', '_', name)
    _now = datetime.now()
    _ts = _now.strftime('%y%m%d_%H%M%S')
    default_log_file = str(_log_dir / f"{_safe_name}_{_ts}.log")

    _common = {
        "id": sid, "name": name, "status": "running",
        "output": [], "created_at": datetime.now().isoformat(),
        "cwd": cwd or "", "last_output": "",
        "log_file": default_log_file, "max_buffer": 2000,
        "screen_html": "", "screen_text": "", "activity": 0,
        "emu": None, "feed_lock": None,
    }

    # 세션 시작 헤더 기록
    _sess_write_log(default_log_file,
        f"=== 세션 시작 · {name} · {_now.isoformat()} ===\n"
        f"CMD: {' '.join(cmd)}\n"
        f"CWD: {cwd or '(기본)'}\n"
        f"{'=' * 60}\n"
    )

    if _HAS_WINPTY:
        pty_proc = _PtyProcess.spawn(cmd, cwd=cwd or None, dimensions=(40, 220))
        sess = {**_common, "proc": pty_proc, "pid": pty_proc.pid, "is_pty": True}
        with _sessions_lock:
            _sessions[sid] = sess
        threading.Thread(target=_sess_pty_reader, args=(sid, pty_proc), daemon=True).start()
    else:
        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            encoding="utf-8", errors="replace", cwd=cwd or None,
        )
        sess = {**_common, "proc": proc, "pid": proc.pid, "is_pty": False}
        with _sessions_lock:
            _sessions[sid] = sess
        threading.Thread(target=_sess_reader, args=(sid, proc.stdout, "stdout"), daemon=True).start()
        threading.Thread(target=_sess_reader, args=(sid, proc.stderr, "stderr"), daemon=True).start()

    info = _sess_info(sess)
    emit("session_status", {**info, "action": "created"})
    return info


def session_kill(sid: str) -> bool:
    with _sessions_lock:
        sess = _sessions.get(sid)
        if not sess:
            return False
        proc   = sess.get("proc")
        is_pty = sess.get("is_pty", False)
        if proc and sess["status"] == "running":
            try:
                if is_pty:
                    proc.close()
                else:
                    proc.terminate()
            except Exception:
                pass
        sess["status"] = "dead"
    emit("session_status", {"session_id": sid, "status": "dead", "action": "killed"})
    return True


def session_send_input(sid: str, text: str) -> bool:
    with _sessions_lock:
        sess = _sessions.get(sid)
        if not sess or sess["status"] != "running":
            return False
        proc   = sess.get("proc")
        is_pty = sess.get("is_pty", False)
    try:
        if is_pty:
            # Bracketed Paste Mode로 텍스트를 붙여넣은 뒤, Claude Code가 paste
            # preview를 표시하므로 잠시 후 Enter(\r)를 보내 제출한다.
            proc.write("\x1b[200~" + text + "\x1b[201~")
            def _send_enter():
                time.sleep(0.25)
                try:
                    proc.write("\r")
                except Exception:
                    pass
            threading.Thread(target=_send_enter, daemon=True).start()
        else:
            proc.stdin.write(text + "\n")
            proc.stdin.flush()
        entry = {"type": "stdin", "text": text, "html": _htmllib.escape(text),
                 "ts": datetime.now().isoformat()}
        log_file = None
        with _sessions_lock:
            if sid in _sessions:
                _sessions[sid]["output"].append(entry)
                log_file = _sessions[sid].get("log_file")
        _sess_write_log(log_file, f"[INPUT] {text}\n")
        emit("session_output", {"session_id": sid, "kind": "commit", "entry": entry})
        return True
    except Exception:
        return False


def sessions_list() -> list:
    with _sessions_lock:
        result = []
        for sid, s in list(_sessions.items()):
            proc = s.get("proc")
            if proc and s["status"] == "running":
                is_pty = s.get("is_pty", False)
                dead = (not proc.isalive()) if is_pty else (proc.poll() is not None)
                if dead:
                    s["status"] = "dead"
            result.append(_sess_info(s))
        return result


def _sess_info(s: dict) -> dict:
    return {
        "id": s["id"], "name": s["name"], "status": s["status"],
        "pid": s.get("pid"), "created_at": s["created_at"], "cwd": s.get("cwd", ""),
        "last_output": s.get("last_output", ""),
        "log_file": s.get("log_file", ""), "max_buffer": s.get("max_buffer", 2000),
    }


def _session_is_running(session_name: str) -> bool:
    """해당 이름의 대화형 세션이 현재 실행 중인지 확인한다."""
    if not session_name:
        return False
    with _sessions_lock:
        return any(s["name"] == session_name and s["status"] == "running"
                   for s in _sessions.values())


def _prev_task_session(project_id: int) -> str:
    """프로젝트에서 가장 최근 실행이 사용한 세션 이름을 반환 (없으면 '').
    아직 실행 중인 세션만 유효하므로 죽은 세션은 건너뛰고 더 과거를 훑는다."""
    try:
        with sqlite3.connect(PROJECTS_DB) as conn:
            rows = conn.execute(
                "SELECT session_name FROM task_runs "
                "WHERE project_id=? AND COALESCE(session_name,'') != '' "
                "ORDER BY id DESC LIMIT 20",
                (project_id,)
            ).fetchall()
    except Exception:
        return ""
    for (name,) in rows:
        if _session_is_running(name):
            return name
    return ""


def _session_run_prompt(session_name: str, prompt: str, timeout: int = 300) -> tuple:
    """세션에 프롬프트를 전송하고 응답이 끝날 때까지 대기 후 출력 반환.
    Returns (success: bool, output: str)
    """
    sid = None
    start_len = 0
    start_act = 0
    with _sessions_lock:
        for s in _sessions.values():
            if s["name"] == session_name and s["status"] == "running":
                sid = s["id"]
                start_len = len(s["output"])
                start_act = s.get("activity", 0)
                break

    if not sid:
        return False, f"세션 '{session_name}'을 찾을 수 없거나 실행 중이 아닙니다."

    if not session_send_input(sid, prompt):
        return False, "세션 입력 전송 실패"

    # PTY: \r이 0.25s 딜레이 후 전송되므로 그 이후부터 출력 폴링 시작
    time.sleep(0.4)

    # idle 감지: IDLE_WAIT 초 동안 새 출력(확정/진행 갱신 모두) 없으면 완료로 판단
    IDLE_WAIT  = 6.0
    last_act   = start_act
    last_new   = time.time()
    deadline   = time.time() + timeout

    while time.time() < deadline:
        time.sleep(0.4)
        with _sessions_lock:
            if sid not in _sessions or _sessions[sid]["status"] != "running":
                break
            curr_act = _sessions[sid].get("activity", 0)
        if curr_act > last_act:
            last_act = curr_act
            last_new = time.time()
        elif last_act > start_act and (time.time() - last_new) >= IDLE_WAIT:
            break

    with _sessions_lock:
        if sid not in _sessions:
            return False, "세션이 응답 중 종료됐습니다."
        new_entries = _sessions[sid]["output"][start_len:]
        screen_text = _sessions[sid].get("screen_text", "")

    lines = [e["text"] for e in new_entries if e["type"] in ("stdout", "stderr")]
    if screen_text.strip():
        lines.append(screen_text)
    return True, "\n".join(lines).strip()


def make_session_name(base: str) -> str:
    with _sessions_lock:
        used = {s["name"] for s in _sessions.values()}
    if base not in used:
        return base
    for i in range(1, 1000):
        cand = f"{base}_{i:03d}"
        if cand not in used:
            return cand
    return base + "_" + _uuid_mod.uuid4().hex[:4]


def _wait_session_ready(session_name: str, timeout: float = 20.0) -> bool:
    """새로 만든 세션의 CLI 가 입력을 받을 준비가 될 때까지 대기.
    화면 출력이 생긴 뒤 1초간 새 출력이 없으면 준비된 것으로 판단한다."""
    deadline = time.time() + timeout
    prev_act = -1
    stable = 0
    while time.time() < deadline:
        time.sleep(0.5)
        with _sessions_lock:
            s = next((x for x in _sessions.values() if x["name"] == session_name), None)
            if not s or s["status"] != "running":
                return False
            act = s.get("activity", 0)
            has_screen = bool((s.get("screen_text") or "").strip())
        if has_screen and act == prev_act:
            stable += 1
            if stable >= 2:
                return True
        else:
            stable = 0
        prev_act = act
    return False


# ── Git worktree helpers ──────────────────────────────────────
import re as _re

def _slugify(text: str) -> str:
    s = _re.sub(r'[^\x00-\x7F]', '', text.lower().strip())
    s = _re.sub(r'[^a-z0-9]+', '-', s).strip('-')
    return s or 'project'

def _is_broken_branch(branch: str) -> bool:
    if not branch:
        return False
    if '\ufffd' in branch:
        return True
    import re
    if not re.match(r'^[a-zA-Z0-9/\-_\.\*]+$', branch):
        return True
    return False

def _git_run(*args, timeout=10, **kwargs):
    """git subprocess 공통 호출 — UTF-8 시도 후 실패 또는 깨짐 발생 시 CP949/EUC-KR 폴백."""
    try:
        kw = kwargs.copy()
        has_custom_enc = 'encoding' in kw
        
        if not has_custom_enc:
            r = subprocess.run(list(args), capture_output=True, timeout=timeout, **kw)
            stdout_str = ''
            if r.stdout:
                for enc in ['utf-8', 'cp949', 'euc-kr']:
                    try:
                        stdout_str = r.stdout.decode(enc)
                        if '\ufffd' not in stdout_str:
                            break
                    except UnicodeDecodeError:
                        continue
                else:
                    stdout_str = r.stdout.decode('utf-8', errors='replace')
                    
            stderr_str = ''
            if r.stderr:
                for enc in ['utf-8', 'cp949', 'euc-kr']:
                    try:
                        stderr_str = r.stderr.decode(enc)
                        if '\ufffd' not in stderr_str:
                            break
                    except UnicodeDecodeError:
                        continue
                else:
                    stderr_str = r.stderr.decode('utf-8', errors='replace')
                    
            class DecodedResult:
                returncode = r.returncode
                stdout = stdout_str
                stderr = stderr_str
            return DecodedResult()
        else:
            r = subprocess.run(list(args), capture_output=True, timeout=timeout, **kw)
            return r
    except Exception:
        class _R:
            returncode = 1
            stdout = ''
            stderr = ''
        return _R()

def _git_out(*args, timeout=10, **kwargs) -> str:
    res = _git_run(*args, timeout=timeout, **kwargs)
    if res.returncode != 0:
        return ""
    return (res.stdout or '').strip()

def _git_ok(cwd: str) -> bool:
    try:
        r = _git_run('git','-C',cwd,'rev-parse','--is-inside-work-tree', timeout=5)
        return r.returncode == 0
    except Exception:
        return False

def _git_root(cwd: str) -> str:
    return _git_out('git','-C',cwd,'rev-parse','--show-toplevel', timeout=5)

def _git_default_branch(root: str) -> str:
    b = _git_out('git','-C',root,'rev-parse','--abbrev-ref','HEAD', timeout=5)
    return b if (b and b != 'HEAD') else 'main'

def _git_project_slug(root: str, project_id: int, project_name: str) -> str:
    base = _slugify(project_name)
    if not base or base == 'project':
        base = f'proj-{project_id}'
    for idx in range(100):
        slug = base if idx == 0 else f'{base}_{idx}'
        if not _git_out('git','-C',root,'branch','--list',f'project/{slug}/*', timeout=5):
            return slug
        stored_id = _git_out('git','-C',root,'config',f'ep4.project-{slug}', timeout=5)
        if not stored_id or stored_id == str(project_id):
            _git_run('git','-C',root,'config',f'ep4.project-{slug}',str(project_id), timeout=5)
            return slug
    return f'proj-{project_id}'

def _git_ensure_proj_branch(root: str, slug: str, base_branch: str, wt_base: Path, project_id: int = 0) -> tuple:
    """Returns (proj_branch, proj_wt_path) or (branch, None) on failure."""
    proj_branch = f'project/{slug}/main'
    wt_path = str(wt_base / slug / 'main')
    if not _git_out('git','-C',root,'branch','--list',proj_branch, timeout=5):
        _git_run('git','-C',root,'branch',proj_branch,base_branch, timeout=10)
    if not os.path.exists(wt_path):
        os.makedirs(str(wt_base / slug), exist_ok=True)
        r = _git_run('git','-C',root,'worktree','add',wt_path,proj_branch, timeout=15)
        if r.returncode != 0:
            return proj_branch, None
    if project_id:
        _git_run('git','-C',root,'config',f'ep4.project-{slug}',str(project_id), timeout=5)
    return proj_branch, wt_path


_proj_branch_cache = {}   # project_id -> (branch, ts) — /api/projects 폴백 캐시

def _project_git_branch_cached(project_id: int, project_root: str, project_name: str) -> str:
    """task_runs 기록이 없을 때(예: 태스크 전체 삭제로 run 까지 삭제됨) 프로젝트의
    git 통합 브랜치(project/{slug}/main)를 git 에서 직접 찾는다. 부수효과 없음.
    /api/projects 는 자주 호출되므로 결과를 짧게 캐시한다."""
    if not project_root or not os.path.isdir(project_root):
        return ""
    now = time.time()
    cached = _proj_branch_cache.get(project_id)
    if cached and now - cached[1] < 120:
        return cached[0]
    branch = ""
    try:
        if _git_ok(project_root):
            # 후보 slug 수집: 이름 기반(우선) → git config 역참조(이름 변경 흔적 대비).
            # 같은 project_id 에 여러 slug 가 매핑될 수 있으므로(이름 변경 시 config 잔존)
            # 이름 기반 slug 를 먼저 시도하고, 실제 존재하는 브랜치를 채택한다.
            candidates = []
            name_slug = _slugify(project_name)
            if name_slug:
                candidates.append(name_slug)
            cfg = _git_out('git','-C',project_root,'config','--get-regexp',r'^ep4\.project-', timeout=5)
            for line in cfg.splitlines():
                k, _, v = line.partition(' ')
                if v.strip() == str(project_id):
                    s = k[len('ep4.project-'):]
                    if s and s not in candidates:
                        candidates.append(s)
            for slug in candidates:
                cand = f'project/{slug}/main'
                if _git_out('git','-C',project_root,'branch','--list',cand, timeout=5):
                    branch = cand
                    break
    except Exception:
        branch = ""
    _proj_branch_cache[project_id] = (branch, now)
    return branch

def _preserve_last_claude_session(conn, project_id: int, deleting_task_ids) -> None:
    """태스크 삭제로 프로젝트의 태스크가 모두 사라질 때 마지막 세션 정보를 보존한다
    — 전체 삭제 후에도 세션이 유지되도록.
      · 마지막 run 의 Claude 세션 ID → projects.claude_session_id
      · 삭제되는 태스크의 마지막 세션 지정(session_override) → projects.session_name
        (프로젝트 기본 세션이 비어 있을 때만 — 이후 '기존 세션'으로 계속 사용)
    task_runs/project_tasks 를 DELETE 하기 전에 호출해야 한다. 부분 삭제(남는
    태스크 존재)나 세션 기록이 없는 경우에는 아무것도 하지 않는다."""
    if not deleting_task_ids:
        return
    ph = ','.join('?' * len(deleting_task_ids))
    remain = conn.execute(
        f"SELECT COUNT(*) FROM project_tasks WHERE project_id=? AND id NOT IN ({ph})",
        (project_id, *deleting_task_ids)).fetchone()[0]
    if remain:
        return
    row = conn.execute(
        "SELECT claude_session_id FROM task_runs WHERE project_id=? "
        "AND claude_session_id != '' ORDER BY id DESC LIMIT 1",
        (project_id,)).fetchone()
    if row and row[0]:
        conn.execute(
            "UPDATE projects SET claude_session_id=?, updated_at=datetime('now') WHERE id=?",
            (row[0], project_id))
    cur = conn.execute(
        "SELECT session_name FROM projects WHERE id=?", (project_id,)).fetchone()
    if cur and not (cur[0] or "").strip():
        srow = conn.execute(
            f"SELECT session_override FROM project_tasks WHERE project_id=? "
            f"AND id IN ({ph}) AND session_override != '' AND session_override != '__new__' "
            "ORDER BY id DESC LIMIT 1",
            (project_id, *deleting_task_ids)).fetchone()
        if srow and srow[0]:
            conn.execute(
                "UPDATE projects SET session_name=?, updated_at=datetime('now') WHERE id=?",
                (srow[0], project_id))


def _git_create_task_wt(root: str, slug: str, idx: int, proj_branch: str, wt_base: Path) -> tuple:
    """Returns (task_branch, task_wt_path) or (branch, None) on failure."""
    task_branch = f'project/{slug}/task{idx:03d}'
    wt_path = str(wt_base / slug / f'task{idx:03d}')
    if os.path.exists(wt_path):
        _git_run('git','-C',root,'worktree','remove','--force',wt_path, timeout=10)
    if _git_out('git','-C',root,'branch','--list',task_branch, timeout=5):
        _git_run('git','-C',root,'branch','-D',task_branch, timeout=5)
    os.makedirs(str(wt_base / slug), exist_ok=True)
    r = _git_run('git','-C',root,'worktree','add','-b',task_branch,wt_path,proj_branch, timeout=15)
    if r.returncode != 0:
        return task_branch, None
    return task_branch, wt_path

def _git_merge_task(proj_wt: str, task_branch: str, title: str) -> tuple:
    r = _git_run('git','-C',proj_wt,'merge','--no-ff','-m',f'task: {title}',task_branch, timeout=30)
    return r.returncode == 0, ((r.stdout or '') + (r.stderr or '')).strip()

def _git_merge_to_default(root: str, proj_branch: str, title: str) -> tuple:
    """프로젝트 브랜치를 루트에 체크아웃된 기본 브랜치(main 등)에 머지.
    반환 (ok, msg — 성공 시 기본 브랜치명). 루트 워킹트리에서 실행되므로
    충돌·미커밋 변경 겹침 시 즉시 abort 해 머지 중간 상태를 남기지 않는다."""
    default = _git_default_branch(root)
    if not default or default == proj_branch:
        return False, f'기본 브랜치 확인 불가({default})'
    r = _git_run('git','-C',root,'merge','--no-ff',
                 '-m',f'task: {title} ({proj_branch} 머지)',proj_branch, timeout=30)
    if r.returncode == 0:
        return True, default
    msg = ((r.stdout or '') + (r.stderr or '')).strip()
    _git_run('git','-C',root,'merge','--abort', timeout=10)
    return False, msg

def _git_diff_files(root: str, base_ref: str, head_ref: str) -> list:
    out = _git_out('git','-C',root,'diff','--numstat',f'{base_ref}...{head_ref}', timeout=15)
    files = []
    for line in out.split('\n'):
        parts = line.split('\t', 2)
        if len(parts) == 3:
            try:
                files.append({'file':parts[2],'added':int(parts[0]) if parts[0]!='-' else 0,
                              'removed':int(parts[1]) if parts[1]!='-' else 0})
            except ValueError:
                pass
    return files

def _git_get_commits(root: str, base_ref: str, head_ref: str) -> list:
    out = _git_out('git','-C',root,'log','--oneline',f'{base_ref}..{head_ref}', timeout=10)
    commits = []
    for line in out.split('\n'):
        if not line.strip(): continue
        h, _, m = line.partition(' ')
        commits.append({'hash':h,'msg':m})
    return commits

def _git_pr_url(root: str, task_branch: str, proj_branch: str) -> str:
    try:
        remote = _git_out('git','-C',root,'remote','get-url','origin', timeout=5).rstrip('/')
        if not remote: return ''
        if remote.startswith('git@'):
            remote = 'https://' + remote[4:].replace(':','/',1)
        if remote.endswith('.git'):
            remote = remote[:-4]
        if 'github.com' in remote:
            return f'{remote}/compare/{proj_branch}...{task_branch}?expand=1'
        if 'gitlab' in remote:
            return (f'{remote}/-/merge_requests/new'
                    f'?merge_request[source_branch]={task_branch}'
                    f'&merge_request[target_branch]={proj_branch}')
        return ''
    except Exception:
        return ''


# ── 프롬프트 문서 기록 (docs/prompt/prompt_MMDD_NNN.md) ──────────
PROMPT_DOC_SEP = "-" * 45
PROMPT_DOC_MAX = 5   # 파일당 기록 수 — 초과하면 인덱스(NNN) 증가
_prompt_doc_lock = threading.Lock()

# 패스워드 값 마스킹 — "password: xxx" / "pwd=xxx" / "비밀번호는 xxx" 등의
# 값 부분을 **** 로 치환해 문서에 평문 비밀번호가 남지 않게 한다.
_PW_MASK_PATTERNS = [
    # password: value / password = value / "password": "value"
    re.compile(r"(?i)((?:password|passwd|pwd|비밀번호|패스워드)[\"']?\s*[:=]\s*)"
               r"([\"']?)([^\s\"']+)"),
    # password is value / 비밀번호는 value
    re.compile(r"(?i)((?:password|passwd|pwd)\s+is\s+"
               r"|(?:비밀번호|패스워드)\s*(?:은|는|이|가|을|를)\s+)"
               r"([\"']?)([^\s\"']+)"),
]


def _mask_passwords(text: str) -> str:
    """텍스트 내 패스워드 값을 **** 로 마스킹한다 (키워드·구분자 기반)."""
    for pat in _PW_MASK_PATTERNS:
        text = pat.sub(lambda m: m.group(1) + m.group(2) + "****", text)
    return text


def _prompt_doc_entry_count(fpath: Path) -> int:
    """파일 내 구분선(대시로만 이루어진 줄) 수 = 기록된 항목 수."""
    try:
        text = fpath.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return 0
    return sum(1 for ln in text.splitlines()
               if len(ln.strip()) >= 40 and set(ln.strip()) == {"-"})


def _append_prompt_doc(prompt: str, answer: str, project_root: str = ""):
    """태스크 입력(프롬프트)과 답변을 해당 프로젝트의 docs/prompt/prompt_MMDD_NNN.md
    에 누적 기록한다. project_root 가 없거나 존재하지 않으면 EP4 리포 기준으로 폴백.
    당일 파일에 항목이 PROMPT_DOC_MAX 개 차면 다음 인덱스 파일로 넘어간다."""
    prompt = _mask_passwords((prompt or "").strip())
    answer = _mask_passwords((answer or "").strip())
    if not prompt:
        return
    try:
        base = Path(project_root) if project_root else None
        if not base or not base.is_dir():
            base = Path(__file__).parent
        doc_dir = base / "docs" / "prompt"
        with _prompt_doc_lock:
            doc_dir.mkdir(parents=True, exist_ok=True)
            mmdd = datetime.now().strftime("%m%d")
            idx = 1
            while True:
                fpath = doc_dir / f"prompt_{mmdd}_{idx:03d}.md"
                if not fpath.exists() or _prompt_doc_entry_count(fpath) < PROMPT_DOC_MAX:
                    break
                idx += 1
            is_new = not fpath.exists()
            # 기존 파일이 구분선 직후 빈 줄 없이 끝나 있어도 항상
            # "구분선 → 빈 줄 → 새 항목" 이 되도록 이음새를 맞춘다.
            prefix = ""
            if not is_new:
                tail = fpath.read_text(encoding="utf-8", errors="replace")
                if not tail.endswith("\n"):
                    prefix = "\n\n"
                elif not tail.endswith("\n\n"):
                    prefix = "\n"
            with open(fpath, "a", encoding="utf-8") as f:
                if is_new:
                    f.write(f"# prompt_{mmdd}_{idx:03d}\n\n")
                f.write(f"{prefix}{prompt}\n\n->\n\n{answer}\n\n{PROMPT_DOC_SEP}\n\n")
    except Exception as e:
        print(f"[prompt-doc] 기록 오류 (무시): {e}")


# ── 웹페이지 스크린샷 캡처 (Playwright CLI) ──────────────────────
SCREENSHOTS_DIR = BASE_DIR / "screenshots"
_EP4_RUNNING_PORT = None   # main() 에서 실제 listen 포트 기록 (스크린샷 자기재시작 방지용)
# 부팅별 고유 인스턴스 ID — peer 핸드셰이크/push 의 '자기 자신' 판별용.
# 폴더 복사 등으로 두 서버가 같은 auth_token 을 쓰는 경우에도 토큰 비교와 달리
# 다른 서버를 자기 자신으로 오인하지 않는다.
_EP4_INSTANCE_ID = secrets.token_hex(16)
_WEB_EXTS = ('.html', '.htm', '.css', '.js', '.jsx', '.ts', '.tsx',
             '.vue', '.svelte', '.astro')


def _is_web_change(git_diff: list) -> bool:
    """git diff 파일 목록에 웹 자산(.html/.css/.js 등)이 포함되면 True."""
    for f in (git_diff or []):
        name = (f.get('file') if isinstance(f, dict) else str(f)) or ''
        if name.lower().endswith(_WEB_EXTS):
            return True
    return False


def _capture_screenshot(url: str, out_path: Path, timeout: int = 45) -> bool:
    """npx playwright screenshot 으로 url 의 렌더링 화면을 out_path(png)에 저장.
    시스템 브라우저(msedge → chrome)를 우선 사용하고, 없으면 번들 chromium 으로
    폴백한다. CLI/브라우저가 모두 없거나 실패하면 조용히 False 반환."""
    if not url:
        return False
    try:
        out_path.parent.mkdir(parents=True, exist_ok=True)
    except Exception:
        return False
    base = ['npx', 'playwright', 'screenshot',
            '--full-page', '--wait-for-timeout', '1500']
    # 채널 우선순위: 윈도우 기본 Edge → Chrome → 번들 chromium(채널 없음)
    attempts = [['--channel=msedge'], ['--channel=chrome'], []]
    for extra in attempts:
        try:
            if out_path.exists():
                out_path.unlink()
            cmd = base + extra + [url, str(out_path)]
            # stdin=DEVNULL: npx/node 가 포그라운드 콘솔 입력(CONIN$)을 건드려
            # run.bat 의 msvcrt.getch() 가 EOF(0xff)를 받아 서버가 자동 종료되는 것을 방지.
            r = subprocess.run(cmd, capture_output=True, timeout=timeout,
                               stdin=subprocess.DEVNULL,
                               shell=(os.name == 'nt'), encoding='utf-8', errors='replace')
            if r.returncode == 0 and out_path.exists() and out_path.stat().st_size > 0:
                return True
        except Exception:
            continue
    return False


def _restart_and_screenshot(project_root: str, run_id: int):
    """project_root의 stop.bat으로 서버 종료 후 재시작하고 스크린샷 캡처.
    기동 우선순위: conf/ep4.conf start_cmd → server.py → run.bat(stdin=DEVNULL).
    반환: (screenshot_filename, preview_url) 또는 ('', '')"""
    import socket as _sock
    proot = Path(project_root)
    stop_bat = proot / "stop.bat"
    if not (stop_bat.exists() and (proot / "run.bat").exists()):
        return '', ''

    # 포트·기동 명령 읽기 (ep4.conf → ep4.local.conf 오버라이드)
    port = 7788
    start_cmd = None
    for _cname in ("ep4.conf", "ep4.local.conf"):
        _cp = proot / "conf" / _cname
        if _cp.exists():
            try:
                _conf = json.loads(_cp.read_text(encoding="utf-8-sig"))
                port = _conf.get("port", port)
                start_cmd = _conf.get("start_cmd", start_cmd)
            except Exception:
                pass

    # 대상이 EP4 자기 자신이면 서버를 죽이면 안 된다. stop.bat 으로 종료하면
    # 지금 실행 중인 EP4 서버가 함께 죽기 때문. 다음 두 경우를 자기 자신으로 본다:
    #   1) project_root 가 EP4 저장소 루트와 동일
    #   2) 대상 포트가 EP4 가 실제로 듣고 있는 포트와 동일 (conf 없는 복제 프로젝트 등)
    # 이 경우 재시작 없이 이미 떠 있는 서버를 그대로 캡처한다.
    try:
        _is_self = (proot.resolve() == BASE_DIR.parent.resolve()) or \
                   (_EP4_RUNNING_PORT is not None and port == _EP4_RUNNING_PORT)
        if _is_self:
            _url = f"http://localhost:{port}"
            _sf = SCREENSHOTS_DIR / f"run_{run_id}.png"
            if _capture_screenshot(_url, _sf):
                return f"run_{run_id}.png", _url
            return '', ''
    except Exception:
        pass

    preview_url = f"http://localhost:{port}"
    flags = subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0
    # 여기까지 왔다는 건 자기 자신이 아닌 외부 프로젝트 서버를 재시작한다는 뜻.
    print(f"[screenshot] {proot.name} 서버 재시작(port {port}) — 외부 프로젝트", flush=True)

    # 1) 기존 서버 종료
    try:
        subprocess.run(
            ["cmd", "/c", str(stop_bat)],
            cwd=str(proot), capture_output=True, timeout=15,
            creationflags=flags,
        )
    except Exception:
        pass
    time.sleep(1.5)

    # 2) 서버 기동: start_cmd(conf) → server.py → run.bat(stdin=DEVNULL로 pause 처리)
    try:
        if start_cmd:
            subprocess.Popen(
                start_cmd, shell=True, cwd=str(proot),
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL,
                creationflags=flags,
            )
        elif (proot / "server.py").exists():
            subprocess.Popen(
                ["python", "server.py"], cwd=str(proot),
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL,
                creationflags=flags,
            )
        else:
            # run.bat의 pause를 stdin=DEVNULL(EOF)으로 통과
            subprocess.Popen(
                ["cmd", "/c", "run.bat"], cwd=str(proot),
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL,
                creationflags=flags,
            )
    except Exception as _e:
        print(f"[screenshot] 서버 기동 실패: {_e}")
        return '', ''

    # 3) 포트 응답 대기 (최대 30초)
    ready = False
    for _ in range(30):
        time.sleep(1)
        try:
            with _sock.create_connection(("localhost", port), timeout=1):
                ready = True
                break
        except Exception:
            continue
    if not ready:
        return '', ''
    time.sleep(1.5)  # 렌더 안정화

    # 4) 스크린샷
    shot_file = SCREENSHOTS_DIR / f"run_{run_id}.png"
    if _capture_screenshot(preview_url, shot_file):
        return f"run_{run_id}.png", preview_url
    return '', ''


def _git_handle_cli_result(pid: int, tid: int, title: str, project_root: str, project_name: str) -> dict:
    """MCP(claude_cli) 태스크 완료 시 project_root의 변경사항을 브랜치에 커밋·머지."""
    try:
        if not project_root or not os.path.isdir(project_root):
            return {}
        git_root = _git_root(project_root) or project_root
        if not _git_ok(git_root):
            return {}

        wt_base = BASE_DIR / 'worktrees'
        wt_base.mkdir(parents=True, exist_ok=True)
        slug = _git_project_slug(git_root, pid, project_name)
        proj_branch = f'project/{slug}/main'

        # 이 태스크 커밋 직전의 HEAD — 이 태스크 변경분만 diff/commit 으로 보이게 하는 기준.
        # (프로젝트 브랜치를 기준으로 쓰면 머지 conflict 로 브랜치가 안 밀릴 때 이전
        #  태스크 커밋들이 누적돼 전체가 표시되므로, 커밋 직전 HEAD 를 기준으로 한다.)
        head_before = _git_out('git', '-C', git_root, 'rev-parse', '--verify', '--quiet',
                               'HEAD^{commit}', timeout=5).strip()

        # 미커밋 변경사항 처리. 기본적으로 EP4 는 사용자 워킹트리에 커밋하지 않는다.
        # (cli_auto_commit 옵트인 시에만 자동 커밋 — 안 그러면 태스크와 무관한
        #  사용자 작업까지 'task: ...' 커밋에 휩쓸려 브랜치가 오염된다.)
        status_out = _git_out('git', '-C', git_root, 'status', '--porcelain', timeout=5)
        if status_out.strip():
            if not _CLI_AUTO_COMMIT:
                return {'git_merge_status': 'skipped'}
            _git_run('git', '-C', git_root, 'add', '-A', timeout=10)
            _git_run('git', '-C', git_root, 'commit', '-m', f'task: {title}', timeout=20)

        # 프로젝트 브랜치 확보 (없으면 현재 HEAD 기준 생성)
        if not _git_out('git', '-C', git_root, 'branch', '--list', proj_branch, timeout=5):
            _git_run('git', '-C', git_root, 'branch', proj_branch, 'HEAD', timeout=10)
            _git_run('git', '-C', git_root, 'config', f'ep4.project-{slug}', str(pid), timeout=5)

        # 태스크 브랜치 생성 (task_id 기반 고유 이름)
        task_branch = f'project/{slug}/task-cli-{tid}'
        if not _git_out('git', '-C', git_root, 'branch', '--list', task_branch, timeout=5):
            _git_run('git', '-C', git_root, 'branch', task_branch, 'HEAD', timeout=10)

        # 수정 파일 목록 / 커밋 계산: head_before..task_branch = 이 태스크 커밋만
        base_ref = head_before or _git_out('git', '-C', git_root, 'rev-parse', '--verify', '--quiet',
                                           f'{task_branch}~1', timeout=5).strip()
        git_diff, git_commits = [], []
        if base_ref:
            try:
                git_diff = _git_diff_files(git_root, base_ref, task_branch)
                git_commits = _git_get_commits(git_root, base_ref, task_branch)
            except Exception:
                pass

        # 프로젝트 브랜치를 태스크 커밋으로 업데이트 (FF 머지)
        proj_wt_path = str(wt_base / slug / 'main')
        if os.path.exists(proj_wt_path):
            r = _git_run('git', '-C', proj_wt_path, 'merge', '--ff-only', task_branch, timeout=30)
            merge_status = 'merged' if r.returncode == 0 else 'conflict'
        else:
            r = _git_run('git', '-C', git_root, 'branch', '-f', proj_branch, task_branch, timeout=10)
            merge_status = 'merged' if r.returncode == 0 else 'conflict'

        return {
            'git_task_branch': task_branch,
            'git_proj_branch': proj_branch,
            'git_merge_status': merge_status,
            'git_diff': git_diff,
            'git_commits': git_commits,
        }
    except Exception as e:
        print(f"[log-result] git 오류 (무시): {e}")
        return {}


def _new_uuid() -> str:
    import uuid as _u
    return str(_u.uuid4())


def _claude_proj_dir_name(root_path: str) -> str:
    """프로젝트 루트 경로를 Claude CLI 트랜스크립트 디렉토리명으로 변환."""
    import re
    return re.sub(r'[:\\/_ ]', '-', root_path)


def _parse_claude_session(path) -> dict:
    """Claude CLI 트랜스크립트 JSONL에서 세션 요약 정보를 추출 (세션 히스토리용)."""
    try:
        session_id = ""
        model = ""
        custom_title = ""
        ai_title = ""
        first_prompt = ""
        first_ts = ""
        last_ts = ""
        msg_count = 0
        user_count = 0
        assistant_count = 0
        tool_count = 0
        error_count = 0
        in_tokens = 0
        out_tokens = 0
        cache_tokens = 0
        seen_msg_ids = set()
        for line in Path(path).read_text(encoding="utf-8", errors="replace").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except Exception:
                continue
            t = obj.get("type", "")
            if not session_id and obj.get("sessionId"):
                session_id = obj["sessionId"]
            # 세션 이름 레코드: custom-title(사용자 지정) > 마지막 ai-title(자동 생성) > summary(구버전)
            if t == "custom-title" and obj.get("customTitle"):
                custom_title = str(obj["customTitle"]).strip()
                continue
            if t == "ai-title" and obj.get("aiTitle"):
                ai_title = str(obj["aiTitle"]).strip()
                continue
            if t == "summary" and obj.get("summary") and not ai_title:
                ai_title = str(obj["summary"]).strip()
                continue
            msg = obj.get("message", {}) if isinstance(obj.get("message"), dict) else {}
            content = msg.get("content", "")
            if t == "user" and not first_prompt:
                if isinstance(content, str) and content.strip():
                    first_prompt = content.strip()[:120]
                elif isinstance(content, list):
                    texts = [c.get("text", "") for c in content if isinstance(c, dict) and c.get("type") == "text"]
                    fp = " ".join(texts).strip()[:120]
                    if fp:
                        first_prompt = fp
            if t in ("user", "assistant"):
                msg_count += 1
                if t == "user":
                    user_count += 1
                else:
                    assistant_count += 1
                ts = obj.get("timestamp")
                if ts:
                    if not first_ts:
                        first_ts = ts
                    last_ts = ts
            # 도구 호출 / 에러 카운트
            if isinstance(content, list):
                for c in content:
                    if not isinstance(c, dict):
                        continue
                    if c.get("type") == "tool_use":
                        tool_count += 1
                    if c.get("type") == "tool_result" and c.get("is_error"):
                        error_count += 1
            # 토큰 집계 (message.id 기준 중복 제거)
            usage = msg.get("usage") if isinstance(msg.get("usage"), dict) else None
            mid = msg.get("id")
            if usage and (not mid or mid not in seen_msg_ids):
                if mid:
                    seen_msg_ids.add(mid)
                in_tokens += int(usage.get("input_tokens") or 0)
                out_tokens += int(usage.get("output_tokens") or 0)
                cache_tokens += int(usage.get("cache_read_input_tokens") or 0)
                cache_tokens += int(usage.get("cache_creation_input_tokens") or 0)
            if t == "assistant" and not model:
                model = msg.get("model", "")
        if not session_id:
            return {}
        return {
            "session_id": session_id,
            "model": model,
            "title": (custom_title or ai_title)[:96],
            "first_prompt": first_prompt,
            "first_ts": first_ts,
            "last_ts": last_ts,
            "msg_count": msg_count,
            "user_count": user_count,
            "assistant_count": assistant_count,
            "tool_count": tool_count,
            "error_count": error_count,
            "total_tokens": in_tokens + out_tokens + cache_tokens,
            "input_tokens": in_tokens,
            "output_tokens": out_tokens,
            "cache_tokens": cache_tokens,
            "file": Path(path).name,
        }
    except Exception:
        return {}


def _summarize_session_content(content) -> str:
    """메시지 content(문자열/블록 배열)를 사람이 읽을 미리보기 텍스트로 변환."""
    if isinstance(content, str):
        return content.strip()
    if not isinstance(content, list):
        return ""
    parts = []
    for c in content:
        if not isinstance(c, dict):
            continue
        ct = c.get("type")
        if ct == "text":
            txt = (c.get("text") or "").strip()
            if txt:
                parts.append(txt)
        elif ct == "tool_use":
            name = c.get("name") or "tool"
            parts.append(f"[도구: {name}]")
        elif ct == "tool_result":
            res = c.get("content")
            if isinstance(res, list):
                rtexts = [r.get("text", "") for r in res if isinstance(r, dict) and r.get("type") == "text"]
                snippet = " ".join(rtexts).strip()
            elif isinstance(res, str):
                snippet = res.strip()
            else:
                snippet = ""
            tag = "[도구 오류]" if c.get("is_error") else "[도구 결과]"
            parts.append(f"{tag} {snippet[:200]}" if snippet else tag)
        elif ct == "thinking":
            parts.append("[사고 과정]")
    return "\n".join(parts).strip()


def _claude_session_cwd(path) -> str:
    """전사에서 그 세션이 실행된 작업 디렉토리만 가볍게 읽어 온다 (없으면 '')."""
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except Exception:
                    continue
                if obj.get("cwd"):
                    return str(obj["cwd"])
    except Exception:
        pass
    return ""


def _parse_claude_session_detail(path, max_messages: int = 200) -> dict:
    """Claude CLI 트랜스크립트 전체를 읽어 대화 메시지 목록과 요약을 반환 (세션 상세용)."""
    try:
        summary = _parse_claude_session(path)
        if not summary:
            return {}
        messages = []
        cwd = ""
        for line in Path(path).read_text(encoding="utf-8", errors="replace").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except Exception:
                continue
            if not cwd and obj.get("cwd"):
                cwd = obj["cwd"]
            t = obj.get("type", "")
            if t not in ("user", "assistant"):
                continue
            msg = obj.get("message", {}) if isinstance(obj.get("message"), dict) else {}
            preview = _summarize_session_content(msg.get("content", ""))
            if not preview:
                continue
            messages.append({
                "role": t,
                "ts": obj.get("timestamp", ""),
                "text": preview[:4000],
            })
        # 너무 길면 최신 메시지 위주로 자름
        truncated = False
        if len(messages) > max_messages:
            messages = messages[-max_messages:]
            truncated = True
        summary["cwd"] = cwd
        summary["messages"] = messages
        summary["truncated"] = truncated
        return summary
    except Exception:
        return {}


def _iso_to_logts(iso: str) -> str:
    """ISO8601 타임스탬프를 실행 로그 형식(HH:MM:SS.fff)으로 변환."""
    if not iso:
        return datetime.now().strftime('%H:%M:%S.%f')[:12]
    try:
        s = iso.replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        try:
            dt = dt.astimezone()
        except Exception:
            pass
        return dt.strftime('%H:%M:%S.%f')[:12]
    except Exception:
        return datetime.now().strftime('%H:%M:%S.%f')[:12]


def _claude_session_snapshot(cwd: str) -> set:
    """실행 전 claude 세션 디렉토리의 기존 jsonl 파일명 집합을 반환."""
    try:
        if not cwd:
            return set()
        dir_name = _claude_proj_dir_name(cwd)
        claude_dir = Path.home() / ".claude" / "projects" / dir_name
        if not claude_dir.exists():
            return set()
        return {f.name for f in claude_dir.glob("*.jsonl")}
    except Exception:
        return set()


def _find_new_claude_session(cwd: str, before: set, since_ts: float):
    """실행 후 새로 생성된(또는 가장 최근 수정된) claude 세션 jsonl 경로를 반환."""
    try:
        if not cwd:
            return None
        dir_name = _claude_proj_dir_name(cwd)
        claude_dir = Path.home() / ".claude" / "projects" / dir_name
        if not claude_dir.exists():
            return None
        files = list(claude_dir.glob("*.jsonl"))
        if not files:
            return None
        # 2) 없으면 실행 시작 이후 수정된 파일 중 최신
        new_files = [f for f in files if f.name not in before]
        if new_files:
            return max(new_files, key=lambda x: x.stat().st_mtime)
        # 2) 없으면 실행 시작 이후 수정된 파일 중 최신
        modified = [f for f in files if f.stat().st_mtime >= (since_ts - 2)]
        if modified:
            return max(modified, key=lambda x: x.stat().st_mtime)
        return None
    except Exception:
        return None


def _find_claude_session_by_id(session_id: str):
    """세션 ID로 모든 claude 프로젝트 디렉토리에서 jsonl 파일을 검색 (cwd 무관)."""
    try:
        if not session_id:
            return None
        base = Path.home() / ".claude" / "projects"
        if not base.exists():
            return None
        matches = list(base.glob(f"*/{session_id}.jsonl"))
        if matches:
            return matches[0]
        return None
    except Exception:
        return None


def _claude_session_log_entries(path) -> tuple:
    """Claude 세션 jsonl을 실행 로그 항목 리스트로 변환. (entries, session_id) 반환.

    각 content 블록(텍스트·도구 호출/도구 결과/사고)을 개별 로그 항목으로 만든다.
    """
    entries = []
    session_id = ""
    try:
        for line in Path(path).read_text(encoding="utf-8", errors="replace").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except Exception:
                continue
            if not session_id and obj.get("sessionId"):
                session_id = obj["sessionId"]
            t = obj.get("type", "")
            if t not in ("user", "assistant"):
                continue
            ts = _iso_to_logts(obj.get("timestamp", ""))
            msg = obj.get("message", {}) if isinstance(obj.get("message"), dict) else {}
            content = msg.get("content", "")
            if isinstance(content, str):
                txt = content.strip()
                if txt and t == "assistant":
                    entries.append({"ts": ts, "level": "CLAUDE", "msg": f"?쨼 {txt[:1500]}"})
                continue
            if not isinstance(content, list):
                continue
            for c in content:
                if not isinstance(c, dict):
                    continue
                ct = c.get("type")
                if ct == "text":
                    txt = (c.get("text") or "").strip()
                    if txt:
                        prefix = "🤖 " if t == "assistant" else "👤 "
                        entries.append({"ts": ts, "level": "CLAUDE", "msg": f"{prefix}{txt[:1500]}"})
                elif ct == "thinking":
                    entries.append({"ts": ts, "level": "CLAUDE", "msg": "💭 [사고 과정]"})
                elif ct == "tool_use":
                    name = c.get("name") or "tool"
                    inp = c.get("input")
                    summ = ""
                    if isinstance(inp, dict):
                        for k in ("command", "file_path", "path", "pattern", "query", "description", "prompt"):
                            if inp.get(k):
                                summ = f"{k}={str(inp[k])[:120]}"
                                break
                    entries.append({"ts": ts, "level": "TOOL", "msg": f"[도구: {name}]" + (f" {summ}" if summ else "")})
                elif ct == "tool_result":
                    res = c.get("content")
                    if isinstance(res, list):
                        rtexts = [r.get("text", "") for r in res if isinstance(r, dict) and r.get("type") == "text"]
                        snippet = " ".join(rtexts).strip()
                    elif isinstance(res, str):
                        snippet = res.strip()
                    else:
                        snippet = ""
                    if c.get("is_error"):
                        entries.append({"ts": ts, "level": "ERROR", "msg": f"[도구 오류] {snippet[:300]}"})
                    elif snippet:
                        entries.append({"ts": ts, "level": "RESULT", "msg": f"[결과] {snippet[:300]}"})
        return entries, session_id
    except Exception:
        return entries, session_id


def _new_span_id() -> str:
    return os.urandom(8).hex()  # 16 hex chars

def _add_run_log(entries: list, run_id, project_id: int, level: str, msg: str, *, trace_id: str = None, span_id: str = None):
    ts = datetime.now().strftime('%H:%M:%S.%f')[:12]
    entry = {"ts": ts, "level": level, "msg": msg}
    if trace_id:
        entry["trace_id"] = trace_id
    if span_id:
        entry["span_id"] = span_id
    entries.append(entry)
    if run_id:
        emit("run_log", {"run_id": run_id, "project_id": project_id, "entry": entry})


def _default_channel_ids() -> list:
    """기본 알림 채널 id 목록(0 또는 1개).
    활성 채널이 1개면 그 채널이 기본, 2개 이상이면 is_default=1 로 지정된 채널,
    지정이 없으면 가장 먼저 등록된 채널을 기본으로 본다."""
    try:
        with sqlite3.connect(CHANNELS_DB) as conn:
            rows = conn.execute(
                "SELECT id, is_default FROM notification_channels WHERE active=1 ORDER BY id"
            ).fetchall()
    except Exception:
        return []
    if not rows:
        return []
    if len(rows) == 1:
        return [rows[0][0]]
    defaults = [r[0] for r in rows if r[1]]
    return [defaults[0]] if defaults else [rows[0][0]]


def _send_notification(channel_ids: list, message: str, project_id: int = None):
    import urllib.request as _req
    import urllib.error as _err
    if not channel_ids:
        if project_id:
            emit("task_log", {"project_id": project_id, "message": "ℹ 알림 채널이 연결되지 않았습니다 (프로젝트 설정에서 채널을 선택하세요)"})
        return
    with sqlite3.connect(CHANNELS_DB) as conn:
        channels = conn.execute(
            f"SELECT type, webhook_url, name FROM notification_channels WHERE id IN ({','.join('?'*len(channel_ids))}) AND active=1",
            channel_ids
        ).fetchall()
    if not channels:
        if project_id:
            emit("task_log", {"project_id": project_id, "message": f"알림 채널(id={channel_ids})을 찾을 수 없거나 비활성화 상태입니다."})
        return
    results = []
    for ch_type, webhook_url, ch_name in channels:
        try:
            payload = json.dumps({"text": message} if ch_type == "slack" else {"content": message}).encode()
            req = _req.Request(webhook_url, data=payload,
                               headers={"Content-Type": "application/json", "User-Agent": "EasyProject4/1.0"},
                               method="POST")
            _req.urlopen(req, timeout=10)
            results.append(f"✅ {ch_name} 알림 전송 완료")
        except _err.HTTPError as e:
            if e.code == 403:
                results.append(f"❌ {ch_name} 전송 실패 (403 Forbidden) Discord 채널에서 Webhook URL을 재생성해 주세요.")
            elif e.code == 404:
                results.append(f"❌ {ch_name} 전송 실패 (404) Webhook이 삭제된 것 같습니다. URL을 확인해 주세요.")
            else:
                results.append(f"??{ch_name} ?꾩넚 ?ㅽ뙣: HTTP {e.code}")
        except Exception as e:
            results.append(f"??{ch_name} ?꾩넚 ?ㅽ뙣: {e}")
    if project_id and results:
        emit("task_log", {"project_id": project_id, "message": " | ".join(results)})


def _send_project_notification(project_id: int, project_name: str, status: str, channel_ids: list, trace_id: str = None):
    if not channel_ids:
        return
    icon = "✅" if status == "done" else "❌"
    label = "완료" if status == "done" else "오류"
    with sqlite3.connect(PROJECTS_DB) as conn:
        rows = conn.execute("SELECT status FROM project_tasks WHERE project_id=?", (project_id,)).fetchall()
    total = len(rows)
    done  = sum(1 for r in rows if r[0] == "done")
    error = sum(1 for r in rows if r[0] == "error")
    summary = f"{icon} [{project_name}] 실행 {label} →완료 {done}/{total}" + (f", 오류 {error}개" if error else "")
    if trace_id:
        summary += f"\n→ trace: `{trace_id}`"
    _send_notification(channel_ids, summary, project_id=project_id)


def harness_runner(project_id: int, single_task_id: int = None, task_ids: list = None):
    with project_states_lock:
        project_states[project_id] = {"status": "running", "current_task": None}
    emit("status", {"project_id": project_id, "status": "running"})

    with sqlite3.connect(PROJECTS_DB) as conn:
        proj = conn.execute("SELECT model, timeout_sec, retry_count, project_root, tool_perms, name, skip_permissions, session_name, preview_url, engine FROM projects WHERE id=?", (project_id,)).fetchone()
        if not proj:
            with project_states_lock:
                project_states[project_id] = {"status": "error", "current_task": None}
            return
        default_model, default_timeout, default_retry, project_root, tool_perms_json, project_name, skip_permissions, project_session_name, project_preview_url, project_engine = proj
        project_engine = (project_engine or "claude").strip()
        tool_perms = json.loads(tool_perms_json or "[]")
        channel_ids = [r[0] for r in conn.execute(
            "SELECT channel_id FROM project_channel_links WHERE project_id=?", (project_id,)
        ).fetchall()]
        if single_task_id:
            conn.execute(
                "UPDATE project_tasks SET status='pending', output='', started_at=NULL, ended_at=NULL, version=version+1 WHERE id=? AND project_id=?",
                (single_task_id, project_id)
            )
            conn.commit()
            pending = conn.execute(
                "SELECT id, title, prompt, test_criteria, model_override, timeout_override, trigger_type, session_override FROM project_tasks WHERE id=? AND project_id=?",
                (single_task_id, project_id)
            ).fetchall()
        elif task_ids:
            ph = ','.join('?' * len(task_ids))
            for tid in task_ids:
                conn.execute(
                    "UPDATE project_tasks SET status='pending', output='', started_at=NULL, ended_at=NULL, version=version+1 WHERE id=? AND project_id=?",
                    (tid, project_id)
                )
            conn.commit()
            pending = conn.execute(
                f"SELECT id, title, prompt, test_criteria, model_override, timeout_override, trigger_type, session_override FROM project_tasks WHERE id IN ({ph}) AND project_id=? ORDER BY sort_order",
                (*task_ids, project_id)
            ).fetchall()
        else:
            pending = conn.execute(
                "SELECT id, title, prompt, test_criteria, model_override, timeout_override, trigger_type, session_override FROM project_tasks WHERE project_id=? AND status='pending' ORDER BY sort_order",
                (project_id,)
            ).fetchall()

    if not pending:
        with project_states_lock:
            project_states[project_id] = {"status": "done", "current_task": None}
        emit("status", {"project_id": project_id, "status": "done", "message": "실행할 태스크가 없습니다"})
        return

    emit("status", {"project_id": project_id, "status": "running", "message": f"태스크 {len(pending)}개 실행 대기"})

    # 실행 엔진 CLI 해석 (claude | antigravity→gemini)
    engine_bin = _resolve_engine_bin(project_engine)
    claude_bin = engine_bin or (shutil.which("claude") or "")

    # 이 실행 흐름 전체를 식별하는 trace_id (flow 시작 시 1회 생성)
    trace_id = _new_uuid()
    prev_span_id = None  # 직전 태스크의 span_id (parent_span_id 연결용)

    # ?? Git worktree ?뗭뾽 ??
    _git_enabled = False
    _git_slug = None
    _git_root_path = None
    _git_proj_branch = None
    _git_proj_wt = None
    _git_wt_base = None
    _task_idx = 0

    _git_base_cwd = project_root if (project_root and os.path.isdir(project_root)) else None
    try:
        if _git_base_cwd and _git_ok(_git_base_cwd):
            _git_root_path = _git_root(_git_base_cwd) or _git_base_cwd
            _base_branch = _git_default_branch(_git_root_path)
            _git_wt_base = BASE_DIR / 'worktrees'
            _git_wt_base.mkdir(parents=True, exist_ok=True)
            _git_slug = _git_project_slug(_git_root_path, project_id, project_name)
            _git_proj_branch, _git_proj_wt = _git_ensure_proj_branch(
                _git_root_path, _git_slug, _base_branch, _git_wt_base, project_id)
            _git_enabled = bool(_git_proj_wt)
    except Exception as _ge:
        print(f"[harness] Git error (skip): {_ge}")
        _git_enabled = False

    for row in pending:
        tid, title, prompt, test_criteria, model_override, timeout_override, trigger_type, session_override = row
        with project_states_lock:
            if project_states.get(project_id, {}).get("status") != "running":
                break
            project_states[project_id]["current_task"] = tid

        span_id = _new_span_id()          # 이 태스크 실행 하나를 식별
        parent_span_id = prev_span_id     # 나를 트리거한 선행 태스크의 span

        model = model_override or default_model or "claude-fable-5"
        timeout = timeout_override if timeout_override > 0 else default_timeout
        cwd = project_root if (project_root and os.path.isdir(project_root)) else None
        task_started_at = datetime.now().isoformat()

        # ── Git: 태스크 worktree 생성 ──
        _task_idx += 1
        _git_task_branch = ''
        _git_task_wt = None
        run_cwd = cwd  # claude 실행 디렉토리 (git 미사용 시 기본)

        if _git_enabled and _git_proj_wt:
            _git_task_branch, _git_task_wt = _git_create_task_wt(
                _git_root_path, _git_slug, _task_idx, _git_proj_branch, _git_wt_base)
            if _git_task_wt:
                run_cwd = _git_task_wt

        run_log_entries = []
        run_id = None

        with sqlite3.connect(PROJECTS_DB) as conn:
            conn.execute("UPDATE project_tasks SET status='running', started_at=?, version=version+1 WHERE id=?",
                         (task_started_at, tid))
            cur = conn.execute(
                "INSERT INTO task_runs (task_id, project_id, task_title, project_name, status, trigger_type, model, prompt, started_at, trace_id, span_id, parent_span_id, git_task_branch, git_proj_branch, git_merge_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (tid, project_id, title, project_name, 'running', trigger_type or 'manual', model, prompt,
                 task_started_at, trace_id, span_id, parent_span_id,
                 _git_task_branch, _git_proj_branch if _git_enabled else '', 'pending' if _git_enabled else 'no_git')
            )
            run_id = cur.lastrowid
            conn.commit()

        def _log(level, msg):
            _add_run_log(run_log_entries, run_id, project_id, level, msg, trace_id=trace_id, span_id=span_id)

        _log("INFO", f"하네스 시작 · model={model}" + (f" · dir={run_cwd}" if run_cwd else ""))
        if _git_task_branch:
            _log("INFO", f"Git worktree 쨌 {_git_task_branch}")
        emit("task_start", {"project_id": project_id, "task_id": tid, "title": title, "run_id": run_id, "trace_id": trace_id, "span_id": span_id})

        # ── Claude 세션 동작 기록: 실행 전 기존 세션 스냅샷 ──
        _claude_session_id = ''
        _claude_sess_before = _claude_session_snapshot(run_cwd)
        _run_start_ts = time.time()

        # ── 태스크별 세션 결정: ''=프로젝트 기본(기존 세션), '__prev__'=이 프로젝트의
        #    직전 실행이 쓴 세션, '__new__'=신규 세션 생성 후 실행,
        #    'claude:<id>'=그 Claude 세션을 --resume 으로 이어서 실행,
        #    그 외=지정한 이름의 실행 중 세션으로 전달 ──
        task_session_name = project_session_name
        _resume_sid = ""
        _sess_ov = (session_override or "").strip()
        if _sess_ov.startswith("claude:"):
            _resume_sid = _sess_ov[len("claude:"):].strip()
            # 대화형 세션이 아니라 CLI 직접 실행 경로로 보내야 --resume 을 붙일 수 있다
            task_session_name = ""
            _resume_file = _find_claude_session_by_id(_resume_sid) if _resume_sid else None
            if not _resume_file:
                _log("WARN", f"Claude 세션 '{_resume_sid}' 전사를 찾지 못함 — 새 대화로 실행")
                _resume_sid = ""
            else:
                # 이어받은 대화는 원래 작업 디렉토리 기준으로 파일을 기억하므로
                # 일회성 worktree 가 아닌 그 디렉토리에서 실행한다. 기존 세션 실행
                # 경로와 같은 정책이며, 이 경우 태스크 worktree 머지는 일어나지 않는다.
                _resume_cwd = _claude_session_cwd(_resume_file) or cwd
                if run_cwd != _resume_cwd:
                    _log("INFO", f"Claude 세션 재개 — worktree 격리 없이 {_resume_cwd} 에서 실행")
                    run_cwd = _resume_cwd
                    _claude_sess_before = _claude_session_snapshot(run_cwd)
                _log("INFO", f"Claude 세션 '{_resume_sid}' 이어서 실행")
        elif _sess_ov == "__prev__":
            _prev = _prev_task_session(project_id)
            if _prev:
                _log("INFO", f"이전 태스크 세션 '{_prev}' 재사용")
                task_session_name = _prev
            else:
                _log("WARN", "이전 태스크 세션이 없거나 종료됨 — 프로젝트 기본으로 진행")
        elif _sess_ov == "__new__":
            try:
                _new_sess = make_session_name(_slugify(project_name) or f"proj{project_id}")
                # 세션은 태스크보다 오래 유지되므로 일회성 worktree 가 아닌 프로젝트 루트에서 연다
                session_create(_new_sess, cwd, None)
                _log("INFO", f"신규 세션 '{_new_sess}' 생성")
                if not _wait_session_ready(_new_sess):
                    _log("WARN", f"세션 '{_new_sess}' 준비 대기 초과 — 전송 시도")
                task_session_name = _new_sess
            except Exception as _se:
                _log("ERROR", f"신규 세션 생성 실패 · {_se} — CLI 직접 실행으로 폴백")
                task_session_name = ""
        elif _sess_ov:
            task_session_name = _sess_ov

        # 실제 사용한 세션을 기록해 둔다 — 다음 태스크의 '__prev__'가 이 값을 되짚는다.
        if task_session_name:
            try:
                with sqlite3.connect(PROJECTS_DB) as conn:
                    conn.execute("UPDATE task_runs SET session_name=? WHERE id=?",
                                 (task_session_name, run_id))
                    conn.commit()
            except Exception:
                pass

        if claude_bin and prompt.strip():
            if task_session_name:
                # ── 세션 연동: 실행 중인 세션에 프롬프트 전달 ──
                _log("INFO", f"세션 '{task_session_name}'으로 프롬프트 전송")
                ok, output = _session_run_prompt(task_session_name, prompt, timeout=timeout)
                rc = 0 if ok else -2
                if not ok:
                    _log("ERROR", f"세션 실행 실패 · {output}")
                else:
                    _log("INFO", "세션 응답 수신 완료")
            else:
                # ── 직접 CLI subprocess 실행 (엔진별 분기) ──
                _log("INFO", f"{project_engine} CLI 실행 시작")
                try:
                    if project_engine == "antigravity":
                        # gemini/antigravity CLI: -p(프롬프트) -o text, 모델은 gemini 계열만 전달
                        cmd = [claude_bin, "-p", prompt, "--output-format", "text"]
                        if (model or "").startswith("gemini"):
                            cmd += ["--model", model]
                        if skip_permissions:
                            cmd += ["--yolo"]
                        if _resume_sid:
                            _log("WARN", "antigravity 엔진은 Claude 세션 재개를 지원하지 않음 — 새 대화로 실행")
                    else:
                        cmd = [claude_bin, "-p", prompt, "--model", model, "--output-format", "text"]
                        if _resume_sid:
                            cmd += ["--resume", _resume_sid]
                        if skip_permissions:
                            cmd += ["--dangerously-skip-permissions"]
                        else:
                            _tool_name_map = {
                                "read":  ["Read", "Glob", "Grep", "LS"],
                                "write": ["Write", "Edit", "MultiEdit"],
                                "bash":  ["Bash"],
                            }
                            allowed_tools = []
                            for p in tool_perms:
                                allowed_tools.extend(_tool_name_map.get(p, []))
                            if allowed_tools:
                                cmd += ["--allowedTools", ",".join(allowed_tools)]
                    # 하네스가 실행하는 프롬프트는 이미 EP4 태스크이므로 훅 재등록을 막는다
                    proc = subprocess.Popen(
                        cmd,
                        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                        stdin=subprocess.DEVNULL,
                        cwd=run_cwd,
                        env=_ep4_internal_env()
                    )
                    with project_states_lock:
                        project_states[project_id]["proc"] = proc
                    try:
                        out_b, err_b = proc.communicate(timeout=timeout)
                        rc = proc.returncode
                    except subprocess.TimeoutExpired:
                        proc.kill(); proc.communicate()
                        out_b, err_b, rc = b"TIMEOUT", b"", -1
                        _log("ERROR", f"타임아웃 · {timeout}s 초과")
                    finally:
                        with project_states_lock:
                            project_states[project_id].pop("proc", None)
                    if rc not in (0, -1) and project_states.get(project_id, {}).get("status") != "running":
                        out_b, err_b, rc = b"STOPPED", b"", -3
                    out_bytes = (out_b or b'') + (err_b or b'')
                    output = out_bytes.decode('utf-8', errors='replace').strip()
                except Exception as e:
                    output, rc = str(e), -2
                    _log("ERROR", f"?ㅽ뻾 ?ㅻ쪟 쨌 {e}")
        else:
            rc, output = run_command(title)

        status = "done" if rc == 0 else "error"
        if rc == 0:
            _log("INFO", "태스크 완료 · rc=0")
        elif rc != -1:
            first_err = (output or "").split('\n')[0][:120]
            _log("ERROR", f"태스크 실패 · rc={rc}" + (f" · {first_err}" if first_err else ""))

        # ── Git: 태스크 → 프로젝트 브랜치 머지 ──
        _git_merge_status = 'no_git'
        _git_diff = []
        _git_commits = []
        _git_pr_url_val = ''

        try:
            if _git_task_branch and _git_proj_wt and _git_root_path:
                if status == 'done':
                    # task worktree의 미커밋 변경사항을 커밋
                    if _git_task_wt:
                        r_add = _git_run('git','-C',_git_task_wt,'add','-A', timeout=15)
                        r_cmt = _git_run('git','-C',_git_task_wt,'commit',
                                         '-m',f'task: {title}',
                                         '--author','EasyProject4 <ep4@localhost>', timeout=15)
                        if r_cmt.returncode == 0:
                            _log("INFO", f"Git 커밋 완료 · {_git_task_branch}")
                        # returncode=1 이면 "nothing to commit" — 정상
                    _git_diff = _git_diff_files(_git_root_path, _git_proj_branch, _git_task_branch)
                    _git_commits = _git_get_commits(_git_root_path, _git_proj_branch, _git_task_branch)
                    if _git_diff or _git_commits:
                        merged, merge_msg = _git_merge_task(_git_proj_wt, _git_task_branch, title)
                        if merged:
                            _git_merge_status = 'merged'
                            _git_pr_url_val = _git_pr_url(_git_root_path, _git_proj_branch,
                                                           _git_default_branch(_git_root_path))
                            _log("INFO", f"Git 머지 완료 · {_git_task_branch} → {_git_proj_branch}")
                            _git_run('git','-C',_git_root_path,'worktree','remove','--force',_git_task_wt, timeout=10)
                            # 프로젝트 브랜치 → 기본 브랜치(main) 머지까지 완결
                            _m_ok, _m_msg = _git_merge_to_default(
                                _git_root_path, _git_proj_branch, title)
                            if _m_ok:
                                _log("INFO", f"Git 머지 완료 · {_git_proj_branch} → {_m_msg}")
                            else:
                                _log("WARN", f"기본 브랜치 머지 실패 (프로젝트 브랜치에는 반영됨) · {_m_msg[:120]}")
                        else:
                            _git_merge_status = 'conflict'
                            _log("WARN", f"Git 머지 충돌 · {merge_msg[:120]}")
                    else:
                        _git_merge_status = 'no_changes'
                        _log("INFO", "Git: 변경 사항 없음")
                else:
                    _git_merge_status = 'task_failed'
                    _log("INFO", f"Git: 태스크 실패로 머지 생략 · {_git_task_branch}")
            elif _git_enabled:
                _git_merge_status = 'wt_error'
        except Exception as _git_err:
            _git_merge_status = 'error'
            print(f"[harness] Git 설정 오류 (태스크 계속 실행): {_git_err}")

        task_ended_at = datetime.now().isoformat()
        try:
            with sqlite3.connect(PROJECTS_DB) as conn:
                conn.execute(
                    "UPDATE project_tasks SET status=?, output=?, ended_at=?, version=version+1 WHERE id=?",
                    (status, output[:4000], task_ended_at, tid)
                )
                conn.commit()
        except Exception as _db_err:
            print(f"[harness] project_tasks update error: {_db_err}")

        _gate_push_task(project_id, tid)   # 동기화 프로젝트: 실행 결과 상태 전파

        emit("task_done", {"project_id": project_id, "task_id": tid, "status": status, "output": output[:500], "rc": rc, "run_id": run_id, "trace_id": trace_id, "span_id": span_id})

        # ── Claude 세션 동작을 실행 로그 + 세션 탭에 기록 ──
        _claude_session_detail = None
        if claude_bin and prompt.strip() and not task_session_name:
            try:
                # 재개 실행은 기존 전사에 이어 쓰이므로 새 파일이 생기지 않는다 — 그 파일을 직접 집는다
                _sess_file = (_find_claude_session_by_id(_resume_sid) if _resume_sid
                              else _find_new_claude_session(run_cwd, _claude_sess_before, _run_start_ts))
                if _sess_file:
                    _sess_entries, _claude_session_id = _claude_session_log_entries(_sess_file)
                    _claude_session_detail = _parse_claude_session_detail(_sess_file)
                    if _claude_session_id:
                        _log("INFO", f"Claude 세션 · {_claude_session_id}")
                    if _sess_entries:
                        _log("INFO", f"Claude 세션 시작 {len(_sess_entries)}개")
                        # 너무 많으면 최근 600건만
                        if len(_sess_entries) > 600:
                            _sess_entries = _sess_entries[-600:]
                        for _e in _sess_entries:
                            _e.setdefault("trace_id", trace_id)
                            _e.setdefault("span_id", span_id)
                            run_log_entries.append(_e)
                            if run_id:
                                emit("run_log", {"run_id": run_id, "project_id": project_id, "entry": _e})
            except Exception as _sess_err:
                print(f"[harness] Claude session log error: {_sess_err}")

        if channel_ids:
            icon = "✅" if status == "done" else "❌"
            notif_msg = f"{icon} [{project_name}] {title} {'완료' if status=='done' else '오류'}"
            _log("INFO", f"알림 전송 중 {len(channel_ids)}개 채널")
            _send_notification(channel_ids, notif_msg, project_id=project_id)

        _log("INFO", "중간 로그 처리 완료")

        # ── 웹페이지 스크린샷 캡처 ──
        _screenshot_path = ''
        _preview_url_saved = ''
        if status == 'done' and run_id:
            _proot = Path(project_root) if project_root else None
            if (_proot and (_proot / "stop.bat").exists() and (_proot / "run.bat").exists()):
                # stop.bat + run.bat 있으면 재시작 후 캡처
                _log("INFO", "서버 재시작 후 스크린샷 캡처 시작")
                _screenshot_path, _preview_url_saved = _restart_and_screenshot(project_root, run_id)
                if _screenshot_path:
                    _log("INFO", f"스크린샷 캡처 완료 · {_preview_url_saved}")
                else:
                    _log("WARN", "스크린샷 캡처 실패")
            elif project_preview_url:
                # 기존 방식: preview_url 직접 설정된 경우
                _web_changed = _is_web_change(_git_diff) or _git_merge_status == 'no_git'
                if _web_changed:
                    _log("INFO", f"스크린샷 캡처 시작 · {project_preview_url}")
                    _shot_file = SCREENSHOTS_DIR / f"run_{run_id}.png"
                    if _capture_screenshot(project_preview_url, _shot_file):
                        _screenshot_path = f"run_{run_id}.png"
                        _preview_url_saved = project_preview_url
                        _log("INFO", "스크린샷 캡처 완료")
                    else:
                        _log("WARN", "스크린샷 캡처 실패 (URL 접속 불가 또는 Playwright 오류)")

        try:
            with sqlite3.connect(PROJECTS_DB) as conn:
                conn.execute(
                    "UPDATE task_runs SET status=?, output=?, log_lines=?, ended_at=?, git_merge_status=?, git_diff_json=?, git_commits_json=?, git_pr_url=?, claude_session_id=?, claude_session_json=?, screenshot_path=?, preview_url=? WHERE id=?",
                    (status, output[:8000], json.dumps(run_log_entries, ensure_ascii=False),
                     task_ended_at, _git_merge_status,
                     json.dumps(_git_diff, ensure_ascii=False),
                     json.dumps(_git_commits, ensure_ascii=False),
                     _git_pr_url_val, _claude_session_id,
                     json.dumps(_claude_session_detail, ensure_ascii=False) if _claude_session_detail else '',
                     _screenshot_path, _preview_url_saved,
                     run_id)
                )
                conn.commit()
        except Exception as _db_err2:
            print(f"[harness] task_runs update error: {_db_err2}")

        # DB 저장 완료 후 run_done 이벤트 — 프론트엔드가 최종 상태로 갱신
        emit("run_done", {
            "run_id": run_id, "project_id": project_id, "status": status,
            "git_merge_status": _git_merge_status,
            "duration_sec": int((datetime.fromisoformat(task_ended_at) - datetime.fromisoformat(task_started_at)).total_seconds())
        })

        # 태스크 입력·답변을 해당 프로젝트의 프롬프트 문서에 기록
        _append_prompt_doc(prompt, output, project_root)

        # 플러그인 훅: 태스크 완료 알림
        try:
            EP4_PM.hook.ep4_on_task_done(run={
                "run_id": run_id, "project_id": project_id, "project_name": project_name,
                "project_root": project_root, "task_id": tid, "title": title,
                "status": status, "output": output[:8000],
                "git_merge_status": _git_merge_status,
                "screenshot_path": _screenshot_path, "preview_url": _preview_url_saved,
            })
        except Exception as _he:
            print(f"[plugins] on_task_done 훅 오류: {_he}")

        prev_span_id = span_id  # 다음 태스크의 parent_span_id
        time.sleep(0.2)

    # 실행 중 큐잉된(pending) 태스크가 있으면 이어서 실행 — /run 이
    # "already running" 거부 대신 pending 마킹으로 큐잉한 태스크를 소화한다
    with project_states_lock:
        _still_running = project_states.get(project_id, {}).get("status") == "running"
    if _still_running:
        with sqlite3.connect(PROJECTS_DB) as _conn:
            _queued_cnt = _conn.execute(
                "SELECT COUNT(*) FROM project_tasks WHERE project_id=? AND status='pending'",
                (project_id,)
            ).fetchone()[0]
        if _queued_cnt > 0:
            threading.Thread(target=harness_runner, args=(project_id,), daemon=True).start()
            return

    with project_states_lock:
        final = project_states.get(project_id, {})
        if final.get("status") == "running":
            project_states[project_id] = {"status": "done", "current_task": None}
    final_status = project_states.get(project_id, {}).get("status", "done")
    emit("status", {"project_id": project_id, "status": final_status, "message": "실행 완료"})

    if channel_ids:
        _send_project_notification(project_id, project_name, final_status, channel_ids, trace_id=trace_id)


# ── 대시보드 도우미 채팅 ─────────────────────────────────
CHAT_DB = BASE_DIR / "chat.db"
CHANNELS_DB = BASE_DIR / "channels.db"
PROJECTS_DB = BASE_DIR / "projects.db"


def _task_uid() -> str:
    """태스크 전역 식별자 (manager_server 동기화용). 머신 간 충돌 없는 UUID."""
    return _uuid_mod.uuid4().hex


# 새 태스크의 기본 트리거. 훅·MCP 는 trigger_type 을 명시하므로 이 값의 영향을
# 받지 않고, trigger_type 을 보내지 않는 클라이언트(모바일 등)에만 적용된다.
DEFAULT_TRIGGER_TYPE = "on_dependency"


TASK_TRIGGER_TYPES = ("manual", "on_dependency", "schedule")


def _insert_task(pid: int, *, title: str, prompt: str, test_c: str = "", trig: str = "",
                 model_ov: str = "", timeout_ov: int = 0, session_ov: str = "",
                 uid: str = "", author: str = "") -> tuple:
    """project_tasks 에 태스크 한 건을 추가하고 (tid, uid) 를 반환한다.
    프로젝트별 tasks 엔드포인트와 이름 기반 /api/task 가 같은 경로를 타도록 공유."""
    uid = (uid or "").strip() or _task_uid()
    author = (author or "").strip() or _new_local_author()
    _sinfo = _gate_sync_info(pid)
    if _sinfo and not author:
        author = _sinfo.get("user") or ""
    with sqlite3.connect(PROJECTS_DB) as conn:
        new_order = _next_top_sort_order(conn, pid)
        cur = conn.execute(
            "INSERT INTO project_tasks (project_id, title, prompt, test_criteria, trigger_type, model_override, timeout_override, sort_order, uid, author, version, session_override) VALUES (?,?,?,?,?,?,?,?,?,?,1,?)",
            (pid, title, prompt, test_c, trig or DEFAULT_TRIGGER_TYPE, model_ov,
             timeout_ov, new_order, uid, author, session_ov)
        )
        conn.commit()
        tid = cur.lastrowid
    _gate_push_task(pid, tid)
    emit("tasks_changed", {"project_id": pid})
    return tid, uid


def _find_project_by_name(name: str) -> tuple:
    """프로젝트 이름으로 (id, name) 을 찾는다. 정확히 일치 → 대소문자 무시 순으로
    보고, 동명이 여럿이면 먼저 만들어진(id 작은) 것을 쓴다. 없으면 (None, None)."""
    name = (name or "").strip()
    if not name:
        return None, None
    with sqlite3.connect(PROJECTS_DB) as conn:
        row = conn.execute(
            "SELECT id, name FROM projects WHERE name=? ORDER BY id LIMIT 1", (name,)
        ).fetchone()
        if not row:
            row = conn.execute(
                "SELECT id, name FROM projects WHERE LOWER(name)=LOWER(?) ORDER BY id LIMIT 1",
                (name,)
            ).fetchone()
    return (row[0], row[1]) if row else (None, None)


def _project_brief_list() -> list:
    """외부 조회용 프로젝트 목록 — 이름과 id 만."""
    with sqlite3.connect(PROJECTS_DB) as conn:
        rows = conn.execute("SELECT id, name FROM projects ORDER BY id").fetchall()
    return [{"project_id": r[0], "project_name": r[1] or ""} for r in rows]


def _project_detail(pid: int) -> dict:
    """프로젝트 정보 + 태스크(id·제목·상태) 목록. 없으면 {}."""
    with sqlite3.connect(PROJECTS_DB) as conn:
        row = conn.execute(
            "SELECT id, name, description, model, engine, project_root, status,"
            "       auto_run, session_name, claude_session_id, preview_url, shared,"
            "       retry_count, timeout_sec, created_at, updated_at"
            "  FROM projects WHERE id=?", (pid,)
        ).fetchone()
        if not row:
            return {}
        tasks = conn.execute(
            "SELECT id, title, status FROM project_tasks"
            " WHERE project_id=? ORDER BY folder_id NULLS FIRST, sort_order", (pid,)
        ).fetchall()

    counts = {}
    for _, _, st in tasks:
        st = st or "pending"
        counts[st] = counts.get(st, 0) + 1
    # 실행 중 상태는 메모리 쪽이 최신이다 (/api/projects 와 같은 규칙)
    live = project_states.get(pid, {}).get("status")
    return {
        "ok": True,
        "project_id": row[0],
        "project_name": row[1] or "",
        "description": row[2] or "",
        "model": row[3] or "",
        "engine": row[4] or "claude",
        "project_root": row[5] or "",
        "status": live or row[6] or "idle",
        "auto_run": bool(row[7]),
        "session_name": row[8] or "",
        "claude_session_id": row[9] or "",
        "preview_url": row[10] or "",
        "shared": bool(row[11]),
        "retry_count": row[12],
        "timeout_sec": row[13],
        "created_at": row[14] or "",
        "updated_at": row[15] or "",
        "task_count": len(tasks),
        "task_status_counts": counts,
        "tasks": [{"id": t[0], "title": t[1] or "", "status": t[2] or "pending"} for t in tasks],
    }


TASK_STATUSES = ("pending", "running", "done", "error")

# PUT /api/task/{id} 의 외부 필드명 -> project_tasks 컬럼명
TASK_UPDATABLE = {
    "title": "title", "prompt": "prompt", "test": "test_criteria",
    "model": "model_override", "trigger": "trigger_type",
    "session": "session_override", "status": "status",
}


def _update_task(tid: int, body: dict) -> tuple:
    """태스크를 부분 수정한다. body 에 실린 키만 갱신하며,
    (error, changed, project_id) 를 반환한다 (error 는 (메시지, 상태코드) 또는 None)."""
    fields = {k: v for k, v in body.items() if k in TASK_UPDATABLE}
    if not fields:
        return ("no updatable field", 400), [], None

    if "trigger" in fields:
        trig = (fields["trigger"] or "").strip()
        if trig not in TASK_TRIGGER_TYPES:
            return (f"invalid trigger: {trig}", 400), [], None
        fields["trigger"] = trig
    if "status" in fields:
        st = (fields["status"] or "").strip()
        if st not in TASK_STATUSES:
            return (f"invalid status: {st}", 400), [], None
        fields["status"] = st

    with sqlite3.connect(PROJECTS_DB) as conn:
        row = conn.execute(
            "SELECT project_id, title, prompt FROM project_tasks WHERE id=?", (tid,)
        ).fetchone()
        if not row:
            return (f"task not found: {tid}", 404), [], None
        pid, cur_title, cur_prompt = row

        # 제목을 비우면 프롬프트 첫 줄로 되살린다 (추가 API 와 같은 규칙)
        if "title" in fields:
            _prompt = fields["prompt"] if "prompt" in fields else (cur_prompt or "")
            fields["title"] = _derive_task_title(fields["title"] or "", _prompt)
            if not fields["title"]:
                return ("title or prompt required", 400), [], None

        sets, vals = [], []
        for key, val in fields.items():
            sets.append(f"{TASK_UPDATABLE[key]}=?")
            vals.append(val if isinstance(val, int) else (val or "").strip())
        vals.append(tid)
        conn.execute(
            f"UPDATE project_tasks SET {', '.join(sets)}, version=version+1 WHERE id=?", vals)
        conn.commit()

    _gate_push_task(pid, tid)   # gate 로 수정 전파
    emit("tasks_changed", {"project_id": pid})
    return None, sorted(fields), pid


def _maybe_autostart_project(pid: int, trigger: str, force: bool = None) -> str:
    """태스크를 추가한 뒤 하네스를 자동으로 걸지 판단한다.

    반환값(응답의 status 필드): started(새로 실행 시작) · queued(이미 실행 중이라
    진행 중인 하네스가 이어서 처리) · auto_run_off · skipped · 그 외에는 걸지
    않은 사유로 trigger 값을 그대로 돌려준다(manual·claude_cli 등).

    trigger 가 on_dependency 면 "선행 태스크가 끝난 뒤 실행"이라는 뜻인데,
    하네스가 pending 을 sort_order 순으로 소화하므로 하네스를 띄우는 것으로 충족된다.
    force 가 True/False 면 trigger 판단을 건너뛴다(API 의 run 파라미터).
    """
    if force is False:
        return "skipped"
    if force is not True:
        # 자동 실행은 on_dependency 만 화이트리스트로 허용한다. manual/schedule 은
        # 물론이고, 훅·MCP 가 같은 엔드포인트로 넣는 claude_cli/antigravity_cli
        # (이미 CLI 에서 실행된 프롬프트의 기록)까지 재실행되면 안 되기 때문이다.
        if trigger != "on_dependency":
            return trigger or "manual"
        with sqlite3.connect(PROJECTS_DB) as conn:
            row = conn.execute("SELECT auto_run FROM projects WHERE id=?", (pid,)).fetchone()
        if not row or not row[0]:
            return "auto_run_off"   # 프로젝트의 '자동 실행 활성화' 가 꺼져 있음
    with project_states_lock:
        if project_states.get(pid, {}).get("status") == "running":
            # 실행 중이면 하네스가 끝날 때 pending 을 다시 훑어 이어서 처리한다
            return "queued"
        project_states[pid] = {"status": "running", "current_task": None}
    threading.Thread(target=harness_runner, args=(pid,), daemon=True).start()
    return "started"


TASK_OUTPUT_CLIP = 2000   # 상태 조회 기본 output 길이 — full=1 이면 전체


def _task_status(tid: int, full_output: bool = False) -> dict:
    """태스크 한 건의 현재 상태를 조회한다. 없으면 {}.
    output 은 폴링에 쓰기 좋게 기본 잘라서 주고, 전체 길이는 output_len 으로 알린다."""
    with sqlite3.connect(PROJECTS_DB) as conn:
        row = conn.execute(
            "SELECT t.id, t.uid, t.project_id, p.name, t.title, t.status, t.trigger_type,"
            "       t.model_override, t.session_override, t.created_at, t.started_at,"
            "       t.ended_at, t.output, t.prompt, t.test_criteria, t.branch"
            "  FROM project_tasks t LEFT JOIN projects p ON p.id = t.project_id"
            " WHERE t.id=?", (tid,)
        ).fetchone()
        if not row:
            return {}
        run = conn.execute(
            "SELECT id, status, started_at, ended_at, model, session_name,"
            "       claude_session_id, git_task_branch, git_merge_status"
            "  FROM task_runs WHERE task_id=? ORDER BY id DESC LIMIT 1", (tid,)
        ).fetchone()
        run_count = conn.execute(
            "SELECT COUNT(*) FROM task_runs WHERE task_id=?", (tid,)
        ).fetchone()[0]

    output = row[12] or ""
    out = {
        "ok": True,
        "id": row[0],
        "uid": row[1] or "",
        "project_id": row[2],
        "project_name": row[3] or "",
        "title": row[4] or "",
        "status": row[5] or "pending",
        "trigger": row[6] or "",
        "model": row[7] or "",
        "session": row[8] or "",
        "created_at": row[9] or "",
        "started_at": row[10] or "",
        "ended_at": row[11] or "",
        "prompt": row[13] or "",
        "test": row[14] or "",
        "branch": row[15] or "",
        "output_len": len(output),
        "output": output if full_output else output[:TASK_OUTPUT_CLIP],
        "output_truncated": (not full_output) and len(output) > TASK_OUTPUT_CLIP,
        "run_count": run_count,
    }
    out["last_run"] = {
        "id": run[0], "status": run[1] or "", "started_at": run[2] or "",
        "ended_at": run[3] or "", "model": run[4] or "", "session_name": run[5] or "",
        "claude_session_id": run[6] or "", "git_task_branch": run[7] or "",
        "git_merge_status": run[8] or "",
    } if run else None
    return out


def _derive_task_title(title: str, prompt: str) -> str:
    """제목은 선택 입력 — 비어 있으면 프롬프트 첫 줄을 제목으로 쓴다.
    모바일 추가 시트가 쓰던 규칙(첫 비어있지 않은 줄, 100자 컷)을 서버로 옮긴 것."""
    title = (title or "").strip()
    if title:
        return title
    for line in (prompt or "").split("\n"):
        line = line.strip()
        if line:
            return line[:100]
    return ""


def _new_local_author() -> str:
    """로컬에서 생성된 태스크의 기본 등록자. gate 로그인 전에는 LOCAL_AUTHOR(기본 빈값)."""
    return os.environ.get("LOCAL_AUTHOR", "").strip()


def _read_connect_info() -> dict:
    """모바일 QR 연결용 정보. 접속 방식 설정(connect_mode)이 direct 면 설정된
    URL(connect_direct_url — 공유기 NAT/포트포워딩 등으로 외부 접속이 되는 주소)을,
    아니면 tunnel.url(현재 Cloudflare 터널 URL)을 사용한다.
    ep4_id.txt(EP4 ID), ep4_name.txt(표시 이름, 없으면 호스트명)도 함께 반환."""
    base = Path(__file__).parent
    mode = (_get_setting("connect_mode") or "tunnel").strip() or "tunnel"
    direct_url = (_get_setting("connect_direct_url") or "").strip().rstrip("/")
    url = ""
    if mode == "direct":
        url = direct_url
    else:
        tf = base / "tunnel.url"
        if tf.exists():
            try:
                for line in tf.read_text(encoding="utf-8", errors="ignore").splitlines():
                    if line.strip().upper().startswith("URL="):
                        url = line.split("=", 1)[1].strip()
                        break
            except Exception:
                pass
    ep4_id = ""
    idf = base / "ep4_id.txt"
    if idf.exists():
        try:
            ep4_id = idf.read_text(encoding="utf-8").strip()
        except Exception:
            pass
    namef = base / "ep4_name.txt"
    try:
        name = namef.read_text(encoding="utf-8").strip() if namef.exists() else socket.gethostname()
    except Exception:
        name = socket.gethostname()
    return {"url": url, "id": ep4_id, "name": name,
            "mode": mode, "direct_url": direct_url}


def _qr_connect_data() -> str:
    """QR 코드에 인코딩할 연결 데이터.
    URL 이 있으면 '접속 URL + 인증 토큰' 형식 — 폰 카메라(브라우저)로 찍으면
    반응형 웹이 자동 로그인으로 열리고, EP4 모바일 앱으로 찍으면 토큰을
    추출해 인증까지 자동 처리된다. URL 이 없으면 기존 JSON(id/name) 형식."""
    info = _read_connect_info()
    if info.get("url"):
        url = info["url"].rstrip("/")
        if _AUTH_TOKEN:
            from urllib.parse import quote
            return f"{url}/?token={quote(_AUTH_TOKEN)}"
        return url
    payload = {k: info[k] for k in ("url", "id", "name") if info.get(k)}
    if _AUTH_TOKEN:
        payload["token"] = _AUTH_TOKEN
    return json.dumps(payload, ensure_ascii=False)


def _next_top_sort_order(conn, pid) -> int:
    """새 최상위 항목(언그룹 태스크/폴더)이 항상 마지막에 오도록 할 sort_order.

    언그룹 태스크와 폴더는 하나의 통합 정렬 공간(10 단위)을 공유한다.
    """
    t = conn.execute(
        "SELECT COALESCE(MAX(sort_order), 0) FROM project_tasks "
        "WHERE project_id=? AND folder_id IS NULL", (pid,)
    ).fetchone()[0] or 0
    f = conn.execute(
        "SELECT COALESCE(MAX(sort_order), 0) FROM task_folders WHERE project_id=?", (pid,)
    ).fetchone()[0] or 0
    return max(t, f) + 10


def _init_projects_db() -> None:
    with sqlite3.connect(PROJECTS_DB) as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS projects (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                name         TEXT NOT NULL,
                description  TEXT DEFAULT '',
                model        TEXT DEFAULT 'claude-fable-5',
                preset       TEXT DEFAULT 'standard',
                retry_count  INTEGER DEFAULT 3,
                timeout_sec  INTEGER DEFAULT 1800,
                tool_perms   TEXT DEFAULT '[]',
                datasource   TEXT DEFAULT '',
                project_root      TEXT    DEFAULT '',
                skip_permissions  INTEGER DEFAULT 0,
                auto_run          INTEGER DEFAULT 1,
                status       TEXT DEFAULT 'idle',
                gate_url          TEXT    DEFAULT '',
                gate_token        TEXT    DEFAULT '',
                gate_project_id   TEXT    DEFAULT '',
                gate_role         TEXT    DEFAULT '',
                gate_user         TEXT    DEFAULT '',
                gate_user_id      TEXT    DEFAULT '',
                gate_cursor       INTEGER DEFAULT 0,
                sync_enabled      INTEGER DEFAULT 0,
                preview_url       TEXT    DEFAULT '',
                engine            TEXT    DEFAULT 'claude',
                shared            INTEGER DEFAULT 0,
                created_at   TEXT DEFAULT (datetime('now')),
                updated_at   TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS project_tasks (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id       INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                title            TEXT NOT NULL,
                prompt           TEXT DEFAULT '',
                test_criteria    TEXT DEFAULT '',
                trigger_type     TEXT DEFAULT 'manual',
                trigger_meta     TEXT DEFAULT '{}',
                model_override   TEXT DEFAULT '',
                timeout_override INTEGER DEFAULT 0,
                sort_order       INTEGER DEFAULT 0,
                status           TEXT DEFAULT 'pending',
                output           TEXT DEFAULT '',
                branch           TEXT DEFAULT '',
                uid              TEXT,
                author           TEXT DEFAULT '',
                version          INTEGER DEFAULT 1,
                started_at       TEXT,
                ended_at         TEXT,
                created_at       TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS task_folders (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                name       TEXT NOT NULL,
                sort_order INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS project_channel_links (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                channel_id INTEGER NOT NULL,
                UNIQUE(project_id, channel_id)
            );
            CREATE TABLE IF NOT EXISTS task_runs (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id        INTEGER NOT NULL,
                project_id     INTEGER NOT NULL,
                task_title     TEXT    DEFAULT '',
                project_name   TEXT    DEFAULT '',
                attempt        INTEGER DEFAULT 1,
                status         TEXT    DEFAULT 'running',
                trigger_type   TEXT    DEFAULT 'manual',
                model          TEXT    DEFAULT '',
                prompt         TEXT    DEFAULT '',
                output         TEXT    DEFAULT '',
                log_lines      TEXT    DEFAULT '[]',
                trace_id          TEXT,
                span_id           TEXT,
                parent_span_id    TEXT,
                git_task_branch   TEXT    DEFAULT '',
                git_proj_branch   TEXT    DEFAULT '',
                git_merge_status  TEXT    DEFAULT 'no_git',
                git_diff_json     TEXT    DEFAULT '[]',
                git_commits_json  TEXT    DEFAULT '[]',
                git_pr_url        TEXT    DEFAULT '',
                screenshot_path   TEXT    DEFAULT '',
                started_at        TEXT,
                ended_at          TEXT,
                created_at        TEXT    DEFAULT (datetime('now'))
            );
        """)
        conn.commit()

_init_projects_db()

def _migrate_projects_db():
    with sqlite3.connect(PROJECTS_DB) as conn:
        cols = [r[1] for r in conn.execute("PRAGMA table_info(projects)").fetchall()]
        if "project_root" not in cols:
            conn.execute("ALTER TABLE projects ADD COLUMN project_root TEXT DEFAULT ''")
        if "skip_permissions" not in cols:
            conn.execute("ALTER TABLE projects ADD COLUMN skip_permissions INTEGER DEFAULT 0")
        run_cols = [r[1] for r in conn.execute("PRAGMA table_info(task_runs)").fetchall()]
        if "trace_id" not in run_cols:
            conn.execute("ALTER TABLE task_runs ADD COLUMN trace_id TEXT")
        if "span_id" not in run_cols:
            conn.execute("ALTER TABLE task_runs ADD COLUMN span_id TEXT")
        if "parent_span_id" not in run_cols:
            conn.execute("ALTER TABLE task_runs ADD COLUMN parent_span_id TEXT")
        if "git_task_branch" not in run_cols:
            conn.execute("ALTER TABLE task_runs ADD COLUMN git_task_branch TEXT DEFAULT ''")
        if "git_proj_branch" not in run_cols:
            conn.execute("ALTER TABLE task_runs ADD COLUMN git_proj_branch TEXT DEFAULT ''")
        if "git_merge_status" not in run_cols:
            conn.execute("ALTER TABLE task_runs ADD COLUMN git_merge_status TEXT DEFAULT 'no_git'")
        if "git_diff_json" not in run_cols:
            conn.execute("ALTER TABLE task_runs ADD COLUMN git_diff_json TEXT DEFAULT '[]'")
        if "git_commits_json" not in run_cols:
            conn.execute("ALTER TABLE task_runs ADD COLUMN git_commits_json TEXT DEFAULT '[]'")
        if "git_pr_url" not in run_cols:
            conn.execute("ALTER TABLE task_runs ADD COLUMN git_pr_url TEXT DEFAULT ''")
        if "session_name" not in run_cols:
            # 이 실행이 실제로 사용한 대화형 세션 이름 (세션 미사용이면 '').
            # 태스크 세션 옵션 '__prev__'(이전 태스크 세션)가 이 값을 되짚는다.
            conn.execute("ALTER TABLE task_runs ADD COLUMN session_name TEXT DEFAULT ''")
        if "claude_session_id" not in run_cols:
            conn.execute("ALTER TABLE task_runs ADD COLUMN claude_session_id TEXT DEFAULT ''")
        if "claude_session_json" not in run_cols:
            conn.execute("ALTER TABLE task_runs ADD COLUMN claude_session_json TEXT DEFAULT ''")
        if "screenshot_path" not in run_cols:
            conn.execute("ALTER TABLE task_runs ADD COLUMN screenshot_path TEXT DEFAULT ''")
        if "preview_url" not in run_cols:
            conn.execute("ALTER TABLE task_runs ADD COLUMN preview_url TEXT DEFAULT ''")
        if "session_name" not in cols:
            conn.execute("ALTER TABLE projects ADD COLUMN session_name TEXT DEFAULT ''")
        if "preview_url" not in cols:
            conn.execute("ALTER TABLE projects ADD COLUMN preview_url TEXT DEFAULT ''")
        if "engine" not in cols:
            conn.execute("ALTER TABLE projects ADD COLUMN engine TEXT DEFAULT 'claude'")
        if "shared" not in cols:
            conn.execute("ALTER TABLE projects ADD COLUMN shared INTEGER DEFAULT 0")
        # 레거시 기본 타임아웃(120초) 상향 — claude CLI 코딩 태스크에 너무 짧아
        # TIMEOUT 이 빈발하던 값. user_version 가드로 한 번만 적용해,
        # 이후 사용자가 의도적으로 짧게 설정한 값은 건드리지 않는다.
        uv = conn.execute("PRAGMA user_version").fetchone()[0]
        if uv < 1:
            conn.execute("UPDATE projects SET timeout_sec=1800 WHERE timeout_sec=120")
            conn.execute("PRAGMA user_version=1")
        # 연결된 다른 EP4(peer) 목록 — 직접 URL 연결 방식
        conn.execute("""
            CREATE TABLE IF NOT EXISTS ep4_peers (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                url        TEXT NOT NULL UNIQUE,
                name       TEXT DEFAULT '',
                enabled    INTEGER DEFAULT 1,
                token      TEXT DEFAULT '',
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)
        peer_cols = [r[1] for r in conn.execute("PRAGMA table_info(ep4_peers)").fetchall()]
        if "token" not in peer_cols:
            conn.execute("ALTER TABLE ep4_peers ADD COLUMN token TEXT DEFAULT ''")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_task_runs_trace ON task_runs(trace_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_task_runs_span  ON task_runs(span_id)")
        # ── Phase 2: 태스크 전역 UUID (manager_server 동기화 기반) ──
        pt_cols = [r[1] for r in conn.execute("PRAGMA table_info(project_tasks)").fetchall()]
        if "uid" not in pt_cols:
            conn.execute("ALTER TABLE project_tasks ADD COLUMN uid TEXT")
        if "author" not in pt_cols:
            conn.execute("ALTER TABLE project_tasks ADD COLUMN author TEXT DEFAULT ''")
        if "version" not in pt_cols:
            conn.execute("ALTER TABLE project_tasks ADD COLUMN version INTEGER DEFAULT 1")
        # 기존 태스크에 uid 백필
        for (rid,) in conn.execute(
            "SELECT id FROM project_tasks WHERE uid IS NULL OR uid=''"
        ).fetchall():
            conn.execute("UPDATE project_tasks SET uid=? WHERE id=?", (_task_uid(), rid))
        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_pt_uid ON project_tasks(uid)")
        # ── Phase 4: 태스크 폴더 ──
        conn.execute("""
            CREATE TABLE IF NOT EXISTS task_folders (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                name       TEXT NOT NULL,
                sort_order INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)
        pt_cols2 = [r[1] for r in conn.execute("PRAGMA table_info(project_tasks)").fetchall()]
        if "folder_id" not in pt_cols2:
            conn.execute("ALTER TABLE project_tasks ADD COLUMN folder_id INTEGER REFERENCES task_folders(id)")
        # ── 태스크별 세션 지정: ''=프로젝트 기본, '__new__'=신규 세션, 그 외=세션 이름 ──
        if "session_override" not in pt_cols2:
            conn.execute("ALTER TABLE project_tasks ADD COLUMN session_override TEXT DEFAULT ''")
        # ── Phase 3: manager_server 연동 컬럼 ──
        for col, ddl in [
            ("gate_url", "ALTER TABLE projects ADD COLUMN gate_url TEXT DEFAULT ''"),
            ("gate_token", "ALTER TABLE projects ADD COLUMN gate_token TEXT DEFAULT ''"),
            ("gate_project_id", "ALTER TABLE projects ADD COLUMN gate_project_id TEXT DEFAULT ''"),
            ("gate_role", "ALTER TABLE projects ADD COLUMN gate_role TEXT DEFAULT ''"),
            ("gate_user", "ALTER TABLE projects ADD COLUMN gate_user TEXT DEFAULT ''"),
            ("gate_user_id", "ALTER TABLE projects ADD COLUMN gate_user_id TEXT DEFAULT ''"),
            ("gate_cursor", "ALTER TABLE projects ADD COLUMN gate_cursor INTEGER DEFAULT 0"),
            ("sync_enabled", "ALTER TABLE projects ADD COLUMN sync_enabled INTEGER DEFAULT 0"),
            ("claude_session_id", "ALTER TABLE projects ADD COLUMN claude_session_id TEXT DEFAULT ''"),
        ]:
            if col not in cols:
                conn.execute(ddl)
        conn.commit()

_migrate_projects_db()


# ── 진입점 ─────────────────────────────────────────────
def _init_plugins_db():
    """설치된 플러그인의 활성 상태/순서/설정을 저장한다. 매니페스트 자체는 폴더에서 스캔."""
    with sqlite3.connect(PROJECTS_DB) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS installed_plugins (
                id          TEXT PRIMARY KEY,
                type        TEXT DEFAULT 'view',
                enabled     INTEGER DEFAULT 1,
                sort_order  INTEGER DEFAULT 100,
                config_json TEXT DEFAULT '{}',
                installed_at TEXT DEFAULT (datetime('now'))
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS ep4_settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL DEFAULT ''
            )
        """)
        conn.commit()

_init_plugins_db()


def _scan_plugin_manifests() -> dict:
    """플러그인 매니페스트를 {id: manifest} 로 반환.
    pluggy 훅(ep4_collect_manifests)으로 수집한다. 같은 id 는 나중 항목이 우선."""
    out = {}
    for group in EP4_PM.hook.ep4_collect_manifests():
        items = group if isinstance(group, list) else [group]
        for mf in items:
            if isinstance(mf, dict) and (pid := mf.get("id")):
                out[pid] = mf
    return out


def _get_plugins(enabled_only: bool = False) -> list:
    """매니페스트 + DB 설치 상태를 병합한 플러그인 목록. menu.order로 정렬."""
    manifests = _scan_plugin_manifests()
    load_errors = get_plugin_load_errors()
    with sqlite3.connect(PROJECTS_DB) as conn:
        rows = {r[0]: r for r in conn.execute(
            "SELECT id, enabled, sort_order, config_json FROM installed_plugins").fetchall()}
        # 폴더에 있으나 DB에 없는 매니페스트는 기본 활성으로 자동 등록
        for pid, mf in manifests.items():
            if pid not in rows:
                order = (mf.get("menu") or {}).get("order", 100)
                conn.execute(
                    "INSERT OR IGNORE INTO installed_plugins (id, type, enabled, sort_order) VALUES (?,?,?,?)",
                    (pid, mf.get("type", "view"), 1, order))
                rows[pid] = (pid, 1, order, "{}")
        conn.commit()
    result = []
    for pid, mf in manifests.items():
        st = rows.get(pid)
        enabled = bool(st[1]) if st else True
        if enabled_only and not enabled:
            continue
        try:
            config = json.loads(st[3]) if st and st[3] else {}
        except Exception:
            config = {}
        item = dict(mf)
        item["enabled"] = enabled
        item["config"] = config
        if pid in load_errors:
            item["load_error"] = load_errors[pid]
        result.append(item)
    result.sort(key=lambda m: (m.get("menu") or {}).get("order", 100))
    return result


# 활성 플러그인 id 집합을 반환하는 체커 등록 (dispatch_route 에서 비활성 라우트 필터링에 사용)
register_enabled_checker(lambda: {p["id"] for p in _get_plugins(enabled_only=True)})


def _set_plugin_enabled(pid: str, enabled: bool) -> bool:
    manifests = _scan_plugin_manifests()
    mf = manifests.get(pid)
    if mf and mf.get("required") and not enabled:
        return False  # 필수 플러그인은 비활성화 불가
    with sqlite3.connect(PROJECTS_DB) as conn:
        conn.execute("INSERT OR IGNORE INTO installed_plugins (id) VALUES (?)", (pid,))
        conn.execute("UPDATE installed_plugins SET enabled=? WHERE id=?", (1 if enabled else 0, pid))
        conn.commit()
    return True


def _get_setting(key: str, default: str = "") -> str:
    """ep4_settings 테이블에서 설정값 조회."""
    with sqlite3.connect(PROJECTS_DB) as conn:
        row = conn.execute("SELECT value FROM ep4_settings WHERE key=?", (key,)).fetchone()
    return row[0] if row else default


def _set_setting(key: str, value: str) -> None:
    """ep4_settings 테이블에 설정값 저장."""
    with sqlite3.connect(PROJECTS_DB) as conn:
        conn.execute("INSERT OR REPLACE INTO ep4_settings(key,value) VALUES(?,?)", (key, value))
        conn.commit()


def _read_marketplace_conf() -> dict:
    """conf/marketplace.conf 에서 마켓플레이스 설정을 읽는다."""
    try:
        if MARKETPLACE_CONF.exists():
            return json.loads(MARKETPLACE_CONF.read_text(encoding="utf-8"))
    except Exception:
        pass
    return {}


def _write_marketplace_conf(data: dict) -> None:
    """conf/marketplace.conf 에 마켓플레이스 설정을 저장한다."""
    MARKETPLACE_CONF.parent.mkdir(parents=True, exist_ok=True)
    MARKETPLACE_CONF.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _marketplace_fetch(manager_url: str, subpath: str = "") -> dict:
    """manager_server에서 마켓플레이스 데이터를 가져온다."""
    import urllib.request as _ur
    url = manager_url.rstrip("/") + "/api/marketplace" + subpath
    req = _ur.urlopen(url, timeout=8)
    return json.loads(req.read().decode("utf-8"))


def _marketplace_fetch_firebase(firebase_db_url: str) -> dict:
    """Firebase Realtime DB에서 마켓플레이스 플러그인 목록을 가져온다."""
    import urllib.request as _ur
    url = firebase_db_url.rstrip("/") + "/ep4_marketplace/plugins.json"
    resp = _ur.urlopen(_ur.Request(url, headers={"User-Agent": "EP4/1.0"}), timeout=8)
    data = json.loads(resp.read().decode("utf-8"))
    if data is None:
        return {"ok": True, "plugins": []}
    plugins = []
    for pid, p in data.items():
        if isinstance(p, dict):
            plugins.append({**p, "id": pid})
    plugins.sort(key=lambda x: (-int(x.get("downloads") or 0), x.get("created_at") or ""))
    return {"ok": True, "plugins": plugins}


def _marketplace_fetch_firebase_plugin(firebase_db_url: str, plugin_id: str) -> dict:
    """Firebase에서 개별 플러그인 메타데이터를 가져온다."""
    import urllib.request as _ur
    url = firebase_db_url.rstrip("/") + f"/ep4_marketplace/plugins/{plugin_id}.json"
    resp = _ur.urlopen(_ur.Request(url, headers={"User-Agent": "EP4/1.0"}), timeout=8)
    data = json.loads(resp.read().decode("utf-8"))
    if not data:
        return {"ok": False, "error": "플러그인 없음"}
    return {"ok": True, **data, "id": plugin_id}


def _install_from_github(github_repo: str, github_path: str, github_token: str = "") -> dict:
    """GitHub 레포에서 플러그인 파일 목록을 가져와 {manifest, files} 반환.
    github_token 이 있으면 private 레포도 접근 가능."""
    import urllib.request as _ur
    import base64
    headers = {"User-Agent": "EP4/1.0", "Accept": "application/vnd.github+json"}
    if github_token:
        headers["Authorization"] = f"Bearer {github_token}"
    api_url = f"https://api.github.com/repos/{github_repo}/contents/{github_path}"
    resp = _ur.urlopen(_ur.Request(api_url, headers=headers), timeout=10)
    items = json.loads(resp.read().decode("utf-8"))
    manifest, files = {}, {}
    for item in items:
        if item.get("type") != "file":
            continue
        fname = item["name"]
        # 개별 파일 API로 가져오면 base64 content 포함 → private 레포도 안전
        file_resp = _ur.urlopen(_ur.Request(item["url"], headers=headers), timeout=10)
        file_data = json.loads(file_resp.read().decode("utf-8"))
        content = base64.b64decode(file_data["content"].replace("\n", "")).decode("utf-8")
        if fname == "plugin.json":
            manifest = json.loads(content)
        else:
            files[fname] = content
    return {"manifest": manifest, "files": files}


def _marketplace_increment_download_firebase(firebase_db_url: str, plugin_id: str) -> None:
    """Firebase에서 플러그인 다운로드 카운트를 증가시킨다."""
    import urllib.request as _ur
    try:
        url = firebase_db_url.rstrip("/") + f"/ep4_marketplace/plugins/{plugin_id}/downloads.json"
        resp = _ur.urlopen(_ur.Request(url, headers={"User-Agent": "EP4/1.0"}), timeout=5)
        current = int(json.loads(resp.read().decode("utf-8")) or 0)
        req = _ur.Request(url, data=str(current + 1).encode(),
                          headers={"Content-Type": "application/json"}, method="PUT")
        _ur.urlopen(req, timeout=5)
    except Exception:
        pass


# ── 커맨드 마켓 등록 (Firebase /ep4_marketplace/commands) ─────────────────
# 커맨드는 '등록 시점 스냅샷'으로 마켓에 올라간다 — 이후 로컬 파일을 수정해도
# 마켓에는 등록본이 유지되고, 상세의 '등록(업데이트)' 버튼으로만 갱신된다.
_MARKET_CMD_CACHE = {"ts": 0.0, "items": []}
_MARKET_CMD_TTL = 60   # 초 — 목록 캐시 (등록/갱신 시 무효화)


def _market_fb_url() -> str:
    """마켓 소스가 Firebase 일 때 DB 루트 URL. 아니면 '' (미지원)."""
    conf = _read_marketplace_conf()
    if (conf.get("source") or "manager") != "firebase+github":
        return ""
    fb = (conf.get("firebase_url") or _get_setting("marketplace_firebase_url") or "").strip()
    return fb.rstrip("/")


def _market_cmd_base() -> str:
    """마켓 소스가 Firebase 일 때 커맨드 저장소 base URL. 아니면 '' (미지원)."""
    fb = _market_fb_url()
    return fb + "/ep4_marketplace/commands" if fb else ""


def _firebase_admin_key() -> str:
    """conf/ 의 Firebase 서비스 계정 키 파일 경로 (없으면 '')."""
    try:
        for f in sorted((Path(__file__).parent / "conf").glob("*.json")):
            try:
                if '"private_key"' in f.read_text(encoding="utf-8"):
                    return str(f)
            except Exception:
                continue
    except Exception:
        pass
    return ""


_FB_ADMIN_LOCK = threading.Lock()
_FB_ADMIN_APPS: dict = {}   # db_url → firebase_admin.App


def _firebase_admin_set(db_url: str, path: str, value) -> None:
    """서비스 계정으로 RTDB 쓰기 — 보안 규칙(.write: auth != null)을 통과한다.
    value 가 None 이면 해당 노드를 삭제한다.
    (ep4_firebase_push.py 와 동일한 conf/ 키 사용, 앱은 db_url 별로 재사용)"""
    import firebase_admin
    from firebase_admin import credentials, db as rtdb
    with _FB_ADMIN_LOCK:
        app = _FB_ADMIN_APPS.get(db_url)
        if app is None:
            cred = credentials.Certificate(_firebase_admin_key())
            app = firebase_admin.initialize_app(
                cred, {"databaseURL": db_url}, name=f"ep4-market-{len(_FB_ADMIN_APPS)}")
            _FB_ADMIN_APPS[db_url] = app
    ref = rtdb.reference(path, app=app)
    if value is None:
        ref.delete()
    else:
        ref.set(value)


def _market_fb_write(path: str, value) -> None:
    """마켓 Firebase 노드 쓰기/삭제(None) — 키 있으면 admin SDK, 없으면 REST."""
    if _firebase_admin_key():
        try:
            _firebase_admin_set(_market_fb_url(), path, value)
            return
        except ImportError:
            raise RuntimeError("firebase-admin 미설치 — pip install firebase-admin")
    import urllib.request as _ur
    import urllib.error as _ue
    url = f"{_market_fb_url()}/{path}.json"
    if value is None:
        req = _ur.Request(url, headers={"User-Agent": "EP4/1.0"}, method="DELETE")
    else:
        req = _ur.Request(url, data=json.dumps(value, ensure_ascii=False).encode("utf-8"),
                          headers={"Content-Type": "application/json", "User-Agent": "EP4/1.0"},
                          method="PUT")
    try:
        _ur.urlopen(req, timeout=8)
    except _ue.HTTPError as e:
        if e.code in (401, 403):
            raise RuntimeError(
                "Firebase 쓰기 거부 — conf/ 에 서비스 계정 키(*.json)를 배치하면 "
                "인증 쓰기로 전환됩니다 (docs/Firebase_key_guide.md)") from e
        raise


def _market_cmd_key(cid: str) -> str:
    """Firebase 키 금지 문자(. # $ [ ] /)를 _ 로 치환한 커맨드 키."""
    return re.sub(r"[.#$\[\]/]", "_", cid)


def _market_commands_fetch(force: bool = False) -> list:
    """마켓(Firebase)에 등록된 커맨드 목록. 60초 캐시, 실패 시 예외 전파."""
    base = _market_cmd_base()
    if not base:
        return []
    now = time.time()
    if not force and now - _MARKET_CMD_CACHE["ts"] < _MARKET_CMD_TTL:
        return _MARKET_CMD_CACHE["items"]
    import urllib.request as _ur
    resp = _ur.urlopen(_ur.Request(base + ".json", headers={"User-Agent": "EP4/1.0"}), timeout=8)
    data = json.loads(resp.read().decode("utf-8")) or {}
    items = [{**c, "key": key} for key, c in data.items() if isinstance(c, dict)]
    items.sort(key=lambda x: x.get("id") or "")
    _MARKET_CMD_CACHE.update(ts=now, items=items)
    return items


def _market_cmd_entry(c: dict) -> dict:
    """로컬 스캔 항목 → 마켓 업로드 페이로드 (내용 20KB 제한, 등록자 host 포함)."""
    return {"id": c["id"], "rel": c["rel"], "description": c.get("description", ""),
            "content": _cd_safe_read(Path(c["path"]), 20000),
            "size": c.get("size", 0), "mtime": c.get("mtime", 0),
            "host": _ep4_host_label(),
            "registered_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")}


def _market_command_upload(entry: dict) -> None:
    """Firebase 에 커맨드 스냅샷 기록 (upsert). 성공 시 목록 캐시 무효화."""
    _market_fb_write(f"ep4_marketplace/commands/{_market_cmd_key(entry['id'])}", entry)
    _MARKET_CMD_CACHE["ts"] = 0


# 마켓에서 삭제된 커맨드 tombstone — 자동(일괄) 등록에서 제외되는 id 목록.
# 설치됨 상세의 등록 버튼·수동 등록 같은 명시적 등록만 tombstone 을 지우고 다시 올린다.
_MARKET_CMD_DEL_CACHE = {"ts": 0.0, "ids": set()}


def _market_cmd_deleted_fetch(force: bool = False) -> set:
    """마켓에서 삭제된(tombstone) 커맨드 id 집합. 60초 캐시, 실패 시 예외 전파."""
    base = _market_fb_url()
    if not base:
        return set()
    now = time.time()
    if not force and now - _MARKET_CMD_DEL_CACHE["ts"] < _MARKET_CMD_TTL:
        return _MARKET_CMD_DEL_CACHE["ids"]
    import urllib.request as _ur
    url = base + "/ep4_marketplace/commands_deleted.json"
    resp = _ur.urlopen(_ur.Request(url, headers={"User-Agent": "EP4/1.0"}), timeout=8)
    data = json.loads(resp.read().decode("utf-8")) or {}
    ids = {(v.get("id") if isinstance(v, dict) else k) or k for k, v in data.items()}
    _MARKET_CMD_DEL_CACHE.update(ts=now, ids=ids)
    return ids


def _market_command_unregister(cid: str) -> None:
    """마켓에서 커맨드 삭제 + tombstone 기록 (이후 자동 등록에서 제외)."""
    key = _market_cmd_key(cid)
    _market_fb_write(f"ep4_marketplace/commands/{key}", None)
    _market_fb_write(f"ep4_marketplace/commands_deleted/{key}",
                     {"id": cid, "host": _ep4_host_label(),
                      "deleted_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")})
    _MARKET_CMD_CACHE["ts"] = 0
    _MARKET_CMD_DEL_CACHE["ts"] = 0


def _market_tombstone_clear(cid: str) -> None:
    """명시적 재등록 시 tombstone 제거 — 실패해도 등록 자체는 유효하므로 무시."""
    try:
        _market_fb_write(f"ep4_marketplace/commands_deleted/{_market_cmd_key(cid)}", None)
        _MARKET_CMD_DEL_CACHE["ts"] = 0
    except Exception:
        pass


def _market_register_entry(entry: dict, overwrite: bool = False) -> dict:
    """마켓 등록 코어 — status: registered | already(동일 내용) | conflict(다른 내용).
    명시적 등록 경로이므로 성공 시 tombstone 도 지운다."""
    old = next((m for m in _market_commands_fetch(force=True) if m.get("id") == entry["id"]), None)
    if old and not overwrite:
        if (old.get("content") or "") == entry["content"]:
            return {"status": "already"}
        return {"status": "conflict", "market_host": old.get("host", ""),
                "registered_at": old.get("registered_at", "")}
    _market_command_upload(entry)
    _market_tombstone_clear(entry["id"])
    return {"status": "registered"}


def _market_register_command(c: dict, overwrite: bool = False) -> dict:
    """로컬 커맨드 파일 1개를 마켓에 등록 (설치됨 상세의 등록 버튼)."""
    return _market_register_entry(_market_cmd_entry(c), overwrite)


# ── 스킬 마켓 등록 (Firebase /ep4_marketplace/skills) ─────────────────────
# 커맨드 마켓과 같은 스냅샷 방식 — SKILL.md 본문만 올린다 (스크립트 등 부속
# 파일은 제외). GitHub 저장소 스킬(/api/marketplace/skills)과는 별개 노드.
_MARKET_SKILL_CACHE = {"ts": 0.0, "items": []}


def _market_skills_fetch(force: bool = False) -> list:
    """마켓(Firebase)에 등록된 스킬 목록. 60초 캐시, 실패 시 예외 전파."""
    base = _market_fb_url()
    if not base:
        return []
    now = time.time()
    if not force and now - _MARKET_SKILL_CACHE["ts"] < _MARKET_CMD_TTL:
        return _MARKET_SKILL_CACHE["items"]
    import urllib.request as _ur
    url = base + "/ep4_marketplace/skills.json"
    resp = _ur.urlopen(_ur.Request(url, headers={"User-Agent": "EP4/1.0"}), timeout=8)
    data = json.loads(resp.read().decode("utf-8")) or {}
    items = [{**s, "key": key} for key, s in data.items() if isinstance(s, dict)]
    items.sort(key=lambda x: x.get("id") or "")
    _MARKET_SKILL_CACHE.update(ts=now, items=items)
    return items


def _market_skill_entry(s: dict) -> dict:
    """로컬 스캔 항목(_scan_skills) → 마켓 업로드 페이로드 (SKILL.md 20KB 제한)."""
    return {"id": s["id"], "name": s.get("name") or s["id"],
            "description": s.get("description", ""),
            "content": _cd_safe_read(Path(s["path"]), 20000),
            "host": _ep4_host_label(),
            "registered_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")}


def _market_register_skill(entry: dict, overwrite: bool = False) -> dict:
    """스킬 마켓 등록 코어 — status: registered | already(동일 내용) | conflict."""
    old = next((m for m in _market_skills_fetch(force=True)
                if m.get("id") == entry["id"]), None)
    if old and not overwrite:
        if (old.get("content") or "") == entry["content"]:
            return {"status": "already"}
        return {"status": "conflict", "market_host": old.get("host", ""),
                "registered_at": old.get("registered_at", "")}
    _market_fb_write(f"ep4_marketplace/skills/{_market_cmd_key(entry['id'])}", entry)
    _MARKET_SKILL_CACHE["ts"] = 0
    return {"status": "registered"}


# ── 서브 에이전트 마켓 등록 (Firebase /ep4_marketplace/agents) ────────────
# 스킬 마켓과 동일한 스냅샷 방식 — 에이전트 .md 본문을 올린다.
_MARKET_AGENT_CACHE = {"ts": 0.0, "items": []}


def _market_agents_fetch(force: bool = False) -> list:
    """마켓(Firebase)에 등록된 서브 에이전트 목록. 60초 캐시, 실패 시 예외 전파."""
    base = _market_fb_url()
    if not base:
        return []
    now = time.time()
    if not force and now - _MARKET_AGENT_CACHE["ts"] < _MARKET_CMD_TTL:
        return _MARKET_AGENT_CACHE["items"]
    import urllib.request as _ur
    url = base + "/ep4_marketplace/agents.json"
    resp = _ur.urlopen(_ur.Request(url, headers={"User-Agent": "EP4/1.0"}), timeout=8)
    data = json.loads(resp.read().decode("utf-8")) or {}
    items = [{**a, "key": key} for key, a in data.items() if isinstance(a, dict)]
    items.sort(key=lambda x: x.get("id") or "")
    _MARKET_AGENT_CACHE.update(ts=now, items=items)
    return items


def _market_agent_entry(a: dict) -> dict:
    """로컬 스캔 항목(_scan_claude_agents) → 마켓 업로드 페이로드 (.md 20KB 제한)."""
    return {"id": a["id"], "rel": a.get("rel") or (a["id"].replace(":", "/") + ".md"),
            "name": a.get("name") or a["id"], "description": a.get("description", ""),
            "content": _cd_safe_read(Path(a["path"]), 20000),
            "host": _ep4_host_label(),
            "registered_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")}


def _market_register_agent(entry: dict, overwrite: bool = False) -> dict:
    """에이전트 마켓 등록 코어 — status: registered | already(동일 내용) | conflict."""
    old = next((m for m in _market_agents_fetch(force=True)
                if m.get("id") == entry["id"]), None)
    if old and not overwrite:
        if (old.get("content") or "") == entry["content"]:
            return {"status": "already"}
        return {"status": "conflict", "market_host": old.get("host", ""),
                "registered_at": old.get("registered_at", "")}
    _market_fb_write(f"ep4_marketplace/agents/{_market_cmd_key(entry['id'])}", entry)
    _MARKET_AGENT_CACHE["ts"] = 0
    return {"status": "registered"}


def _market_register_bulk(cmds: list, overwrite_ids=None) -> dict:
    """여러 커맨드 일괄 등록. cmds 는 글로벌 → 프로젝트 순서로 전달되어야 하며
    같은 이름은 먼저 온 것만 처리한다(글로벌 우선). 마켓에 같은 이름이 이미 있으면
    내용 동일 → already, 다름 → conflicts 로 보고만 하고 올리지 않는다
    (overwrite_ids 에 포함된 id 는 강제 갱신)."""
    overwrite_ids = set(overwrite_ids or [])
    try:
        existing = {m.get("id"): (m.get("content") or "")
                    for m in _market_commands_fetch(force=True)}
        deleted_ids = _market_cmd_deleted_fetch(force=True)
    except Exception as e:
        return {"ok": False, "error": f"마켓 조회 실패: {e}"}
    res = {"ok": True, "registered": [], "already": [], "conflicts": [],
           "deleted": [], "errors": []}
    seen = set()
    for c in cmds:
        cid = c["id"]
        if cid in seen:
            continue
        seen.add(cid)
        # 마켓에서 삭제된(tombstone) 명령은 자동 등록으로 되살리지 않는다 —
        # 설치됨 상세의 등록 버튼으로만 재등록 가능
        if cid not in existing and cid in deleted_ids:
            res["deleted"].append(cid)
            continue
        entry = _market_cmd_entry(c)
        if cid in existing and cid not in overwrite_ids:
            if existing[cid] == entry["content"]:
                res["already"].append(cid)
            else:
                res["conflicts"].append({"id": cid, "rel": c["rel"],
                                         "scope": c.get("scope"),
                                         "project_id": c.get("project_id")})
            continue
        try:
            _market_command_upload(entry)
            res["registered"].append(cid)
        except Exception as e:
            res["errors"].append(f"{cid}: {e}")
    return res


def _shareable_commands() -> list:
    """공유켜기 시 마켓 등록 대상 — 글로벌 전체 + shared=1 프로젝트의 커맨드.
    글로벌이 목록 앞에 오므로 이름 충돌 시 글로벌이 우선 등록된다."""
    cmds = _scan_command_dir(_COMMANDS_DIR, "global")
    with sqlite3.connect(PROJECTS_DB) as conn:
        rows = conn.execute(
            "SELECT id, name, project_root FROM projects "
            "WHERE shared=1 AND project_root IS NOT NULL AND TRIM(project_root) != '' "
            "ORDER BY id").fetchall()
    seen_roots = set()
    for pid, pname, root in rows:
        base = Path(os.path.expanduser(root.strip()))
        key = str(base).lower()
        if key in seen_roots:
            continue
        seen_roots.add(key)
        cmds.extend(_scan_command_dir(base / ".claude" / "commands", "project", pid, pname))
    return cmds


def _market_register_project_commands(pid: int) -> None:
    """프로젝트 '공유' 켜짐 시 해당 프로젝트 커맨드 자동 등록 (기등록 이름은 스킵).
    백그라운드 스레드에서 호출 — 실패는 조용히 무시."""
    try:
        if not _market_cmd_base():
            return
        with sqlite3.connect(PROJECTS_DB) as conn:
            row = conn.execute("SELECT name, project_root FROM projects WHERE id=?",
                               (pid,)).fetchone()
        if not row or not (row[1] or "").strip():
            return
        base = Path(os.path.expanduser(row[1].strip())) / ".claude" / "commands"
        cmds = _scan_command_dir(base, "project", pid, row[0])
        if cmds:
            _market_register_bulk(cmds)
    except Exception:
        pass


# ── Claude Skill 외부 마켓 (GitHub 저장소 캐시) ───────────────────────────
# 요청 최소화 전략: 저장소당 zipball 1회 + 조건부(ETag) 커밋 조회.
#  - 목록/미리보기/설치는 전부 로컬 캐시(zip + index.json)에서 처리
#  - TTL 내 재조회는 네트워크 0회, TTL 후엔 ETag 304(rate limit 미차감) 확인만
SKILL_MARKET_CACHE_DIR = BASE_DIR / "cache" / "skill_market"
_SKILL_MARKET_TTL      = 12 * 3600          # 12시간
_SKILL_MARKET_ZIP_MAX  = 50 * 1024 * 1024   # zipball 50MB 상한
_DEFAULT_SKILL_REPOS   = ["anthropics/skills"]
_skill_market_lock = threading.Lock()
_skill_market_mem: dict = {}   # repo -> index dict


def _skill_repo_dir(repo: str) -> Path:
    return SKILL_MARKET_CACHE_DIR / repo.strip().strip("/").replace("/", "__")


def _skill_market_repos() -> list:
    conf = _read_marketplace_conf()
    repos = conf.get("skill_repos")
    if not isinstance(repos, list) or not repos:
        repos = list(_DEFAULT_SKILL_REPOS)
    return [str(r).strip().strip("/") for r in repos if str(r).strip()]


def _skill_index_load(repo: str) -> dict:
    """메모리 → 디스크 순으로 index 로드. 없으면 {}."""
    idx = _skill_market_mem.get(repo)
    if idx:
        return idx
    f = _skill_repo_dir(repo) / "index.json"
    try:
        if f.is_file():
            idx = json.loads(f.read_text(encoding="utf-8"))
            _skill_market_mem[repo] = idx
            return idx
    except Exception:
        pass
    return {}


def _skill_index_save(repo: str, idx: dict) -> None:
    d = _skill_repo_dir(repo)
    d.mkdir(parents=True, exist_ok=True)
    (d / "index.json").write_text(json.dumps(idx, ensure_ascii=False, indent=1), encoding="utf-8")
    _skill_market_mem[repo] = idx


def _parse_skills_from_zip(zip_path: Path) -> list:
    """zipball 안의 **/SKILL.md 를 찾아 frontmatter(name/description)를 파싱."""
    import zipfile as _zf
    out = []
    with _zf.ZipFile(zip_path) as zf:
        names = zf.namelist()
        root = names[0].split("/")[0] if names else ""   # '{owner}-{repo}-{sha}/'
        for n in names:
            if not n.endswith("/SKILL.md"):
                continue
            rel_dir = n[len(root) + 1:-len("/SKILL.md")]   # 저장소 내 스킬 폴더 경로
            if not rel_dir or ".." in rel_dir:
                continue
            sid = rel_dir.split("/")[-1]
            try:
                raw = zf.read(n)[:8192].decode("utf-8", "replace")
            except Exception:
                raw = ""
            meta = _cd_frontmatter(raw)
            out.append({
                "id": sid,
                "path": rel_dir,
                "name": meta.get("name", sid),
                "description": meta.get("description", ""),
            })
    out.sort(key=lambda s: s["path"])
    return out


def _skill_market_refresh(repo: str, force: bool = False, token: str = "") -> dict:
    """저장소 스킬 index 반환. TTL 내면 캐시 그대로, 아니면 조건부 갱신."""
    import urllib.request as _u
    import urllib.error as _ue
    now = time.time()
    with _skill_market_lock:
        idx = _skill_index_load(repo)
        if idx and not force and now - idx.get("fetched_ts", 0) < _SKILL_MARKET_TTL:
            return idx
        headers = {"User-Agent": "EP4/1.0", "Accept": "application/vnd.github+json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        if idx.get("etag"):
            headers["If-None-Match"] = idx["etag"]
        # 1) 최신 커밋 SHA 확인 (ETag 304 응답은 GitHub rate limit 미차감)
        try:
            resp = _u.urlopen(_u.Request(
                f"https://api.github.com/repos/{repo}/commits/HEAD", headers=headers), timeout=15)
            etag = resp.headers.get("ETag", "")
            sha = (json.loads(resp.read().decode("utf-8", "replace")) or {}).get("sha", "")
        except _ue.HTTPError as e:
            if e.code == 304 and idx:      # 변경 없음 — 캐시 유지
                idx["fetched_ts"] = now
                _skill_index_save(repo, idx)
                return idx
            raise
        if idx and idx.get("sha") == sha and (_skill_repo_dir(repo) / "repo.zip").is_file():
            idx["fetched_ts"] = now
            idx["etag"] = etag or idx.get("etag", "")
            _skill_index_save(repo, idx)
            return idx
        # 2) SHA 변경 → zipball 1회 다운로드 (용량 상한 적용)
        zreq = _u.Request(f"https://api.github.com/repos/{repo}/zipball/{sha}",
                          headers={k: v for k, v in headers.items() if k != "If-None-Match"})
        d = _skill_repo_dir(repo)
        d.mkdir(parents=True, exist_ok=True)
        zip_path = d / "repo.zip"
        total = 0
        with _u.urlopen(zreq, timeout=60) as zr, open(zip_path, "wb") as f:
            while True:
                chunk = zr.read(1024 * 256)
                if not chunk:
                    break
                total += len(chunk)
                if total > _SKILL_MARKET_ZIP_MAX:
                    f.close()
                    zip_path.unlink(missing_ok=True)
                    raise RuntimeError(f"zipball 이 {_SKILL_MARKET_ZIP_MAX // (1024*1024)}MB 를 초과")
                f.write(chunk)
        shutil.rmtree(_skill_repo_dir(repo) / "ko", ignore_errors=True)   # 이전 번역 무효화
        idx = {
            "repo": repo, "sha": sha, "etag": etag,
            "fetched_ts": now,
            "fetched_at": datetime.now().isoformat(timespec="seconds"),
            "skills": _parse_skills_from_zip(zip_path),
        }
        _skill_index_save(repo, idx)
        return idx


def _skill_zip_read(repo: str, member_rel: str) -> bytes:
    """캐시 zip 에서 저장소 상대경로 파일 1개 읽기 (네트워크 0회)."""
    import zipfile as _zf
    zip_path = _skill_repo_dir(repo) / "repo.zip"
    with _zf.ZipFile(zip_path) as zf:
        names = zf.namelist()
        root = names[0].split("/")[0] if names else ""
        return zf.read(f"{root}/{member_rel}")


def _skill_install_from_cache(repo: str, skill: dict, overwrite: bool = False,
                              base_dir=None) -> Path:
    """캐시 zip 에서 스킬 폴더 전체를 {base_dir|~/.claude/skills}/<id>/ 로 추출 (네트워크 0회)."""
    import zipfile as _zf
    sid = re.sub(r"[^0-9A-Za-z가-힣._-]", "-", skill["id"]).strip("-.") or "skill"
    dest = (base_dir or _SKILLS_DIR) / sid
    if dest.exists() and not overwrite:
        raise FileExistsError(f"이미 설치됨: {dest}")
    zip_path = _skill_repo_dir(repo) / "repo.zip"
    prefix_rel = skill["path"] + "/"
    with _zf.ZipFile(zip_path) as zf:
        names = zf.namelist()
        root = names[0].split("/")[0] if names else ""
        prefix = f"{root}/{prefix_rel}"
        members = [n for n in names if n.startswith(prefix) and not n.endswith("/")]
        if not members:
            raise FileNotFoundError("스킬 폴더를 캐시에서 찾을 수 없음")
        for n in members:
            rel = n[len(prefix):]
            if not rel or ".." in rel:
                continue
            target = dest / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(zf.read(n))
    return dest


# ── 마켓 번역 캐시 (설명·SKILL.md 한국어 사전 번역) ───────────────────────
_TRANS_CACHE_FILE = BASE_DIR / "cache" / "translations_ko.json"
_trans_cache_lock = threading.Lock()
_trans_cache: dict = {}
_trans_cache_loaded = False
_trans_bg_running: set = set()   # 중복 백그라운드 번역 방지 (키: 'skills:<repo>' / 'market')


def _trans_key(text: str) -> str:
    import hashlib
    return hashlib.sha1((text or "").encode("utf-8", "replace")).hexdigest()


def _trans_cache_get(text: str) -> str:
    global _trans_cache_loaded
    with _trans_cache_lock:
        if not _trans_cache_loaded:
            try:
                if _TRANS_CACHE_FILE.is_file():
                    _trans_cache.update(json.loads(_TRANS_CACHE_FILE.read_text(encoding="utf-8")))
            except Exception:
                pass
            _trans_cache_loaded = True
        return _trans_cache.get(_trans_key(text), "")


def _trans_cache_put_many(pairs: dict) -> None:
    """{원문: 한국어} 를 캐시에 저장."""
    if not pairs:
        return
    with _trans_cache_lock:
        for src, ko in pairs.items():
            if ko:
                _trans_cache[_trans_key(src)] = ko
        try:
            _TRANS_CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
            _TRANS_CACHE_FILE.write_text(
                json.dumps(_trans_cache, ensure_ascii=False, indent=0), encoding="utf-8")
        except Exception:
            pass


def _ensure_ko_map(texts: list) -> dict:
    """{원문: 한국어} — 캐시 우선, 미스는 haiku 배치 번역 후 캐시 저장.
    이미 한글이 포함된 원문은 번역하지 않고 그대로 사용."""
    result, missing = {}, []
    seen = set()
    for t in texts:
        t = (t or "").strip()
        if not t or t in seen:
            continue
        seen.add(t)
        if re.search(r"[가-힣]", t):     # 이미 한국어
            result[t] = t
            continue
        ko = _trans_cache_get(t)
        if ko:
            result[t] = ko
        else:
            missing.append(t)
    for i in range(0, len(missing), 30):   # 배치 30개 단위
        chunk = missing[i:i + 30]
        trans = _claude_translate_batch_ko(chunk)
        if not trans:
            break
        pairs = dict(zip(chunk, trans))
        _trans_cache_put_many(pairs)
        result.update(pairs)
    return result


def _skill_translate_bg(repo: str) -> None:
    """스킬 index 의 description 일괄 번역 + SKILL.md 전문 사전 번역 (백그라운드 1회)."""
    key = f"skills:{repo}"
    if key in _trans_bg_running:
        return
    _trans_bg_running.add(key)
    try:
        idx = _skill_index_load(repo)
        skills = idx.get("skills", [])
        if not skills:
            return
        # 1) description 배치 번역 → index 에 description_ko 저장
        mapping = _ensure_ko_map([s.get("description", "") for s in skills])
        changed = False
        for s in skills:
            ko = mapping.get((s.get("description") or "").strip(), "")
            if ko and s.get("description_ko") != ko:
                s["description_ko"] = ko
                changed = True
        if changed:
            with _skill_market_lock:
                _skill_index_save(repo, idx)
        # 2) SKILL.md 전문 사전 번역 → cache/skill_market/<repo>/ko/<id>.md (3개 병렬)
        from concurrent.futures import ThreadPoolExecutor
        ko_dir = _skill_repo_dir(repo) / "ko"
        ko_dir.mkdir(parents=True, exist_ok=True)

        def _do_one(s):
            f = ko_dir / f"{s['id']}.md"
            if f.is_file():
                return
            try:
                raw = _skill_zip_read(repo, s["path"] + "/SKILL.md").decode("utf-8", "replace")
                ko = _claude_translate_text(raw)
                if ko:
                    f.write_text(ko, encoding="utf-8")
            except Exception:
                pass

        with ThreadPoolExecutor(max_workers=3) as ex:
            list(ex.map(_do_one, skills))
    except Exception as e:
        print(f"[skill-translate] {repo}: {e}", flush=True)
    finally:
        _trans_bg_running.discard(key)


def _skill_market_warmup():
    """서버 시작 시 스킬 마켓 캐시 갱신 + 사전 번역을 미리 수행 (백그라운드).
    첫 마켓 방문·번역 클릭 전에 캐시가 준비되도록 한다."""
    time.sleep(5.0)   # 기동 직후 부하 회피
    try:
        token = (_read_marketplace_conf().get("github_token") or "").strip()
        for repo in _skill_market_repos():
            try:
                _skill_market_refresh(repo, token=token)   # TTL·ETag 로 요청 최소화
            except Exception:
                continue
            if _skill_translate_needed(repo):
                _skill_translate_bg(repo)
    except Exception as e:
        print(f"[skill-market] warmup 오류: {e}", flush=True)


def _skill_translate_needed(repo: str) -> bool:
    """description_ko 나 SKILL.md 한국어 캐시가 비어 있으면 True."""
    idx = _skill_index_load(repo)
    skills = idx.get("skills", [])
    if not skills:
        return False
    ko_dir = _skill_repo_dir(repo) / "ko"
    for s in skills:
        if not s.get("description_ko") and (s.get("description") or "").strip():
            return True
        if not (ko_dir / f"{s['id']}.md").is_file():
            return True
    return False


def _market_attach_ko(data) -> None:
    """마켓 플러그인 목록에 description_ko 부착 (캐시 히트 즉시, 미스는 백그라운드 번역)."""
    plugins = data.get("plugins") if isinstance(data, dict) else None
    if not plugins:
        return
    missing = []
    for p in plugins:
        if not isinstance(p, dict):
            continue
        if (p.get("descriptions") or {}).get("ko"):
            continue                       # 매니페스트에 한국어 설명이 이미 있음
        t = (p.get("description") or "").strip()
        if not t or re.search(r"[가-힣]", t):
            continue
        ko = _trans_cache_get(t)
        if ko:
            p["description_ko"] = ko
        else:
            missing.append(t)
    if missing and "market" not in _trans_bg_running:
        _trans_bg_running.add("market")
        def _bg():
            try:
                _ensure_ko_map(missing)    # 번역 후 캐시 저장 → 다음 조회부터 즉시 부착
            finally:
                _trans_bg_running.discard("market")
        threading.Thread(target=_bg, daemon=True).start()


# ── Claude CLI 설정 헬퍼 ──────────────────────────────────
_CLAUDE_JSON   = Path.home() / ".claude.json"
_CLAUDE_HOME   = Path.home() / ".claude"
_SETTINGS_JSON = _CLAUDE_HOME / "settings.json"
_SKILLS_DIR    = _CLAUDE_HOME / "skills"
_COMMANDS_DIR  = _CLAUDE_HOME / "commands"
_AGENTS_DIR    = _CLAUDE_HOME / "agents"

def _read_claude_json() -> dict:
    """~/.claude.json 읽기 (없으면 {})."""
    try:
        return json.loads(_CLAUDE_JSON.read_text(encoding="utf-8")) if _CLAUDE_JSON.exists() else {}
    except Exception:
        return {}

def _write_claude_json(data: dict) -> None:
    """~/.claude.json ?곌린."""
    _CLAUDE_JSON.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

def _read_settings_json() -> dict:
    """~/.claude/settings.json ?쎄린."""
    try:
        return json.loads(_SETTINGS_JSON.read_text(encoding="utf-8")) if _SETTINGS_JSON.exists() else {}
    except Exception:
        return {}

def _scan_skill_dir(skills_dir, scope: str, project_id=None, project_name: str = "") -> list:
    """skills 폴더 스캔 — 하위 폴더의 SKILL.md frontmatter(name/description) 파싱."""
    out = []
    if not skills_dir.is_dir():
        return out
    for d in sorted(skills_dir.iterdir()):
        skill_md = d / "SKILL.md"
        if not d.is_dir() or not skill_md.exists():
            continue
        try:
            raw = skill_md.read_text(encoding="utf-8", errors="replace")
            name = d.name
            description = ""
            if raw.startswith("---"):
                end = raw.find("---", 3)
                if end > 0:
                    fm = raw[3:end]
                    for line in fm.splitlines():
                        if line.startswith("name:"):
                            name = line[5:].strip().strip('"\'')
                        elif line.startswith("description:"):
                            description = line[12:].strip().strip('"\'')
        except Exception:
            name, description = d.name, ""
        out.append({"id": d.name, "name": name, "description": description,
                    "path": str(skill_md), "scope": scope,
                    "project_id": project_id, "project_name": project_name})
    return out


def _scan_skills() -> list:
    """확장 > Claude Skill — 글로벌(~/.claude/skills) + 각 프로젝트(.claude/skills)."""
    items = _scan_skill_dir(_SKILLS_DIR, "global")
    try:
        with sqlite3.connect(PROJECTS_DB) as conn:
            rows = conn.execute(
                "SELECT id, name, project_root FROM projects "
                "WHERE project_root IS NOT NULL AND TRIM(project_root) != '' ORDER BY id").fetchall()
    except Exception:
        rows = []
    seen_roots = set()
    for pid, pname, root in rows:
        base = Path(os.path.expanduser(root.strip()))
        key = str(base).lower()
        if key in seen_roots:
            continue
        seen_roots.add(key)
        items.extend(_scan_skill_dir(base / ".claude" / "skills", "project", pid, pname))
    return items


def _skills_base_dir(scope: str, project_id=None):
    """scope 에 따른 skills 베이스 폴더 — (base, 프로젝트명). project 인데
    프로젝트 root 가 없으면 ValueError."""
    if scope != "project":
        return _SKILLS_DIR, ""
    with sqlite3.connect(PROJECTS_DB) as conn:
        row = conn.execute("SELECT name, project_root FROM projects WHERE id=?",
                           (project_id,)).fetchone()
    if not row or not (row[1] or "").strip():
        raise ValueError(f"프로젝트 root 를 찾을 수 없습니다: {project_id}")
    return Path(os.path.expanduser(row[1].strip())) / ".claude" / "skills", row[0]


def _agents_base_dir(scope: str, project_id=None):
    """scope 에 따른 (서브 에이전트) agents 베이스 폴더 — (base, 프로젝트명)."""
    base, pn = _skills_base_dir(scope, project_id)
    return (base.parent / "agents" if scope == "project" else _AGENTS_DIR), pn


def _scan_agent_dir(agent_dir, scope: str, project_id=None, project_name: str = "") -> list:
    """agents 폴더의 *.md 재귀 스캔 — Claude CLI 서브 에이전트.
    frontmatter 의 name/description 을 파싱하고, 하위 폴더는 네임스페이스(:)로 표기."""
    out = []
    if not agent_dir.is_dir():
        return out
    for f in sorted(agent_dir.rglob("*.md")):
        rel = str(f.relative_to(agent_dir)).replace("\\", "/")
        aid = rel[:-3].replace("/", ":")
        try:
            raw = f.read_text(encoding="utf-8", errors="replace")
            name, description = aid, ""
            if raw.startswith("---"):
                end = raw.find("---", 3)
                if end > 0:
                    for line in raw[3:end].splitlines():
                        if line.startswith("name:"):
                            name = line[5:].strip().strip('"\'') or aid
                        elif line.startswith("description:"):
                            description = line[12:].strip().strip('"\'')
        except Exception:
            name, description = aid, ""
        out.append({"id": aid, "rel": rel, "name": name, "description": description,
                    "path": str(f), "scope": scope,
                    "project_id": project_id, "project_name": project_name})
    return out


def _scan_claude_agents() -> list:
    """확장 > Claude Agent — 글로벌(~/.claude/agents) + 각 프로젝트(.claude/agents)."""
    items = _scan_agent_dir(_AGENTS_DIR, "global")
    try:
        with sqlite3.connect(PROJECTS_DB) as conn:
            rows = conn.execute(
                "SELECT id, name, project_root FROM projects "
                "WHERE project_root IS NOT NULL AND TRIM(project_root) != '' ORDER BY id").fetchall()
    except Exception:
        rows = []
    seen_roots = set()
    for pid, pname, root in rows:
        base = Path(os.path.expanduser(root.strip()))
        key = str(base).lower()
        if key in seen_roots:
            continue
        seen_roots.add(key)
        items.extend(_scan_agent_dir(base / ".claude" / "agents", "project", pid, pname))
    return items

def _scan_command_dir(cmd_dir, scope: str, project_id=None, project_name: str = "") -> list:
    """commands 폴더의 *.md 재귀 스캔 — 하위 폴더는 네임스페이스(:)로 표기."""
    out = []
    if not cmd_dir.is_dir():
        return out
    for f in sorted(cmd_dir.rglob("*.md")):
        rel = str(f.relative_to(cmd_dir)).replace("\\", "/")
        cid = rel[:-3].replace("/", ":")
        try:
            raw = f.read_text(encoding="utf-8", errors="replace")
            description = ""
            if raw.startswith("---"):
                end = raw.find("---", 3)
                if end > 0:
                    fm = raw[3:end]
                    for line in fm.splitlines():
                        if line.startswith("description:"):
                            description = line[12:].strip().strip('"\'')
            # 첫 번째 비어 있지 않은 줄을 설명으로 사용 (frontmatter 없을 때)
            if not description:
                for line in raw.splitlines():
                    if line.strip() and not line.startswith("#") and not line.startswith("---"):
                        description = line.strip()[:120]
                        break
        except Exception:
            description = ""
        try:
            st = f.stat()
            size, mtime = st.st_size, int(st.st_mtime)
        except Exception:
            size, mtime = 0, 0
        out.append({"id": cid, "name": cid, "rel": rel, "description": description,
                    "path": str(f), "size": size, "mtime": mtime, "scope": scope,
                    "project_id": project_id, "project_name": project_name})
    return out


def _scan_commands() -> list:
    """확장 > Claude > Command — 글로벌(~/.claude/commands) + 각 프로젝트(.claude/commands)."""
    items = _scan_command_dir(_COMMANDS_DIR, "global")
    shared = _get_setting("share_claude_commands_global") == "1"
    for it in items:
        it["shared"] = shared
    try:
        with sqlite3.connect(PROJECTS_DB) as conn:
            rows = conn.execute(
                "SELECT id, name, project_root FROM projects "
                "WHERE project_root IS NOT NULL AND TRIM(project_root) != '' ORDER BY id").fetchall()
    except Exception:
        rows = []
    seen_roots = set()
    for pid, pname, root in rows:
        base = Path(os.path.expanduser(root.strip()))
        key = str(base).lower()
        if key in seen_roots:
            continue
        seen_roots.add(key)
        items.extend(_scan_command_dir(base / ".claude" / "commands", "project", pid, pname))
    return items


# ── MCP 카탈로그 ──────────────────────────────────────────
MCP_CATALOG = [
    {"id":"context7","name":"Context7","description":"최신 라이브러리 문서·예제를 실시간으로 가져오는 MCP","category":"docs",
     "install":{"type":"stdio","command":"npx","args":["-y","@upstash/context7-mcp"]}},
    {"id":"github-official","name":"GitHub (공식)","description":"이슈/PR/커밋/워크플로 조작. GITHUB_TOKEN 필요.","category":"dev",
     "install":{"type":"stdio","command":"docker","args":["run","-i","--rm","-e","GITHUB_PERSONAL_ACCESS_TOKEN","ghcr.io/github/github-mcp-server"]}},
    {"id":"filesystem","name":"Filesystem","description":"지정 디렉토리 파일 읽기/쓰기.","category":"utility",
     "install":{"type":"stdio","command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","/Users/YOU/allowed-path"]}},
    {"id":"memory","name":"Memory","description":"세션 간 지식 그래프 저장/검색.","category":"memory",
     "install":{"type":"stdio","command":"npx","args":["-y","@modelcontextprotocol/server-memory"]}},
    {"id":"playwright","name":"Playwright","description":"실제 브라우저 자동화 (클릭/스냅샷/평가).","category":"test",
     "install":{"type":"stdio","command":"npx","args":["-y","@microsoft/mcp-server-playwright"]}},
    {"id":"fetch","name":"Fetch","description":"URL 가져오기 (HTML → 텍스트 변환).","category":"utility",
     "install":{"type":"stdio","command":"uvx","args":["mcp-server-fetch"]}},
    {"id":"sqlite","name":"SQLite","description":"로컬 SQLite DB 쿼리 실행.","category":"db",
     "install":{"type":"stdio","command":"uvx","args":["mcp-server-sqlite","--db-path","/absolute/path.db"]}},
    {"id":"brave-search","name":"Brave Search","description":"Brave API 기반 웹 검색. BRAVE_API_KEY 필요.","category":"search",
     "install":{"type":"stdio","command":"npx","args":["-y","@modelcontextprotocol/server-brave-search"],"env":{"BRAVE_API_KEY":""}}},
    {"id":"slack","name":"Slack","description":"Slack 메시지 조회/전송. SLACK_BOT_TOKEN 필요.","category":"messaging",
     "install":{"type":"stdio","command":"npx","args":["-y","@modelcontextprotocol/server-slack"],"env":{"SLACK_BOT_TOKEN":"","SLACK_TEAM_ID":""}}},
    {"id":"sequential-thinking","name":"Sequential Thinking","description":"단계적 추론 프레임워크.","category":"reasoning",
     "install":{"type":"stdio","command":"npx","args":["-y","@modelcontextprotocol/server-sequential-thinking"]}},
    {"id":"exa","name":"Exa Search","description":"AI 네이티브 웹 검색. EXA_API_KEY 필요.","category":"search",
     "install":{"type":"stdio","command":"npx","args":["-y","exa-mcp-server"],"env":{"EXA_API_KEY":""}}},
    {"id":"notion","name":"Notion","description":"Notion 페이지 검색/편집.","category":"productivity",
     "install":{"type":"stdio","command":"npx","args":["-y","@makenotion/notion-mcp-server"],"env":{"INTERNAL_INTEGRATION_TOKEN":""}}},
]


def _migrate_todo_if_exists() -> None:
    """기존 todo_list.md를 'Default Project'로 임포트"""
    with sqlite3.connect(PROJECTS_DB) as conn:
        count = conn.execute("SELECT COUNT(*) FROM projects").fetchone()[0]
    if count > 0:
        return
    todos = load_todos()
    if not todos:
        return
    with sqlite3.connect(PROJECTS_DB) as conn:
        cur = conn.execute(
            "INSERT INTO projects (name, description) VALUES (?, ?)",
            ("Default Project", "todo_list.md에서 마이그레이션된 프로젝트")
        )
        pid = cur.lastrowid
        for i, td in enumerate(todos):
            conn.execute(
                """INSERT INTO project_tasks (project_id, title, prompt, test_criteria, sort_order, status, uid, version)
                   VALUES (?, ?, ?, ?, ?, ?, ?, 1)""",
                (pid, td["text"], td.get("body",""), td.get("test",""), i, td.get("status","pending"), _task_uid())
            )
        conn.commit()
    if TODO_FILE.exists():
        TODO_FILE.rename(TODO_FILE.with_suffix(".md.migrated"))

_migrate_todo_if_exists()


# ── manager_server 동기화 에이전트 (Phase 3: 수신 단방향) ──────────────
import urllib.request as _urlreq
import urllib.error as _urlerr

_sync_agents: dict = {}      # { local_pid: {"stop": Event, "thread": Thread} }
_sync_lock = threading.Lock()

# ── Manager 자동 발견 ─────────────────────────────────────────────────────────
_MANAGER: dict = {}   # {"url": ..., "token": ...}
_CONF_DIR = Path(__file__).parent / "conf"
# Firebase Realtime DB 주소 — conf/ep4.local.conf 의 firebase_db_url 에서 main() 이 주입한다.
# 비어 있으면 Firebase 기반 manager 발견을 건너뛴다 (localhost 폴백은 그대로 동작).
_FIREBASE_DB = ""


def _gate_url_reachable(url: str, timeout: int = 3) -> bool:
    """TCP 연결로 gate URL 응답 여부 빠르게 확인."""
    try:
        from urllib.parse import urlparse as _up
        import socket as _sock
        p = _up(url)
        _sock.create_connection(
            (p.hostname or "localhost", p.port or 7799), timeout=timeout
        ).close()
        return True
    except Exception:
        return False


def _discover_manager() -> None:
    """Firebase에서 manager URL을 발견하면 _MANAGER 전역변수에 초기화"""

    global _MANAGER
    id_file = _CONF_DIR / "manager_id.txt"
    token_file = _CONF_DIR / "manager_token.txt"
    token = token_file.read_text(encoding="utf-8").strip() if token_file.exists() else ""

    firebase_url = ""
    manager_id = id_file.read_text(encoding="utf-8").strip() if id_file.exists() else ""
    if manager_id and _FIREBASE_DB:
        try:
            import json as _j
            req = _urlreq.Request(
                f"{_FIREBASE_DB}/ep4_manager/{manager_id}.json")
            with _urlreq.urlopen(req, timeout=3) as r:
                data = _j.loads(r.read())
            if isinstance(data, dict) and data.get("url"):
                firebase_url = data["url"]
        except Exception:
            pass

    for candidate in [firebase_url, "http://localhost:7799"]:
        if candidate and _gate_url_reachable(candidate):
            _MANAGER = {"url": candidate, "token": token}
            src = "Firebase" if candidate == firebase_url else "localhost"
            if not os.environ.get("EP4_NO_MANAGER_PRINT"):
                print(f"  [Manager] connected ({src}): {candidate}")
            return

    # 모두 실패 → 기본값으로 설정 (백그라운드에서 재시도)
    _MANAGER = {"url": firebase_url or "http://localhost:7799", "token": token}
    if not os.environ.get("EP4_NO_MANAGER_PRINT"):
        print(f"  [Manager] not reachable (background retry), default: {_MANAGER['url']}")


def _gate_http_get_json(url: str, token: str, timeout: int = 15):
    req = _urlreq.Request(url)
    if token:
        req.add_header("Authorization", "Bearer " + token)
    with _urlreq.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def _gate_http_post_json(url: str, token: str, body: dict, timeout: int = 15):
    data = json.dumps(body).encode("utf-8")
    req = _urlreq.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    with _urlreq.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def _gate_sync_info(local_pid: int):
    """프로젝트의 gate 연동 정보 반환. (url, token, gpid, role, gate_user) 또는 None."""
    with sqlite3.connect(PROJECTS_DB) as conn:
        row = conn.execute(
            "SELECT gate_url, gate_token, gate_project_id, gate_role, gate_user, sync_enabled"
            " FROM projects WHERE id=?", (local_pid,)).fetchone()
    if not row or not row[5] or not row[0] or not row[2]:
        return None
    return {"url": row[0], "token": row[1], "gpid": row[2],
            "role": row[3], "user": row[4]}


def _gate_push_op(local_pid: int, op_type: str, task: dict) -> None:
    """로컬 변경을 gate로 송신(비차단). 쓰기 권한 없으면 무시.
    버전 LWW로 broadcast echo는 자동 무시되므로 op_id 불필요."""
    info = _gate_sync_info(local_pid)
    if not info or info["role"] not in ("owner", "collaborator"):
        return
    def _send():
        try:
            _gate_http_post_json(
                f"{info['url']}/api/projects/{info['gpid']}/ops", info["token"],
                {"op_type": op_type, "task": task})
        except Exception:
            pass   # 네트워크 실패 시 다음 catch-up 때 정합성 회복
    threading.Thread(target=_send, daemon=True).start()


def _gate_push_task(local_pid: int, tid: int) -> None:
    """로컬 태스크(id) 1건을 읽어 gate upsert op로 송신."""
    with sqlite3.connect(PROJECTS_DB) as conn:
        r = conn.execute(
            "SELECT uid, title, prompt, test_criteria, status, author, version"
            " FROM project_tasks WHERE id=? AND project_id=?", (tid, local_pid)).fetchone()
    if not r or not r[0]:
        return
    _gate_push_op(local_pid, "upsert", {
        "uid": r[0], "text": r[1], "body": r[2], "test": r[3],
        "status": r[4], "author": r[5] or "", "version": r[6] or 1})


def _gate_apply_op(local_pid: int, op: dict) -> bool:
    """gate op 를 로컬 project_tasks 에 적용. LWW(version) + 삭제.
    필드 매핑: gate(text/body/test) → local(title/prompt/test_criteria)."""
    task = op.get("task") or {}
    uid = task.get("uid")
    if not uid:
        return False
    deleted = bool(task.get("deleted")) or op.get("op_type") == "delete"
    ver = int(task.get("version") or 1)
    with sqlite3.connect(PROJECTS_DB) as conn:
        row = conn.execute(
            "SELECT id, version FROM project_tasks WHERE project_id=? AND uid=?",
            (local_pid, uid),
        ).fetchone()
        if deleted:
            if row:
                conn.execute("DELETE FROM project_tasks WHERE id=?", (row[0],))
                conn.commit()
                return True
            return False
        title  = task.get("text", "")
        prompt = task.get("body", "")
        testc  = task.get("test", "")
        status = task.get("status", "pending")
        author = task.get("author") or ""
        if row is None:
            new_order = _next_top_sort_order(conn, local_pid)
            conn.execute(
                "INSERT INTO project_tasks(project_id,title,prompt,test_criteria,sort_order,"
                "status,uid,author,version) VALUES(?,?,?,?,?,?,?,?,?)",
                (local_pid, title, prompt, testc, new_order, status, uid, author, ver),
            )
            conn.commit()
            return True
        if ver > (row[1] or 1):     # LWW: 더 높은 버전만 반영
            conn.execute(
                "UPDATE project_tasks SET title=?,prompt=?,test_criteria=?,status=?,"
                "author=?,version=? WHERE id=?",
                (title, prompt, testc, status, author, ver, row[0]),
            )
            conn.commit()
            return True
    return False


def _gate_set_cursor(local_pid: int, seq: int) -> None:
    if not seq:
        return
    with sqlite3.connect(PROJECTS_DB) as conn:
        conn.execute("UPDATE projects SET gate_cursor=? WHERE id=?", (seq, local_pid))
        conn.commit()


def _gate_catchup(local_pid, gate_url, token, gpid, cursor) -> int:
    """재접속 시 놓친 op 재생."""
    data = _gate_http_get_json(
        f"{gate_url}/api/projects/{gpid}/sync?since={cursor}", token)
    changed = False
    for op in data.get("ops", []):
        if _gate_apply_op(local_pid, op):
            changed = True
        cursor = op.get("seq", cursor)
    _gate_set_cursor(local_pid, cursor)
    if changed:
        emit("tasks_changed", {"project_id": local_pid, "source": "gate"})
    return cursor


def _gate_stream(local_pid, gate_url, token, gpid, cursor, stop_evt) -> int:
    """SSE 실시간 op 수신. 소켓 timeout 으로 주기적으로 stop 체크."""
    req = _urlreq.Request(f"{gate_url}/api/projects/{gpid}/stream")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    resp = _urlreq.urlopen(req, timeout=25)
    ev = None
    try:
        for raw in resp:
            if stop_evt.is_set():
                break
            line = raw.decode("utf-8", "replace").rstrip("\n")
            if line.startswith("event:"):
                ev = line[6:].strip()
            elif line.startswith("data:"):
                payload = line[5:].strip()
                try:
                    data = json.loads(payload)
                except Exception:
                    ev = None
                    continue
                if ev == "op":
                    if _gate_apply_op(local_pid, data):
                        emit("tasks_changed", {"project_id": local_pid, "source": "gate"})
                    cursor = data.get("seq", cursor)
                    _gate_set_cursor(local_pid, cursor)
                elif ev == "collab_request":
                    # 소유자에게 공동작업 요청 알림 전달
                    emit("gate_collab_request", {"project_id": local_pid,
                         "request_id": data.get("request_id"),
                         "user_id": data.get("user_id"), "name": data.get("name")})
                elif ev == "member_update":
                    # 내 권한이 바뀌면 로컬 gate_role 갱신
                    with sqlite3.connect(PROJECTS_DB) as conn:
                        myid = conn.execute(
                            "SELECT gate_user_id FROM projects WHERE id=?", (local_pid,)).fetchone()
                        if myid and myid[0] and myid[0] == data.get("user_id"):
                            conn.execute("UPDATE projects SET gate_role=? WHERE id=?",
                                         (data.get("role", ""), local_pid))
                            conn.commit()
                    emit("gate_member_update", {"project_id": local_pid,
                         "user_id": data.get("user_id"), "role": data.get("role")})
                ev = None
    finally:
        try:
            resp.close()
        except Exception:
            pass
    return cursor


def _gate_sync_agent(local_pid: int, stop_evt) -> None:
    """프로젝트별 수신 동기화 루프: catch-up → stream → (끊기면) 재접속."""
    while not stop_evt.is_set():
        with sqlite3.connect(PROJECTS_DB) as conn:
            row = conn.execute(
                "SELECT gate_url, gate_token, gate_project_id, gate_cursor, sync_enabled"
                " FROM projects WHERE id=?", (local_pid,)).fetchone()
        if not row or not row[4] or not row[0] or not row[2]:
            break       # sync 비활성/연결정보 없음 → 종료
        gate_url, token, gpid, cursor = row[0], row[1], row[2], row[3] or 0
        # 저장된 gate_url이 불통이면 Firebase 발견 URL로 자동 전환
        effective_url = gate_url
        if not _gate_url_reachable(gate_url):
            fallback = _MANAGER.get("url", "")
            if fallback and fallback != gate_url and _gate_url_reachable(fallback):
                effective_url = fallback
                with sqlite3.connect(PROJECTS_DB) as _fc:
                    _fc.execute(
                        "UPDATE projects SET gate_url=? WHERE id=?",
                        (effective_url, local_pid))
                    _fc.commit()
        try:
            cursor = _gate_catchup(local_pid, effective_url, token, gpid, cursor)
            cursor = _gate_stream(local_pid, effective_url, token, gpid, cursor, stop_evt)
        except (_urlerr.URLError, OSError, TimeoutError):
            pass         # 네트워크 오류/타임아웃 시 무시 후 재시도
        except Exception:
            pass
        stop_evt.wait(3.0)   # 재접속 백오프 (stop 체크 겸용)


def start_sync_agent(local_pid: int) -> None:
    with _sync_lock:
        if local_pid in _sync_agents:
            return
        ev = threading.Event()
        t = threading.Thread(target=_gate_sync_agent, args=(local_pid, ev), daemon=True)
        _sync_agents[local_pid] = {"stop": ev, "thread": t}
        t.start()


def stop_sync_agent(local_pid: int) -> None:
    with _sync_lock:
        a = _sync_agents.pop(local_pid, None)
    if a:
        a["stop"].set()


def start_all_sync_agents() -> None:
    with sqlite3.connect(PROJECTS_DB) as conn:
        rows = conn.execute("SELECT id FROM projects WHERE sync_enabled=1").fetchall()
    for (pid,) in rows:
        start_sync_agent(pid)


def connect_project_to_gate(gate_url, token, gpid, mode, name=None, gate_user=None, gate_user_id=None) -> dict:
    """gate 공유 프로젝트를 로컬로 다운로드(스냅샷) + (collab 시) 동기화 시작."""
    gate_url = (gate_url or "").rstrip("/")
    snap = _gate_http_get_json(
        f"{gate_url}/api/projects/{gpid}/download?mode={mode}", token)
    proj_name = name or snap.get("project", {}).get("name") or "gate ?꾨줈?앺듃"
    with sqlite3.connect(PROJECTS_DB) as conn:
        cur = conn.execute(
            "INSERT INTO projects (name, description) VALUES (?, ?)",
            (proj_name, f"gate 공유 프로젝트 ({gpid})"))
        local_pid = cur.lastrowid
        for i, t in enumerate(snap.get("tasks", [])):
            conn.execute(
                "INSERT INTO project_tasks(project_id,title,prompt,test_criteria,sort_order,"
                "status,uid,author,version) VALUES(?,?,?,?,?,?,?,?,?)",
                (local_pid, t.get("text", ""), t.get("body", ""), t.get("test", ""), i,
                 t.get("status", "pending"), t.get("uid") or _task_uid(),
                 t.get("author") or "", t.get("version") or 1))
        if mode == "collab":
            conn.execute(
                "UPDATE projects SET gate_url=?, gate_token=?, gate_project_id=?,"
                " gate_role=?, gate_user=?, gate_user_id=?, gate_cursor=?, sync_enabled=1 WHERE id=?",
                (gate_url, token, gpid, snap.get("my_role", "viewer"),
                 gate_user or "", gate_user_id or "", snap.get("cursor", 0), local_pid))
        conn.commit()
    if mode == "collab":
        start_sync_agent(local_pid)
    return {"ok": True, "project_id": local_pid, "mode": mode,
            "task_count": len(snap.get("tasks", []))}


def publish_project_to_gate(local_pid, gate_url, token, gate_user=None, name=None, gate_user_id=None) -> dict:
    """로컬 프로젝트를 gate에 게시(owner) + 동기화 시작."""
    gate_url = (gate_url or "").rstrip("/")
    with sqlite3.connect(PROJECTS_DB) as conn:
        proj = conn.execute("SELECT name, sync_enabled FROM projects WHERE id=?", (local_pid,)).fetchone()
        if not proj:
            raise ValueError("?꾨줈?앺듃 ?놁쓬")
        if proj[1]:
            raise ValueError("gate 동기화 프로젝트를 찾을 수 없습니다.")
        pname = name or proj[0]
        trows = conn.execute(
            "SELECT uid, title, prompt, test_criteria, status FROM project_tasks"
            " WHERE project_id=? ORDER BY sort_order", (local_pid,)).fetchall()
    payload = {"name": pname, "tasks": [
        {"uid": t[0] or _task_uid(), "text": t[1], "body": t[2], "test": t[3], "status": t[4]}
        for t in trows]}
    resp = _gate_http_post_json(f"{gate_url}/api/projects", token, payload)
    gpid = resp["project_id"]
    snap = _gate_http_get_json(f"{gate_url}/api/projects/{gpid}/download?mode=collab", token)
    with sqlite3.connect(PROJECTS_DB) as conn:
        conn.execute(
            "UPDATE projects SET gate_url=?, gate_token=?, gate_project_id=?,"
            " gate_role='owner', gate_user=?, gate_user_id=?, gate_cursor=?, sync_enabled=1 WHERE id=?",
            (gate_url, token, gpid, gate_user or "", gate_user_id or "", snap.get("cursor", 0), local_pid))
        conn.commit()
    start_sync_agent(local_pid)
    return {"ok": True, "gate_project_id": gpid, "share_code": resp.get("share_code")}


def _init_channels_db() -> None:
    with sqlite3.connect(CHANNELS_DB) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS notification_channels (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                type        TEXT NOT NULL,
                name        TEXT NOT NULL,
                webhook_url TEXT NOT NULL,
                server_name TEXT DEFAULT '',
                active      INTEGER DEFAULT 1,
                tested      INTEGER DEFAULT 0,
                created_at  TEXT DEFAULT (datetime('now'))
            )
        """)
        conn.commit()

def _migrate_channels_db():
    with sqlite3.connect(CHANNELS_DB) as conn:
        cols = [r[1] for r in conn.execute("PRAGMA table_info(notification_channels)").fetchall()]
        if "tested" not in cols:
            conn.execute("ALTER TABLE notification_channels ADD COLUMN tested INTEGER DEFAULT 0")
        if "is_default" not in cols:
            conn.execute("ALTER TABLE notification_channels ADD COLUMN is_default INTEGER DEFAULT 0")
        conn.commit()


_init_channels_db()
_migrate_channels_db()


def _init_conn_history_db() -> None:
    """접속 히스토리 테이블 — 서버 재시작 후에도 과거 수·발신 연결 기록을 보존한다."""
    with sqlite3.connect(PROJECTS_DB) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS connection_history (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                direction  TEXT NOT NULL,          -- 'in' | 'out'
                kind       TEXT DEFAULT '',        -- 내부/외부 호스트·EP4
                ip         TEXT DEFAULT '',
                via        TEXT DEFAULT '',
                hostname   TEXT DEFAULT '',
                local_ip   TEXT DEFAULT '',
                client     TEXT DEFAULT '',
                url        TEXT DEFAULT '',        -- 발신 대상 (direction='out')
                host       TEXT DEFAULT '',        -- 발신 상대 호스트 라벨
                ok         INTEGER DEFAULT 1,
                error      TEXT DEFAULT '',
                first_seen TEXT DEFAULT '',
                last_seen  TEXT DEFAULT '',
                count      INTEGER DEFAULT 1
            )
        """)
        conn.commit()


_init_conn_history_db()


def _conn_history_insert(direction: str, rec: dict) -> int:
    """접속 기록 1건을 히스토리 테이블에 추가하고 row id 를 반환. 실패 시 0."""
    try:
        with sqlite3.connect(PROJECTS_DB) as conn:
            cur = conn.execute(
                "INSERT INTO connection_history (direction, kind, ip, via, hostname, local_ip,"
                " client, url, host, ok, error, first_seen, last_seen, count)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (direction, rec.get("kind", ""), rec.get("ip", ""), rec.get("via", ""),
                 rec.get("hostname", ""), rec.get("local_ip", ""), rec.get("client", ""),
                 rec.get("url", ""), rec.get("host", ""), 1 if rec.get("ok", True) else 0,
                 rec.get("error", ""), rec.get("first", ""), rec.get("last", ""),
                 rec.get("count", 1)))
            conn.commit()
            return cur.lastrowid or 0
    except Exception:
        return 0


def _conn_history_flush() -> None:
    """메모리 접속 기록의 last/count 등을 히스토리 테이블에 반영 (조회 시점에 호출)."""
    with _seen_remote_ips_lock:
        rows = [(r.get("last", ""), r.get("count", 1), 1 if r.get("ok", True) else 0,
                 r.get("error", ""), r.get("host", ""), r.get("hid", 0))
                for r in list(_conn_seen.values()) + list(_peer_out_seen.values())
                if r.get("hid")]
    if not rows:
        return
    try:
        with sqlite3.connect(PROJECTS_DB) as conn:
            conn.executemany(
                "UPDATE connection_history SET last_seen=?, count=?, ok=?, error=?, host=? WHERE id=?",
                rows)
            conn.commit()
    except Exception:
        pass


def _init_chat_db() -> None:
    with sqlite3.connect(CHAT_DB) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS chat_messages (
                id   INTEGER PRIMARY KEY AUTOINCREMENT,
                role TEXT    NOT NULL,
                text TEXT    NOT NULL,
                ts   REAL    DEFAULT (unixepoch())
            )
        """)
        conn.commit()


_init_chat_db()

_CHAT_SYSTEM_PROMPT = """당신은 EasyProject4 대시보드의 도우미입니다.
TRM-Harness는 todo_list.md 파일을 기반으로 태스크를 순차 실행하는 자동화 어시스턴트 도구입니다.

## 주요 기능
- 태스크 목록: 추가 / 수정 / 삭제 / 상세 보기
- 전체 실행: pending 태스크를 순서대로 자동 실행
- 일시정지: 현재 실행 중단, 재시작 가능
- 새로고침: error 상태 태스크를 pending 으로 리셋
- 재시도: 실패한 개별 태스크만 다시 실행
- 실행 로그: 실시간 실행 출력 확인
- Git 격리 실행: 태스크마다 브랜치 생성 후 작업, 완료 시 main 에 머지

## todo_list.md 형식
- [ ] 태스크 제목 (명령형)
  상세 설명
  테스트: 완료 판정 기준
- [x] 완료된 태스크
## 응답 규칙
1. 한국어로 간결하게 2-3문장 답변
2. 반드시 JSON 형식으로만 응답
3. 태스크 추가 요청이면 action 필드 포함:
   {"answer": "태스크를 추가합니다.", "action": {"type": "add_task", "text": "제목 (명령형)", "body": "상세 설명", "test": "완료 판정 기준"}}
4. 태스크 삭제 요청이면:
   {"answer": "태스크를 삭제합니다.", "action": {"type": "delete_task", "title": "삭제할 태스크 제목의 일부"}}
5. 일반 질문은 action 없이:
   {"answer": "..."}
"""


_LANG_NAMES = {
    "ko": "Korean", "en": "English", "zh": "Chinese",
    "fr": "French", "de": "German", "es": "Spanish",
}


# 번역용 claude subprocess 가 콘솔 창(흰색 팝업)을 띄우지 않도록 하는 플래그 (Windows)
_SUBPROC_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0


def _ep4_internal_env() -> dict:
    """서버가 내부 용도로 claude CLI 를 호출할 때 쓰는 환경.
    EP4_INTERNAL_CALL 을 표시해 ep4_hook_prompt/stop 훅이 태스크를 재등록하지 않게 한다."""
    env = os.environ.copy()
    env["EP4_INTERNAL_CALL"] = "1"
    return env


def _claude_translate_text(text: str, to_name: str = "Korean", timeout: int = 90) -> str:
    """단일 장문 텍스트를 to_name 언어로 번역 (마크다운 구조 유지). 실패 시 ''."""
    text = str(text or "")[:6000]
    claude_bin = shutil.which("claude") or ""
    if not text.strip() or not claude_bin:
        return ""
    prompt = (
        f"You are a translation engine. Translate the text between the <TEXT> markers into {to_name}.\n"
        f"Rules: preserve markdown structure; keep code blocks, shell commands, file paths and "
        f"YAML frontmatter keys unchanged (translate frontmatter values only).\n"
        f"Output ONLY the translated text — no preamble, no explanation, no markers.\n"
        f"<TEXT>\n{text}\n</TEXT>"
    )
    try:
        result = subprocess.run(
            [claude_bin, "-p", prompt, "--model", "haiku"],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=timeout, creationflags=_SUBPROC_NO_WINDOW, env=_ep4_internal_env()
        )
        return (result.stdout or "").strip()
    except Exception:
        return ""


def _claude_translate_batch_ko(texts: list) -> list:
    """짧은 텍스트 배열을 haiku 1회 호출로 한국어 일괄 번역. 실패 시 []."""
    claude_bin = shutil.which("claude") or ""
    if not claude_bin or not texts:
        return []
    prompt = (
        "You are a translation engine. Translate each string in the JSON array below into Korean. "
        "Keep technical terms, commands, file names and product names unchanged. "
        "Return ONLY a JSON array of translated strings, same count and order as input. No explanation.\n\n"
        + json.dumps(texts, ensure_ascii=False)
    )
    try:
        result = subprocess.run(
            [claude_bin, "-p", prompt, "--model", "haiku"],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=120, creationflags=_SUBPROC_NO_WINDOW, env=_ep4_internal_env()
        )
        m = re.search(r'\[[\s\S]*\]', (result.stdout or "").strip())
        if m:
            arr = json.loads(m.group())
            if isinstance(arr, list) and len(arr) == len(texts):
                return [str(x) for x in arr]
    except Exception:
        pass
    return []


def handle_translate(handler, body: dict) -> None:
    # 단일 장문 텍스트 번역 모드: {text, to} — 임의 언어 → 지정 언어 (마크다운 구조 유지)
    if isinstance(body, dict) and body.get("text") is not None and (body.get("to") or "").strip():
        to_name = _LANG_NAMES.get(body["to"].strip(), body["to"].strip())
        out = _claude_translate_text(str(body.get("text")), to_name)
        if out:
            handler.send_json({"ok": True, "text": out})
        else:
            handler.send_json({"ok": False, "error": "번역 실패 (claude CLI 확인)"})
        return

    texts = body.get("texts", []) if isinstance(body, dict) else []
    lang = (body.get("lang") or "en") if isinstance(body, dict) else "en"

    if not texts or lang == "ko":
        handler.send_json({"translations": texts})
        return

    lang_name = _LANG_NAMES.get(lang, "English")
    prompt = (
        f"Translate each of the following Korean texts to {lang_name}. "
        f"Keep technical commands inside parentheses (e.g. `npm test`, `git commit`) unchanged. "
        f"Return ONLY a JSON array of translated strings, same count and order as input. No explanation.\n\n"
        f"Input: {json.dumps(texts, ensure_ascii=False)}"
    )

    claude_bin = shutil.which("claude") or ""
    if not claude_bin:
        handler.send_json({"translations": texts})
        return

    try:
        result = subprocess.run(
            [claude_bin, "-p", prompt, "--model", "haiku"],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=30, creationflags=_SUBPROC_NO_WINDOW, env=_ep4_internal_env()
        )
        output = result.stdout.strip()
        m = re.search(r'\[[\s\S]*\]', output)
        if m:
            translations = json.loads(m.group())
            if isinstance(translations, list) and len(translations) == len(texts):
                handler.send_json({"translations": translations})
                return
    except Exception:
        pass

    handler.send_json({"translations": texts})


def handle_chat_stream(handler, body: dict) -> None:
    user_msg = (body.get("message") or "").strip() if isinstance(body, dict) else ""
    auto_translate = bool(body.get("auto_translate")) if isinstance(body, dict) else False
    lang = (body.get("lang") or "ko") if isinstance(body, dict) else "ko"

    def _sse(event: str, data: str) -> None:
        chunk = f"event: {event}\ndata: {data}\n\n"
        try:
            handler.wfile.write(chunk.encode("utf-8"))
            handler.wfile.flush()
        except Exception:
            pass

    handler.send_response(200)
    handler.send_header("Content-Type", "text/event-stream; charset=utf-8")
    handler.send_header("Cache-Control", "no-cache")
    handler.send_header("Connection", "close")
    handler.send_header("X-Accel-Buffering", "no")
    handler.end_headers()

    if not user_msg:
        _sse("error", json.dumps({"error": "빈 메시지"}, ensure_ascii=False))
        return

    claude_bin = shutil.which("claude") or ""
    if not claude_bin:
        _sse("error", json.dumps({"error": "Claude CLI를 찾을 수 없습니다."}, ensure_ascii=False))
        return

    history = body.get("history") or []
    conv_lines = []
    for h in history[-6:]:
        role, text = h.get("role", ""), h.get("text", "")
        if role == "user":
            conv_lines.append(f"?ъ슜?? {text}")
        elif role == "assistant":
            conv_lines.append(f"사용자: {text}")

    if auto_translate:
        lang_name = _LANG_NAMES.get(lang, "Korean")
        lang_prefix = (
            f"[LANGUAGE OVERRIDE] You MUST respond ONLY in {lang_name}. "
            f"Disregard any other language instruction below. "
            f"The JSON 'answer' field MUST be written in {lang_name}.\n\n"
        )
        json_suffix = f"Respond only in JSON. Answer field MUST be in {lang_name}:"
    else:
        lang_prefix = ""
        json_suffix = "JSON으로만 답변:"

    parts = [lang_prefix + _CHAT_SYSTEM_PROMPT]
    if conv_lines:
        parts.append("\n## 이전 대화\n" + "\n".join(conv_lines))
    parts.append(f"\n## 현재 지시\n내용: {user_msg}\n\n{json_suffix}")
    full_prompt = "\n".join(parts)

    chat_model = os.environ.get("CHAT_MODEL", "haiku")
    try:
        proc = subprocess.Popen(
            [claude_bin, "-p", full_prompt, "--model", chat_model,
             "--output-format", "stream-json",
             "--verbose", "--include-partial-messages"],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, encoding="utf-8", errors="replace",
            env=_ep4_internal_env(),
        )
        full_text = ""
        for line in proc.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except Exception:
                continue
            msg_type = obj.get("type")
            if msg_type == "assistant":
                for block in (obj.get("message") or {}).get("content") or []:
                    if isinstance(block, dict) and block.get("type") == "text":
                        new_text = block.get("text", "")
                        if len(new_text) > len(full_text):
                            _sse("delta", json.dumps({"text": new_text[len(full_text):]}, ensure_ascii=False))
                            full_text = new_text
            elif msg_type == "result":
                result_text = obj.get("result", "")
                if result_text and not full_text:
                    full_text = result_text
                    _sse("delta", json.dumps({"text": result_text}, ensure_ascii=False))
                m = re.search(r"\{[\s\S]*\}", full_text)
                action = None
                if m:
                    try:
                        parsed = json.loads(m.group(0))
                        answer = parsed.get("answer", "")
                        action = parsed.get("action")
                        if answer and answer != full_text:
                            _sse("replace", json.dumps({"text": answer}, ensure_ascii=False))
                            full_text = answer
                    except Exception:
                        pass
                _sse("done", json.dumps({"text": full_text, "action": action}, ensure_ascii=False))
        proc.wait(timeout=5)
    except Exception as e:
        _sse("error", json.dumps({"error": str(e)}, ensure_ascii=False))


# ── Claude CLI 상태 ──────────────────────────────────────
_cli_status_cache: dict = {"data": None, "ts": 0.0}

def get_cli_status() -> dict:
    now = time.time()
    if _cli_status_cache["data"] and now - _cli_status_cache["ts"] < 30:
        return _cli_status_cache["data"]

    cli_path = shutil.which("claude") or ""
    version = ""
    if cli_path:
        try:
            version = subprocess.check_output(
                [cli_path, "--version"], text=True,
                encoding="utf-8", errors="replace", timeout=3,
            ).strip().split("\n")[0][:60]
        except Exception:
            pass

    connected = False
    email = ""
    claude_json = Path.home() / ".claude.json"
    if cli_path and claude_json.exists():
        try:
            data = json.loads(claude_json.read_text(encoding="utf-8", errors="replace"))
            oauth = data.get("oauthAccount") or {}
            if oauth:
                connected = True
                email = oauth.get("emailAddress", "")
        except Exception:
            pass

    result = {
        "installed": bool(cli_path),
        "path": cli_path,
        "version": version,
        "connected": connected,
        "email": email,
    }
    _cli_status_cache["data"] = result
    _cli_status_cache["ts"] = now
    return result


# ── Antigravity / Gemini CLI 상태 ────────────────────────
# antigravity 전용 CLI는 아직 PATH에 없고 gemini CLI가 Antigravity 엔진을 구동한다.
# 따라서 antigravity → gemini 순으로 해석하고, 인증은 ~/.gemini 에서 확인한다.
_ag_status_cache: dict = {"data": None, "ts": 0.0}

def _resolve_engine_bin(engine: str) -> str:
    """실행 엔진 이름에 해당하는 CLI 실행파일 경로를 반환한다."""
    if engine == "antigravity":
        return shutil.which("antigravity") or shutil.which("gemini") or ""
    return shutil.which("claude") or ""

def get_antigravity_status() -> dict:
    now = time.time()
    if _ag_status_cache["data"] and now - _ag_status_cache["ts"] < 30:
        return _ag_status_cache["data"]

    cli_path = _resolve_engine_bin("antigravity")
    command = Path(cli_path).stem if cli_path else ""
    version = ""
    if cli_path:
        try:
            version = subprocess.check_output(
                [cli_path, "--version"], text=True,
                encoding="utf-8", errors="replace", timeout=5,
            ).strip().split("\n")[0][:60]
        except Exception:
            pass

    connected = False
    email = ""
    gem_dir = Path.home() / ".gemini"
    creds = gem_dir / "oauth_creds.json"
    accts = gem_dir / "google_accounts.json"
    if cli_path and creds.exists():
        try:
            d = json.loads(creds.read_text(encoding="utf-8", errors="replace"))
            # access_token 또는 refresh_token 이 있으면 연결됨(만료는 CLI가 자동 갱신)
            if d.get("access_token") or d.get("refresh_token"):
                connected = True
        except Exception:
            pass
    if accts.exists():
        try:
            email = (json.loads(accts.read_text(encoding="utf-8", errors="replace")) or {}).get("active", "") or ""
        except Exception:
            pass

    result = {
        "installed": bool(cli_path),
        "path": cli_path,
        "command": command,
        "version": version,
        "connected": connected,
        "email": email,
    }
    _ag_status_cache["data"] = result
    _ag_status_cache["ts"] = now
    return result


# ── Antigravity CLI(agy) 입력 → EP4 태스크 등록 (history.jsonl 감시) ──
# agy.exe 는 Claude/gemini 식 훅을 지원하지 않으므로, agy 가 입력을 기록하는
# ~/.gemini/antigravity-cli/history.jsonl 을 감시해 새 프롬프트를 태스크로 등록한다.
ANTIGRAVITY_HISTORY = Path.home() / ".gemini" / "antigravity-cli" / "history.jsonl"
_AG_WATCH_STATE = BASE_DIR / "antigravity_watch.json"

def _ag_extract_steps(workspace: str, since_mtime: float):
    """agy 대화 DB(protobuf)에서 도구 실행 단계를 best-effort 로 추출한다.
    workspace 경로를 참조하고 since_mtime 이후 수정된 DB 중 가장 최근 것을 사용.
    반환: (log_lines:list, steps_text:str, conv_id:str). 실패 시 ([], '', '')."""
    conv_dir = Path.home() / ".gemini" / "antigravity-cli" / "conversations"
    if not conv_dir.exists():
        return [], "", ""
    try:
        ws_name = Path(workspace).name
    except Exception:
        ws_name = workspace
    best_txt = None
    best_mtime = -1.0
    best_id = ""
    for db in conv_dir.glob("*.db"):
        try:
            mt = db.stat().st_mtime
            if mt < since_mtime - 3:
                continue
        except Exception:
            continue
        try:
            txt = _ag_read_conv_blob(db)
        except Exception:
            continue
        if ws_name and ws_name in txt and mt > best_mtime:
            best_mtime = mt
            best_txt = txt
            best_id = db.stem
    if not best_txt:
        return [], "", ""
    steps = _ag_steps_from_text(best_txt)
    if not steps:
        return [], "", best_id
    log_lines = [{"level": "INFO", "msg": f"[Antigravity] {x}", "ts": "", "span_id": ""} for x in steps]
    steps_text = "\n".join(f"  {i+1}. {x}" for i, x in enumerate(steps))
    return log_lines, steps_text, best_id


def _ag_enrich_run(pid: int, tid: int, run_id: int, title: str, prompt: str,
                   project_root: str, project_name: str, preview_url: str,
                   since_mtime: float) -> None:
    """등록된 antigravity 태스크 run 을 보강한다:
    1) agy 대화 DB 에서 실행 과정 추출 → 로그, 2) Git 브랜치/커밋/diff, 3) 스크린샷.
    agy 응답이 안정화될 때까지 폴링 후 Git·스크린샷을 수행한다."""
    try:
        # ── 1) 실행 과정 추출 (agy 가 끝날 때까지 폴링) ──
        deadline = time.time() + 300   # 최대 5분 대기
        last_text = None
        stable = 0
        while time.time() < deadline:
            time.sleep(15)
            log_lines, steps_text, conv_id = _ag_extract_steps(project_root, since_mtime)
            if not steps_text:
                continue
            if steps_text == last_text:
                stable += 1
            else:
                stable = 0
                last_text = steps_text
                output = f"── 입력 ──\n{prompt}\n\n── 실행 과정 (Antigravity) ──\n{steps_text}"
                with sqlite3.connect(PROJECTS_DB) as conn:
                    # conv_id 를 claude_session_id 컬럼에 저장 → run 상세에서 세션 연결에 사용
                    conn.execute(
                        "UPDATE task_runs SET output=?, log_lines=?, claude_session_id=?, ended_at=? WHERE id=?",
                        (output[:8000], json.dumps(log_lines, ensure_ascii=False),
                         conv_id or "", datetime.now().isoformat(), run_id))
                    conn.commit()
                emit("run_done", {"run_id": run_id, "project_id": pid, "status": "done"})
            if stable >= 2:        # 30초간 변화 없음 = agy 완료로 간주
                break

        # ── 2) Git 처리 (claude_cli 와 동일: project_root 변경을 브랜치에 커밋·머지) ──
        git_info = {}
        try:
            git_info = _git_handle_cli_result(pid, tid, title, project_root, project_name) or {}
            if git_info:
                with sqlite3.connect(PROJECTS_DB) as conn:
                    conn.execute(
                        "UPDATE task_runs SET git_task_branch=?, git_proj_branch=?, "
                        "git_merge_status=?, git_diff_json=?, git_commits_json=? WHERE id=?",
                        (git_info.get('git_task_branch', ''), git_info.get('git_proj_branch', ''),
                         git_info.get('git_merge_status', 'no_git'),
                         json.dumps(git_info.get('git_diff', []), ensure_ascii=False),
                         json.dumps(git_info.get('git_commits', []), ensure_ascii=False),
                         run_id))
                    conn.commit()
                emit("run_done", {"run_id": run_id, "project_id": pid, "status": "done"})
        except Exception as _ge:
            print(f"[antigravity-watch] git 보강 오류: {_ge}", flush=True)

        # ── 3) 스크린샷 (claude_cli 와 동일 규칙) ──
        try:
            sp, pu = "", ""
            proot = Path(project_root)
            if (proot / "stop.bat").exists() and (proot / "run.bat").exists():
                sp, pu = _restart_and_screenshot(str(proot), run_id)
            elif preview_url and (_is_web_change(git_info.get("git_diff", []))
                                  or git_info.get("git_merge_status") == "no_git"):
                _sf = SCREENSHOTS_DIR / f"run_{run_id}.png"
                if _capture_screenshot(preview_url, _sf):
                    sp, pu = f"run_{run_id}.png", preview_url
            if sp:
                with sqlite3.connect(PROJECTS_DB) as conn:
                    conn.execute("UPDATE task_runs SET screenshot_path=?, preview_url=? WHERE id=?",
                                 (sp, pu, run_id))
                    conn.commit()
                emit("run_done", {"run_id": run_id, "project_id": pid, "status": "done"})
        except Exception as _se:
            print(f"[antigravity-watch] 스크린샷 보강 오류: {_se}", flush=True)
    except Exception as e:
        print(f"[antigravity-watch] 로그 보강 오류: {e}", flush=True)


def _ag_register_prompt(display: str, workspace: str, ts_ms: "int | None" = None) -> None:
    """agy 입력 1건을 workspace 매칭 프로젝트에 태스크 + 실행 로그(run)로 등록."""
    display = (display or "").strip()
    workspace = (workspace or "").strip()
    if not display or not workspace:
        return
    try:
        ws = Path(workspace).resolve()
    except Exception:
        return
    try:
        now = datetime.now().isoformat()
        with sqlite3.connect(PROJECTS_DB) as conn:
            matched = None
            for pid, name, root, prev in conn.execute(
                    "SELECT id, name, project_root, preview_url FROM projects").fetchall():
                if not root:
                    continue
                try:
                    if Path(root).resolve() == ws:
                        matched = (pid, name, root, prev or "")
                        break
                except Exception:
                    continue
            if not matched:
                return  # 매칭 프로젝트 없으면 등록하지 않음(자동 생성 안 함)
            pid, pname, proot, preview_url = matched
            title = display.split("\n")[0].strip()[:100] or "Antigravity 작업"
            order = _next_top_sort_order(conn, pid)
            cur = conn.execute(
                "INSERT INTO project_tasks (project_id, title, prompt, trigger_type, "
                "sort_order, uid, author, version, status, ended_at) "
                "VALUES (?,?,?,?,?,?,?,1,'done',?)",
                (pid, title, display, "antigravity_cli", order,
                 _task_uid(), _new_local_author(), now),
            )
            tid = cur.lastrowid
            # 실행 로그(run) 생성 — 우선 입력만 기록, 이후 백그라운드로 실행 과정 보강
            cur2 = conn.execute(
                "INSERT INTO task_runs (task_id, project_id, task_title, project_name, "
                "status, trigger_type, model, prompt, output, log_lines, "
                "started_at, ended_at, trace_id, span_id) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (tid, pid, title, pname, "done", "antigravity_cli", "antigravity",
                 display, f"── 입력 ──\n{display}", "[]", now, now,
                 _new_uuid(), _new_span_id()),
            )
            run_id = cur2.lastrowid
            conn.commit()
        emit("tasks_changed", {"project_id": pid})
        emit("task_done", {"project_id": pid, "task_id": tid, "status": "done", "run_id": run_id})
        # 백그라운드: agy 대화 DB 에서 실행 과정 추출 + Git 처리 + 스크린샷
        since = (ts_ms / 1000.0) if ts_ms else (time.time() - 5)
        threading.Thread(target=_ag_enrich_run,
                         args=(pid, tid, run_id, title, display, proot, pname, preview_url, since),
                         daemon=True).start()
    except Exception as e:
        print(f"[antigravity-watch] 등록 오류: {e}", flush=True)


def _ag_read_conv_blob(db_path: Path) -> str:
    """agy 대화 DB(protobuf)의 step_payload 들을 이어붙여 디코드한 텍스트 반환."""
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=2)
    blob = b""
    try:
        for (p,) in con.execute("SELECT step_payload FROM steps ORDER BY idx"):
            if isinstance(p, bytes):
                blob += p + b"\x00"
    finally:
        con.close()
    return blob.decode("utf-8", "replace")


def _ag_steps_from_text(txt: str) -> list:
    """대화 텍스트에서 도구 실행 단계(toolAction — toolSummary)를 연속 중복 제거해 추출."""
    import re as _re
    actions   = _re.findall(r'"toolAction":"([^"]{1,120})"', txt)
    summaries = _re.findall(r'"toolSummary":"([^"]{1,120})"', txt)
    steps, prev = [], None
    for i, a in enumerate(actions):
        s = summaries[i] if i < len(summaries) else ""
        line = a + (f" — {s}" if s and s != a else "")
        if line != prev:
            steps.append(line)
            prev = line
    return steps


def _ag_list_sessions(project_root: str) -> list:
    """project_root(workspace) 와 일치하는 Antigravity(agy) 대화 세션 목록.
    history.jsonl(사용자 입력)을 conversationId 로 묶고, 대화 DB 로 도구 수를 보강."""
    if not project_root:
        return []
    try:
        ws = Path(project_root).resolve()
    except Exception:
        return []
    conv_dir = Path.home() / ".gemini" / "antigravity-cli" / "conversations"
    groups = {}
    if ANTIGRAVITY_HISTORY.exists():
        try:
            lines = ANTIGRAVITY_HISTORY.read_text(encoding="utf-8", errors="replace").splitlines()
        except Exception:
            lines = []
        for line in lines:
            line = line.strip()
            if not line:
                continue
            try:
                o = json.loads(line)
            except Exception:
                continue
            wsv = (o.get("workspace") or "").strip()
            try:
                if not wsv or Path(wsv).resolve() != ws:
                    continue
            except Exception:
                continue
            disp = (o.get("display") or "").strip()
            if not disp:
                continue
            ts = o.get("timestamp") or 0
            cid = o.get("conversationId") or f"ts-{ts}"
            g = groups.get(cid)
            if not g:
                g = {"session_id": cid, "first_prompt": disp, "first_ts": ts,
                     "last_ts": ts, "msg_count": 0, "tool_count": 0}
                groups[cid] = g
            g["msg_count"] += 1
            if ts and ts < g["first_ts"]:
                g["first_ts"] = ts; g["first_prompt"] = disp
            if ts and ts > g["last_ts"]:
                g["last_ts"] = ts
    out = []
    for g in groups.values():
        db = conv_dir / f"{g['session_id']}.db"
        if db.exists():
            try:
                steps = _ag_steps_from_text(_ag_read_conv_blob(db))
                g["tool_count"] = len(steps)
                g["last_ts"] = max(g["last_ts"], int(db.stat().st_mtime * 1000))
            except Exception:
                pass
        last_iso = datetime.fromtimestamp(g["last_ts"] / 1000.0).isoformat() if g["last_ts"] else ""
        out.append({
            "session_id": g["session_id"], "first_prompt": g["first_prompt"],
            "last_ts": last_iso, "msg_count": g["msg_count"],
            "tool_count": g["tool_count"], "model": "antigravity",
            "file": g["session_id"],
        })
    out.sort(key=lambda x: x["last_ts"], reverse=True)
    return out


def _ag_scope_steps(blob: str, ordered_inputs: list, focus: str) -> list:
    """대화 blob 에서 focus 입력의 턴(다음 입력 직전까지)에 해당하는 도구 단계만 추출.
    focus 위치를 못 찾으면 전체 단계로 폴백한다."""
    if not blob:
        return []
    def _find(s):
        snip = (s or "").split("\n")[0].strip()[:40]
        return blob.find(snip) if snip else -1
    start = _find(focus)
    if start < 0:
        return _ag_steps_from_text(blob)
    end = len(blob)
    for other in ordered_inputs:
        if other == focus:
            continue
        p = _find(other)
        if start < p < end:
            end = p
    return _ag_steps_from_text(blob[start:end])


def _ag_session_detail(project_root: str, conv_id: str, focus_prompt: str = None) -> dict:
    """Antigravity 대화 세션 상세: 사용자 입력 + 실행 단계.
    focus_prompt 가 주어지면(실행로그 run 컨텍스트) 해당 입력 1건과 그 턴의 단계만,
    None 이면(세션 뷰) 대화 전체를 반환한다."""
    ordered = []
    if ANTIGRAVITY_HISTORY.exists():
        try:
            lines = ANTIGRAVITY_HISTORY.read_text(encoding="utf-8", errors="replace").splitlines()
        except Exception:
            lines = []
        for line in lines:
            line = line.strip()
            if not line:
                continue
            try:
                o = json.loads(line)
            except Exception:
                continue
            ts = o.get("timestamp") or 0
            cid = o.get("conversationId") or f"ts-{ts}"
            if cid != conv_id:
                continue
            disp = (o.get("display") or "").strip()
            if disp:
                ordered.append((ts, disp))
    ordered.sort(key=lambda x: x[0])
    all_inputs = [d for _, d in ordered]

    db = Path.home() / ".gemini" / "antigravity-cli" / "conversations" / f"{conv_id}.db"
    blob = ""
    if db.exists():
        try:
            blob = _ag_read_conv_blob(db)
        except Exception:
            blob = ""

    if focus_prompt:
        focus = focus_prompt.strip()
        steps = _ag_scope_steps(blob, all_inputs, focus)
        return {"ok": True, "session_id": conv_id, "inputs": [focus], "steps": steps}
    steps = _ag_steps_from_text(blob) if blob else []
    return {"ok": True, "session_id": conv_id, "inputs": all_inputs, "steps": steps}


def _antigravity_history_watcher() -> None:
    """history.jsonl 을 폴링해 새 입력 줄을 태스크로 등록. 최초엔 파일 끝부터 시작."""
    offset = None
    try:
        if _AG_WATCH_STATE.exists():
            offset = int(json.loads(_AG_WATCH_STATE.read_text()).get("offset", 0))
    except Exception:
        offset = None
    while True:
        try:
            if ANTIGRAVITY_HISTORY.exists():
                size = ANTIGRAVITY_HISTORY.stat().st_size
                if offset is None:
                    offset = size            # 첫 실행: 기존 히스토리 무시, 새 입력만
                elif size < offset:
                    offset = 0                # 파일 재생성됨 → 처음부터
                if size > offset:
                    with open(ANTIGRAVITY_HISTORY, "rb") as f:
                        f.seek(offset)
                        chunk = f.read()
                    nl = chunk.rfind(b"\n")
                    if nl != -1:
                        complete = chunk[:nl + 1]
                        for raw in complete.split(b"\n"):
                            raw = raw.strip()
                            if not raw:
                                continue
                            try:
                                obj = json.loads(raw.decode("utf-8", "replace"))
                            except Exception:
                                continue
                            _ag_register_prompt(obj.get("display"), obj.get("workspace"), obj.get("timestamp"))
                        offset += len(complete)
                        try:
                            _AG_WATCH_STATE.write_text(json.dumps({"offset": offset}))
                        except Exception:
                            pass
        except Exception:
            pass
        time.sleep(2)


# ── 다른 EP4 연결(peer) / 프로젝트 공유 ──────────────────
def _ep4_host_label() -> str:
    """이 EP4 인스턴스를 식별하는 라벨(호스트명:포트)."""
    try:
        hn = __import__("socket").gethostname()
    except Exception:
        hn = "ep4"
    return f"{hn}:{_EP4_RUNNING_PORT or 7788}"


_peer_ident_cache: dict = {}


def _peer_ident_headers() -> dict:
    """peer 요청에 싣는 발신자 식별 헤더(X-EP4-Hostname / X-EP4-Local-IP).
    NAT 뒤에서 소스 IP가 공유기 주소로 바뀌어도 수신측 접속 로그에
    발신 호스트를 표시하기 위한 정보 — 위조 가능하므로 표시용으로만 쓴다."""
    if _peer_ident_cache:
        return dict(_peer_ident_cache)
    import socket
    try:
        _peer_ident_cache["X-EP4-Hostname"] = socket.gethostname()
    except Exception:
        _peer_ident_cache["X-EP4-Hostname"] = "ep4"
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))  # 실제 전송 없음 — 라우팅 기반 로컬 IP 판별
        _peer_ident_cache["X-EP4-Local-IP"] = s.getsockname()[0]
        s.close()
    except Exception:
        pass
    return dict(_peer_ident_cache)


def _list_peers(enabled_only: bool = False) -> list:
    with sqlite3.connect(PROJECTS_DB) as conn:
        q = "SELECT id, url, name, enabled FROM ep4_peers"
        if enabled_only:
            q += " WHERE enabled=1"
        return [{"id": r[0], "url": r[1], "name": r[2] or "", "enabled": bool(r[3])}
                for r in conn.execute(q + " ORDER BY id").fetchall()]


def _peer_registered(url: str) -> bool:
    base = (url or "").rstrip("/")
    return any(p["url"].rstrip("/") == base for p in _list_peers())


def _peer_token(url: str) -> str:
    """등록된 peer 의 인증 토큰 조회 (API 응답에는 노출하지 않는 내부용)."""
    base = (url or "").rstrip("/")
    with sqlite3.connect(PROJECTS_DB) as conn:
        for r in conn.execute("SELECT url, token FROM ep4_peers").fetchall():
            if (r[0] or "").rstrip("/") == base:
                return r[1] or ""
    return ""


def _http_get_json(url: str, timeout: int = 8, token: str = ""):
    import urllib.request as _u
    headers = {"User-Agent": "EP4-peer/1.0", **_peer_ident_headers()}
    if token:
        headers["Authorization"] = "Bearer " + token
    req = _u.Request(url, headers=headers)
    with _u.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def _log_peer_out(base_url: str, host_label: str = "", ok: bool = True, error: str = "") -> None:
    """이 EP4 가 다른 EP4 로 발신 연결한 결과를 기록하고 콘솔에 표시.
    수신 로그(_log_remote_host)와 대칭 — 상태(성공/수신동작/실패) 전환 시에만 출력하고
    이후에는 _peer_out_seen 의 last/count 만 갱신한다.
    직접 발신이 실패해도 상대가 최근 push(수신 연결)로 접촉 중이면(NAT/방화벽 뒤)
    실패 대신 '수신 연결로 동작 중'으로 표시한다."""
    key = (base_url or "").rstrip("/")
    if not key:
        return
    now = time.strftime("%Y-%m-%d %H:%M:%S")
    push_alive = False
    if not ok:
        cached = _peer_pushed_projects.get(key)
        push_alive = bool(cached and time.time() - cached.get("ts", 0) < _PEER_PUSH_INTERVAL * 4)
        if push_alive:
            if not host_label:
                host_label = (cached.get("host") or "").strip()
            error = "직접 발신 불가 — 상대가 수신(push) 연결로 동작 중"
    status = "ok" if ok else ("push" if push_alive else "fail")
    new_rec = None
    with _seen_remote_ips_lock:
        rec = _peer_out_seen.get(key)
        should_print = rec is None or rec.get("status") != status
        if rec is None:
            new_rec = {"url": key, "host": host_label, "ok": ok,
                       "push": push_alive, "status": status,
                       "error": error if not ok else "",
                       "first": now, "last": now, "count": 1}
            _peer_out_seen[key] = new_rec
        else:
            rec["last"] = now
            rec["count"] += 1
            rec["ok"] = ok
            rec["push"] = push_alive
            rec["status"] = status
            if host_label:
                rec["host"] = host_label
            rec["error"] = error if not ok else ""
    if new_rec is not None:
        new_rec["hid"] = _conn_history_insert("out", new_rec)
    if not should_print:
        return
    if not ok:
        if push_alive:
            ident = f" (host : {host_label})" if host_label else ""
            print(f"\n  [~] 외부 EP4 발신 불가 — 수신(push) 연결로 동작 중: {key}{ident}  ({now})\n",
                  flush=True)
        else:
            print(f"\n  [-] 외부 EP4 연결 실패(발신): {key} — {error}  ({now})\n", flush=True)
        return
    label = "외부 EP4 연결(발신)"
    suffix = ""
    if host_label and host_label == _ep4_host_label():
        label = "내부 EP4 연결(발신)"
        suffix = " — 자기 자신(등록된 peer 주소가 이 서버를 가리킴)"
    ident = f" (host : {host_label})" if host_label else ""
    print(f"\n  [+] {label}: {key}{ident}{suffix}  ({now})\n", flush=True)


def _peer_out_recheck(base_url: str) -> None:
    """수신(push/handshake)으로 접촉해 온 등록 peer 의 발신 연결 상태를 재확인.
    시작 시 실패로 기록된 peer 가 다시 살아나면 _log_peer_out 의 전환 로직이
    성공 로그를 출력하고 /api/connections 의 발신 기록도 갱신된다."""
    key = (base_url or "").rstrip("/")
    if not key:
        return
    now = time.time()
    with _seen_remote_ips_lock:
        rec = _peer_out_seen.get(key)
        if rec is not None and rec.get("ok"):
            return   # 이미 성공 상태 — 재확인 불필요
        if now - _peer_out_retry_ts.get(key, 0) < _PEER_OUT_RETRY_GAP:
            return
        _peer_out_retry_ts[key] = now

    def _run():
        try:
            d = _http_get_json(f"{key}/api/ping", timeout=6, token=_peer_token(key))
            _log_peer_out(key, (d or {}).get("host", "") if isinstance(d, dict) else "")
        except Exception as e:
            _log_peer_out(key, ok=False, error=str(e))
    threading.Thread(target=_run, daemon=True).start()


def _peer_startup_check():
    """서버 시작 시 등록된 peer EP4 에 접속을 시도해 연결 상태를 콘솔에 표시.
    성공하면 _log_peer_out 로 발신 연결 로그, 실패하면 실패 사유를 출력한다."""
    time.sleep(2.0)   # 시작 배너 출력 이후에 표시
    try:
        peers = _list_peers(enabled_only=True)
    except Exception:
        return
    for peer in peers:
        url = (peer.get("url") or "").rstrip("/")
        if not url:
            continue
        try:
            d = _http_get_json(f"{url}/api/ping", timeout=6, token=_peer_token(url))
            _log_peer_out(url, (d or {}).get("host", "") if isinstance(d, dict) else "")
        except Exception as e:
            _log_peer_out(url, ok=False, error=str(e))


def _claude_md_shared_payload() -> list:
    """peer 에 공유할 CLAUDE.md 목록 — Global(share_claude_md_global 설정 시) +
    shared=1 프로젝트의 CLAUDE.md. 존재하는 파일만, 내용은 20KB 로 제한."""
    items = []

    def _entry(scope, name, f: Path, project_id=None):
        st = f.stat()
        return {"scope": scope, "project_id": project_id, "name": name,
                "path": str(f), "size": st.st_size, "mtime": int(st.st_mtime),
                "content": _cd_safe_read(f, 20000)}

    if _get_setting("share_claude_md_global") == "1":
        g = Path.home() / ".claude" / "CLAUDE.md"
        if g.is_file():
            items.append(_entry("global", "Global", g))
    with sqlite3.connect(PROJECTS_DB) as conn:
        rows = conn.execute(
            "SELECT id, name, project_root FROM projects "
            "WHERE shared=1 AND project_root IS NOT NULL AND TRIM(project_root) != '' "
            "ORDER BY id").fetchall()
    seen = set()
    for pid, pname, root in rows:
        f = Path(os.path.expanduser(root.strip())) / "CLAUDE.md"
        key = str(f).lower()
        if key in seen or not f.is_file():
            continue
        seen.add(key)
        items.append(_entry("project", pname, f, project_id=pid))
    return items


def _remote_claude_md() -> list:
    """연결된(enabled) peer EP4 가 공유한 CLAUDE.md 집계.
    push 캐시 우선(NAT 뒤 peer 지원), 없으면 /api/shared-projects 직접 조회.
    실패한 peer 는 조용히 건너뛴다 (프로젝트 목록과 달리 보조 정보이므로)."""
    out = []
    for peer in _list_peers(enabled_only=True):
        url = peer["url"].rstrip("/")
        cached = _peer_pushed_projects.get(url)
        if cached and time.time() - cached.get("ts", 0) < _PEER_PUSH_INTERVAL * 4:
            host = cached.get("host") or url
            mds = cached.get("claude_md") or []
        else:
            try:
                data = _http_get_json(f"{url}/api/shared-projects", timeout=6,
                                      token=_peer_token(url))
            except Exception:
                continue
            host = data.get("host", url) if isinstance(data, dict) else url
            mds = (data.get("claude_md") or []) if isinstance(data, dict) else []
        for m in mds:
            m = dict(m)
            m["remote"] = True
            m["exists"] = True
            m["peer_url"] = url
            m["peer_name"] = peer["name"] or host
            out.append(m)
    return out


def _shared_projects_payload() -> dict:
    """이 EP4 의 프로젝트 목록 + 호스트 라벨. 연결된 peer 가 가져간다.
    (인증 토큰을 가진 peer 는 어차피 전체 API 접근이 가능하므로 shared
    플래그와 무관하게 전체 프로젝트를 노출한다.)"""
    out = []
    with sqlite3.connect(PROJECTS_DB) as conn:
        rows = conn.execute(
            """SELECT p.id, p.name, p.description, p.model, p.engine, p.project_root,
                      p.shared,
                      COUNT(t.id),
                      SUM(CASE WHEN t.status='done' THEN 1 ELSE 0 END),
                      SUM(CASE WHEN t.status='running' THEN 1 ELSE 0 END),
                      SUM(CASE WHEN t.status='error' THEN 1 ELSE 0 END)
               FROM projects p LEFT JOIN project_tasks t ON t.project_id=p.id
               GROUP BY p.id ORDER BY p.id"""
        ).fetchall()
    for r in rows:
        out.append({
            "id": r[0], "name": r[1], "description": r[2], "model": r[3],
            "engine": r[4], "project_root": r[5] or "", "shared": bool(r[6]),
            "stats": {"total": r[7] or 0, "done": r[8] or 0,
                      "running": r[9] or 0, "error": r[10] or 0},
        })
    return {"host": _ep4_host_label(), "projects": out,
            "claude_md": _claude_md_shared_payload()}


def _tasks_payload(pid: int, clip_output: int = 0) -> list:
    """GET /api/projects/{pid}/tasks 응답과 동일한 태스크 목록.
    clip_output>0 이면 output 을 잘라 peer push 페이로드 크기를 제한한다."""
    with sqlite3.connect(PROJECTS_DB) as conn:
        pname_row = conn.execute("SELECT name FROM projects WHERE id=?", (pid,)).fetchone()
        pname = pname_row[0] if pname_row else "project"
        slug = _slugify(pname)
        rows = conn.execute(
            """SELECT t.id, t.title, t.prompt, t.test_criteria, t.trigger_type,
                      t.model_override, t.timeout_override, t.sort_order, t.status,
                      t.output, t.branch, t.started_at, t.ended_at, t.uid, t.author, t.version,
                      (SELECT r.claude_session_id FROM task_runs r
                       WHERE r.task_id=t.id ORDER BY r.id DESC LIMIT 1) as last_session_id,
                      (SELECT r.git_task_branch FROM task_runs r
                       WHERE r.task_id=t.id AND r.git_task_branch != ''
                       ORDER BY r.id DESC LIMIT 1) as git_task_branch,
                      (SELECT r.model FROM task_runs r
                       WHERE r.task_id=t.id AND COALESCE(r.model,'') != ''
                       ORDER BY r.id DESC LIMIT 1) as last_run_model,
                      t.folder_id, t.session_override
               FROM project_tasks t WHERE t.project_id=? ORDER BY t.folder_id NULLS FIRST, t.sort_order""",
            (pid,)
        ).fetchall()
    out = []
    for r in rows:
        d = {
            "id": r[0], "text": r[1], "body": r[2], "test": r[3],
            "trigger_type": r[4], "model_override": r[5], "timeout_override": r[6],
            "sort_order": r[7], "status": r[8], "output": r[9], "branch": r[10],
            "started_at": r[11], "ended_at": r[12],
            "uid": r[13], "author": r[14] or "", "version": r[15] or 1,
            "claude_session_id": r[16] or "",
            "git_task_branch": f"project/{slug}/task-cli-{r[0]}" if _is_broken_branch(r[17]) else (r[17] or ""),
            "last_run_model": r[18] or "",
            "folder_id": r[19],
            "session_override": r[20] or ""
        }
        if clip_output and isinstance(d.get("output"), str) and len(d["output"]) > clip_output:
            d["output"] = d["output"][:clip_output] + "\n…(이하 생략 — 전체 내용은 원격 EP4 에 있음)"
        out.append(d)
    return out


def _folders_payload(pid: int) -> list:
    """GET /api/projects/{pid}/folders 응답과 동일한 폴더 목록."""
    with sqlite3.connect(PROJECTS_DB) as conn:
        rows = conn.execute(
            "SELECT id, name, sort_order FROM task_folders WHERE project_id=? ORDER BY sort_order, id",
            (pid,)
        ).fetchall()
    return [{"id": r[0], "name": r[1], "sort_order": r[2]} for r in rows]


def _remote_projects() -> dict:
    """연결된(enabled) 모든 peer EP4 의 프로젝트를 집계.
    실패한 peer 는 조용히 건너뛰지 않고 errors 에 사유를 담아 UI 에 표시한다."""
    import urllib.error as _e
    out, errors = [], []
    for peer in _list_peers(enabled_only=True):
        url = peer["url"].rstrip("/")
        label = peer["name"] or url
        cached = _peer_pushed_projects.get(url)
        if cached and time.time() - cached.get("ts", 0) < _PEER_PUSH_INTERVAL * 4:
            # 상대가 최근 push 한 목록이 있으면 우선 사용 — 상대가 NAT 뒤라
            # 직접 접속할 수 없는 경우에도 프로젝트가 표시된다.
            host = cached.get("host") or url
            for pr in cached.get("projects") or []:
                pr = dict(pr)
                pr["remote"] = True
                pr["peer_url"] = url
                pr["peer_name"] = peer["name"] or host
                pr["host"] = host
                out.append(pr)
            continue
        try:
            data = _http_get_json(f"{url}/api/shared-projects", timeout=6, token=_peer_token(url))
        except _e.HTTPError as ex:
            msg = ("인증 실패 — peer 등록에 상대 EP4 의 인증 토큰을 입력하세요"
                   if ex.code == 401 else f"HTTP {ex.code}")
            errors.append({"peer_url": url, "peer_name": label, "error": msg})
            continue
        except Exception as ex:
            errors.append({"peer_url": url, "peer_name": label, "error": f"연결 실패: {ex}"})
            continue
        host = data.get("host", url) if isinstance(data, dict) else url
        _log_peer_out(url, host if isinstance(host, str) else "")
        projs = data.get("projects", []) if isinstance(data, dict) else (data or [])
        for pr in projs:
            pr = dict(pr)
            pr["remote"] = True
            pr["peer_url"] = url
            pr["peer_name"] = peer["name"] or host
            pr["host"] = host
            out.append(pr)
    return {"projects": out, "errors": errors}


_peer_direct_bad: dict = {}   # peer_url -> 마지막 직접 연결 실패 시각 (push 캐시 우선 응답용)


def _peer_proxy_passthrough(handler, method: str, peer_url: str, remote_path: str, body_bytes=None) -> None:
    """등록된 peer EP4 로 요청을 그대로 포워드(투명 프록시). 등록 안 된 URL 은 거부(SSRF 방지).
    태스크/폴더 목록 GET 은 상대가 NAT/방화벽 뒤라 직접 연결이 안 될 때
    상대가 밀어 넣은 push 캐시로 대신 응답한다."""
    base = (peer_url or "").rstrip("/")
    if not base or not _peer_registered(base):
        handler.send_json({"ok": False, "error": "unregistered peer"}, 403)
        return
    if not remote_path.startswith("/api/"):
        handler.send_json({"ok": False, "error": "bad path"}, 400)
        return
    import urllib.request as _u, urllib.error as _e

    _pure = remote_path.split("?")[0]
    _m = re.match(r'^/api/projects/(\d+)/(tasks|folders)$',
                  _pure) if method == "GET" else None
    _is_sessions = method == "GET" and _pure == "/api/sessions"

    def _serve_cached() -> bool:
        cached = _peer_pushed_projects.get(base)
        if not cached:
            return False
        if _is_sessions:
            handler.send_json(cached.get("sessions") or [])
            return True
        if not _m:
            return False
        data = (cached.get(_m.group(2)) or {}).get(_m.group(1))
        if data is None:
            return False
        handler.send_json(data)
        return True

    # 최근 직접 연결에 실패한(도달 불가) peer 는 타임아웃을 기다리지 않고 캐시로 응답
    _recent_bad = time.time() - _peer_direct_bad.get(base, 0) < 60
    if _recent_bad and _serve_cached():
        return

    _hdrs = {"Content-Type": "application/json", "User-Agent": "EP4-peer/1.0",
             **_peer_ident_headers()}
    _ptok = _peer_token(base)
    if _ptok:
        _hdrs["Authorization"] = "Bearer " + _ptok   # 상대 peer 의 인증 게이트 통과용
    req = _u.Request(base + remote_path,
                     data=(body_bytes if method == "POST" else None),
                     method=method,
                     headers=_hdrs)
    try:
        # 캐시로 대체 가능한 요청과 최근 도달 불가였던 peer 는 짧게 시도하고
        # 빨리 폴백한다(변경 op 는 큐로 넘어가므로 오래 기다릴 이유가 없다)
        with _u.urlopen(req, timeout=(6 if (_m or _is_sessions or _recent_bad) else 30)) as r:
            _peer_direct_bad.pop(base, None)
            _log_peer_out(base)
            body = r.read()
            ctype = r.headers.get("Content-Type", "application/json; charset=utf-8")
            handler.send_response(200)
            handler.send_header("Content-Type", ctype)
            handler.send_header("Content-Length", str(len(body)))
            handler.end_headers()
            handler.wfile.write(body)
    except _e.HTTPError as he:
        # HTTP 에러는 도달 자체는 된 것 — 캐시 폴백 없이 그대로 전달
        handler.send_json({"ok": False, "error": f"peer http {he.code}"}, he.code)
    except Exception as ex:
        _peer_direct_bad[base] = time.time()
        if _serve_cached():
            return   # 직접 연결 실패 — push 캐시로 대체 응답
        if method in ("POST", "DELETE") and _queue_peer_op(base, method, remote_path, body_bytes):
            # 도달 불가 peer — 변경 op 를 큐에 저장, 상대의 다음 push 응답으로 전달·실행
            handler.send_json({"ok": True, "queued": True})
            return
        handler.send_json({"ok": False, "error": str(ex)}, 502)


# ── peer SSE 릴레이: 연결된 EP4 의 이벤트를 로컬 SSE 로 재방출 ──────────
# 원격 프로젝트를 보고 있는 브라우저가 peer 쪽 변경(태스크 추가/삭제/실행 등)을
# 실시간으로 반영할 수 있도록, peer 의 /api/events 를 구독해 이벤트에
# peer_url 을 붙여 로컬 SSE 클라이언트에 재방출한다.
_PEER_RELAY_EVENTS = {"status", "task_start", "task_done", "tasks_changed",
                      "task_log", "run_log", "run_done"}
_peer_relay_threads: dict = {}   # url -> threading.Thread
_peer_relay_lock = threading.Lock()


def _send_peer_handshake(url: str) -> bool:
    """상대 EP4 에 내 접속 정보(인증 토큰 포함)를 전달해 역방향 peer 자동 등록을 유도.
    어느 한쪽이라도 상대 토큰으로 인증된 관계면 양쪽 모두 인증 완료로 취급한다:
    내 쪽에 상대 토큰이 없어도(미인증) 내 토큰을 제시하면 상대가 신뢰 관계를
    확인해 수락하고, 응답에 자기 토큰을 실어줘 상호 프로젝트 조회가 열린다."""
    import urllib.request as _u
    try:
        payload = {"name": _ep4_host_label(), "token": _AUTH_TOKEN or "",
                   "port": _EP4_RUNNING_PORT or 7788,
                   "instance": _EP4_INSTANCE_ID}
        pub = (_load_ep4_conf().get("public_url") or "").strip().rstrip("/")
        if pub:
            payload["url"] = pub   # 명시된 외부 접속 주소가 있으면 우선 사용
        hdrs = {"Content-Type": "application/json", "User-Agent": "EP4-peer/1.0",
                **_peer_ident_headers()}
        tok = _peer_token(url)
        if tok:
            hdrs["Authorization"] = "Bearer " + tok
        req = _u.Request(url + "/api/peers/handshake",
                         data=json.dumps(payload, ensure_ascii=False).encode(),
                         headers=hdrs)
        with _u.urlopen(req, timeout=6) as r:
            resp = json.loads(r.read().decode())
        if not resp.get("ok"):
            return False
        # 상대가 응답에 실어준 자기 토큰을 저장 — 상대 쪽에만 토큰이 등록된
        # 관계(내 쪽 token 이 비어 있던 경우)도 이 저장으로 양방향 인증이 완성된다.
        new_tok = (resp.get("token") or "").strip()
        if not resp.get("self") and new_tok and new_tok != tok:
            with sqlite3.connect(PROJECTS_DB) as conn:
                conn.execute("UPDATE ep4_peers SET token=? WHERE rtrim(url,'/')=?",
                             (new_tok, url.rstrip("/")))
                conn.commit()
        return True
    except Exception:
        return False


def _register_peer_payload(body: dict, client_ip: str):
    """핸드셰이크/프로젝트 push 공용 — 페이로드의 접속 정보(name/token/url/port)로
    역방향 peer 를 등록·갱신한다. 반환 (r_url, err):
    자기 자신이면 ("", None), 실패면 (None, 사유)."""
    r_name  = (body.get("name") or "").strip()
    r_token = (body.get("token") or "").strip()
    r_url   = (body.get("url") or "").strip().rstrip("/")
    try:
        r_port = int(body.get("port") or 0)
    except (TypeError, ValueError):
        r_port = 0
    r_iid = (body.get("instance") or "").strip()
    if r_iid:
        if r_iid == _EP4_INSTANCE_ID:
            return "", None   # 같은 프로세스 = 자기 자신(순환 등록 방지)
    elif r_token and r_token == (_AUTH_TOKEN or ""):
        # 구버전 발신자(instance 필드 없음) 호환 — 토큰 동일성으로 자기 자신 추정.
        # 단, 폴더 복사로 두 서버가 같은 토큰을 쓰면 오탐하므로 instance 를 우선한다.
        return "", None
    if not r_url:
        # 접속 주소가 명시되지 않으면 요청의 발신 IP + 알려온 포트로 추정
        if not r_port or not client_ip:
            return None, "url 또는 port 필요"
        host = f"[{client_ip}]" if ":" in client_ip else client_ip
        r_url = f"http://{host}:{r_port}"
    with sqlite3.connect(PROJECTS_DB) as conn:
        row = None
        if r_token:
            row = conn.execute("SELECT id, url FROM ep4_peers WHERE token=?", (r_token,)).fetchone()
        if row:
            # 같은 토큰의 peer 가 이미 있으면(사용자 수동 등록 등) URL 은 유지
            conn.execute(
                "UPDATE ep4_peers SET name=COALESCE(NULLIF(?, ''), name), enabled=1 WHERE id=?",
                (r_name, row[0]))
            r_url = (row[1] or r_url).rstrip("/")
        else:
            # 빈 토큰이 기존 저장 토큰을 지우지 않도록 CASE 로 보존
            conn.execute(
                "INSERT INTO ep4_peers (url, name, enabled, token) VALUES (?,?,1,?) "
                "ON CONFLICT(url) DO UPDATE SET name=excluded.name, enabled=1, "
                "token=CASE WHEN excluded.token='' THEN token ELSE excluded.token END",
                (r_url, r_name, r_token))
        conn.commit()
    # 부팅 인스턴스 ID 변경 감지 — 상대 EP4 가 재시작 후 다시 접속해 온 것을 콘솔에 표시
    if r_iid:
        with _seen_remote_ips_lock:
            prev_iid = _peer_instance_seen.get(r_url)
            _peer_instance_seen[r_url] = r_iid
        if prev_iid and prev_iid != r_iid:
            now = time.strftime("%Y-%m-%d %H:%M:%S")
            ident = f" (host : {r_name})" if r_name else ""
            print(f"\n  [+] 외부 EP4 재연결(재시작 감지): {r_url}{ident}  ({now})\n", flush=True)
    _sync_peer_relays()   # 새로 등록된 상대의 이벤트 릴레이 시작
    return r_url, None


# ── peer 프로젝트 push: NAT/방화벽 뒤 EP4 의 프로젝트 표시 ──────────
# 상대가 내 주소로 접속할 수 없는(도달 불가) 경우, 상대가 나에게 여는 발신
# 연결로 자기 프로젝트 목록을 주기적으로 밀어 넣는다. _remote_projects 는
# 최근 push 캐시가 있으면 직접 조회 대신 이를 사용한다.
_peer_pushed_projects: dict = {}   # peer_url -> {"ts", "host", "projects"}
_PEER_PUSH_INTERVAL = 20           # push 주기(초)

# ── peer 오프라인 op 릴레이: 도달 불가(NAT 뒤) peer 로 향한 변경 요청 큐 ──
# peer-proxy POST/DELETE 가 직접 연결 실패하면 여기 저장했다가, 상대가
# projects-push 로 접속해 올 때 응답(pending_ops)으로 전달해 상대 쪽에서 실행한다.
_peer_pending_ops: dict = {}       # peer_url -> [{method, path, body, ts, tmp_uids?}]
_peer_pending_lock = threading.Lock()
_PEER_OP_PATH_RE = re.compile(r'^/api/projects/\d+/(tasks(/|$)|folders(/|$)|run-selected$)')
_PEER_PENDING_MAX = 200


_peer_tmp_id_lock = threading.Lock()
_peer_tmp_id_seq = 0


def _peer_tmp_task_id() -> int:
    """push 캐시 낙관 반영용 임시(음수) 태스크 id — 실제 id 와 충돌하지 않는다."""
    global _peer_tmp_id_seq
    with _peer_tmp_id_lock:
        _peer_tmp_id_seq += 1
        return -_peer_tmp_id_seq


def _peer_cache_apply_op(base: str, path: str, body: dict) -> None:
    """추가/삭제 op 큐 등록 시 push 캐시를 낙관적으로 갱신해 목록에 즉시 반영한다."""
    cached = _peer_pushed_projects.get(base)
    if not cached:
        return
    # 태스크 추가 — 임시 id 로 캐시에 붙여 상대가 실행·재push 할 때까지 표시한다
    m = re.match(r'^/api/projects/(\d+)/tasks$', path)
    if m:
        pid = m.group(1)
        title = (body.get("title") or body.get("text") or "").strip()
        tl = cached.setdefault("tasks", {}).setdefault(pid, [])
        if title and isinstance(tl, list):
            tl.append({
                "id": _peer_tmp_task_id(), "text": title,
                "body": (body.get("prompt") or body.get("body") or ""),
                "test": (body.get("test_criteria") or body.get("test") or ""),
                "trigger_type": (body.get("trigger_type") or "manual"),
                "model_override": body.get("model_override") or "",
                "session_override": body.get("session_override") or "",
                "timeout_override": 0,
                "sort_order": max([t.get("sort_order") or 0 for t in tl] or [0]) + 1,
                "status": "pending", "output": "", "branch": "",
                "started_at": None, "ended_at": None,
                # uid 는 add op 큐 등록 시 부여됨 — 임시 id 를 참조하는 후속
                # op(실행/삭제/수정)를 상대 쪽에서 실제 id 로 해석하는 키
                "uid": (body.get("uid") or ""), "author": "", "version": 1,
                "claude_session_id": "", "git_task_branch": "",
                "last_run_model": "", "folder_id": None})
            emit("tasks_changed", {"project_id": int(pid), "peer_url": base})
        return
    # 태스크 실행 — 캐시 상태를 낙관적으로 running 표시(다음 push 때 실제 상태로 보정)
    m = re.match(r'^/api/projects/(\d+)/tasks/(-?\d+)/run$', path)
    run_ids = None
    if m:
        pid, run_ids = m.group(1), {int(m.group(2))}
    else:
        m = re.match(r'^/api/projects/(\d+)/run-selected$', path)
        if m:
            pid = m.group(1)
            run_ids = {int(i) for i in (body.get("task_ids") or [])
                       if str(i).lstrip("-").isdigit()}
    if run_ids:
        changed = False
        for t in (cached.get("tasks") or {}).get(pid) or []:
            if t.get("id") in run_ids:
                t["status"] = "running"
                changed = True
        if changed:
            emit("tasks_changed", {"project_id": int(pid), "peer_url": base})
        return
    pid, ids = None, None
    m = re.match(r'^/api/projects/(\d+)/tasks/bulk-delete$', path)
    if m:
        pid = m.group(1)
        ids = {int(i) for i in (body.get("task_ids") or []) if str(i).isdigit()}
    else:
        m = re.match(r'^/api/projects/(\d+)/tasks/(\d+)/delete$', path)
        if m:
            pid, ids = m.group(1), {int(m.group(2))}
    if pid and ids:
        tl = (cached.get("tasks") or {}).get(pid)
        if isinstance(tl, list):
            cached["tasks"][pid] = [t for t in tl if t.get("id") not in ids]
        emit("tasks_changed", {"project_id": int(pid), "peer_url": base})
        return
    m = re.match(r'^/api/projects/(\d+)/folders/(\d+)$', path)
    if m:
        pid, fid = m.group(1), int(m.group(2))
        fl = (cached.get("folders") or {}).get(pid)
        if isinstance(fl, list):
            cached["folders"][pid] = [f for f in fl if f.get("id") != fid]
        for t in (cached.get("tasks") or {}).get(pid) or []:
            if t.get("folder_id") == fid:
                t["folder_id"] = None
        emit("tasks_changed", {"project_id": int(pid), "peer_url": base})


def _peer_tmp_uid_map(base: str, pure_path: str, body: dict) -> dict:
    """op 가 참조하는 임시(음수) 태스크 id → uid 매핑을 push 캐시에서 수집한다.
    상대 쪽 _exec_pending_ops 가 uid 로 실제 id 를 해석해 경로/본문을 치환한다."""
    tmp_ids = {int(m) for m in re.findall(r'/tasks/(-\d+)(?:/|$)', pure_path)}
    if isinstance(body, dict):
        tmp_ids |= {int(i) for i in (body.get("task_ids") or [])
                    if str(i).lstrip("-").isdigit() and int(i) < 0}
    if not tmp_ids:
        return {}
    m = re.match(r'^/api/projects/(\d+)/', pure_path)
    cached_tasks = ((_peer_pushed_projects.get(base) or {}).get("tasks") or {}) \
        .get(m.group(1)) if m else None
    uid_by_id = {t.get("id"): (t.get("uid") or "")
                 for t in (cached_tasks or []) if isinstance(t, dict)}
    return {str(tid): uid_by_id.get(tid, "") for tid in tmp_ids}


def _queue_peer_op(base: str, method: str, remote_path: str, body_bytes) -> bool:
    """도달 불가 peer 로 향한 태스크/폴더 변경 요청을 큐에 저장한다.
    push 캐시가 있는(=상대가 나에게 push 하는 NAT 뒤) peer 만 대상 — 그 외에는
    전달 경로가 없으므로 큐잉하지 않고 호출부가 502 를 반환한다."""
    pure = remote_path.split("?")[0]
    if base not in _peer_pushed_projects or not _PEER_OP_PATH_RE.match(pure):
        return False
    try:
        body = json.loads(body_bytes.decode("utf-8")) if body_bytes else {}
    except Exception:
        body = {}
    op = {"method": method, "path": remote_path, "body": body, "ts": time.time()}
    # 태스크 추가 op 는 uid 를 여기서 부여 — 캐시의 임시(음수) id 태스크와
    # 상대 쪽에 실제 생성될 태스크를 같은 uid 로 잇는다
    if method == "POST" and isinstance(body, dict) \
            and re.match(r'^/api/projects/\d+/tasks$', pure) \
            and not (body.get("uid") or "").strip():
        body["uid"] = _task_uid()
    # 임시 id 를 참조하는 op(실행/삭제/수정)에는 uid 매핑을 첨부
    tmp_uids = _peer_tmp_uid_map(base, pure, body)
    if tmp_uids:
        op["tmp_uids"] = tmp_uids
    with _peer_pending_lock:
        q = _peer_pending_ops.setdefault(base, [])
        if len(q) >= _PEER_PENDING_MAX:
            return False
        q.append(op)
    _peer_cache_apply_op(base, pure, body)
    return True


def _resolve_op_tmp_ids(op: dict) -> bool:
    """op 의 임시(음수) 태스크 id 를 tmp_uids 매핑(uid)으로 내 DB 의 실제 id 로
    치환한다. 해석 실패(uid 없음·태스크 미생성/삭제됨)면 False — op 를 건너뛴다."""
    tmp = op.get("tmp_uids") or {}
    if not tmp:
        return True
    real = {}
    with sqlite3.connect(PROJECTS_DB) as conn:
        for sid, uid in tmp.items():
            row = conn.execute(
                "SELECT id FROM project_tasks WHERE uid=?", (uid,)
            ).fetchone() if (uid or "").strip() else None
            if not row:
                return False
            real[sid] = row[0]
    path = str(op.get("path") or "")
    for sid, rid in real.items():
        path = re.sub(rf'(/tasks/){re.escape(sid)}(/|$)', rf'\g<1>{rid}\g<2>', path)
    op["path"] = path
    body = op.get("body")
    if isinstance(body, dict) and isinstance(body.get("task_ids"), list):
        body["task_ids"] = [real.get(str(i), i) for i in body["task_ids"]]
    return True


def _exec_pending_ops(ops: list) -> int:
    """상대 EP4 가 (내가 도달 불가일 때) 대신 받아 둔 op 를 내 API 로 실행한다.
    태스크/폴더 경로만 허용해 임의 엔드포인트 호출을 차단한다."""
    import urllib.request as _u
    port = _EP4_RUNNING_PORT or 7788
    done = 0
    for op in ops:
        # 임시(음수) id 참조 op 는 uid 로 실제 id 를 해석 — 같은 배치의 추가 op 가
        # 먼저 순차 실행되므로 추가 직후의 실행/삭제 op 도 여기서 해석된다
        if not _resolve_op_tmp_ids(op):
            continue
        path = str(op.get("path") or "")
        method = str(op.get("method") or "POST").upper()
        if method not in ("POST", "DELETE") or not _PEER_OP_PATH_RE.match(path.split("?")[0]):
            continue
        try:
            data = None
            if method == "POST":
                data = json.dumps(op.get("body") or {}, ensure_ascii=False).encode("utf-8")
            hdrs = {"Content-Type": "application/json", "User-Agent": "EP4-peer/1.0"}
            if _AUTH_TOKEN:
                hdrs["Authorization"] = "Bearer " + _AUTH_TOKEN
            req = _u.Request(f"http://127.0.0.1:{port}{path}", data=data,
                             method=method, headers=hdrs)
            with _u.urlopen(req, timeout=30):
                done += 1
        except Exception:
            pass
    return done


def _peer_push_loop():
    """토큰을 보유한 모든 enabled peer 에 내 프로젝트 목록을 주기적으로 push.
    내가 NAT 뒤라서 상대가 나에게 접속할 수 없어도 상대 쪽에 내 프로젝트가 표시된다."""
    import urllib.request as _u
    while True:
        executed = 0
        try:
            peers = [p for p in _list_peers(enabled_only=True)
                     if _peer_token(p["url"].rstrip("/"))]
            if peers:
                payload = _shared_projects_payload()
                projs = payload.get("projects", [])
                body = {"name": _ep4_host_label(), "token": _AUTH_TOKEN or "",
                        "port": _EP4_RUNNING_PORT or 7788,
                        "instance": _EP4_INSTANCE_ID,
                        "host": payload.get("host", ""),
                        "projects": projs,
                        # 태스크/폴더 목록도 함께 push — 상대가 나에게 직접 접속할 수
                        # 없어도(NAT 뒤) 원격 프로젝트의 태스크 목록을 볼 수 있다.
                        "tasks": {str(pr["id"]): _tasks_payload(pr["id"], clip_output=20000)
                                  for pr in projs},
                        "folders": {str(pr["id"]): _folders_payload(pr["id"])
                                    for pr in projs},
                        # 실행 중 세션 목록 — NAT 뒤에서도 상대가 태스크 세션
                        # 옵션 드롭다운을 채울 수 있다
                        "sessions": [{"id": s["id"], "name": s["name"],
                                      "status": s["status"], "cwd": s.get("cwd", "")}
                                     for s in sessions_list()],
                        # 공유 설정된 CLAUDE.md (Global 옵션 + shared 프로젝트) —
                        # NAT 뒤에서도 상대가 내 CLAUDE.md 를 볼 수 있다.
                        "claude_md": payload.get("claude_md", [])}
                pub = (_load_ep4_conf().get("public_url") or "").strip().rstrip("/")
                if pub:
                    body["url"] = pub
                data = json.dumps(body, ensure_ascii=False).encode()
                for p in peers:
                    url = p["url"].rstrip("/")
                    try:
                        hdrs = {"Content-Type": "application/json",
                                "User-Agent": "EP4-peer/1.0",
                                "Authorization": "Bearer " + _peer_token(url),
                                **_peer_ident_headers()}
                        req = _u.Request(url + "/api/peers/projects-push",
                                         data=data, headers=hdrs)
                        with _u.urlopen(req, timeout=6) as resp:
                            try:
                                rj = json.loads(resp.read().decode("utf-8"))
                            except ValueError:
                                rj = {}
                        # 상대가 대신 받아 둔 오프라인 op (내가 NAT 뒤라 도달 불가일 때
                        # 상대 쪽 모바일 앱 등이 요청한 태스크 삭제 등) 를 실행한다
                        ops = rj.get("pending_ops") or []
                        if ops:
                            executed += _exec_pending_ops(ops)
                    except Exception:
                        pass   # 상대가 구버전(404)이거나 오프라인 — 조용히 무시
        except Exception:
            pass
        # op 실행 직후에는 곧바로 다시 push 해 상대 캐시를 빠르게 갱신한다
        time.sleep(2 if executed else _PEER_PUSH_INTERVAL)


def _peer_sse_relay(url: str):
    import urllib.request as _u
    handshaked = False
    while True:
        if not any(p["url"].rstrip("/") == url for p in _list_peers(enabled_only=True)):
            return   # peer 삭제/비활성 → 릴레이 종료
        if not handshaked:
            handshaked = _send_peer_handshake(url)   # 역방향 자동 등록(성공까지 재시도)
        try:
            hdrs = {"User-Agent": "EP4-peer/1.0", "Accept": "text/event-stream",
                    **_peer_ident_headers()}
            tok = _peer_token(url)
            if tok:
                hdrs["Authorization"] = "Bearer " + tok
            req = _u.Request(url + "/api/events", headers=hdrs)
            # 서버가 20초마다 ping 을 보내므로 60초 무응답이면 재접속
            with _u.urlopen(req, timeout=60) as r:
                ev, data = "", ""
                for raw in r:
                    line = raw.decode("utf-8", "replace").rstrip("\r\n")
                    if line.startswith("event:"):
                        ev = line[6:].strip()
                    elif line.startswith("data:"):
                        data += line[5:].strip()
                    elif not line:
                        if ev in _PEER_RELAY_EVENTS and data:
                            try:
                                payload = json.loads(data)
                            except ValueError:
                                payload = {}
                            # 이미 릴레이된 이벤트(peer_url 보유)는 건너뜀 — 순환 방지
                            if isinstance(payload, dict) and not payload.get("peer_url"):
                                payload["peer_url"] = url
                                emit(ev, payload)
                        ev, data = "", ""
        except Exception:
            pass
        time.sleep(5)   # 연결 실패/끊김 — 재접속 대기


def _sync_peer_relays():
    """enabled peer 마다 릴레이 스레드를 보장한다 (없거나 죽었으면 기동)."""
    with _peer_relay_lock:
        for p in _list_peers(enabled_only=True):
            url = p["url"].rstrip("/")
            t = _peer_relay_threads.get(url)
            if t and t.is_alive():
                continue
            t = threading.Thread(target=_peer_sse_relay, args=(url,),
                                 daemon=True, name=f"peer-relay-{url}")
            _peer_relay_threads[url] = t
            t.start()


# ── 정적 파일 서빙 ─────────────────────────────────────
def _apk_path() -> Path:
    """mobile/build_apk.bat 이 만드는 릴리스 APK 경로."""
    return (BASE_DIR.parent / "mobile" / "build" / "app" / "outputs"
            / "flutter-apk" / "app-release.apk")


def _serve_file(handler, file_path: Path, content_type: str):
    try:
        body = file_path.read_bytes()
        handler.send_response(200)
        handler.send_header("Content-Type", content_type)
        handler.send_header("Content-Length", str(len(body)))
        handler.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        handler.end_headers()
        handler.wfile.write(body)
    except FileNotFoundError:
        handler.send_response(404)
        handler.end_headers()


# ── 프로젝트 Claude 상세 (CLAUDE.md / .claude 구성 / ~/.claude.json 엔트리) ──
def _cd_safe_read(p, limit: int = 20000) -> str:
    try:
        with open(p, "r", encoding="utf-8", errors="replace") as f:
            return f.read(limit)
    except Exception:
        return ""


def _cd_frontmatter(text: str) -> dict:
    """마크다운 선두 --- 블록의 key: value 라인만 단순 파싱 (LazyClaude 방식)."""
    meta = {}
    m = re.match(r"^---\s*\n(.*?)\n---", text or "", re.S)
    if m:
        for line in m.group(1).splitlines():
            mm = re.match(r"^(\w[\w-]*):\s*(.*)$", line)
            if mm:
                meta[mm.group(1)] = mm.group(2).strip().strip('"\'')
    return meta


def _cd_tools_field(v: str) -> list:
    v = (v or "").strip()
    if not v:
        return []
    if v.startswith("["):
        try:
            return [str(x) for x in json.loads(v)]
        except Exception:
            pass
    return [t.strip() for t in v.split(",") if t.strip()]


def _scan_repo_claude_detail(root: str) -> dict:
    """project_root 의 CLAUDE.md 와 .claude/ 구성(에이전트·스킬·명령어·훅·settings.local.json)을 수집."""
    base = Path(root)
    dot = base / ".claude"
    out = {"exists": dot.is_dir(), "claude_md": "", "claude_md_path": "",
           "agents": [], "skills": [], "commands": [], "hooks": [],
           "settings_local": None, "settings_local_path": ""}
    claude_md = base / "CLAUDE.md"
    if claude_md.is_file():
        out["claude_md"] = _cd_safe_read(claude_md, 20000)
        out["claude_md_path"] = str(claude_md)
    if not dot.is_dir():
        return out
    try:
        agents_dir = dot / "agents"
        if agents_dir.is_dir():
            for p in sorted(agents_dir.glob("*.md")):
                meta = _cd_frontmatter(_cd_safe_read(p, 4000))
                out["agents"].append({
                    "id": p.stem, "name": meta.get("name", p.stem),
                    "description": meta.get("description", ""),
                    "model": meta.get("model", "inherit"),
                    "tools": _cd_tools_field(meta.get("tools", "")),
                })
        cmd_dir = dot / "commands"
        if cmd_dir.is_dir():
            for p in sorted(cmd_dir.rglob("*.md")):
                meta = _cd_frontmatter(_cd_safe_read(p, 2000))
                rel = str(p.relative_to(cmd_dir)).replace("\\", "/")
                out["commands"].append({
                    "id": rel.replace("/", ":").removesuffix(".md"),
                    "name": meta.get("name", p.stem),
                    "description": meta.get("description", ""),
                })
        skills_dir = dot / "skills"
        if skills_dir.is_dir():
            for sp in sorted(skills_dir.iterdir()):
                if not sp.is_dir():
                    continue
                sm = sp / "SKILL.md"
                meta = _cd_frontmatter(_cd_safe_read(sm)) if sm.is_file() else {}
                out["skills"].append({
                    "id": sp.name, "name": meta.get("name", sp.name),
                    "description": meta.get("description", ""),
                })
        hooks_dir = dot / "hooks"
        if hooks_dir.is_dir():
            for p in sorted(hooks_dir.iterdir()):
                if p.is_file():
                    out["hooks"].append({"name": p.name})
        settings_local = dot / "settings.local.json"
        if settings_local.is_file():
            try:
                out["settings_local"] = json.loads(_cd_safe_read(settings_local, 20000))
            except Exception:
                out["settings_local"] = {"_raw": _cd_safe_read(settings_local, 4000)}
            out["settings_local_path"] = str(settings_local)
    except Exception:
        pass
    return out


def _claude_json_project_entry(root: str) -> dict:
    """~/.claude.json 의 projects[<절대경로>] 엔트리에서 표시용 필드만 추출."""
    try:
        cj = Path.home() / ".claude.json"
        if not cj.is_file():
            return {}
        data = json.loads(_cd_safe_read(cj, 200000))
        entry = (data.get("projects") or {}).get(root) or {}
        if not entry:
            return {}
        return {
            "allowedTools": entry.get("allowedTools", []),
            "mcpServers": list((entry.get("mcpServers") or {}).keys()),
            "enabledMcpjsonServers": entry.get("enabledMcpjsonServers", []),
            "disabledMcpjsonServers": entry.get("disabledMcpjsonServers", []),
            "hasTrustDialogAccepted": entry.get("hasTrustDialogAccepted"),
            "lastCost": entry.get("lastCost"),
            "lastAPIDuration": entry.get("lastAPIDuration"),
            "lastDuration": entry.get("lastDuration"),
            "lastLinesAdded": entry.get("lastLinesAdded"),
            "lastLinesRemoved": entry.get("lastLinesRemoved"),
            "onboardingSeenCount": entry.get("projectOnboardingSeenCount"),
        }
    except Exception:
        return {}


# ── HTTP 핸들러 ─────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def parse_request(self):
        ok = super().parse_request()
        if ok:
            self._log_remote_host()
        return ok

    def _client_ip(self) -> str:
        """실제 클라이언트 IP. 프록시/터널 헤더(CF-Connecting-IP → X-Forwarded-For)를
        우선하고 없으면 TCP 소스 주소를 쓴다. 헤더는 위조 가능하므로 표시용으로만 사용."""
        ip = (self.headers.get("CF-Connecting-IP") or "").strip()
        if ip:
            return ip
        fwd = (self.headers.get("X-Forwarded-For") or "").strip()
        if fwd:
            return fwd.split(",")[0].strip()
        return self.client_address[0]

    @staticmethod
    def _ua_family(ua: str) -> str:
        """User-Agent 를 표시용 클라이언트 종류로 축약."""
        u = ua or ""
        if u.startswith("EP4-peer"):
            return "EP4"
        if "Edg/" in u:
            return "Edge"
        if "Chrome" in u:
            return "Chrome"
        if "Firefox" in u:
            return "Firefox"
        if "Safari" in u:
            return "Safari"
        if u.startswith("Dart"):
            return "모바일 앱"
        if "python" in u.lower():
            return "훅/스크립트"
        return (u.split("/")[0].strip()[:20]) or "unknown"

    def _log_remote_host(self):
        ip = self._client_ip()
        ua = self.headers.get("User-Agent", "") or ""
        fam = self._ua_family(ua)
        now = time.strftime("%Y-%m-%d %H:%M:%S")
        # 같은 PC(localhost) 접속: 브라우저·앱·훅 등 클라이언트 종류별로 1회 표시
        if ip in ("127.0.0.1", "::1"):
            key = f"local|{fam}"
            with _seen_remote_ips_lock:
                rec = _conn_seen.get(key)
                if rec:
                    rec["last"] = now
                    rec["count"] += 1
                    return
                rec = {"kind": "내부 호스트", "ip": ip, "client": fam,
                       "hostname": "", "local_ip": "", "via": "",
                       "first": now, "last": now, "count": 1}
                _conn_seen[key] = rec
            rec["hid"] = _conn_history_insert("in", rec)
            print(f"\n  [+] 내부 호스트 연결: {ip} ({fam})  ({now})\n", flush=True)
            return
        hn  = (self.headers.get("X-EP4-Hostname") or "").strip()
        lip = (self.headers.get("X-EP4-Local-IP") or "").strip()
        key = f"{ip}|{hn}|{lip}|{fam}"   # 같은 NAT 뒤의 서로 다른 발신 호스트/클라이언트도 각각 1회 로그
        src = self.client_address[0]
        via = src if (src != ip and src not in ("127.0.0.1", "::1")) else ""
        is_ep4 = bool(hn or lip) or ua.startswith("EP4-peer")
        my = _peer_ident_headers()
        self_conn = is_ep4 and hn and hn == my.get("X-EP4-Hostname", "") and \
            lip == my.get("X-EP4-Local-IP", "")
        kind = "내부 EP4" if self_conn else ("외부 EP4" if is_ep4 else "외부 호스트")
        now_ts = time.time()
        reconnect = False
        with _seen_remote_ips_lock:
            rec = _conn_seen.get(key)
            if rec:
                gap = now_ts - rec.get("last_ts", now_ts)
                rec["last"] = now
                rec["last_ts"] = now_ts
                rec["count"] += 1
                # EP4 peer 가 한동안 무소식이다가 다시 접속 — 재연결로 콘솔에 표시
                if not (is_ep4 and gap > _PEER_RECONNECT_GAP):
                    return
                reconnect = True
                # 재연결은 새 접속 회차로 히스토리에 별도 기록 (이전 회차 row 는 보존)
                rec["first"] = now
                rec["count"] = 1
            else:
                rec = {"kind": kind, "ip": ip, "client": fam,
                       "hostname": hn, "local_ip": lip, "via": via,
                       "first": now, "last": now, "last_ts": now_ts,
                       "count": 1}
                _conn_seen[key] = rec
        rec["hid"] = _conn_history_insert("in", rec)
        via_str = f" (경유 {via})" if via else ""
        ident = ""
        if hn or lip:
            parts = [f"hostname : {hn}"] if hn else []
            if lip and lip != ip:
                parts.append(f"ip : {lip}")
            if parts:
                ident = " (" + ", ".join(parts) + ")"
        if not is_ep4:
            ident = f" ({fam})"
        suffix = " — 자기 자신(등록된 peer 주소가 이 서버를 가리킴)" if self_conn else ""
        verb = "재연결" if reconnect else "연결"
        print(f"\n  [+] {kind} {verb}: {ip}{via_str}{ident}{suffix}  ({now})\n", flush=True)

    def send_json(self, data, code=200):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _request_token(self) -> str:
        """요청에서 인증 토큰을 추출한다 (Authorization 헤더 → 쿠키 → 쿼리 순)."""
        auth = self.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            return auth[7:].strip()
        cookie = self.headers.get("Cookie", "") or ""
        for part in cookie.split(";"):
            if "=" in part:
                k, v = part.strip().split("=", 1)
                if k == "ep4_token":
                    return v.strip()
        try:
            q = parse_qs(urlparse(self.path).query)
            if q.get("token"):
                return q["token"][0]
        except Exception:
            pass
        return ""

    def _token_matches(self) -> bool:
        """요청 토큰이 내 인증 토큰과 일치하는지 판정만 한다 (401 응답 없음)."""
        if not _AUTH_TOKEN:
            return True
        tok = self._request_token()
        return bool(tok and secrets.compare_digest(tok, _AUTH_TOKEN))

    def _auth_ok(self) -> bool:
        """/api/* 요청에 대해 인증을 검사한다. 실패 시 401을 보내고 False 반환.
        정적 파일 등 /api/ 이외 경로와 인증 비활성 상태는 항상 통과한다."""
        if not _AUTH_TOKEN:
            return True
        path = urlparse(self.path).path
        if not path.startswith("/api/"):
            return True
        if self._token_matches():
            return True
        self.send_json({"ok": False, "error": "unauthorized"}, 401)
        return False

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)
        if not self._auth_ok():
            return

        if path == "/" or path == "/index.html":
            try:
                html = (DIST_DIR / "index.html").read_text(encoding="utf-8")
                html = html.replace('src="/app.js"', f'src="/app.js?v={_BOOT_VER}"')
                html = html.replace('src="/shell.js"', f'src="/shell.js?v={_BOOT_VER}"')
                body = html.encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
                self.end_headers()
                self.wfile.write(body)
            except FileNotFoundError:
                self.send_response(404)
                self.end_headers()

        elif path == "/app.js":
            _serve_file(self, DIST_DIR / "app.js", "application/javascript; charset=utf-8")

        elif path.startswith("/mascots/"):
            gif_name = path.split("/")[-1]
            _serve_file(self, DIST_DIR / "mascots" / gif_name, "image/gif")

        elif path == "/shell.js":
            _serve_file(self, DIST_DIR / "shell.js", "application/javascript; charset=utf-8")

        elif path.startswith("/webdoc/"):
            # 태스크 프롬프트·답변 웹 문서 뷰어 — 데이터는 /api/projects/{pid}/webdoc 로 로드
            _serve_file(self, DIST_DIR / "webdoc.html", "text/html; charset=utf-8")

        elif path == "/api/plugins":
            self.send_json({"plugins": _get_plugins()})

        elif path == "/api/settings":
            # 전체 설정 반환
            with sqlite3.connect(PROJECTS_DB) as conn:
                rows = conn.execute("SELECT key,value FROM ep4_settings").fetchall()
            self.send_json({r[0]: r[1] for r in rows})

        elif path == "/api/connect-info":
            # 모바일 QR 연결용 정보 (터널 URL / EP4 ID / 이름)
            self.send_json(_read_connect_info())

        elif path == "/api/qr":
            # QR 코드(SVG) 생성. data 미지정 시 연결 데이터(_qr_connect_data)를 인코딩.
            data = qs.get("data", [""])[0]
            if not data:
                data = _qr_connect_data()
            try:
                import qrcode
                import qrcode.image.svg
                buf = io.BytesIO()
                qrcode.make(data, image_factory=qrcode.image.svg.SvgPathImage,
                            box_size=10, border=2).save(buf)
                body = buf.getvalue()
                self.send_response(200)
                self.send_header("Content-Type", "image/svg+xml; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body)
            except ImportError:
                self.send_json({"ok": False, "error": "qrcode 미설치: pip install qrcode"}, code=500)
            except Exception as e:
                self.send_json({"ok": False, "error": str(e)}, code=500)

        elif path in ("/api/apk-info", "/api/apk/info"):
            # 모바일 앱 릴리스 APK 빌드 정보 (mobile/build_apk.bat 산출물).
            # /api/apk/info 는 구버전(0813) 모바일 앱 호환 별칭.
            apk = _apk_path()
            if apk.is_file():
                st = apk.stat()
                self.send_json({
                    "ok": True, "exists": True, "size": st.st_size,
                    "mtime": datetime.fromtimestamp(st.st_mtime).isoformat(timespec="seconds"),
                })
            else:
                self.send_json({"ok": True, "exists": False})

        elif path == "/api/apk":
            # 반응형 웹에서 모바일 앱 APK 다운로드
            apk = _apk_path()
            if not apk.is_file():
                self.send_json({"ok": False,
                                "error": "APK 없음 — mobile\\build_apk.bat 실행으로 생성하세요."},
                               code=404)
            else:
                try:
                    body = apk.read_bytes()
                    self.send_response(200)
                    self.send_header("Content-Type", "application/vnd.android.package-archive")
                    self.send_header("Content-Disposition", 'attachment; filename="ep4.apk"')
                    self.send_header("Content-Length", str(len(body)))
                    self.send_header("Cache-Control", "no-store")
                    self.end_headers()
                    self.wfile.write(body)
                except Exception as e:
                    self.send_json({"ok": False, "error": str(e)}, code=500)

        elif path == "/api/marketplace/config":
            conf = _read_marketplace_conf()
            self.send_json({
                "ok":          True,
                "source":      conf.get("source", "manager"),
                "firebase_url": conf.get("firebase_url", ""),
                "github_repo": conf.get("github_repo", ""),
                "manager_url": conf.get("manager_url", ""),
                "has_token":   bool(conf.get("github_token", "").strip()),
                "skill_repos": _skill_market_repos(),
            })

        elif path == "/api/marketplace/skills":
            # 외부 GitHub 저장소의 Claude Skill 목록 — 캐시 우선(TTL 내 네트워크 0회)
            force = qs.get("refresh", ["0"])[0] in ("1", "true")
            token = (_read_marketplace_conf().get("github_token") or "").strip()
            skills, repos_meta = [], []
            for repo in _skill_market_repos():
                try:
                    idx = _skill_market_refresh(repo, force=force, token=token)
                    for s in idx.get("skills", []):
                        skills.append({**s, "repo": repo})
                    repos_meta.append({"repo": repo, "sha": (idx.get("sha") or "")[:10],
                                       "fetched_at": idx.get("fetched_at", ""),
                                       "count": len(idx.get("skills", []))})
                    # 설명·SKILL.md 한국어 사전 번역 (백그라운드, 캐시에 저장)
                    if _skill_translate_needed(repo):
                        threading.Thread(target=_skill_translate_bg, args=(repo,), daemon=True).start()
                except Exception as e:
                    repos_meta.append({"repo": repo, "error": str(e)})
            self.send_json({"ok": True, "skills": skills, "repos": repos_meta})

        elif path == "/api/marketplace/skills/preview":
            repo = (qs.get("repo") or [""])[0].strip()
            sid = (qs.get("id") or [""])[0].strip()
            lang = (qs.get("lang") or [""])[0].strip()
            idx = _skill_index_load(repo)
            skill = next((s for s in idx.get("skills", []) if s["id"] == sid), None)
            if not skill:
                self.send_json({"ok": False, "error": "스킬을 찾을 수 없음 (목록을 먼저 갱신하세요)"}); return
            try:
                if lang == "ko":
                    # 사전 번역 캐시 우선, 없으면 즉석 번역 후 캐시에 저장
                    ko_file = _skill_repo_dir(repo) / "ko" / f"{sid}.md"
                    if ko_file.is_file():
                        self.send_json({"ok": True, "id": sid, "repo": repo, "translated": True,
                                        "description_ko": skill.get("description_ko", ""),
                                        "content": ko_file.read_text(encoding="utf-8")[:20000]})
                        return
                    raw = _skill_zip_read(repo, skill["path"] + "/SKILL.md").decode("utf-8", "replace")
                    ko = _claude_translate_text(raw)
                    if ko:
                        ko_file.parent.mkdir(parents=True, exist_ok=True)
                        ko_file.write_text(ko, encoding="utf-8")
                        self.send_json({"ok": True, "id": sid, "repo": repo, "translated": True,
                                        "description_ko": skill.get("description_ko", ""),
                                        "content": ko[:20000]})
                        return
                    self.send_json({"ok": False, "error": "번역 실패 (claude CLI 확인)"}); return
                raw = _skill_zip_read(repo, skill["path"] + "/SKILL.md").decode("utf-8", "replace")
                self.send_json({"ok": True, "id": sid, "repo": repo, "content": raw[:20000]})
            except Exception as e:
                self.send_json({"ok": False, "error": str(e)})

        elif path == "/api/marketplace/skills/registered":
            # 마켓(Firebase)에 등록된 스킬 목록 — 이름(id) 기준 SKILL.md 스냅샷
            if not _market_fb_url():
                self.send_json({"ok": True, "skills": [], "no_source": True}); return
            try:
                force = qs.get("refresh", [""])[0] == "1"
                self.send_json({"ok": True, "skills": _market_skills_fetch(force)})
            except Exception as e:
                self.send_json({"ok": False, "skills": [], "error": str(e)})

        elif path == "/api/marketplace/agents/registered":
            # 마켓(Firebase)에 등록된 서브 에이전트 목록 — 이름(id) 기준 .md 스냅샷
            if not _market_fb_url():
                self.send_json({"ok": True, "agents": [], "no_source": True}); return
            try:
                force = qs.get("refresh", [""])[0] == "1"
                self.send_json({"ok": True, "agents": _market_agents_fetch(force)})
            except Exception as e:
                self.send_json({"ok": False, "agents": [], "error": str(e)})

        elif path == "/api/marketplace":
            conf = _read_marketplace_conf()
            source = qs.get("source", [""])[0].strip() or conf.get("source", "")
            if source == "firebase":
                firebase_url = (qs.get("firebase_url", [""])[0].strip()
                                or conf.get("firebase_url", "")
                                or _get_setting("marketplace_firebase_url"))
                if not firebase_url:
                    self.send_json({"ok": True, "plugins": [], "no_url": True})
                    return
                try:
                    _mdata = _marketplace_fetch_firebase(firebase_url)
                    _market_attach_ko(_mdata)   # 캐시된 한국어 설명 부착 (미스는 백그라운드 번역)
                    self.send_json(_mdata)
                except Exception as e:
                    self.send_json({"ok": False, "plugins": [], "error": str(e)})
            else:
                manager_url = (qs.get("url", [""])[0].strip()
                               or conf.get("manager_url", "")
                               or _get_setting("marketplace_url"))
                if not manager_url:
                    self.send_json({"ok": True, "plugins": [], "no_url": True})
                    return
                try:
                    _mdata = _marketplace_fetch(manager_url)
                    _market_attach_ko(_mdata)
                    self.send_json(_mdata)
                except Exception as e:
                    self.send_json({"ok": False, "plugins": [], "error": str(e)})

        elif path == "/api/mcp/connectors":
            cj = _read_claude_json()
            servers = cj.get("mcpServers") or {}
            items = []
            for name, spec in servers.items():
                items.append({
                    "id": name, "name": name,
                    "type": spec.get("type", "stdio"),
                    "command": spec.get("command", ""),
                    "args": spec.get("args", []),
                    "env": {k: ("***" if any(s in k.lower() for s in ["token","key","secret","password"]) else v)
                           for k, v in (spec.get("env") or {}).items()},
                    "scope": "user",
                })
            self.send_json({"ok": True, "connectors": items})

        elif path == "/api/mcp/catalog":
            cj = _read_claude_json()
            installed_ids = set((cj.get("mcpServers") or {}).keys())
            catalog = []
            for c in MCP_CATALOG:
                catalog.append({**c, "installed": c["id"] in installed_ids})
            self.send_json({"ok": True, "catalog": catalog})

        elif path == "/api/claude/skills":
            self.send_json({"ok": True, "skills": _scan_skills()})

        elif path == "/api/claude/skills/view":
            # 설치됨 > Claude Skill 상세 — scope 기준(글로벌/프로젝트) SKILL.md 내용
            sid = qs.get("id", [""])[0].strip()
            scope = (qs.get("scope", ["global"])[0] or "global").strip()
            pid = qs.get("project_id", [""])[0].strip()
            if not sid:
                self.send_json({"ok": False, "error": "id 필요"}); return
            try:
                base, _pn = _skills_base_dir(scope, pid)
            except Exception as e:
                self.send_json({"ok": False, "error": str(e)}); return
            try:
                target = (base / sid / "SKILL.md").resolve()
                target.relative_to(base.resolve())   # 경로 탈출 방지
            except Exception:
                self.send_json({"ok": False, "error": "잘못된 경로"}); return
            if not target.is_file():
                self.send_json({"ok": False, "error": "SKILL.md 없음"}); return
            self.send_json({"ok": True, "path": str(target),
                            "content": _cd_safe_read(target, 200000)})

        elif path == "/api/claude/agents":
            # 확장 > Claude Agent — 글로벌(~/.claude/agents) + 각 프로젝트(.claude/agents)
            self.send_json({"ok": True, "agents": _scan_claude_agents()})

        elif path == "/api/claude/agents/view":
            # 설치됨 > Claude Agent 상세 — scope 기준(글로벌/프로젝트) 에이전트 .md 내용
            rel = qs.get("rel", [""])[0].strip()
            scope = (qs.get("scope", ["global"])[0] or "global").strip()
            pid = qs.get("project_id", [""])[0].strip()
            if not rel:
                self.send_json({"ok": False, "error": "rel 필요"}); return
            try:
                base, _pn = _agents_base_dir(scope, pid)
            except Exception as e:
                self.send_json({"ok": False, "error": str(e)}); return
            try:
                target = (base / rel).resolve()
                target.relative_to(base.resolve())   # 경로 탈출 방지
            except Exception:
                self.send_json({"ok": False, "error": "잘못된 경로"}); return
            if not target.is_file():
                self.send_json({"ok": False, "error": "파일 없음"}); return
            self.send_json({"ok": True, "path": str(target),
                            "content": _cd_safe_read(target, 200000)})

        elif path == "/api/claude/md":
            # 확장 > Claude > CLAUDE.md — 글로벌 + 각 프로젝트 + peer 공유분.
            # 존재하는 파일만 표시한다. Global 은 share_claude_md_global 설정으로 peer 공유 여부 제어.
            def _md_stat(f: Path) -> dict:
                st = f.stat()
                return {"exists": True, "size": st.st_size, "mtime": int(st.st_mtime)}
            items = []
            g = Path.home() / ".claude" / "CLAUDE.md"
            if g.is_file():
                items.append({"scope": "global", "project_id": None, "name": "Global",
                              "path": str(g), "projects": [],
                              "shared": _get_setting("share_claude_md_global") == "1",
                              **_md_stat(g)})
            with sqlite3.connect(PROJECTS_DB) as conn:
                rows = conn.execute(
                    "SELECT id, name, project_root, shared FROM projects "
                    "WHERE project_root IS NOT NULL AND TRIM(project_root) != '' ORDER BY id").fetchall()
            seen = {}
            for pid, pname, root, pshared in rows:
                f = Path(os.path.expanduser(root.strip())) / "CLAUDE.md"
                if not f.is_file():
                    continue
                key = str(f).lower()
                if key in seen:
                    # 같은 project_root 를 공유하는 프로젝트는 한 카드로 합침
                    seen[key]["projects"].append({"id": pid, "name": pname})
                    seen[key]["shared"] = seen[key]["shared"] or bool(pshared)
                    continue
                item = {"scope": "project", "project_id": pid, "name": pname,
                        "path": str(f), "projects": [{"id": pid, "name": pname}],
                        "shared": bool(pshared), **_md_stat(f)}
                seen[key] = item
                items.append(item)
            # 연결된 peer EP4 가 공유한 CLAUDE.md (Global 공유 옵션 + shared 프로젝트)
            items.extend(_remote_claude_md())
            self.send_json({"ok": True, "items": items})

        elif path == "/api/claude/md/global":
            f = Path.home() / ".claude" / "CLAUDE.md"
            if not f.is_file():
                self.send_json({"ok": False, "error": "CLAUDE.md not found"}); return
            self.send_json({"ok": True, "path": str(f), "content": _cd_safe_read(f, 200000)})

        elif path == "/api/claude/commands":
            self.send_json({"ok": True, "commands": _scan_commands()})

        elif path == "/api/marketplace/commands":
            # 마켓(Firebase)에 등록된 커맨드 목록 — 이름(id) 기준 스냅샷
            if not _market_cmd_base():
                self.send_json({"ok": True, "commands": [], "no_source": True}); return
            try:
                force = qs.get("refresh", [""])[0] == "1"
                self.send_json({"ok": True, "commands": _market_commands_fetch(force)})
            except Exception as e:
                self.send_json({"ok": False, "commands": [], "error": str(e)})

        elif path == "/api/claude/commands/view":
            # 커맨드 .md 내용 보기 — scope 기준 base 디렉토리 안의 rel 경로만 허용
            scope = qs.get("scope", ["global"])[0].strip()
            rel = qs.get("rel", [""])[0].strip()
            if scope == "global":
                base = _COMMANDS_DIR
            else:
                pid = qs.get("project_id", [""])[0].strip()
                with sqlite3.connect(PROJECTS_DB) as conn:
                    row = conn.execute("SELECT project_root FROM projects WHERE id=?",
                                       (pid,)).fetchone()
                if not row or not (row[0] or "").strip():
                    self.send_json({"ok": False, "error": "project_root 없음"}); return
                base = Path(os.path.expanduser(row[0].strip())) / ".claude" / "commands"
            try:
                target = (base / rel).resolve()
                target.relative_to(base.resolve())   # 경로 탈출 방지
            except Exception:
                self.send_json({"ok": False, "error": "잘못된 경로"}); return
            if not rel or not target.is_file():
                self.send_json({"ok": False, "error": "파일 없음"}); return
            self.send_json({"ok": True, "path": str(target),
                            "content": _cd_safe_read(target, 200000)})

        elif path == "/api/claude/hooks":
            settings = _read_settings_json()
            hooks = settings.get("hooks") or {}
            ep4_hooks = []
            ep4_hook_dir = Path(__file__).parent
            for hf in ["ep4_hook_prompt.py", "ep4_hook_stop.py"]:
                ep4_hooks.append({
                    "file": hf,
                    "exists": (ep4_hook_dir / hf).exists(),
                    "event": "UserPromptSubmit" if "prompt" in hf else "Stop",
                })
            self.send_json({"ok": True, "hooks": hooks, "ep4_hooks": ep4_hooks})

        elif path == "/api/agents":
            _AGENTS_ALL = []
            for _grp in EP4_PM.hook.ep4_collect_agents():
                _AGENTS_ALL.extend(_grp or [])
            with sqlite3.connect(PROJECTS_DB) as _ac:
                _disabled = {r[0] for r in _ac.execute(
                    "SELECT id FROM installed_plugins WHERE type='agent' AND enabled=0").fetchall()}
            _AGENTS = [a for a in _AGENTS_ALL if a["id"] not in _disabled]
            self.send_json({"ok": True, "agents": _AGENTS})

        elif path.startswith("/plugins/"):
            # 플러그인 정적 에셋 서빙 (예: /plugins/sessions/view.js)
            # 플러그인은 플랫(plugins/<id>/) 또는 카테고리(plugins/<Cat>/<id>/) 구조 둘 다
            # 가능하므로 양쪽을 모두 탐색한다.
            rel = path[len("/plugins/"):]
            if ".." in rel:
                self.send_response(403); self.end_headers(); return
            ctype = "application/json; charset=utf-8" if rel.endswith(".json") else \
                    "application/javascript; charset=utf-8" if rel.endswith(".js") else \
                    "text/css; charset=utf-8" if rel.endswith(".css") else \
                    "image/svg+xml" if rel.endswith(".svg") else "application/octet-stream"
            _seg = rel.split("/", 1)
            _pid = _seg[0]
            _sub = _seg[1] if len(_seg) > 1 else ""
            _CATS = ("View", "MCP", "Data", "Helper")
            target = None
            for base in (INSTALLED_PLUGINS_DIR, PLUGINS_DIR):
                # 후보 플러그인 디렉토리: 플랫 + 카테고리 하위
                for pdir in [base / _pid] + [base / c / _pid for c in _CATS]:
                    candidate = (pdir / _sub).resolve()
                    try:
                        candidate.relative_to(pdir.resolve())
                    except ValueError:
                        continue
                    if candidate.is_file():
                        target = candidate
                        break
                if target:
                    break
            if target is None:
                self.send_response(404); self.end_headers(); return
            _serve_file(self, target, ctype)

        elif path == "/api/claude-sessions":
            root = qs.get("root", [""])[0].strip()
            sessions = []
            if root:
                dir_name = _claude_proj_dir_name(root)
                claude_dir = Path.home() / ".claude" / "projects" / dir_name
                if claude_dir.exists():
                    for f in sorted(claude_dir.glob("*.jsonl"), key=lambda x: x.stat().st_mtime, reverse=True):
                        info = _parse_claude_session(f)
                        if info:
                            sessions.append(info)
            self.send_json(sessions)

        elif path == "/api/projects":
            with sqlite3.connect(PROJECTS_DB) as conn:
                rows = conn.execute("""
                    SELECT p.id, p.name, p.description, p.model, p.preset, p.retry_count,
                           p.timeout_sec, p.tool_perms, p.datasource, p.project_root,
                           p.skip_permissions, p.auto_run, p.status,
                           COUNT(t.id) as total,
                           SUM(CASE WHEN t.status='done' THEN 1 ELSE 0 END) as done,
                           SUM(CASE WHEN t.status='running' THEN 1 ELSE 0 END) as running,
                           SUM(CASE WHEN t.status='error' THEN 1 ELSE 0 END) as error,
                           p.session_name, p.claude_session_id,
                           (SELECT r.git_proj_branch FROM task_runs r
                            WHERE r.project_id=p.id AND r.git_proj_branch != ''
                            ORDER BY r.id DESC LIMIT 1) as git_proj_branch,
                           p.preview_url, p.engine, p.shared
                    FROM projects p LEFT JOIN project_tasks t ON t.project_id=p.id
                    GROUP BY p.id ORDER BY p.id
                """).fetchall()
                result = []
                for r in rows:
                    ch_rows = conn.execute(
                        "SELECT channel_id FROM project_channel_links WHERE project_id=?", (r[0],)
                    ).fetchall()
                    ps = project_states.get(r[0], {})
                    _proot = r[9] or ""
                    _claude_md_path = os.path.join(_proot, "CLAUDE.md") if _proot else ""
                    # run 기반 브랜치가 없거나 깨진 브랜치명인 경우 git 에서 직접 파생
                    _db_branch = r[19]
                    if not _db_branch or _is_broken_branch(_db_branch):
                        _proj_branch = _project_git_branch_cached(r[0], _proot, r[1])
                    else:
                        _proj_branch = _db_branch
                    result.append({
                        "id": r[0], "name": r[1], "description": r[2],
                        "model": r[3], "preset": r[4], "retry_count": r[5],
                        "timeout_sec": r[6], "tool_perms": json.loads(r[7] or "[]"),
                        "datasource": r[8], "project_root": _proot,
                        "skip_permissions": bool(r[10]), "auto_run": bool(r[11]),
                        "status": ps.get("status") or r[12],
                        "stats": {"total": r[13] or 0, "done": r[14] or 0, "running": r[15] or 0, "error": r[16] or 0},
                        "channel_ids": [c[0] for c in ch_rows],
                        "session_name": r[17] or "",
                        "claude_session_id": r[18] or "",
                        "git_proj_branch": _proj_branch,
                        "preview_url": r[20] or "",
                        "engine": r[21] or "claude",
                        "shared": bool(r[22]),
                        "has_claude_md": bool(_claude_md_path and os.path.isfile(_claude_md_path)),
                    })
            self.send_json(result)

        elif path.startswith("/api/projects/") and path.endswith("/tasks") and path.count("/") == 4:
            try:
                pid = int(path.split("/")[3])
            except (IndexError, ValueError):
                self.send_response(400); self.end_headers(); return
            self.send_json(_tasks_payload(pid))

        elif path.startswith("/api/projects/") and path.endswith("/folders") and path.count("/") == 4:
            try:
                pid = int(path.split("/")[3])
            except (IndexError, ValueError):
                self.send_response(400); self.end_headers(); return
            self.send_json(_folders_payload(pid))

        elif path.startswith("/api/projects/") and path.endswith("/webdoc") and path.count("/") == 4:
            try:
                pid = int(path.split("/")[3])
            except (IndexError, ValueError):
                self.send_response(400); self.end_headers(); return
            self.send_json(_webdoc_load(pid))

        elif path.startswith("/api/projects/") and path.endswith("/gate/requests"):
            try:
                pid = int(path.split("/")[3])
            except (IndexError, ValueError):
                self.send_json({"ok": False}, 400); return
            info = _gate_sync_info(pid)
            if not info:
                self.send_json([]); return
            try:
                r = _gate_http_get_json(
                    f"{info['url']}/api/projects/{info['gpid']}/requests", info["token"])
            except Exception:
                r = []
            self.send_json(r)

        elif path.startswith("/api/projects/") and path.endswith("/gate/info"):
            try:
                pid = int(path.split("/")[3])
            except (IndexError, ValueError):
                self.send_json({"ok": False}, 400); return
            with sqlite3.connect(PROJECTS_DB) as conn:
                row = conn.execute(
                    "SELECT gate_url, gate_project_id, gate_role, gate_user, sync_enabled"
                    " FROM projects WHERE id=?", (pid,)).fetchone()
            if not row:
                self.send_json({"ok": False}, 404); return
            self.send_json({"ok": True, "gate_url": row[0], "gate_project_id": row[1],
                            "gate_role": row[2], "gate_user": row[3],
                            "sync_enabled": bool(row[4])})

        elif path.startswith("/api/projects/") and path.endswith("/claude-sessions"):
            try:
                pid = int(path.split("/")[3])
            except (IndexError, ValueError):
                self.send_json([]); return
            with sqlite3.connect(PROJECTS_DB) as conn:
                prow = conn.execute("SELECT project_root FROM projects WHERE id=?", (pid,)).fetchone()
            if not prow or not prow[0]:
                self.send_json([]); return
            dir_name = _claude_proj_dir_name(prow[0])
            claude_dir = Path.home() / ".claude" / "projects" / dir_name
            sessions = []
            if claude_dir.exists():
                for f in sorted(claude_dir.glob("*.jsonl"), key=lambda x: x.stat().st_mtime, reverse=True):
                    info = _parse_claude_session(f)
                    if info:
                        sessions.append(info)
            self.send_json(sessions)

        elif path.startswith("/api/projects/") and path.endswith("/claude-session-detail"):
            try:
                pid = int(path.split("/")[3])
            except (IndexError, ValueError):
                self.send_json({"ok": False, "error": "bad id"}); return
            fname = qs.get("file", [""])[0].strip()
            if not fname or "/" in fname or "\\" in fname or not fname.endswith(".jsonl"):
                self.send_json({"ok": False, "error": "bad file"}); return
            with sqlite3.connect(PROJECTS_DB) as conn:
                prow = conn.execute("SELECT project_root FROM projects WHERE id=?", (pid,)).fetchone()
            if not prow or not prow[0]:
                self.send_json({"ok": False, "error": "no project_root"}); return
            dir_name = _claude_proj_dir_name(prow[0])
            sess_file = Path.home() / ".claude" / "projects" / dir_name / fname
            if not sess_file.is_file():
                self.send_json({"ok": False, "error": "not found"}); return
            detail = _parse_claude_session_detail(sess_file)
            if not detail:
                self.send_json({"ok": False, "error": "parse failed"}); return
            detail["ok"] = True
            self.send_json(detail)

        elif path.startswith("/api/projects/") and path.endswith("/antigravity-sessions"):
            try:
                pid = int(path.split("/")[3])
            except (IndexError, ValueError):
                self.send_json([]); return
            with sqlite3.connect(PROJECTS_DB) as conn:
                prow = conn.execute("SELECT project_root FROM projects WHERE id=?", (pid,)).fetchone()
            if not prow or not prow[0]:
                self.send_json([]); return
            self.send_json(_ag_list_sessions(prow[0]))

        elif path.startswith("/api/projects/") and path.endswith("/antigravity-session-detail"):
            try:
                pid = int(path.split("/")[3])
            except (IndexError, ValueError):
                self.send_json({"ok": False, "error": "bad id"}); return
            conv = qs.get("conv", [""])[0].strip()
            if not conv or "/" in conv or "\\" in conv or ".." in conv:
                self.send_json({"ok": False, "error": "bad conv"}); return
            with sqlite3.connect(PROJECTS_DB) as conn:
                prow = conn.execute("SELECT project_root FROM projects WHERE id=?", (pid,)).fetchone()
            self.send_json(_ag_session_detail(prow[0] if prow else "", conv))

        elif path.startswith("/api/projects/") and path.endswith("/claude-md"):
            try:
                pid = int(path.split("/")[3])
            except (IndexError, ValueError):
                self.send_json({"ok": False, "error": "bad id"}); return
            with sqlite3.connect(PROJECTS_DB) as conn:
                prow = conn.execute("SELECT project_root FROM projects WHERE id=?", (pid,)).fetchone()
            if not prow or not prow[0]:
                self.send_json({"ok": False, "error": "no project_root"}); return
            claude_md = os.path.join(prow[0], "CLAUDE.md")
            if not os.path.isfile(claude_md):
                self.send_json({"ok": False, "error": "CLAUDE.md not found"}); return
            try:
                with open(claude_md, "r", encoding="utf-8", errors="replace") as f:
                    content = f.read()
                self.send_json({"ok": True, "content": content, "path": claude_md})
            except Exception as e:
                self.send_json({"ok": False, "error": str(e)})

        elif path.startswith("/api/projects/") and path.endswith("/claude-detail/download"):
            try:
                pid = int(path.split("/")[3])
            except (IndexError, ValueError):
                self.send_json({"ok": False, "error": "bad id"}); return
            part = (qs.get("part") or ["all"])[0]
            with sqlite3.connect(PROJECTS_DB) as conn:
                prow = conn.execute("SELECT project_root, name FROM projects WHERE id=?", (pid,)).fetchone()
            if not prow or not prow[0]:
                self.send_json({"ok": False, "error": "no_project_root"}); return
            root = os.path.abspath(os.path.expanduser(prow[0]))
            slug = _slugify(prow[1] or "project")
            base = Path(root)
            dot = base / ".claude"
            import zipfile as _zipfile

            def _send_download(data: bytes, filename: str, ctype: str):
                self.send_response(200)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def _zip_add_dir(zf, dirpath: Path, arcprefix: str):
                for p in sorted(dirpath.rglob("*")):
                    if p.is_file():
                        arc = arcprefix + "/" + str(p.relative_to(dirpath)).replace("\\", "/")
                        zf.write(p, arc)

            try:
                if part == "claude_md":
                    f = base / "CLAUDE.md"
                    if not f.is_file():
                        self.send_json({"ok": False, "error": "CLAUDE.md 없음"}); return
                    _send_download(f.read_bytes(), f"{slug}-CLAUDE.md", "text/markdown; charset=utf-8")
                elif part == "settings_local":
                    f = dot / "settings.local.json"
                    if not f.is_file():
                        self.send_json({"ok": False, "error": "settings.local.json 없음"}); return
                    _send_download(f.read_bytes(), f"{slug}-settings.local.json", "application/json; charset=utf-8")
                elif part == "claude_json":
                    entry = _claude_json_project_entry(root)
                    if not entry:
                        self.send_json({"ok": False, "error": "~/.claude.json 에 프로젝트 엔트리 없음"}); return
                    data = json.dumps(entry, ensure_ascii=False, indent=2).encode("utf-8")
                    _send_download(data, f"{slug}-claude-json-entry.json", "application/json; charset=utf-8")
                elif part in ("agents", "skills", "commands", "hooks"):
                    d = dot / part
                    if not d.is_dir() or not any(p.is_file() for p in d.rglob("*")):
                        self.send_json({"ok": False, "error": f".claude/{part} 비어있음"}); return
                    buf = io.BytesIO()
                    with _zipfile.ZipFile(buf, "w", _zipfile.ZIP_DEFLATED) as zf:
                        _zip_add_dir(zf, d, part)
                    _send_download(buf.getvalue(), f"{slug}-claude-{part}.zip", "application/zip")
                else:   # all — 전체 zip
                    buf = io.BytesIO()
                    with _zipfile.ZipFile(buf, "w", _zipfile.ZIP_DEFLATED) as zf:
                        f = base / "CLAUDE.md"
                        if f.is_file():
                            zf.write(f, "CLAUDE.md")
                        for sub in ("agents", "skills", "commands", "hooks"):
                            d = dot / sub
                            if d.is_dir():
                                _zip_add_dir(zf, d, f".claude/{sub}")
                        sl = dot / "settings.local.json"
                        if sl.is_file():
                            zf.write(sl, ".claude/settings.local.json")
                        entry = _claude_json_project_entry(root)
                        if entry:
                            zf.writestr("claude-json-entry.json",
                                        json.dumps(entry, ensure_ascii=False, indent=2))
                    _send_download(buf.getvalue(), f"{slug}-claude-config.zip", "application/zip")
            except Exception as e:
                self.send_json({"ok": False, "error": str(e)})

        elif path.startswith("/api/projects/") and path.endswith("/claude-detail"):
            try:
                pid = int(path.split("/")[3])
            except (IndexError, ValueError):
                self.send_json({"ok": False, "error": "bad id"}); return
            with sqlite3.connect(PROJECTS_DB) as conn:
                prow = conn.execute("SELECT project_root, name FROM projects WHERE id=?", (pid,)).fetchone()
            if not prow:
                self.send_json({"ok": False, "error": "project not found"}); return
            if not prow[0]:
                self.send_json({"ok": False, "error": "no_project_root",
                                "name": prow[1] if len(prow) > 1 else ""}); return
            abs_path = os.path.abspath(os.path.expanduser(prow[0]))
            self.send_json({
                "ok": True,
                "name": prow[1],
                "cwd": abs_path,
                "repo": _scan_repo_claude_detail(abs_path),
                "claude_json_entry": _claude_json_project_entry(abs_path),
            })

        elif path.startswith("/api/projects/") and path.endswith("/git-info"):
            try:
                pid = int(path.split("/")[3])
            except (IndexError, ValueError):
                self.send_json({"ok": False, "has_git": False}); return
            with sqlite3.connect(PROJECTS_DB) as conn:
                prow = conn.execute("SELECT project_root, name FROM projects WHERE id=?", (pid,)).fetchone()
            if not prow:
                self.send_json({"ok": False, "has_git": False}); return
            project_root, _pname = prow
            has_git = False
            proj_branch = ''
            default_branch = 'main'
            branches = []
            if project_root and os.path.isdir(project_root):
                git_root = _git_root(project_root) or project_root
                if _git_ok(git_root):
                    has_git = True
                    default_branch = _git_default_branch(git_root)
                    cfg_out = _git_out('git', '-C', git_root, 'config', '--list', timeout=5)
                    slug = None
                    for _line in cfg_out.split('\n'):
                        if _line.startswith('ep4.project-') and '=' in _line:
                            _k, _v = _line.split('=', 1)
                            if _v.strip() == str(pid):
                                slug = _k[len('ep4.project-'):]
                                break
                    if slug:
                        proj_branch = f'project/{slug}/main'
                    br_out = _git_out('git', '-C', git_root, 'branch', '--format=%(refname:short)', timeout=5)
                    branches = [b.strip() for b in br_out.split('\n') if b.strip() and not b.strip().startswith('project/')]
            self.send_json({"ok": True, "has_git": has_git, "proj_branch": proj_branch,
                            "default_branch": default_branch, "branches": branches})

        elif path.startswith("/api/projects/"):
            parts = path.split("/")
            if len(parts) == 4:
                try:
                    pid = int(parts[3])
                except ValueError:
                    self.send_response(404); self.end_headers(); return
                with sqlite3.connect(PROJECTS_DB) as conn:
                    r = conn.execute("SELECT * FROM projects WHERE id=?", (pid,)).fetchone()
                    if not r:
                        self.send_response(404); self.end_headers(); return
                    ch_rows = conn.execute("SELECT channel_id FROM project_channel_links WHERE project_id=?", (pid,)).fetchall()
                ps = project_states.get(pid, {})
                self.send_json({
                    "id": r[0], "name": r[1], "description": r[2], "model": r[3],
                    "preset": r[4], "retry_count": r[5], "timeout_sec": r[6],
                    "tool_perms": json.loads(r[7] or "[]"), "datasource": r[8],
                    "project_root": r[9], "skip_permissions": bool(r[10]),
                    "auto_run": bool(r[11]), "status": ps.get("status") or r[12],
                    "channel_ids": [c[0] for c in ch_rows],
                })
            else:
                self.send_response(404); self.end_headers()

        # ── 외부용 프로젝트 목록: GET /api/project ──
        elif path == "/api/project":
            _list = _project_brief_list()
            self.send_json({"ok": True, "count": len(_list), "projects": _list})

        # ── 외부용 프로젝트 상세: GET /api/project/{id} (태스크 id·제목·상태 포함) ──
        elif path.startswith("/api/project/"):
            _pid_raw = path[len("/api/project/"):].strip("/")
            try:
                _pid = int(_pid_raw)
            except ValueError:
                self.send_json({"ok": False, "error": f"invalid project id: {_pid_raw}"}, 400); return
            _info = _project_detail(_pid)
            if not _info:
                self.send_json({"ok": False, "error": f"project not found: {_pid}"}, 404); return
            self.send_json(_info)

        # ── 외부용 태스크 상태 조회: GET /api/task/{id} (?full=1 이면 output 전체) ──
        elif path.startswith("/api/task/"):
            _tid_raw = path[len("/api/task/"):].strip("/")
            try:
                _tid = int(_tid_raw)
            except ValueError:
                self.send_json({"ok": False, "error": f"invalid task id: {_tid_raw}"}, 400); return
            _full = qs.get("full", ["0"])[0] in ("1", "true", "yes")
            _info = _task_status(_tid, full_output=_full)
            if not _info:
                self.send_json({"ok": False, "error": f"task not found: {_tid}"}, 404); return
            self.send_json(_info)

        elif path == "/api/tasks":
            with state_lock:
                self.send_json(state["tasks"])

        elif path == "/api/state":
            with state_lock:
                self.send_json({"status": state["status"], "current": state["current"]})

        elif path == "/api/ping":
            self.send_json({"ok": True, "started_at": SERVER_START_TIME, "host": _ep4_host_label()})

        elif path == "/api/shared-projects":
            # 이 EP4 가 공유하는 프로젝트 목록 (다른 EP4 가 가져감)
            self.send_json(_shared_projects_payload())

        elif path == "/api/peers":
            self.send_json({"ok": True, "peers": _list_peers(), "host": _ep4_host_label()})

        elif path == "/api/remote-projects":
            # 연결된 peer 들의 공유 프로젝트 집계
            _rp = _remote_projects()
            self.send_json({"ok": True, "projects": _rp["projects"], "errors": _rp["errors"]})

        elif path == "/api/peer-proxy":
            _purl = qs.get("url", [""])[0]
            _ppath = qs.get("path", [""])[0]
            _peer_proxy_passthrough(self, "GET", _purl, _ppath)

        elif path == "/api/config/manager":
            self.send_json({
                "url": _MANAGER.get("url", ""),
                "token": _MANAGER.get("token", ""),
                "configured": bool(_MANAGER.get("url")),
            })

        elif path == "/api/cli-status":
            self.send_json(get_cli_status())

        elif path == "/api/antigravity-status":
            self.send_json(get_antigravity_status())

        elif path == "/api/runs" or path.startswith("/api/runs?"):
            pid_f     = qs.get('project_id', [None])[0]
            stat_f    = qs.get('status', [None])[0]
            date_f    = qs.get('date', [None])[0]
            trace_f   = qs.get('trace_id', [None])[0]
            task_f    = qs.get('task_id', [None])[0]
            query = "SELECT id,task_id,project_id,task_title,project_name,status,trigger_type,model,started_at,ended_at,trace_id,span_id,parent_span_id FROM task_runs"
            params, conds = [], []
            if pid_f:
                conds.append("project_id=?"); params.append(int(pid_f))
            if stat_f:
                conds.append("status=?"); params.append(stat_f)
            if date_f == 'today':
                today = datetime.now().strftime('%Y-%m-%d')
                conds.append("started_at LIKE ?"); params.append(today + '%')
            if trace_f:
                conds.append("trace_id=?"); params.append(trace_f)
            if task_f:
                conds.append("task_id=?"); params.append(int(task_f))
            if conds:
                query += " WHERE " + " AND ".join(conds)
            query += " ORDER BY id DESC LIMIT 300"
            with sqlite3.connect(PROJECTS_DB) as conn:
                rows = conn.execute(query, params).fetchall()
            result = []
            for r in rows:
                dur = None
                if r[8] and r[9]:
                    try:
                        dur = int((datetime.fromisoformat(r[9]) - datetime.fromisoformat(r[8])).total_seconds())
                    except Exception:
                        pass
                result.append({"id":r[0],"task_id":r[1],"project_id":r[2],"task_title":r[3],"project_name":r[4],"status":r[5],"trigger_type":r[6],"model":r[7],"started_at":r[8],"ended_at":r[9],"duration_sec":dur,"trace_id":r[10],"span_id":r[11],"parent_span_id":r[12]})
            self.send_json(result)

        elif path.startswith("/api/runs/") and path.endswith("/git-patch"):
            try:
                rid = int(path.split("/")[3])
            except (IndexError, ValueError):
                self.send_json({"ok": False}); return
            with sqlite3.connect(PROJECTS_DB) as conn:
                rr = conn.execute(
                    "SELECT project_id, git_commits_json, git_task_branch, git_proj_branch FROM task_runs WHERE id=?",
                    (rid,)
                ).fetchone()
            if not rr:
                self.send_json({"ok": False, "msg": "run ?놁쓬"}); return
            _rpid, _gc_json, _gt_branch, _gp_branch = rr
            with sqlite3.connect(PROJECTS_DB) as conn:
                _prow = conn.execute("SELECT project_root FROM projects WHERE id=?", (_rpid,)).fetchone()
            if not _prow or not _prow[0] or not os.path.isdir(_prow[0]):
                self.send_json({"ok": False, "msg": "project_root ?놁쓬"}); return
            _gr = _git_root(_prow[0]) or _prow[0]
            if not _git_ok(_gr):
                self.send_json({"ok": False, "msg": "git repo ?놁쓬"}); return
            try: _commits = json.loads(_gc_json or '[]')
            except Exception: _commits = []
            _patches = []
            for _c in _commits:
                _h = (_c.get('hash') or '').strip()
                if _h and len(_h) >= 6:
                    _p = _git_out('git', '-C', _gr, 'show', '--patch', '--no-color', _h, timeout=15)
                    if _p: _patches.append(_p)
            if not _patches and _gt_branch and _gp_branch:
                _p = _git_out('git', '-C', _gr, 'diff', '--no-color',
                              f'{_gp_branch}...{_gt_branch}', timeout=15)
                if _p: _patches.append(_p)
            self.send_json({"ok": True, "patch": '\n\n'.join(_patches)})

        elif path.startswith("/api/runs/") and path.endswith("/screenshot"):
            try:
                rid = int(path.split("/")[3])
            except (IndexError, ValueError):
                self.send_response(404); self.end_headers(); return
            with sqlite3.connect(PROJECTS_DB) as conn:
                rr = conn.execute("SELECT screenshot_path FROM task_runs WHERE id=?", (rid,)).fetchone()
            sp = (rr[0] if rr else '') or ''
            if not sp or ".." in sp or "/" in sp or "\\" in sp:
                self.send_response(404); self.end_headers(); return
            target = (SCREENSHOTS_DIR / sp).resolve()
            try:
                target.relative_to(SCREENSHOTS_DIR.resolve())
            except ValueError:
                self.send_response(404); self.end_headers(); return
            if not target.exists():
                self.send_response(404); self.end_headers(); return
            _serve_file(self, target, "image/png")

        elif path.startswith("/api/runs/trace/"):
            parts = path.split("/")
            if len(parts) < 5 or not parts[4]:
                self.send_response(400); self.end_headers(); return
            trace_id_q = parts[4]
            with sqlite3.connect(PROJECTS_DB) as conn:
                rows = conn.execute(
                    "SELECT id,task_id,project_id,task_title,project_name,status,trigger_type,model,span_id,parent_span_id,started_at,ended_at FROM task_runs WHERE trace_id=? ORDER BY id ASC",
                    (trace_id_q,)
                ).fetchall()
            result = []
            for r in rows:
                dur = None
                if r[10] and r[11]:
                    try:
                        dur = int((datetime.fromisoformat(r[11]) - datetime.fromisoformat(r[10])).total_seconds())
                    except Exception:
                        pass
                result.append({"id":r[0],"task_id":r[1],"project_id":r[2],"task_title":r[3],"project_name":r[4],"status":r[5],"trigger_type":r[6],"model":r[7],"span_id":r[8],"parent_span_id":r[9],"started_at":r[10],"ended_at":r[11],"duration_sec":dur,"trace_id":trace_id_q})
            self.send_json(result)

        elif path.startswith("/api/runs/"):
            try:
                rid = int(path.split("/")[3])
            except (IndexError, ValueError):
                self.send_response(404); self.end_headers(); return
            with sqlite3.connect(PROJECTS_DB) as conn:
                r = conn.execute(
                    "SELECT id,task_id,project_id,task_title,project_name,status,trigger_type,model,prompt,output,log_lines,started_at,ended_at,trace_id,span_id,parent_span_id,git_task_branch,git_proj_branch,git_merge_status,git_diff_json,git_commits_json,git_pr_url,claude_session_id,claude_session_json,screenshot_path,preview_url FROM task_runs WHERE id=?",
                    (rid,)
                ).fetchone()
            if not r:
                self.send_response(404); self.end_headers(); return
            dur = None
            if r[11] and r[12]:
                try:
                    dur = int((datetime.fromisoformat(r[12]) - datetime.fromisoformat(r[11])).total_seconds())
                except Exception:
                    pass
            try: log_lines = json.loads(r[10] or '[]')
            except Exception: log_lines = []
            try: git_diff = json.loads(r[19] or '[]')
            except Exception: git_diff = []
            try: git_commits = json.loads(r[20] or '[]')
            except Exception: git_commits = []
            try: claude_session = json.loads(r[23]) if r[23] else None
            except Exception: claude_session = None
            # 폴백: 저장된 세션 JSON이 없으면 세션 ID로 jsonl을 찾아 라이브 파싱
            if not claude_session and r[22]:
                _sp = _find_claude_session_by_id(r[22])
                if _sp:
                    claude_session = _parse_claude_session_detail(_sp) or None
            _shot = f"/api/runs/{r[0]}/screenshot" if (len(r) > 24 and r[24]) else ""
            _preview_url = r[25] if len(r) > 25 else ""
            _gt_branch_raw = r[16] or ""
            _gp_branch_raw = r[17] or ""
            with sqlite3.connect(PROJECTS_DB) as conn:
                _prow = conn.execute("SELECT name, project_root FROM projects WHERE id=?", (r[2],)).fetchone()
            _pslug = _slugify(_prow[0]) if _prow else "project"
            # Antigravity 런: conv_id(claude_session_id)로 agy 세션 상세(입력+실행단계) 부착
            antigravity_session = None
            if r[6] == "antigravity_cli" and r[22]:
                try:
                    _proot = _prow[1] if _prow and len(_prow) > 1 else ""
                    # run 컨텍스트: 이 태스크의 프롬프트(r[8])에 해당하는 입력/턴만 표시
                    antigravity_session = _ag_session_detail(_proot, r[22], focus_prompt=r[8])
                except Exception:
                    antigravity_session = None
            _git_task_branch_cleaned = f"project/{_pslug}/task-cli-{r[1]}" if _is_broken_branch(_gt_branch_raw) else _gt_branch_raw
            _git_proj_branch_cleaned = "main" if _is_broken_branch(_gp_branch_raw) else _gp_branch_raw

            self.send_json({
                "id": r[0],
                "task_id": r[1],
                "project_id": r[2],
                "task_title": r[3],
                "project_name": r[4],
                "status": r[5],
                "trigger_type": r[6],
                "model": r[7],
                "prompt": r[8],
                "output": r[9],
                "log_lines": log_lines,
                "started_at": r[11],
                "ended_at": r[12],
                "duration_sec": dur,
                "trace_id": r[13],
                "span_id": r[14],
                "parent_span_id": r[15],
                "git_task_branch": _git_task_branch_cleaned,
                "git_proj_branch": _git_proj_branch_cleaned,
                "git_merge_status": r[18] or "no_git",
                "git_diff": git_diff,
                "git_commits": git_commits,
                "git_pr_url": r[21] or "",
                "claude_session_id": r[22] or "",
                "claude_session": claude_session,
                "antigravity_session": antigravity_session,
                "screenshot": _shot,
                "preview_url": _preview_url or ""
            })

        elif path == "/api/connections":
            # 접속 현황: 요청자 자신 + 수신 연결 기록 + 발신 peer 연결 기록
            ua = self.headers.get("User-Agent", "") or ""
            _conn_history_flush()   # 조회 시점에 last/count 를 히스토리에 반영
            with _seen_remote_ips_lock:
                inbound  = [dict(r) for r in _conn_seen.values()]
                outbound = [dict(r) for r in _peer_out_seen.values()]
            inbound.sort(key=lambda r: r.get("last", ""), reverse=True)
            outbound.sort(key=lambda r: r.get("last", ""), reverse=True)
            self.send_json({
                "ok": True,
                "host": _ep4_host_label(),
                "started_at": SERVER_START_TIME,
                "me": {"ip": self._client_ip(), "client": self._ua_family(ua)},
                "inbound": inbound,
                "outbound": outbound,
            })

        elif path == "/api/connections/history":
            # 접속 히스토리: 서버 재시작과 무관하게 보존된 과거 수·발신 기록.
            # 같은 대상(발신 URL / 수신 IP·호스트·클라이언트)의 회차들은 1줄로 합쳐
            # 기간(first~last)·누적 횟수·회차 수(sessions)로 표시한다.
            _conn_history_flush()
            try:
                limit = min(int((qs.get("limit") or ["100"])[0]), 500)
            except Exception:
                limit = 100
            with sqlite3.connect(PROJECTS_DB) as conn:
                rows = conn.execute(
                    "SELECT direction, kind, ip, via, hostname, local_ip, client, url, host,"
                    " ok, error, first_seen, last_seen, count"
                    " FROM connection_history ORDER BY last_seen DESC, id DESC LIMIT 2000"
                ).fetchall()
            merged: dict = {}
            order: list = []
            for r in rows:   # 최신 회차부터 순회 — 첫 등장 행이 최신 상태(ok/error 등)를 대표
                key = ("out", r[7]) if r[0] == "out" \
                    else ("in", r[2], r[4], r[5], r[6])
                g = merged.get(key)
                if g is None:
                    merged[key] = g = {
                        "direction": r[0], "kind": r[1], "ip": r[2], "via": r[3],
                        "hostname": r[4], "local_ip": r[5], "client": r[6], "url": r[7],
                        "host": r[8], "ok": bool(r[9]), "error": r[10],
                        "first": r[11], "last": r[12], "count": r[13] or 0,
                        "sessions": 1}
                    order.append(g)
                else:
                    g["count"] += r[13] or 0
                    g["sessions"] += 1
                    if (r[11] or "") and (not g["first"] or r[11] < g["first"]):
                        g["first"] = r[11]
                    if not g["host"] and r[8]:
                        g["host"] = r[8]
            self.send_json({"ok": True, "history": order[:limit]})

        elif path == "/api/channels":
            with sqlite3.connect(CHANNELS_DB) as conn:
                rows = conn.execute(
                    "SELECT id, type, name, webhook_url, server_name, active, tested, is_default FROM notification_channels ORDER BY id"
                ).fetchall()
            _eff = _default_channel_ids()   # 실효 기본 채널 (1개면 그 채널, 아니면 지정/첫 채널)
            _eff_id = _eff[0] if _eff else None
            self.send_json([
                {"id": r[0], "type": r[1], "name": r[2], "webhook_url": r[3], "server_name": r[4],
                 "active": bool(r[5]), "tested": bool(r[6]), "is_default": bool(r[7]),
                 "effective_default": r[0] == _eff_id}
                for r in rows
            ])

        elif path == "/api/chat/history":
            with sqlite3.connect(CHAT_DB) as conn:
                rows = conn.execute(
                    "SELECT role, text FROM chat_messages ORDER BY id"
                ).fetchall()
            self.send_json([{"role": r[0], "text": r[1]} for r in rows])

        elif path == "/api/sessions":
            self.send_json(sessions_list())

        elif path.startswith("/api/sessions/") and path.endswith("/output"):
            parts = path.split("/")
            if len(parts) == 5:
                sid = parts[3]
                with _sessions_lock:
                    sess = _sessions.get(sid)
                    if sess:
                        out = {"entries": list(sess["output"]),
                               "screen_html": sess.get("screen_html", "")}
                    else:
                        out = {"entries": [], "screen_html": ""}
                self.send_json(out)
            else:
                self.send_response(404); self.end_headers()

        elif path == "/api/events":
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("X-Accel-Buffering", "no")
            self.end_headers()
            client_q: queue.Queue = queue.Queue(maxsize=5000)
            with sse_lock:
                sse_clients.append(client_q)
            try:
                with state_lock:
                    s = state["status"]
                self._sse_write("status", {"status": s})
                while True:
                    try:
                        ev = client_q.get(timeout=20)
                        self._sse_write(ev["event"], ev["data"])
                    except queue.Empty:
                        self._sse_write("ping", {})
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass
            finally:
                with sse_lock:
                    try:
                        sse_clients.remove(client_q)
                    except ValueError:
                        pass

        else:
            # 플러그인이 등록한 백엔드 라우트(GET) 디스패치
            handled, code, payload = dispatch_route(
                EP4_PM, "GET", path,
                {"method": "GET", "path": path, "query": qs, "body": {},
                 "headers": dict(self.headers)})
            if handled:
                self.send_json(payload, code)
            else:
                self.send_response(404)
                self.end_headers()

    def _sse_write(self, event: str, data: dict):
        msg = f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
        self.wfile.write(msg.encode())
        self.wfile.flush()

    def _handle_peer_handshake(self, body: dict):
        """POST /api/peers/handshake — 상대 EP4 가 자신의 접속 정보(토큰 포함)를
        알려오는 핸드셰이크. 어느 한쪽이라도 상대 토큰으로 인증에 성공한 관계라면
        양쪽 모두 인증이 완료된 것으로 취급한다:
          · 내 토큰으로 인증된 요청 → 역방향 peer 로 자동 등록
          · 미인증 요청이라도 내가 등록해 둔(enabled) peer 의 토큰을 제시하면
            같은 신뢰 관계로 보고 수락
        응답에 내 토큰을 실어 보내므로, 토큰이 없던 쪽도 이를 저장해
        양방향 프로젝트 조회가 열린다."""
        r_token = (body.get("token") or "").strip()
        if not self._token_matches():
            # 미인증 핸드셰이크 — 발신자가 등록된 peer 의 토큰을 알고 있으면
            # (= 그 peer 본인) 이미 맺어진 신뢰 관계로 보고 수락한다.
            trusted = False
            if r_token:
                with sqlite3.connect(PROJECTS_DB) as conn:
                    rows = conn.execute(
                        "SELECT token FROM ep4_peers WHERE enabled=1 AND token<>''"
                    ).fetchall()
                trusted = any(secrets.compare_digest(r_token, t or "") for (t,) in rows)
            if not trusted:
                self.send_json({"ok": False, "error": "unauthorized"}, 401)
                return
        r_url, err = _register_peer_payload(body, self._client_ip())
        if err:
            self.send_json({"ok": False, "error": err}); return
        if not r_url:
            # 내 토큰과 동일 = 자기 자신(순환 등록 방지)
            self.send_json({"ok": True, "self": True})
            return
        _peer_out_recheck(r_url)   # 시작 시 발신 실패였던 peer 가 살아났는지 재확인
        self.send_json({"ok": True, "url": r_url, "token": _AUTH_TOKEN or ""})

    def do_POST(self):
        path = urlparse(self.path).path
        length = int(self.headers.get("Content-Length", 0))
        try:
            body = json.loads(self.rfile.read(length)) if length else {}
        except (ValueError, UnicodeDecodeError):
            # 잘못된/비-UTF8 본문 — 스레드 크래시 대신 400 응답
            self.send_json({"ok": False, "error": "invalid request body"}, 400)
            return
        if path == "/api/peers/handshake":
            # 인증 게이트보다 먼저 처리 — 내 토큰이 없는 상대라도 '등록된 peer 의
            # 토큰 제시'로 신원을 증명할 수 있다 (핸들러 내부에서 검증).
            self._handle_peer_handshake(body)
            return

        if not self._auth_ok():
            return

        if path == "/api/peer-proxy":
            _pq = parse_qs(urlparse(self.path).query)
            _purl = _pq.get("url", [""])[0]
            _ppath = _pq.get("path", [""])[0]
            _peer_proxy_passthrough(self, "POST", _purl, _ppath,
                                    json.dumps(body, ensure_ascii=False).encode("utf-8"))
            return

        if path == "/api/peers/projects-push":
            # 상대 EP4 가 (내 토큰으로 인증 후) 자기 프로젝트 목록을 밀어 넣는다.
            # 상대가 NAT/방화벽 뒤라 내가 직접 접속할 수 없어도 표시가 가능해진다.
            r_url, err = _register_peer_payload(body, self._client_ip())
            if err:
                self.send_json({"ok": False, "error": err}); return
            ops = []
            if r_url:
                _peer_out_recheck(r_url)   # 시작 시 발신 실패였던 peer 가 살아났는지 재확인
                _prev = _peer_pushed_projects.get(r_url) or {}
                _peer_pushed_projects[r_url] = {
                    "ts": time.time(),
                    "host": (body.get("host") or "").strip(),
                    "projects": body.get("projects") or [],
                    "tasks": body.get("tasks") or {},
                    "folders": body.get("folders") or {},
                    "sessions": body.get("sessions") or [],
                    "claude_md": body.get("claude_md") or []}
                # 내가 도달할 수 없는 이 peer 에게, 대신 받아 둔 변경 op 를 전달
                with _peer_pending_lock:
                    ops = _peer_pending_ops.pop(r_url, [])
                # 방금 덮어쓴 캐시는 op 실행 전 상태 — 추가/삭제 op 를 재적용해
                # 상대가 실행을 마치고 다시 push 할 때까지 목록이 되돌아 보이지 않게 한다
                for _op in ops:
                    _peer_cache_apply_op(
                        r_url, str(_op.get("path") or "").split("?")[0],
                        _op.get("body") or {})
                # push 내용이 이전과 달라진 프로젝트는 SSE 로 알림 — 상대 쪽에서
                # 실행된 태스크 추가/삭제/출력 변화가 화면에 자동 반영된다
                _new = _peer_pushed_projects[r_url]
                _changed = set()
                for _k in ("tasks", "folders"):
                    _om, _nm = _prev.get(_k) or {}, _new.get(_k) or {}
                    for _pid in set(_om) | set(_nm):
                        if _om.get(_pid) != _nm.get(_pid):
                            _changed.add(_pid)
                for _pid in _changed:
                    if str(_pid).lstrip("-").isdigit():
                        emit("tasks_changed",
                             {"project_id": int(_pid), "peer_url": r_url})
            self.send_json({"ok": True, "self": not r_url, "pending_ops": ops})
            return

        if path == "/api/peers/test":
            url = (body.get("url") or "").strip().rstrip("/")
            if not url:
                self.send_json({"ok": False, "error": "url required"}); return
            try:
                _ttok = (body.get("token") or "").strip() or _peer_token(url)
                d = _http_get_json(f"{url}/api/ping", timeout=6, token=_ttok)
                _log_peer_out(url, d.get("host", ""))
                self.send_json({"ok": True, "host": d.get("host", url)})
            except Exception as e:
                self.send_json({"ok": False, "error": str(e)})
            return

        if path == "/api/peers":
            url = (body.get("url") or "").strip().rstrip("/")
            name = (body.get("name") or "").strip()
            token = (body.get("token") or "").strip()
            if not url or not (url.startswith("http://") or url.startswith("https://")):
                self.send_json({"ok": False, "error": "유효한 http(s) URL 이 필요합니다."}); return
            try:
                with sqlite3.connect(PROJECTS_DB) as conn:
                    # 토큰 입력 없이 재저장해도 기존 저장 토큰은 보존한다
                    conn.execute(
                        "INSERT INTO ep4_peers (url, name, enabled, token) VALUES (?,?,1,?) "
                        "ON CONFLICT(url) DO UPDATE SET name=excluded.name, "
                        "token=CASE WHEN excluded.token='' THEN token ELSE excluded.token END",
                        (url, name, token))
                    conn.commit()
                _sync_peer_relays()   # 새 peer 이벤트 릴레이 기동
                self.send_json({"ok": True, "peers": _list_peers()})
            except Exception as e:
                self.send_json({"ok": False, "error": str(e)})
            return

        if path.startswith("/api/plugins/") and path.endswith("/toggle"):
            pid = path.split("/")[3]
            enabled = bool(body.get("enabled", True))
            ok = _set_plugin_enabled(pid, enabled)
            if ok:
                invalidate_route_cache()  # 라우트 캐시 무효화: 토글된 플러그인 라우트 즉시 반영
                emit("plugins_changed", {"id": pid, "enabled": enabled})
                try:
                    EP4_PM.hook.ep4_on_plugin_toggle(plugin_id=pid, enabled=enabled)
                except Exception as _he:
                    print(f"[plugins] on_plugin_toggle 훅 오류: {_he}")
            self.send_json({"ok": ok, "plugins": _get_plugins()})
            return

        if path == "/api/marketplace/config":
            conf = _read_marketplace_conf()
            new_conf = {
                "source":      (body.get("source")      or conf.get("source",      "manager")).strip(),
                "firebase_url":(body.get("firebase_url")or conf.get("firebase_url","")).strip(),
                "github_repo": (body.get("github_repo") or conf.get("github_repo", "")).strip(),
                "manager_url": (body.get("manager_url") or conf.get("manager_url", "")).strip(),
            }
            token = (body.get("github_token") or "").strip()
            if token:
                new_conf["github_token"] = token
            elif conf.get("github_token"):
                new_conf["github_token"] = conf["github_token"]
            _write_marketplace_conf(new_conf)
            self.send_json({"ok": True})
            return

        if path == "/api/settings":
            key = (body.get("key") or "").strip()
            value = str(body.get("value") or "")
            if not key:
                self.send_json({"ok": False, "error": "key ?꾩슂"}); return
            _set_setting(key, value)
            self.send_json({"ok": True, "key": key, "value": value})
            return

        if path == "/api/plugins/install":
            import urllib.request as _ur2
            source = (body.get("source") or "manager").strip()
            plugin_id = (body.get("id") or "").strip()

            if source == "firebase+github":
                _mc = _read_marketplace_conf()
                firebase_url  = (body.get("firebase_url")  or _mc.get("firebase_url",  "") or _get_setting("marketplace_firebase_url")  or "").strip()
                github_repo   = (body.get("github_repo")   or _mc.get("github_repo",   "") or _get_setting("marketplace_github_repo")   or "").strip()
                github_token  = (body.get("github_token")  or _mc.get("github_token",  "") or _get_setting("marketplace_github_token")  or "").strip()
                if not firebase_url or not github_repo or not plugin_id:
                    self.send_json({"ok": False, "error": "firebase_url, github_repo, id ?꾩슂"}); return
                try:
                    meta = _marketplace_fetch_firebase_plugin(firebase_url, plugin_id)
                    if not meta.get("ok"):
                        self.send_json({"ok": False, "error": "플러그인 없음"}); return
                    github_path = (meta.get("github_path") or f"plugins/{plugin_id}").strip("/")
                    gh = _install_from_github(github_repo, github_path, github_token)
                    manifest, files = gh["manifest"], gh["files"]
                    plugin_dir = INSTALLED_PLUGINS_DIR / plugin_id
                    plugin_dir.mkdir(parents=True, exist_ok=True)
                    (plugin_dir / "plugin.json").write_text(
                        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
                    for fname, content in files.items():
                        if ".." in fname or fname == "plugin.json":
                            continue
                        (plugin_dir / fname).write_text(content, encoding="utf-8")
                    _marketplace_increment_download_firebase(firebase_url, plugin_id)
                    emit("plugins_changed", {"installed": plugin_id})
                    self.send_json({"ok": True, "id": plugin_id})
                except Exception as e:
                    self.send_json({"ok": False, "error": str(e)})
                return

            # 기존 manager_server 방식
            manager_url = (body.get("manager_url") or _get_setting("marketplace_url") or "").strip()
            if not manager_url or not plugin_id:
                self.send_json({"ok": False, "error": "manager_url, id ?꾩슂"}); return
            try:
                data = _marketplace_fetch(manager_url, f"/{plugin_id}")
                if not data.get("ok"):
                    self.send_json({"ok": False, "error": "플러그인 없음"}); return
                manifest_raw = data.get("manifest_json") or "{}"
                files_raw = data.get("files_json") or "{}"
                manifest = json.loads(manifest_raw) if isinstance(manifest_raw, str) else manifest_raw
                files = json.loads(files_raw) if isinstance(files_raw, str) else files_raw
                plugin_dir = INSTALLED_PLUGINS_DIR / plugin_id
                plugin_dir.mkdir(parents=True, exist_ok=True)
                (plugin_dir / "plugin.json").write_text(
                    json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
                for fname, content in files.items():
                    if ".." in fname or fname == "plugin.json":
                        continue
                    (plugin_dir / fname).write_text(content, encoding="utf-8")
                try:
                    _ur2.urlopen(_ur2.Request(
                        f"{manager_url.rstrip('/')}/api/marketplace/{plugin_id}/download",
                        data=b"", method="POST"), timeout=3)
                except Exception:
                    pass
                emit("plugins_changed", {"installed": plugin_id})
                self.send_json({"ok": True, "id": plugin_id})
            except Exception as e:
                self.send_json({"ok": False, "error": str(e)})
            return

        if path == "/api/claude/skills/install":
            # 외부 마켓(캐시 zip)에서 스킬 폴더 설치 — 네트워크 0회.
            # scope: global(~/.claude/skills, 기본) | project(root/.claude/skills)
            repo = (body.get("repo") or "").strip()
            sid = (body.get("id") or "").strip()
            overwrite = bool(body.get("overwrite"))
            idx = _skill_index_load(repo)
            skill = next((s for s in idx.get("skills", []) if s["id"] == sid), None)
            if not skill:
                self.send_json({"ok": False, "error": "스킬을 찾을 수 없음 (목록을 먼저 갱신하세요)"}); return
            try:
                base, _pn = _skills_base_dir((body.get("scope") or "global").strip(),
                                             body.get("project_id"))
            except Exception as e:
                self.send_json({"ok": False, "error": str(e)}); return
            try:
                dest = _skill_install_from_cache(repo, skill, overwrite=overwrite,
                                                 base_dir=base)
                emit("plugins_changed", {"installed_skill": sid})
                self.send_json({"ok": True, "id": sid, "path": str(dest)})
            except FileExistsError as e:
                self.send_json({"ok": False, "error": str(e), "exists": True})
            except Exception as e:
                self.send_json({"ok": False, "error": str(e)})
            return

        if path == "/api/claude/md/install":
            # 마켓(peer 공유) CLAUDE.md 설치 — 대상 파일이 없을 때만 쓴다.
            # global → ~/.claude/CLAUDE.md, project → 같은 이름의 로컬 프로젝트 project_root.
            # 이미 존재하면 exists=True 와 함께 로컬↔원격 unified diff 를 돌려준다.
            import difflib
            scope = (body.get("scope") or "").strip()
            name = (body.get("name") or "").strip()
            content = body.get("content")
            if scope not in ("global", "project") or not isinstance(content, str):
                self.send_json({"ok": False, "error": "scope(global|project), content 필요"}); return
            if scope == "global":
                target = Path.home() / ".claude" / "CLAUDE.md"
            else:
                with sqlite3.connect(PROJECTS_DB) as conn:
                    row = conn.execute(
                        "SELECT id, name, project_root FROM projects "
                        "WHERE name=? AND project_root IS NOT NULL AND TRIM(project_root) != '' "
                        "ORDER BY id LIMIT 1", (name,)).fetchone()
                if not row:
                    self.send_json({"ok": False,
                                    "error": f"같은 이름의 로컬 프로젝트가 없습니다: {name}"}); return
                root = Path(os.path.expanduser(row[2].strip()))
                if not root.is_dir():
                    self.send_json({"ok": False,
                                    "error": f"프로젝트 루트 폴더가 없습니다: {root}"}); return
                target = root / "CLAUDE.md"
            if target.is_file():
                local = _cd_safe_read(target, 200000)
                diff = list(difflib.unified_diff(
                    local.splitlines(), content.splitlines(),
                    fromfile=f"local: {target}",
                    tofile=f"peer: {name or 'Global'}", lineterm=""))
                self.send_json({"ok": False, "exists": True, "path": str(target),
                                "same": local == content, "diff": diff})
                return
            try:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(content, encoding="utf-8")
                emit("plugins_changed", {"installed_claude_md": str(target)})
                self.send_json({"ok": True, "path": str(target)})
            except Exception as e:
                self.send_json({"ok": False, "error": str(e)})
            return

        if path == "/api/claude/commands/share":
            # Global 커맨드 공유 On/Off — On 시 글로벌 + shared 프로젝트 커맨드를
            # 마켓에 일괄 등록한다 (같은 이름 기등록 스킵, 내용 다르면 conflicts 로
            # 보고 → 프론트 확인 후 overwrite_ids 로 재호출).
            # Off 는 설정만 끈다 — 마켓의 등록본은 유지된다.
            value = "1" if str(body.get("value", "")).strip() == "1" else "0"
            if value == "0":
                _set_setting("share_claude_commands_global", "0")
                self.send_json({"ok": True, "off": True}); return
            if not _market_cmd_base():
                self.send_json({"ok": False,
                                "error": "커맨드 마켓 등록은 Firebase 마켓 소스에서 지원됩니다 (⚙ 설정 확인)"}); return
            _set_setting("share_claude_commands_global", "1")
            res = _market_register_bulk(_shareable_commands(),
                                        body.get("overwrite_ids") or [])
            if res.get("ok"):
                emit("plugins_changed", {"claude_commands_registered": len(res.get("registered", []))})
            self.send_json(res)
            return

        if path == "/api/claude/commands/register":
            # 로컬 커맨드 1개를 마켓에 등록/갱신 (설치됨 상세의 등록 버튼)
            scope = (body.get("scope") or "").strip()
            rel = (body.get("rel") or "").strip()
            overwrite = bool(body.get("overwrite"))
            if not rel or scope not in ("global", "project"):
                self.send_json({"ok": False, "error": "scope(global|project), rel 필요"}); return
            if not _market_cmd_base():
                self.send_json({"ok": False,
                                "error": "커맨드 마켓 등록은 Firebase 마켓 소스에서 지원됩니다 (⚙ 설정 확인)"}); return
            pid, pname = None, ""
            if scope == "global":
                base = _COMMANDS_DIR
            else:
                pid = body.get("project_id")
                with sqlite3.connect(PROJECTS_DB) as conn:
                    row = conn.execute("SELECT name, project_root FROM projects WHERE id=?",
                                       (pid,)).fetchone()
                if not row or not (row[1] or "").strip():
                    self.send_json({"ok": False, "error": f"프로젝트 root 를 찾을 수 없습니다: {pid}"}); return
                pname = row[0]
                base = Path(os.path.expanduser(row[1].strip())) / ".claude" / "commands"
            c = next((x for x in _scan_command_dir(base, scope, pid, pname)
                      if x["rel"] == rel), None)
            if not c:
                self.send_json({"ok": False, "error": f"커맨드 파일 없음: {rel}"}); return
            try:
                r = _market_register_command(c, overwrite)
            except Exception as e:
                self.send_json({"ok": False, "error": str(e)}); return
            if r["status"] == "registered":
                emit("plugins_changed", {"claude_command_registered": c["id"]})
                self.send_json({"ok": True, "id": c["id"]})
            elif r["status"] == "already":
                self.send_json({"ok": False, "already": True, "id": c["id"]})
            else:
                self.send_json({"ok": False, "conflict": True, "id": c["id"],
                                "market_host": r.get("market_host", "")})
            return

        if path == "/api/claude/skills/register":
            # 로컬 스킬 1개를 마켓에 등록/갱신 (설치됨 > Claude Skill 상세의 등록 버튼)
            # scope/project_id 로 글로벌·프로젝트 스킬을 구분한다 (기본 global)
            sid = (body.get("id") or "").strip()
            scope = (body.get("scope") or "global").strip()
            pid = body.get("project_id")
            overwrite = bool(body.get("overwrite"))
            if not sid:
                self.send_json({"ok": False, "error": "id 필요"}); return
            if not _market_fb_url():
                self.send_json({"ok": False,
                                "error": "스킬 마켓 등록은 Firebase 마켓 소스에서 지원됩니다 (⚙ 설정 확인)"}); return
            s = next((x for x in _scan_skills()
                      if x["id"] == sid and x["scope"] == scope
                      and (scope == "global" or str(x["project_id"]) == str(pid))), None)
            if not s:
                self.send_json({"ok": False, "error": f"스킬 없음: {sid}"}); return
            try:
                r = _market_register_skill(_market_skill_entry(s), overwrite)
            except Exception as e:
                self.send_json({"ok": False, "error": str(e)}); return
            if r["status"] == "registered":
                emit("plugins_changed", {"claude_skill_registered": sid})
                self.send_json({"ok": True, "id": sid})
            elif r["status"] == "already":
                self.send_json({"ok": False, "already": True, "id": sid})
            else:
                self.send_json({"ok": False, "conflict": True, "id": sid,
                                "market_host": r.get("market_host", "")})
            return

        if path == "/api/claude/skills/register-manual":
            # 마켓에 스킬 수동 등록 — 스킬 이름(폴더명)과 SKILL.md 내용을 직접 입력
            # (로컬 파일 불필요). name/description 은 frontmatter 에서 자동 추출.
            sid = (body.get("id") or "").strip()
            content = body.get("content")
            overwrite = bool(body.get("overwrite"))
            if not sid or not isinstance(content, str) or not content.strip():
                self.send_json({"ok": False, "error": "스킬 이름(id)과 내용(content)이 필요합니다"}); return
            if "/" in sid or "\\" in sid or ".." in sid or _market_cmd_key(sid) != sid:
                self.send_json({"ok": False,
                                "error": "스킬 이름에 사용 불가 문자가 있습니다 (. # $ [ ] / \\ 금지)"}); return
            if not _market_fb_url():
                self.send_json({"ok": False,
                                "error": "스킬 마켓 등록은 Firebase 마켓 소스에서 지원됩니다 (⚙ 설정 확인)"}); return
            name, desc = sid, (body.get("description") or "").strip()
            if content.startswith("---"):
                end = content.find("---", 3)
                if end > 0:
                    for line in content[3:end].splitlines():
                        if line.startswith("name:"):
                            name = line[5:].strip().strip('"\'') or sid
                        elif line.startswith("description:") and not desc:
                            desc = line[12:].strip().strip('"\'')
            if not desc:
                for line in content.splitlines():
                    ls = line.strip()
                    if ls and not ls.startswith("#") and not ls.startswith("---"):
                        desc = ls[:120]
                        break
            entry = {"id": sid, "name": name, "description": desc,
                     "content": content[:20000], "host": _ep4_host_label(),
                     "registered_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")}
            try:
                r = _market_register_skill(entry, overwrite)
            except Exception as e:
                self.send_json({"ok": False, "error": str(e)}); return
            if r["status"] == "registered":
                emit("plugins_changed", {"claude_skill_registered": sid})
                self.send_json({"ok": True, "id": sid})
            elif r["status"] == "already":
                self.send_json({"ok": False, "already": True, "id": sid})
            else:
                self.send_json({"ok": False, "conflict": True, "id": sid,
                                "market_host": r.get("market_host", "")})
            return

        if path == "/api/claude/skills/install-market":
            # 마켓(Firebase) 등록 스킬 설치 — {base}/{id}/SKILL.md 에 쓴다.
            # scope: global(기본) | project. SKILL.md 가 이미 있으면 unified diff 반환.
            import difflib
            sid = (body.get("id") or "").strip()
            content = body.get("content") or ""
            if not sid or "/" in sid or "\\" in sid or ".." in sid:
                self.send_json({"ok": False, "error": "잘못된 id"}); return
            try:
                base, _pn = _skills_base_dir((body.get("scope") or "global").strip(),
                                             body.get("project_id"))
            except Exception as e:
                self.send_json({"ok": False, "error": str(e)}); return
            target = (base / sid / "SKILL.md").resolve()
            try:
                target.relative_to(base.resolve())   # 경로 탈출 방지
            except ValueError:
                self.send_json({"ok": False, "error": "잘못된 경로"}); return
            if target.is_file():
                local = _cd_safe_read(target, 200000)
                diff = list(difflib.unified_diff(
                    local.splitlines(), content.splitlines(),
                    fromfile=f"local: {target}",
                    tofile=f"market: {sid}", lineterm=""))
                self.send_json({"ok": False, "exists": True, "path": str(target),
                                "same": local == content, "diff": diff})
                return
            try:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(content, encoding="utf-8")
                emit("plugins_changed", {"installed_skill": sid})
                self.send_json({"ok": True, "id": sid, "path": str(target)})
            except Exception as e:
                self.send_json({"ok": False, "error": str(e)})
            return

        if path == "/api/claude/skills/unregister":
            # 마켓에서 스킬 삭제 — 커맨드와 달리 자동 일괄 등록이 없어 tombstone 불필요
            sid = (body.get("id") or "").strip()
            if not sid:
                self.send_json({"ok": False, "error": "id 필요"}); return
            if not _market_fb_url():
                self.send_json({"ok": False,
                                "error": "스킬 마켓은 Firebase 마켓 소스에서 지원됩니다 (⚙ 설정 확인)"}); return
            try:
                _market_fb_write(f"ep4_marketplace/skills/{_market_cmd_key(sid)}", None)
                _MARKET_SKILL_CACHE["ts"] = 0
                emit("plugins_changed", {"claude_skill_unregistered": sid})
                self.send_json({"ok": True, "id": sid})
            except Exception as e:
                self.send_json({"ok": False, "error": str(e)})
            return

        if path == "/api/claude/agents/register":
            # 로컬 서브 에이전트 1개를 마켓에 등록/갱신 (설치됨 > Claude Agent 상세)
            aid = (body.get("id") or "").strip()
            scope = (body.get("scope") or "global").strip()
            pid = body.get("project_id")
            overwrite = bool(body.get("overwrite"))
            if not aid:
                self.send_json({"ok": False, "error": "id 필요"}); return
            if not _market_fb_url():
                self.send_json({"ok": False,
                                "error": "에이전트 마켓 등록은 Firebase 마켓 소스에서 지원됩니다 (⚙ 설정 확인)"}); return
            a = next((x for x in _scan_claude_agents()
                      if x["id"] == aid and x["scope"] == scope
                      and (scope == "global" or str(x["project_id"]) == str(pid))), None)
            if not a:
                self.send_json({"ok": False, "error": f"에이전트 없음: {aid}"}); return
            try:
                r = _market_register_agent(_market_agent_entry(a), overwrite)
            except Exception as e:
                self.send_json({"ok": False, "error": str(e)}); return
            if r["status"] == "registered":
                emit("plugins_changed", {"claude_agent_registered": aid})
                self.send_json({"ok": True, "id": aid})
            elif r["status"] == "already":
                self.send_json({"ok": False, "already": True, "id": aid})
            else:
                self.send_json({"ok": False, "conflict": True, "id": aid,
                                "market_host": r.get("market_host", "")})
            return

        if path == "/api/claude/agents/register-manual":
            # 마켓에 서브 에이전트 수동 등록 — 이름과 .md 내용을 직접 입력 (로컬 파일 불필요)
            aid = (body.get("id") or "").strip().lstrip("/")
            content = body.get("content")
            overwrite = bool(body.get("overwrite"))
            if not aid or not isinstance(content, str) or not content.strip():
                self.send_json({"ok": False, "error": "에이전트 이름(id)과 내용(content)이 필요합니다"}); return
            if _market_cmd_key(aid) != aid:
                self.send_json({"ok": False,
                                "error": "에이전트 이름에 사용 불가 문자가 있습니다 (. # $ [ ] / 금지, 네임스페이스는 : 사용)"}); return
            if not _market_fb_url():
                self.send_json({"ok": False,
                                "error": "에이전트 마켓 등록은 Firebase 마켓 소스에서 지원됩니다 (⚙ 설정 확인)"}); return
            name, desc = aid, (body.get("description") or "").strip()
            if content.startswith("---"):
                end = content.find("---", 3)
                if end > 0:
                    for line in content[3:end].splitlines():
                        if line.startswith("name:"):
                            name = line[5:].strip().strip('"\'') or aid
                        elif line.startswith("description:") and not desc:
                            desc = line[12:].strip().strip('"\'')
            if not desc:
                for line in content.splitlines():
                    ls = line.strip()
                    if ls and not ls.startswith("#") and not ls.startswith("---"):
                        desc = ls[:120]
                        break
            entry = {"id": aid, "rel": aid.replace(":", "/") + ".md", "name": name,
                     "description": desc, "content": content[:20000],
                     "host": _ep4_host_label(),
                     "registered_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")}
            try:
                r = _market_register_agent(entry, overwrite)
            except Exception as e:
                self.send_json({"ok": False, "error": str(e)}); return
            if r["status"] == "registered":
                emit("plugins_changed", {"claude_agent_registered": aid})
                self.send_json({"ok": True, "id": aid})
            elif r["status"] == "already":
                self.send_json({"ok": False, "already": True, "id": aid})
            else:
                self.send_json({"ok": False, "conflict": True, "id": aid,
                                "market_host": r.get("market_host", "")})
            return

        if path == "/api/claude/agents/install-market":
            # 마켓(Firebase) 등록 에이전트 설치 — {base}/{rel} 에 쓴다.
            # scope: global(기본) | project. 파일이 이미 있으면 unified diff 반환.
            import difflib
            aid = (body.get("id") or "").strip()
            rel = (body.get("rel") or (aid.replace(":", "/") + ".md" if aid else "")).strip()
            content = body.get("content") or ""
            if not rel:
                self.send_json({"ok": False, "error": "rel 필요"}); return
            try:
                base, _pn = _agents_base_dir((body.get("scope") or "global").strip(),
                                             body.get("project_id"))
            except Exception as e:
                self.send_json({"ok": False, "error": str(e)}); return
            try:
                target = (base / rel).resolve()
                target.relative_to(base.resolve())   # 경로 탈출 방지
            except Exception:
                self.send_json({"ok": False, "error": "잘못된 경로"}); return
            if target.is_file():
                local = _cd_safe_read(target, 200000)
                diff = list(difflib.unified_diff(
                    local.splitlines(), content.splitlines(),
                    fromfile=f"local: {target}",
                    tofile=f"market: {aid or rel}", lineterm=""))
                self.send_json({"ok": False, "exists": True, "path": str(target),
                                "same": local == content, "diff": diff})
                return
            try:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(content, encoding="utf-8")
                emit("plugins_changed", {"installed_agent": aid or rel})
                self.send_json({"ok": True, "id": aid or rel, "path": str(target)})
            except Exception as e:
                self.send_json({"ok": False, "error": str(e)})
            return

        if path == "/api/claude/agents/unregister":
            # 마켓에서 에이전트 삭제
            aid = (body.get("id") or "").strip()
            if not aid:
                self.send_json({"ok": False, "error": "id 필요"}); return
            if not _market_fb_url():
                self.send_json({"ok": False,
                                "error": "에이전트 마켓은 Firebase 마켓 소스에서 지원됩니다 (⚙ 설정 확인)"}); return
            try:
                _market_fb_write(f"ep4_marketplace/agents/{_market_cmd_key(aid)}", None)
                _MARKET_AGENT_CACHE["ts"] = 0
                emit("plugins_changed", {"claude_agent_unregistered": aid})
                self.send_json({"ok": True, "id": aid})
            except Exception as e:
                self.send_json({"ok": False, "error": str(e)})
            return

        if path == "/api/claude/commands/register-manual":
            # 마켓에 커맨드 수동 등록 — 명령 이름과 내용을 직접 입력 (로컬 파일 불필요)
            cid = (body.get("id") or "").strip().lstrip("/")
            content = body.get("content")
            overwrite = bool(body.get("overwrite"))
            if not cid or not isinstance(content, str) or not content.strip():
                self.send_json({"ok": False, "error": "명령 이름(id)과 내용(content)이 필요합니다"}); return
            if _market_cmd_key(cid) != cid:
                self.send_json({"ok": False,
                                "error": "명령 이름에 사용 불가 문자가 있습니다 (. # $ [ ] / 금지, 네임스페이스는 : 사용)"}); return
            if not _market_cmd_base():
                self.send_json({"ok": False,
                                "error": "커맨드 마켓 등록은 Firebase 마켓 소스에서 지원됩니다 (⚙ 설정 확인)"}); return
            desc = (body.get("description") or "").strip()
            if not desc:
                for line in content.splitlines():
                    if line.strip() and not line.startswith("#") and not line.startswith("---"):
                        desc = line.strip()[:120]
                        break
            entry = {"id": cid, "rel": cid.replace(":", "/") + ".md", "description": desc,
                     "content": content[:20000], "size": len(content.encode("utf-8")),
                     "mtime": int(time.time()), "host": _ep4_host_label(),
                     "registered_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")}
            try:
                r = _market_register_entry(entry, overwrite)
            except Exception as e:
                self.send_json({"ok": False, "error": str(e)}); return
            if r["status"] == "registered":
                emit("plugins_changed", {"claude_command_registered": cid})
                self.send_json({"ok": True, "id": cid})
            elif r["status"] == "already":
                self.send_json({"ok": False, "already": True, "id": cid})
            else:
                self.send_json({"ok": False, "conflict": True, "id": cid,
                                "market_host": r.get("market_host", "")})
            return

        if path == "/api/claude/commands/unregister":
            # 마켓에서 커맨드 삭제 — tombstone 기록으로 자동(일괄) 등록에서 제외된다
            cid = (body.get("id") or "").strip()
            if not cid:
                self.send_json({"ok": False, "error": "id 필요"}); return
            if not _market_cmd_base():
                self.send_json({"ok": False,
                                "error": "커맨드 마켓은 Firebase 마켓 소스에서 지원됩니다 (⚙ 설정 확인)"}); return
            try:
                _market_command_unregister(cid)
                emit("plugins_changed", {"claude_command_unregistered": cid})
                self.send_json({"ok": True, "id": cid})
            except Exception as e:
                self.send_json({"ok": False, "error": str(e)})
            return

        if path == "/api/claude/commands/delete":
            # 로컬 커맨드 .md 파일 삭제 (설치됨 상세의 삭제 버튼)
            scope = (body.get("scope") or "").strip()
            rel = (body.get("rel") or "").strip()
            if not rel or scope not in ("global", "project"):
                self.send_json({"ok": False, "error": "scope(global|project), rel 필요"}); return
            if scope == "global":
                base = _COMMANDS_DIR
            else:
                pid = body.get("project_id")
                with sqlite3.connect(PROJECTS_DB) as conn:
                    row = conn.execute("SELECT project_root FROM projects WHERE id=?",
                                       (pid,)).fetchone()
                if not row or not (row[0] or "").strip():
                    self.send_json({"ok": False, "error": f"프로젝트 root 를 찾을 수 없습니다: {pid}"}); return
                base = Path(os.path.expanduser(row[0].strip())) / ".claude" / "commands"
            try:
                target = (base / rel).resolve()
                target.relative_to(base.resolve())   # 경로 탈출 방지
            except Exception:
                self.send_json({"ok": False, "error": "잘못된 경로"}); return
            if not target.is_file():
                self.send_json({"ok": False, "error": "파일 없음"}); return
            try:
                target.unlink()
                emit("plugins_changed", {"deleted_claude_command": str(target)})
                self.send_json({"ok": True, "path": str(target)})
            except Exception as e:
                self.send_json({"ok": False, "error": str(e)})
            return

        if path == "/api/claude/commands/install":
            # 마켓 커맨드 설치 — scope 에 따라 글로벌(~/.claude/commands) 또는
            # 프로젝트(.claude/commands)에 쓴다. 대상 파일이 없을 때만 쓰고,
            # 이미 있으면 로컬↔마켓 unified diff 를 반환한다.
            import difflib
            rel = (body.get("rel") or "").strip()
            content = body.get("content") or ""
            if not rel:
                self.send_json({"ok": False, "error": "rel 필요"}); return
            scope = (body.get("scope") or "global").strip()
            if scope == "project":
                pid = body.get("project_id")
                with sqlite3.connect(PROJECTS_DB) as conn:
                    row = conn.execute("SELECT project_root FROM projects WHERE id=?",
                                       (pid,)).fetchone()
                if not row or not (row[0] or "").strip():
                    self.send_json({"ok": False, "error": f"프로젝트 root 를 찾을 수 없습니다: {pid}"}); return
                root = Path(os.path.expanduser(row[0].strip()))
                if not root.is_dir():
                    self.send_json({"ok": False, "error": f"프로젝트 루트 폴더가 없습니다: {root}"}); return
                base = root / ".claude" / "commands"
            else:
                base = _COMMANDS_DIR
            try:
                target = (base / rel).resolve()
                target.relative_to(base.resolve())   # 경로 탈출 방지
            except Exception:
                self.send_json({"ok": False, "error": "잘못된 경로"}); return
            if target.is_file():
                local = _cd_safe_read(target, 200000)
                diff = list(difflib.unified_diff(
                    local.splitlines(), content.splitlines(),
                    fromfile=f"local: {target}",
                    tofile=f"peer: /{rel}", lineterm=""))
                self.send_json({"ok": False, "exists": True, "path": str(target),
                                "same": local == content, "diff": diff})
                return
            try:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(content, encoding="utf-8")
                emit("plugins_changed", {"installed_claude_command": str(target)})
                self.send_json({"ok": True, "path": str(target)})
            except Exception as e:
                self.send_json({"ok": False, "error": str(e)})
            return

        if path == "/api/claude/md/save":
            # 로컬 CLAUDE.md 수정 저장 — 기존 파일은 타임스탬프 .bak 으로 백업 후 덮어쓴다.
            # global → ~/.claude/CLAUDE.md, project → project_id 의 project_root.
            scope = (body.get("scope") or "").strip()
            content = body.get("content")
            if scope not in ("global", "project") or not isinstance(content, str):
                self.send_json({"ok": False, "error": "scope(global|project), content 필요"}); return
            if scope == "global":
                target = Path.home() / ".claude" / "CLAUDE.md"
            else:
                pid = body.get("project_id")
                with sqlite3.connect(PROJECTS_DB) as conn:
                    row = conn.execute(
                        "SELECT project_root FROM projects WHERE id=?", (pid,)).fetchone()
                if not row or not (row[0] or "").strip():
                    self.send_json({"ok": False,
                                    "error": f"프로젝트 root 를 찾을 수 없습니다: {pid}"}); return
                target = Path(os.path.expanduser(row[0].strip())) / "CLAUDE.md"
            backup = ""
            try:
                if target.is_file():
                    backup = f"{target}.{datetime.now().strftime('%Y%m%d_%H%M%S')}.bak"
                    shutil.copy2(target, backup)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(content, encoding="utf-8")
                emit("plugins_changed", {"saved_claude_md": str(target)})
                self.send_json({"ok": True, "path": str(target), "backup": backup})
            except Exception as e:
                self.send_json({"ok": False, "error": str(e)})
            return

        if path == "/api/mcp/add":
            name = (body.get("name") or "").strip()
            spec = body.get("spec") or {}
            if not name or not spec:
                self.send_json({"ok": False, "error": "name, spec ?꾩슂"}); return
            if not re.match(r'^[a-zA-Z0-9_\-]+$', name):
                self.send_json({"ok": False, "error": "name은 영문/숫자/언더스코어/하이픈만 허용"}); return
            cj = _read_claude_json()
            if "mcpServers" not in cj:
                cj["mcpServers"] = {}
            cj["mcpServers"][name] = spec
            _write_claude_json(cj)
            self.send_json({"ok": True, "name": name})
            return

        if path == "/api/mcp/remove":
            name = (body.get("name") or "").strip()
            if not name:
                self.send_json({"ok": False, "error": "name ?꾩슂"}); return
            cj = _read_claude_json()
            removed = (cj.get("mcpServers") or {}).pop(name, None)
            if removed is not None:
                _write_claude_json(cj)
            self.send_json({"ok": removed is not None, "name": name})
            return

        if path == "/api/shell/navigate":
            # MCP/도우미가 대시보드 화면 전환을 트리거 (SSE로 셸에 push)
            route = (body.get("route") or "").strip()
            emit("shell_navigate", {
                "route": route,
                "action": body.get("action") or "",
                "params": body.get("params") or {},
            })
            self.send_json({"ok": True, "navigated": route})
            return

        if path == "/api/projects/connect-gate":
            gate_url = (body.get("gate_url") or "").strip()
            token    = (body.get("token") or "").strip()
            gpid     = (body.get("gate_project_id") or "").strip()
            mode     = (body.get("mode") or "collab").strip()
            name     = (body.get("name") or "").strip() or None
            gate_user = (body.get("gate_user") or "").strip() or None
            gate_user_id = (body.get("gate_user_id") or "").strip() or None
            if not gate_url or not gpid:
                self.send_json({"ok": False, "error": "gate_url, gate_project_id ?꾩슂"}, 400); return
            try:
                result = connect_project_to_gate(gate_url, token, gpid, mode, name, gate_user, gate_user_id)
            except _urlerr.HTTPError as e:
                self.send_json({"ok": False, "error": f"gate ?ㅻ쪟 {e.code}"}, 502); return
            except Exception as e:
                self.send_json({"ok": False, "error": str(e)}, 502); return
            self.send_json(result)
            return

        if path.startswith("/api/projects/") and path.endswith("/gate/publish"):
            try:
                pid = int(path.split("/")[3])
            except (IndexError, ValueError):
                self.send_json({"ok": False}, 400); return
            try:
                result = publish_project_to_gate(
                    pid, (body.get("gate_url") or "").strip(),
                    (body.get("token") or "").strip(),
                    (body.get("gate_user") or "").strip() or None,
                    (body.get("name") or "").strip() or None,
                    (body.get("gate_user_id") or "").strip() or None)
            except _urlerr.HTTPError as e:
                self.send_json({"ok": False, "error": f"gate ?ㅻ쪟 {e.code}"}, 502); return
            except Exception as e:
                self.send_json({"ok": False, "error": str(e)}, 502); return
            self.send_json(result)
            return

        if path.startswith("/api/projects/") and path.endswith("/gate/request"):
            try:
                pid = int(path.split("/")[3])
            except (IndexError, ValueError):
                self.send_json({"ok": False}, 400); return
            info = _gate_sync_info(pid)
            if not info:
                self.send_json({"ok": False, "error": "gate ?곕룞 ?꾨줈?앺듃 ?꾨떂"}, 400); return
            try:
                r = _gate_http_post_json(
                    f"{info['url']}/api/projects/{info['gpid']}/collab-request", info["token"], {})
            except Exception as e:
                self.send_json({"ok": False, "error": str(e)}, 502); return
            self.send_json(r)
            return

        if path.startswith("/api/projects/") and path.endswith("/gate/approve"):
            try:
                pid = int(path.split("/")[3])
            except (IndexError, ValueError):
                self.send_json({"ok": False}, 400); return
            info = _gate_sync_info(pid)
            if not info:
                self.send_json({"ok": False, "error": "gate ?곕룞 ?꾨줈?앺듃 ?꾨떂"}, 400); return
            try:
                r = _gate_http_post_json(
                    f"{info['url']}/api/projects/{info['gpid']}/collab-approve", info["token"],
                    {"user_id": body.get("user_id"), "approve": body.get("approve", True)})
            except Exception as e:
                self.send_json({"ok": False, "error": str(e)}, 502); return
            self.send_json(r)
            return

        if path == "/api/sessions":
            raw_name = (body.get("name") or "session").strip()
            cwd = (body.get("cwd") or "").strip() or None
            command = (body.get("command") or "").strip() or None
            name = make_session_name(raw_name)
            try:
                info = session_create(name, cwd, command)
                self.send_json(info)
            except Exception as e:
                self.send_json({"ok": False, "error": str(e)}, code=500)
            return

        if path.startswith("/api/sessions/") and path.endswith("/input"):
            parts = path.split("/")
            if len(parts) == 5:
                sid = parts[3]
                ok = session_send_input(sid, body.get("text", ""))
                self.send_json({"ok": ok})
            else:
                self.send_response(404); self.end_headers()
            return

        if path.startswith("/api/sessions/") and path.endswith("/settings"):
            parts = path.split("/")
            if len(parts) == 5:
                sid = parts[3]
                with _sessions_lock:
                    if sid in _sessions:
                        if "log_file" in body:
                            _sessions[sid]["log_file"] = body["log_file"]
                        if "max_buffer" in body:
                            mb = int(body["max_buffer"])
                            _sessions[sid]["max_buffer"] = max(100, min(mb, 100000))
                        self.send_json({"ok": True, **_sess_info(_sessions[sid])})
                    else:
                        self.send_json({"ok": False, "error": "세션 없음"}, code=404)
            else:
                self.send_response(404); self.end_headers()
            return

        if path == "/api/runs/bulk-delete":
            ids = body.get("ids", [])
            if ids:
                placeholders = ",".join("?" * len(ids))
                with sqlite3.connect(PROJECTS_DB) as conn:
                    conn.execute(f"DELETE FROM task_runs WHERE id IN ({placeholders})", ids)
                    conn.commit()
            self.send_json({"ok": True, "deleted": len(ids)})
            return

        if path == "/api/translate":
            handle_translate(self, body)
            return

        if path == "/api/browse-folder":
            try:
                import tkinter as tk
                from tkinter import filedialog
                root = tk.Tk()
                root.withdraw()
                root.attributes('-topmost', True)
                folder = filedialog.askdirectory(title="?대뜑 ?좏깮", parent=root)
                root.destroy()
                self.send_json({"ok": True, "path": folder or ""})
            except Exception as e:
                self.send_json({"ok": False, "path": "", "error": str(e)})
            return

        if path == "/api/projects":
            name = (body.get("name") or "").strip()
            if not name:
                self.send_json({"ok": False, "error": "name required"}); return
            desc         = (body.get("description") or "").strip()
            model        = (body.get("model") or "claude-fable-5").strip()
            preset       = (body.get("preset") or "standard").strip()
            retry_count  = int(body.get("retry_count") or 3)
            timeout_sec  = int(body.get("timeout_sec") or 1800)
            tool_perms   = json.dumps(body.get("tool_perms") or [])
            datasource        = (body.get("datasource") or "").strip()
            project_root      = (body.get("project_root") or "").strip()
            skip_permissions  = 1 if body.get("skip_permissions") else 0
            auto_run          = 1 if body.get("auto_run") else 0
            session_name_val   = (body.get("session_name") or "").strip()
            claude_session_id  = (body.get("claude_session_id") or "").strip()
            preview_url        = (body.get("preview_url") or "").strip()
            engine             = (body.get("engine") or "claude").strip()
            if engine not in ("claude", "antigravity"):
                engine = "claude"
            shared             = 1 if body.get("shared") else 0
            channel_ids        = body.get("channel_ids") or []
            # 프로젝트 등록 시 채널을 명시하지 않으면 기본 채널을 자동 연결
            # (body 에 channel_ids 키를 보낸 경우는 사용자의 명시적 선택으로 보고 그대로 둔다)
            if "channel_ids" not in body:
                channel_ids = _default_channel_ids()
            with sqlite3.connect(PROJECTS_DB) as conn:
                cur = conn.execute(
                    "INSERT INTO projects (name, description, model, preset, retry_count, timeout_sec, tool_perms, datasource, project_root, skip_permissions, auto_run, session_name, claude_session_id, preview_url, engine, shared) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (name, desc, model, preset, retry_count, timeout_sec, tool_perms, datasource, project_root, skip_permissions, auto_run, session_name_val, claude_session_id, preview_url, engine, shared)
                )
                pid = cur.lastrowid
                for cid in channel_ids:
                    try:
                        conn.execute("INSERT OR IGNORE INTO project_channel_links (project_id, channel_id) VALUES (?,?)", (pid, cid))
                    except Exception:
                        pass
                conn.commit()
            # 공유 상태로 생성된 프로젝트는 커맨드를 마켓에 자동 등록 (기등록 이름 스킵)
            if shared:
                threading.Thread(target=_market_register_project_commands,
                                 args=(pid,), daemon=True).start()
            self.send_json({"ok": True, "id": pid})
            return

        # ── 외부용 태스크 추가 API: 프로젝트를 이름으로 지정한다 ──
        #    필수: project_name, prompt · 선택: title, test, model, trigger, session
        if path == "/api/task":
            project_name = (body.get("project_name") or "").strip()
            prompt       = (body.get("prompt") or "").strip()
            if not project_name:
                self.send_json({"ok": False, "error": "project_name is required"}, 400); return
            if not prompt:
                self.send_json({"ok": False, "error": "prompt is required"}, 400); return
            pid, pname = _find_project_by_name(project_name)
            if pid is None:
                self.send_json({"ok": False,
                                "error": f"project not found: {project_name}"}, 404); return
            trig = (body.get("trigger") or DEFAULT_TRIGGER_TYPE).strip()
            if trig not in TASK_TRIGGER_TYPES:
                self.send_json({"ok": False,
                                "error": f"invalid trigger: {trig}",
                                "allowed": list(TASK_TRIGGER_TYPES)}, 400); return
            title = _derive_task_title(body.get("title") or "", prompt)
            tid, uid = _insert_task(
                pid,
                title=title,
                prompt=prompt,
                test_c=(body.get("test") or "").strip(),
                trig=trig,
                model_ov=(body.get("model") or "").strip(),
                session_ov=(body.get("session") or "").strip(),
            )
            # 트리거에 맞춰 하네스를 자동으로 건다 (run 파라미터로 강제/억제 가능)
            _force = body.get("run")
            _force = None if _force is None else bool(_force)
            run_state = _maybe_autostart_project(pid, trig, force=_force)
            self.send_json({"ok": True, "id": tid, "uid": uid,
                            "project_id": pid, "project_name": pname, "title": title,
                            "status": run_state})
            return

        if path.startswith("/api/projects/") and path.endswith("/tasks") and "/" in path[14:]:
            try:
                pid = int(path.split("/")[3])
            except (IndexError, ValueError):
                self.send_json({"ok": False}); return
            title      = (body.get("title") or body.get("text") or "").strip()
            prompt     = (body.get("prompt") or body.get("body") or "").strip()
            test_c     = (body.get("test_criteria") or body.get("test") or "").strip()
            trig       = (body.get("trigger_type") or DEFAULT_TRIGGER_TYPE).strip()
            model_ov   = (body.get("model_override") or "").strip()
            timeout_ov = int(body.get("timeout_override") or 0)
            session_ov = (body.get("session_override") or "").strip()
            title = _derive_task_title(title, prompt)
            if not title:
                self.send_json({"ok": False, "error": "title or prompt required"}); return
            tid, uid = _insert_task(
                pid, title=title, prompt=prompt, test_c=test_c, trig=trig,
                model_ov=model_ov, timeout_ov=timeout_ov, session_ov=session_ov,
                uid=(body.get("uid") or ""), author=(body.get("author") or ""))
            # 웹·모바일 추가도 API 와 같은 규칙으로 자동 실행한다. on_dependency
            # 이면서 프로젝트의 '자동 실행 활성화' 가 켜져 있을 때만 걸리므로,
            # 훅·MCP 가 넣는 claude_cli 기록은 그대로 대기 상태로 남는다.
            _force = body.get("run")
            _force = None if _force is None else bool(_force)
            run_state = _maybe_autostart_project(pid, trig, force=_force)
            self.send_json({"ok": True, "id": tid, "uid": uid, "status": run_state})
            return

        # ── 태스크 순서/폴더 일괄 변경 ──
        if re.match(r'/api/projects/\d+/tasks/reorder$', path):
            try:
                pid = int(path.split("/")[3])
            except (IndexError, ValueError):
                self.send_json({"ok": False}); return
            orders = body.get("orders", [])
            with sqlite3.connect(PROJECTS_DB) as conn:
                for item in orders:
                    fid = item.get("folder_id")
                    fid = int(fid) if fid is not None else None
                    conn.execute(
                        "UPDATE project_tasks SET sort_order=?, folder_id=? WHERE id=? AND project_id=?",
                        (int(item["sort_order"]), fid, int(item["id"]), pid)
                    )
                conn.commit()
            emit("tasks_changed", {"project_id": pid})
            self.send_json({"ok": True})
            return

        # 너무 길면 최신 메시지 위주로 자름
        if re.match(r'/api/projects/\d+/folders/reorder$', path):
            try:
                pid = int(path.split("/")[3])
            except (IndexError, ValueError):
                self.send_json({"ok": False}); return
            orders = body.get("orders", [])
            with sqlite3.connect(PROJECTS_DB) as conn:
                for item in orders:
                    conn.execute(
                        "UPDATE task_folders SET sort_order=? WHERE id=? AND project_id=?",
                        (item.get("sort_order"), item["id"], pid)
                    )
                conn.commit()
            emit("tasks_changed", {"project_id": pid})
            self.send_json({"ok": True})
            return

        # ?? ?대뜑 ?앹꽦 ??
        if path.startswith("/api/projects/") and path.endswith("/folders") and path.count("/") == 4:
            try:
                pid = int(path.split("/")[3])
            except (IndexError, ValueError):
                self.send_json({"ok": False}); return
            name = (body.get("name") or "").strip()
            if not name:
                self.send_json({"ok": False, "error": "name required"}); return
            with sqlite3.connect(PROJECTS_DB) as conn:
                new_order = _next_top_sort_order(conn, pid)
                cur = conn.execute(
                    "INSERT INTO task_folders (project_id, name, sort_order) VALUES (?,?,?)",
                    (pid, name, new_order)
                )
                conn.commit()
                fid = cur.lastrowid
            emit("tasks_changed", {"project_id": pid})
            self.send_json({"ok": True, "id": fid})
            return

        # 너무 길면 최신 메시지 위주로 자름
        if re.match(r'/api/projects/\d+/folders/\d+/rename$', path):
            parts = path.split("/")
            try:
                pid, fid = int(parts[3]), int(parts[5])
            except (IndexError, ValueError):
                self.send_json({"ok": False}); return
            name = (body.get("name") or "").strip()
            if not name:
                self.send_json({"ok": False, "error": "name required"}); return
            with sqlite3.connect(PROJECTS_DB) as conn:
                conn.execute(
                    "UPDATE task_folders SET name=? WHERE id=? AND project_id=?", (name, fid, pid)
                )
                conn.commit()
            emit("tasks_changed", {"project_id": pid})
            self.send_json({"ok": True})
            return

        # ── 태스크 폴더 이동 ──
        if re.match(r'/api/projects/\d+/tasks/\d+/move$', path):
            parts = path.split("/")
            try:
                pid, tid = int(parts[3]), int(parts[5])
            except (IndexError, ValueError):
                self.send_json({"ok": False}); return
            folder_id = body.get("folder_id")  # None or int
            if folder_id is not None:
                folder_id = int(folder_id)
            with sqlite3.connect(PROJECTS_DB) as conn:
                conn.execute(
                    "UPDATE project_tasks SET folder_id=? WHERE id=? AND project_id=?",
                    (folder_id, tid, pid)
                )
                conn.commit()
            emit("tasks_changed", {"project_id": pid})
            self.send_json({"ok": True})
            return

        if path.startswith("/api/projects/") and path.endswith("/tasks/bulk-delete"):
            try:
                pid = int(path.split("/")[3])
            except (IndexError, ValueError):
                self.send_json({"ok": False}); return
            task_ids = body.get("task_ids", [])
            if not task_ids:
                self.send_json({"ok": False, "msg": "task_ids required"}); return
            ph = ','.join('?' * len(task_ids))
            with sqlite3.connect(PROJECTS_DB) as conn:
                rows = conn.execute(
                    f"SELECT id, uid FROM project_tasks WHERE id IN ({ph}) AND project_id=?",
                    (*task_ids, pid)
                ).fetchall()
                _preserve_last_claude_session(conn, pid, task_ids)
                conn.execute(f"DELETE FROM task_runs WHERE task_id IN ({ph}) AND project_id=?", (*task_ids, pid))
                conn.execute(f"DELETE FROM project_tasks WHERE id IN ({ph}) AND project_id=?", (*task_ids, pid))
                conn.commit()
            for _, uid in rows:
                if uid:
                    _gate_push_op(pid, "delete", {"uid": uid})
            emit("tasks_changed", {"project_id": pid})
            self.send_json({"ok": True, "deleted": len(rows)})
            return

        if path.startswith("/api/projects/") and "/tasks/" in path and path.endswith("/delete"):
            parts = path.split("/")
            try:
                pid, tid = int(parts[3]), int(parts[5])
            except (IndexError, ValueError):
                self.send_json({"ok": False}); return
            with sqlite3.connect(PROJECTS_DB) as conn:
                _drow = conn.execute("SELECT uid FROM project_tasks WHERE id=? AND project_id=?", (tid, pid)).fetchone()
                _preserve_last_claude_session(conn, pid, [tid])
                conn.execute("DELETE FROM task_runs WHERE task_id=? AND project_id=?", (tid, pid))
                conn.execute("DELETE FROM project_tasks WHERE id=? AND project_id=?", (tid, pid))
                conn.commit()
            if _drow and _drow[0]:
                _gate_push_op(pid, "delete", {"uid": _drow[0]})   # gate로 삭제 전파
            emit("tasks_changed", {"project_id": pid})
            self.send_json({"ok": True})
            return

        if path.startswith("/api/projects/") and "/tasks/" in path and path.endswith("/update"):
            parts = path.split("/")
            try:
                pid, tid = int(parts[3]), int(parts[5])
            except (IndexError, ValueError):
                self.send_json({"ok": False}); return
            title    = (body.get("title") or body.get("text") or "").strip()
            prompt   = (body.get("prompt") or body.get("body") or "").strip()
            test_c   = (body.get("test_criteria") or body.get("test") or "").strip()
            title    = _derive_task_title(title, prompt)
            with sqlite3.connect(PROJECTS_DB) as conn:
                conn.execute(
                    "UPDATE project_tasks SET title=?, prompt=?, test_criteria=?, version=version+1 WHERE id=? AND project_id=?",
                    (title, prompt, test_c, tid, pid)
                )
                # 아래 필드는 body 에 키가 있을 때만 갱신 — 해당 필드를 보내지 않는
                # 클라이언트(모바일 등)가 기존 설정을 지우지 않도록 한다
                if "trigger_type" in body:
                    conn.execute("UPDATE project_tasks SET trigger_type=? WHERE id=? AND project_id=?",
                                 ((body.get("trigger_type") or DEFAULT_TRIGGER_TYPE).strip(), tid, pid))
                if "model_override" in body:
                    conn.execute("UPDATE project_tasks SET model_override=? WHERE id=? AND project_id=?",
                                 ((body.get("model_override") or "").strip(), tid, pid))
                if "timeout_override" in body:
                    try:
                        _to = int(body.get("timeout_override") or 0)
                    except (TypeError, ValueError):
                        _to = 0
                    conn.execute("UPDATE project_tasks SET timeout_override=? WHERE id=? AND project_id=?",
                                 (_to, tid, pid))
                if "session_override" in body:
                    conn.execute(
                        "UPDATE project_tasks SET session_override=? WHERE id=? AND project_id=?",
                        ((body.get("session_override") or "").strip(), tid, pid)
                    )
                conn.commit()
                row = conn.execute("SELECT uid, version FROM project_tasks WHERE id=?", (tid,)).fetchone()
            _gate_push_task(pid, tid)   # gate로 수정 전파
            emit("tasks_changed", {"project_id": pid})
            self.send_json({"ok": True, "uid": row[0] if row else None,
                            "version": row[1] if row else None})
            return

        if path.startswith("/api/projects/") and "/tasks/" in path and path.endswith("/run"):
            parts = path.split("/")
            try:
                pid, tid = int(parts[3]), int(parts[5])
            except (IndexError, ValueError):
                self.send_json({"ok": False}); return
            ps = project_states.get(pid, {})
            if ps.get("status") == "running":
                # 이미 실행 중 → 태스크를 pending 으로 마킹해 두면 하네스가
                # 현재 배치를 마친 뒤 이어서 실행한다 (거부 대신 큐잉)
                with sqlite3.connect(PROJECTS_DB) as _conn:
                    _conn.execute(
                        "UPDATE project_tasks SET status='pending', output='', started_at=NULL, ended_at=NULL, version=version+1 WHERE id=? AND project_id=?",
                        (tid, pid)
                    )
                emit("tasks_changed", {"project_id": pid})
                self.send_json({"ok": True, "queued": True})
                return
            with project_states_lock:
                project_states[pid] = {"status": "running", "current_task": None}
            threading.Thread(target=harness_runner, args=(pid,), kwargs={"single_task_id": tid}, daemon=True).start()
            self.send_json({"ok": True})
            return

        if path.startswith("/api/projects/") and path.endswith("/run-selected"):
            try:
                pid = int(path.split("/")[3])
            except (IndexError, ValueError):
                self.send_json({"ok": False}); return
            task_ids = body.get("task_ids", [])
            if not task_ids:
                self.send_json({"ok": False, "msg": "task_ids required"}); return
            ps = project_states.get(pid, {})
            if ps.get("status") == "running":
                self.send_json({"ok": False, "msg": "already running"}); return
            with project_states_lock:
                project_states[pid] = {"status": "running", "current_task": None}
            threading.Thread(target=harness_runner, args=(pid,), kwargs={"task_ids": task_ids}, daemon=True).start()
            self.send_json({"ok": True})
            return

        if path.startswith("/api/projects/") and "/tasks/" in path and path.endswith("/log-result"):
            parts = path.split("/")
            try:
                pid, tid = int(parts[3]), int(parts[5])
            except (IndexError, ValueError):
                self.send_json({"ok": False}); return
            output = (body.get("output") or "").strip()
            # answer: 최종 답변만 담은 필드 — 태스크의 "답변" 표시에 사용 (없으면 output 폴백)
            answer = (body.get("answer") or "").strip() or output
            status = body.get("status", "done")
            if status not in ("done", "error"):
                status = "done"
            model = (body.get("model") or "").strip()
            trigger_type = (body.get("trigger_type") or "claude_cli").strip() or "claude_cli"
            claude_session_id = (body.get("claude_session_id") or body.get("session_id") or "").strip()
            # 훅이 model 을 보내지 않으면 세션 jsonl 에서 실제 사용 모델을 추출
            if not model and claude_session_id and trigger_type == "claude_cli":
                try:
                    _sess_path = _find_claude_session_by_id(claude_session_id)
                    if _sess_path:
                        _sd = _parse_claude_session_detail(_sess_path)
                        model = ((_sd or {}).get("model") or "").strip()
                except Exception:
                    pass
            log_lines = body.get("log_lines") or []
            log_lines_json = json.dumps(log_lines, ensure_ascii=False)
            now = datetime.now().isoformat()
            with sqlite3.connect(PROJECTS_DB) as conn:
                row = conn.execute(
                    "SELECT title, prompt FROM project_tasks WHERE id=? AND project_id=?",
                    (tid, pid),
                ).fetchone()
                if not row:
                    self.send_json({"ok": False, "error": "task not found"}); return
                title, prompt = row
                proj_row = conn.execute(
                    "SELECT name, project_root, preview_url FROM projects WHERE id=?", (pid,)
                ).fetchone()
                proj_name = proj_row[0] if proj_row else ""
                project_root = proj_row[1] if proj_row else ""
                project_preview_url = proj_row[2] if proj_row else ""
            # Git 브랜치 처리 (done 상태일 때만)
            git_info = {}
            if status == "done":
                git_info = _git_handle_cli_result(pid, tid, title, project_root, proj_name)
            with sqlite3.connect(PROJECTS_DB) as conn:
                # 같은 태스크·세션의 Stop 훅이 여러 번 오면(백그라운드 에이전트 알림 등
                # 멀티턴 응답) 새 run 을 만들지 않고 기존 run 을 최신 내용으로 갱신한다.
                run_id = None
                if claude_session_id:
                    _prev = conn.execute(
                        "SELECT id FROM task_runs WHERE task_id=? AND project_id=? "
                        "AND claude_session_id=? ORDER BY id DESC LIMIT 1",
                        (tid, pid, claude_session_id),
                    ).fetchone()
                    if _prev:
                        run_id = _prev[0]
                _run_updated = run_id is not None
                if run_id:
                    conn.execute(
                        "UPDATE task_runs SET status=?, model=?, output=?, log_lines=?, "
                        "ended_at=?, git_task_branch=?, git_proj_branch=?, git_merge_status=?, "
                        "git_diff_json=?, git_commits_json=? WHERE id=?",
                        (status, model, output[:8000], log_lines_json, now,
                         git_info.get('git_task_branch', ''),
                         git_info.get('git_proj_branch', ''),
                         git_info.get('git_merge_status', 'no_git'),
                         json.dumps(git_info.get('git_diff', []), ensure_ascii=False),
                         json.dumps(git_info.get('git_commits', []), ensure_ascii=False),
                         run_id),
                    )
                else:
                    cur = conn.execute(
                        "INSERT INTO task_runs (task_id, project_id, task_title, project_name, "
                        "status, trigger_type, model, prompt, output, log_lines, "
                        "started_at, ended_at, trace_id, span_id, claude_session_id, "
                        "git_task_branch, git_proj_branch, git_merge_status, "
                        "git_diff_json, git_commits_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        (tid, pid, title, proj_name, status, trigger_type, model,
                         prompt, output[:8000], log_lines_json, now, now,
                         _new_uuid(), _new_span_id(), claude_session_id,
                         git_info.get('git_task_branch', ''),
                         git_info.get('git_proj_branch', ''),
                         git_info.get('git_merge_status', 'no_git'),
                         json.dumps(git_info.get('git_diff', []), ensure_ascii=False),
                         json.dumps(git_info.get('git_commits', []), ensure_ascii=False)),
                    )
                    run_id = cur.lastrowid
                conn.execute(
                    "UPDATE project_tasks SET status=?, output=?, ended_at=?, version=version+1 WHERE id=?",
                    (status, answer[:4000], now, tid),
                )
                conn.commit()
            emit("task_done", {"project_id": pid, "task_id": tid, "status": status,
                               "output": answer[:500], "run_id": run_id})
            # 태스크 입력·답변을 해당 프로젝트의 프롬프트 문서에 기록
            # (같은 세션 Stop 훅 재수신으로 기존 run 을 갱신한 경우는 중복 기록 방지를 위해 제외)
            if not _run_updated:
                _append_prompt_doc(prompt, answer, project_root)
            self.send_json({"ok": True, "run_id": run_id})
            # 스크린샷 캡처 — 서버 재시작이 필요해 시간이 걸리므로 백그라운드에서 실행
            if status == "done" and project_root:
                _proot_cli = Path(project_root)
                _git_diff_cli = git_info.get("git_diff", [])
                _prev_url_cli = project_preview_url or ""
                _rid_cli = run_id
                def _cli_screenshot():
                    try:
                        sp, pu = "", ""
                        if (_proot_cli / "stop.bat").exists() and (_proot_cli / "run.bat").exists():
                            sp, pu = _restart_and_screenshot(str(_proot_cli), _rid_cli)
                        elif _prev_url_cli and (_is_web_change(_git_diff_cli) or git_info.get("git_merge_status") == "no_git"):
                            _sf = SCREENSHOTS_DIR / f"run_{_rid_cli}.png"
                            if _capture_screenshot(_prev_url_cli, _sf):
                                sp, pu = f"run_{_rid_cli}.png", _prev_url_cli
                        if sp:
                            with sqlite3.connect(PROJECTS_DB) as _c:
                                _c.execute("UPDATE task_runs SET screenshot_path=?, preview_url=? WHERE id=?",
                                           (sp, pu, _rid_cli))
                                _c.commit()
                            # run_done 재emit → 프론트엔드가 run 데이터 재조회해 스크린샷 탭 표시
                            emit("run_done", {"run_id": _rid_cli, "project_id": pid, "status": "done"})
                    except Exception as _exc:
                        print(f"[screenshot] _cli_screenshot 오류: {_exc}")
                threading.Thread(target=_cli_screenshot, daemon=True).start()
            return

        if path.startswith("/api/projects/") and path.endswith("/webdoc/build"):
            # 선택 태스크의 프롬프트·답변을 프로젝트 웹 문서에 추가 (이미 있는 태스크는 스킵)
            try:
                pid = int(path.split("/")[3])
            except (IndexError, ValueError):
                self.send_json({"ok": False, "error": "bad id"}); return
            task_ids = [t for t in (body.get("task_ids") or []) if isinstance(t, int)]
            if not task_ids:
                self.send_json({"ok": False, "error": "task_ids 가 비어 있음"}); return
            with sqlite3.connect(PROJECTS_DB) as conn:
                prow = conn.execute("SELECT name FROM projects WHERE id=?", (pid,)).fetchone()
                if not prow:
                    self.send_json({"ok": False, "error": "project not found"}); return
                ph = ",".join("?" * len(task_ids))
                rows = conn.execute(
                    f"SELECT id, title, prompt, output FROM project_tasks "
                    f"WHERE project_id=? AND id IN ({ph})", (pid, *task_ids)).fetchall()
            doc = _webdoc_load(pid)
            doc["project_name"] = prow[0]
            entries = {e.get("task_id"): e for e in doc.get("entries", [])}
            now = datetime.now().isoformat()
            added = skipped = 0
            for tid, title, prompt, output in rows:
                if tid in entries:
                    skipped += 1
                    continue
                entries[tid] = {
                    "task_id": tid,
                    "title": (title or (prompt or "").split("\n")[0]).strip()[:100] or f"태스크 {tid}",
                    "prompt": prompt or "",
                    "answer": output or "",
                    "added_at": now,
                }
                added += 1
            doc["entries"] = list(entries.values())
            _webdoc_save(pid, doc)
            self.send_json({"ok": True, "added": added, "skipped": skipped,
                            "count": len(doc["entries"]), "url": f"/webdoc/{pid}"})
            return

        if path.startswith("/api/projects/") and path.endswith("/webdoc/delete"):
            # 웹 문서에서 선택 항목 제거
            try:
                pid = int(path.split("/")[3])
            except (IndexError, ValueError):
                self.send_json({"ok": False, "error": "bad id"}); return
            del_ids = set(body.get("task_ids") or [])
            doc = _webdoc_load(pid)
            before = len(doc.get("entries", []))
            doc["entries"] = [e for e in doc.get("entries", []) if e.get("task_id") not in del_ids]
            _webdoc_save(pid, doc)
            self.send_json({"ok": True, "deleted": before - len(doc["entries"]),
                            "count": len(doc["entries"])})
            return

        if path.startswith("/api/projects/") and path.endswith("/open-folder"):
            try:
                pid = int(path.split("/")[3])
            except (IndexError, ValueError):
                self.send_json({"ok": False, "error": "bad id"}); return
            with sqlite3.connect(PROJECTS_DB) as conn:
                prow = conn.execute("SELECT project_root FROM projects WHERE id=?", (pid,)).fetchone()
            if not prow or not prow[0] or not os.path.isdir(prow[0]):
                self.send_json({"ok": False, "error": "no valid project_root"}); return
            try:
                import subprocess as _sp
                _sp.Popen(["explorer", os.path.normpath(prow[0])])
                self.send_json({"ok": True})
            except Exception as e:
                self.send_json({"ok": False, "error": str(e)})
            return

        if path.startswith("/api/projects/") and path.endswith("/start"):
            try:
                pid = int(path.split("/")[3])
            except (IndexError, ValueError):
                self.send_json({"ok": False}); return
            ps = project_states.get(pid, {})
            if ps.get("status") == "running" and not body.get("reset_all"):
                self.send_json({"ok": False, "msg": "already running"}); return
            if body.get("reset_all"):
                with sqlite3.connect(PROJECTS_DB) as conn:
                    conn.execute("UPDATE project_tasks SET status='pending', output='', started_at=NULL, ended_at=NULL, version=version+1 WHERE project_id=?", (pid,))
                    conn.commit()
                with project_states_lock:
                    project_states[pid] = {"status": "idle", "current_task": None}
            with project_states_lock:
                project_states[pid] = {"status": "running", "current_task": None}
            threading.Thread(target=harness_runner, args=(pid,), daemon=True).start()
            self.send_json({"ok": True})
            return

        if path.startswith("/api/projects/") and path.endswith("/stop"):
            try:
                pid = int(path.split("/")[3])
            except (IndexError, ValueError):
                self.send_json({"ok": False}); return
            proc_to_kill = None
            with project_states_lock:
                proc_to_kill = project_states.get(pid, {}).pop("proc", None)
                project_states[pid] = {"status": "idle", "current_task": None}
            if proc_to_kill:
                try:
                    proc_to_kill.kill()
                except Exception:
                    pass
            # 실행 중 태스크를 error 로 처리
            with sqlite3.connect(PROJECTS_DB) as conn:
                conn.execute("UPDATE project_tasks SET status='error', output='중지됨', ended_at=datetime('now') WHERE project_id=? AND status='running'", (pid,))
                conn.commit()
            emit("status", {"project_id": pid, "status": "idle", "message": "완료"})
            self.send_json({"ok": True})
            return

        if path.startswith("/api/projects/") and path.endswith("/git-merge"):
            try:
                pid = int(path.split("/")[3])
            except (IndexError, ValueError):
                self.send_json({"ok": False, "msg": "invalid id"}); return
            target_branch = (body.get("target_branch") or "").strip()
            if not target_branch:
                self.send_json({"ok": False, "msg": "target_branch 필수"}); return
            with sqlite3.connect(PROJECTS_DB) as conn:
                prow = conn.execute("SELECT project_root, name FROM projects WHERE id=?", (pid,)).fetchone()
            if not prow:
                self.send_json({"ok": False, "msg": "프로젝트 없음"}); return
            project_root, _pname = prow
            if not project_root or not os.path.isdir(project_root):
                self.send_json({"ok": False, "msg": "project_root 없음"}); return
            git_root = _git_root(project_root) or project_root
            if not _git_ok(git_root):
                self.send_json({"ok": False, "msg": "git repo 없음"}); return
            cfg_out = _git_out('git', '-C', git_root, 'config', '--list', timeout=5)
            slug = None
            for _line in cfg_out.split('\n'):
                if _line.startswith('ep4.project-') and '=' in _line:
                    _k, _v = _line.split('=', 1)
                    if _v.strip() == str(pid):
                        slug = _k[len('ep4.project-'):]
                        break
            if not slug:
                self.send_json({"ok": False, "msg": "Git 프로젝트 브랜치 없음 (먼저 태스크를 실행하세요)"}); return
            proj_branch = f'project/{slug}/main'
            if not _git_out('git', '-C', git_root, 'branch', '--list', proj_branch, timeout=5):
                self.send_json({"ok": False, "msg": f"브랜치 없음: {proj_branch}"}); return
            # 타겟 브랜치가 이미 체크아웃된 worktree 찾기
            wt_list_out = _git_out('git', '-C', git_root, 'worktree', 'list', '--porcelain', timeout=5)
            existing_wt = None
            _cur_wt = None
            for _wl in wt_list_out.split('\n'):
                _wl = _wl.strip()
                if _wl.startswith('worktree '):
                    _cur_wt = _wl[len('worktree '):]
                elif _wl == f'branch refs/heads/{target_branch}' and _cur_wt:
                    existing_wt = _cur_wt
                    break

            tmp_wt = None
            merge_wt = existing_wt
            if not merge_wt:
                wt_base = BASE_DIR / 'worktrees'
                wt_base.mkdir(parents=True, exist_ok=True)
                tmp_wt = str(wt_base / f'merge_tmp_{pid}')
                if os.path.exists(tmp_wt):
                    _git_run('git', '-C', git_root, 'worktree', 'remove', '--force', tmp_wt, timeout=10)
                r_add = _git_run('git', '-C', git_root, 'worktree', 'add', tmp_wt, target_branch, timeout=15)
                if r_add.returncode != 0:
                    err_msg = ((r_add.stdout or '') + (r_add.stderr or '')).strip()[:200]
                    self.send_json({"ok": False, "msg": "worktree 생성 실패: " + err_msg}); return
                merge_wt = tmp_wt

            r_merge = _git_run('git', '-C', merge_wt, 'merge', '--no-ff', '-m',
                               f'merge: {proj_branch} into {target_branch}', proj_branch, timeout=30)
            if r_merge.returncode == 0:
                if tmp_wt:
                    _git_run('git', '-C', git_root, 'worktree', 'remove', '--force', tmp_wt, timeout=10)
                self.send_json({"ok": True, "msg": f"{proj_branch} → {target_branch} 머지 완료"})
            else:
                merge_out = ((r_merge.stdout or '') + (r_merge.stderr or '')).strip()[:300]
                _git_run('git', '-C', merge_wt, 'merge', '--abort', timeout=10)
                if tmp_wt:
                    _git_run('git', '-C', git_root, 'worktree', 'remove', '--force', tmp_wt, timeout=10)
                self.send_json({"ok": False, "msg": "머지 충돌: " + merge_out})
            return

        if path.startswith("/api/projects/") and path.endswith("/reset"):
            try:
                pid = int(path.split("/")[3])
            except (IndexError, ValueError):
                self.send_json({"ok": False}); return
            with sqlite3.connect(PROJECTS_DB) as conn:
                conn.execute("UPDATE project_tasks SET status='pending' WHERE project_id=? AND status='error'", (pid,))
                conn.commit()
            with project_states_lock:
                project_states[pid] = {"status": "idle", "current_task": None}
            self.send_json({"ok": True})
            return

        if path.startswith("/api/projects/") and path.endswith("/delete"):
            parts = path.split("/")
            if len(parts) == 5:
                try:
                    pid = int(parts[3])
                except ValueError:
                    self.send_json({"ok": False}); return
                with sqlite3.connect(PROJECTS_DB) as conn:
                    # PRAGMA foreign_keys 가 꺼져 있어 CASCADE 가 동작하지 않으므로 관련 데이터를 명시적으로 삭제
                    conn.execute("DELETE FROM task_runs WHERE project_id=?", (pid,))
                    conn.execute("DELETE FROM project_tasks WHERE project_id=?", (pid,))
                    conn.execute("DELETE FROM task_folders WHERE project_id=?", (pid,))
                    conn.execute("DELETE FROM project_channel_links WHERE project_id=?", (pid,))
                    conn.execute("DELETE FROM projects WHERE id=?", (pid,))
                    conn.commit()
                with project_states_lock:
                    project_states.pop(pid, None)
                self.send_json({"ok": True})
                return

        if path.startswith("/api/projects/") and path.endswith("/update"):
            parts = path.split("/")
            if len(parts) == 5:
                try:
                    pid = int(parts[3])
                except ValueError:
                    self.send_json({"ok": False}); return
                name         = (body.get("name") or "").strip()
                desc         = (body.get("description") or "").strip()
                model        = (body.get("model") or "claude-fable-5").strip()
                preset       = (body.get("preset") or "standard").strip()
                retry_count  = int(body.get("retry_count") or 3)
                timeout_sec  = int(body.get("timeout_sec") or 1800)
                tool_perms   = json.dumps(body.get("tool_perms") or [])
                datasource        = (body.get("datasource") or "").strip()
                project_root      = (body.get("project_root") or "").strip()
                skip_permissions  = 1 if body.get("skip_permissions") else 0
                auto_run          = 1 if body.get("auto_run") else 0
                session_name_val   = (body.get("session_name") or "").strip()
                claude_session_id  = (body.get("claude_session_id") or "").strip()
                preview_url        = (body.get("preview_url") or "").strip()
                engine             = (body.get("engine") or "claude").strip()
                if engine not in ("claude", "antigravity"):
                    engine = "claude"
                shared             = 1 if body.get("shared") else 0
                channel_ids        = body.get("channel_ids") or []
                with sqlite3.connect(PROJECTS_DB) as conn:
                    _old_shared = conn.execute(
                        "SELECT shared FROM projects WHERE id=?", (pid,)).fetchone()
                    if name:
                        conn.execute(
                            "UPDATE projects SET name=?, description=?, model=?, preset=?, retry_count=?, timeout_sec=?, tool_perms=?, datasource=?, project_root=?, skip_permissions=?, auto_run=?, session_name=?, claude_session_id=?, preview_url=?, engine=?, shared=?, updated_at=datetime('now') WHERE id=?",
                            (name, desc, model, preset, retry_count, timeout_sec, tool_perms, datasource, project_root, skip_permissions, auto_run, session_name_val, claude_session_id, preview_url, engine, shared, pid)
                        )
                    conn.execute("DELETE FROM project_channel_links WHERE project_id=?", (pid,))
                    for cid in channel_ids:
                        try:
                            conn.execute("INSERT OR IGNORE INTO project_channel_links (project_id, channel_id) VALUES (?,?)", (pid, cid))
                        except Exception:
                            pass
                    conn.commit()
                # 프로젝트 공유가 새로 켜지면 커맨드를 마켓에 자동 등록 (기등록 이름 스킵)
                if name and shared and _old_shared and not _old_shared[0]:
                    threading.Thread(target=_market_register_project_commands,
                                     args=(pid,), daemon=True).start()
                self.send_json({"ok": True})
                return

        if path == "/api/channels":
            ch_type = (body.get("type") or "").strip().lower()
            name    = (body.get("name") or "").strip()
            webhook = (body.get("webhook_url") or "").strip()
            server  = (body.get("server_name") or "").strip()
            if ch_type not in ("slack", "discord") or not name or not webhook:
                self.send_json({"ok": False, "error": "type/name/webhook_url ?꾩닔"})
                return
            with sqlite3.connect(CHANNELS_DB) as conn:
                first = conn.execute("SELECT COUNT(*) FROM notification_channels").fetchone()[0] == 0
                cur = conn.execute(
                    "INSERT INTO notification_channels (type, name, webhook_url, server_name, is_default) VALUES (?,?,?,?,?)",
                    (ch_type, name, webhook, server, 1 if first else 0)   # 첫 채널은 자동으로 기본 채널
                )
                conn.commit()
                new_id = cur.lastrowid
            self.send_json({"ok": True, "id": new_id})
            return

        if path.startswith("/api/channels/") and path.endswith("/delete"):
            try:
                ch_id = int(path.split("/")[3])
            except (IndexError, ValueError):
                self.send_json({"ok": False}); return
            with sqlite3.connect(CHANNELS_DB) as conn:
                conn.execute("DELETE FROM notification_channels WHERE id=?", (ch_id,))
                conn.commit()
            self.send_json({"ok": True})
            return

        if path.startswith("/api/channels/") and path.endswith("/set-default"):
            try:
                ch_id = int(path.split("/")[3])
            except (IndexError, ValueError):
                self.send_json({"ok": False}); return
            with sqlite3.connect(CHANNELS_DB) as conn:
                conn.execute("UPDATE notification_channels SET is_default=0")
                conn.execute("UPDATE notification_channels SET is_default=1 WHERE id=?", (ch_id,))
                conn.commit()
            self.send_json({"ok": True})
            return

        if path.startswith("/api/channels/") and path.endswith("/toggle"):
            try:
                ch_id = int(path.split("/")[3])
            except (IndexError, ValueError):
                self.send_json({"ok": False}); return
            with sqlite3.connect(CHANNELS_DB) as conn:
                conn.execute(
                    "UPDATE notification_channels SET active = CASE WHEN active=1 THEN 0 ELSE 1 END WHERE id=?",
                    (ch_id,)
                )
                conn.commit()
            self.send_json({"ok": True})
            return

        if path.startswith("/api/channels/") and path.endswith("/update"):
            try:
                ch_id = int(path.split("/")[3])
            except (IndexError, ValueError):
                self.send_json({"ok": False}); return
            name    = (body.get("name") or "").strip()
            webhook = (body.get("webhook_url") or "").strip()
            server  = (body.get("server_name") or "").strip()
            if not name or not webhook:
                self.send_json({"ok": False, "error": "채널 이름과 Webhook URL은 필수입니다."}); return
            with sqlite3.connect(CHANNELS_DB) as conn:
                conn.execute(
                    "UPDATE notification_channels SET name=?, webhook_url=?, server_name=?, tested=0 WHERE id=?",
                    (name, webhook, server, ch_id)
                )
                conn.commit()
            self.send_json({"ok": True})
            return

        if path.startswith("/api/channels/") and path.endswith("/test"):
            try:
                ch_id = int(path.split("/")[3])
            except (IndexError, ValueError):
                self.send_json({"ok": False}); return
            with sqlite3.connect(CHANNELS_DB) as conn:
                row = conn.execute(
                    "SELECT type, webhook_url, name FROM notification_channels WHERE id=?", (ch_id,)
                ).fetchone()
            if not row:
                self.send_json({"ok": False, "error": "채널을 찾을 수 없습니다."}); return
            ch_type, webhook_url, ch_name = row
            import urllib.request as _req
            import urllib.error as _err
            test_msg = f"🧪 [{ch_name}] EasyProject4 알림 테스트 — 연결이 정상입니다!"
            payload = json.dumps({"text": test_msg} if ch_type == "slack" else {"content": test_msg}).encode()
            try:
                req = _req.Request(webhook_url, data=payload,
                                   headers={"Content-Type": "application/json", "User-Agent": "EasyProject4/1.0"},
                                   method="POST")
                _req.urlopen(req, timeout=10)
                with sqlite3.connect(CHANNELS_DB) as conn:
                    conn.execute("UPDATE notification_channels SET tested=1, active=1 WHERE id=?", (ch_id,))
                    conn.commit()
                self.send_json({"ok": True, "message": f"테스패 성공! {ch_name} 채널로 알림이 전송됐습니다."})
            except _err.HTTPError as e:
                if e.code == 403:
                    self.send_json({"ok": False, "error": "403 Forbidden - Discord 채널에서 Webhook URL을 재생성해 주세요."})
                elif e.code == 404:
                    self.send_json({"ok": False, "error": "404 - Webhook이 삭제된 것 같습니다. URL을 확인해 주세요."})
                else:
                    self.send_json({"ok": False, "error": f"HTTP {e.code}"})
            except Exception as e:
                self.send_json({"ok": False, "error": str(e)})
            return

        if path == "/api/chat/stream":
            handle_chat_stream(self, body)
            return

        if path == "/api/chat/message":
            role = (body.get("role") or "").strip()
            text = (body.get("text") or "").strip()
            if role not in ("user", "assistant") or not text:
                self.send_json({"ok": False})
                return
            with sqlite3.connect(CHAT_DB) as conn:
                conn.execute(
                    "INSERT INTO chat_messages (role, text) VALUES (?, ?)", (role, text)
                )
                conn.commit()
            self.send_json({"ok": True})
            return

        if path == "/api/chat/clear":
            with sqlite3.connect(CHAT_DB) as conn:
                conn.execute("DELETE FROM chat_messages")
                conn.commit()
            self.send_json({"ok": True})
            return

        if path == "/api/tasks/delete-by-title":
            title_q = (body.get("title") or "").strip().lower()
            if not title_q:
                self.send_json({"ok": False, "error": "title required"})
                return
            with state_lock:
                before = len(state["tasks"])
                state["tasks"] = [
                    t for t in state["tasks"]
                    if title_q not in t.get("text", "").lower()
                ]
                deleted = before - len(state["tasks"])
                save_todos(state["tasks"])
            self.send_json({"ok": True, "deleted": deleted})
            return

        if path == "/api/cli-login":
            cli = shutil.which("claude") or ""
            if not cli:
                self.send_json({"ok": False, "msg": "Claude CLI 미설치"})
                return
            try:
                # 새 콘솔에서 CLI를 대화형으로 실행 → 미인증 시 로그인 진행
                cmd_name = Path(cli).stem
                subprocess.Popen(
                    f'start "Claude Login" cmd /k {cmd_name}',
                    shell=True,
                )
                _cli_status_cache["data"] = None
                self.send_json({"ok": True, "msg": "터미널에서 로그인하세요."})
            except Exception as e:
                self.send_json({"ok": False, "msg": str(e)})

        elif path == "/api/cli-logout":
            try:
                creds = Path.home() / ".claude" / ".credentials.json"
                if creds.exists():
                    bak = creds.with_suffix(".json.logout-bak")
                    try:
                        if bak.exists():
                            bak.unlink()
                    except Exception:
                        pass
                    creds.rename(bak)
                _cli_status_cache["data"] = None
                self.send_json({"ok": True, "msg": "로그아웃 완료"})
            except Exception as e:
                self.send_json({"ok": False, "msg": str(e)})

        elif path == "/api/antigravity-login":
            cli = _resolve_engine_bin("antigravity")
            if not cli:
                self.send_json({"ok": False, "msg": "Antigravity/Gemini CLI 미설치"})
                return
            try:
                # 새 콘솔에서 CLI를 대화형으로 실행 → 브라우저 OAuth 로그인 진행
                cmd_name = Path(cli).stem
                subprocess.Popen(
                    f'start "Antigravity Login" cmd /k {cmd_name}',
                    shell=True,
                )
                _ag_status_cache["data"] = None
                self.send_json({"ok": True, "msg": "터미널에서 로그인하세요."})
            except Exception as e:
                self.send_json({"ok": False, "msg": str(e)})

        elif path == "/api/antigravity-logout":
            try:
                creds = Path.home() / ".gemini" / "oauth_creds.json"
                if creds.exists():
                    bak = creds.with_suffix(".json.logout-bak")
                    try:
                        if bak.exists():
                            bak.unlink()
                    except Exception:
                        pass
                    creds.rename(bak)
                _ag_status_cache["data"] = None
                self.send_json({"ok": True, "msg": "로그아웃 완료"})
            except Exception as e:
                self.send_json({"ok": False, "msg": str(e)})

        elif path == "/api/start":
            with state_lock:
                if state["status"] == "running":
                    self.send_json({"ok": False, "msg": "already running"})
                    return
                state["status"] = "running"
            # 레거시 호환: 첫 번째 프로젝트 실행
            with sqlite3.connect(PROJECTS_DB) as _conn:
                _first = _conn.execute("SELECT id FROM projects ORDER BY id LIMIT 1").fetchone()
            if _first:
                threading.Thread(target=harness_runner, args=(_first[0],), daemon=True).start()
            self.send_json({"ok": True})

        elif path == "/api/stop":
            with state_lock:
                state["status"] = "idle"
            emit("status", {"status": "idle", "message": "사용자에 의해 중지"})
            self.send_json({"ok": True})

        elif path == "/api/reset":
            with state_lock:
                for t in state["tasks"]:
                    if t["status"] != "done":
                        t["status"] = "pending"
                        t["output"] = ""
                        t["started_at"] = None
                        t["ended_at"] = None
                state["status"] = "idle"
                state["current"] = -1
            with state_lock:
                save_todos(state["tasks"])
            emit("status", {"status": "idle", "message": "사용자에 의해 중지"})
            self.send_json({"ok": True})

        elif re.match(r'/api/tasks/(\d+)/retry$', path):
            m2 = re.match(r'/api/tasks/(\d+)/retry$', path)
            tid = int(m2.group(1))
            with state_lock:
                for t in state["tasks"]:
                    if t["id"] == tid:
                        t["status"] = "pending"
                        t["output"] = ""
                        t["started_at"] = None
                        t["ended_at"] = None
                        break
                save_todos(state["tasks"])
            self.send_json({"ok": True})

        elif path == "/api/tasks":
            text = body.get("text", "").strip()
            cmd  = body.get("command") or parse_command(text)
            tbody = (body.get("body") or "").strip("\n")
            ttest = (body.get("test") or "").strip()
            with state_lock:
                new_id = max((t["id"] for t in state["tasks"]), default=-1) + 1
                state["tasks"].append({
                    "id": new_id, "text": text, "body": tbody, "test": ttest, "branch": "",
                    "command": cmd, "status": "pending", "output": "",
                    "started_at": None, "ended_at": None,
                })
                save_todos(state["tasks"])
            self.send_json({"ok": True})

        else:
            # 플러그인이 등록한 백엔드 라우트(POST) 디스패치
            _pq = parse_qs(urlparse(self.path).query)
            handled, code, payload = dispatch_route(
                EP4_PM, "POST", path,
                {"method": "POST", "path": path, "query": _pq, "body": body,
                 "headers": dict(self.headers)})
            if handled:
                self.send_json(payload, code)
            else:
                self.send_response(404)
                self.end_headers()

    def do_PUT(self):
        path = urlparse(self.path).path
        length = int(self.headers.get("Content-Length", 0))
        try:
            body = json.loads(self.rfile.read(length)) if length else {}
        except (ValueError, UnicodeDecodeError):
            self.send_json({"ok": False, "error": "invalid request body"}, 400)
            return
        if not self._auth_ok():
            return
        # ── 외부용 태스크 수정: PUT /api/task/{id} (보낸 키만 부분 갱신) ──
        if path.startswith("/api/task/"):
            _tid_raw = path[len("/api/task/"):].strip("/")
            try:
                _tid = int(_tid_raw)
            except ValueError:
                self.send_json({"ok": False, "error": f"invalid task id: {_tid_raw}"}, 400); return
            _err, _changed, _pid = _update_task(_tid, body)
            if _err:
                self.send_json({"ok": False, "error": _err[0]}, _err[1]); return
            _info = _task_status(_tid)
            _info["changed"] = _changed
            self.send_json(_info)
            return

        m = re.match(r'/api/tasks/(\d+)$', path)
        if m:
            tid = int(m.group(1))
            with state_lock:
                for t in state["tasks"]:
                    if t["id"] == tid:
                        t["text"] = body.get("text", t["text"])
                        if "body" in body:
                            t["body"] = (body.get("body") or "").strip("\n")
                        if "test" in body:
                            t["test"] = (body.get("test") or "").strip()
                        t["command"] = body.get("command") or parse_command(t["text"])
                        break
                save_todos(state["tasks"])
            self.send_json({"ok": True})
        else:
            self.send_response(404)
            self.end_headers()

    def do_DELETE(self):
        path = urlparse(self.path).path
        if not self._auth_ok():
            return

        # peer 프록시 (DELETE 포워드)
        if path == "/api/peer-proxy":
            _pq = parse_qs(urlparse(self.path).query)
            _purl = _pq.get("url", [""])[0]
            _ppath = _pq.get("path", [""])[0]
            _peer_proxy_passthrough(self, "DELETE", _purl, _ppath)
            return

        # 설치된 Claude Skill 삭제: DELETE /api/claude/skills/{id}?scope=&project_id=
        if path.startswith("/api/claude/skills/"):
            sid = path.rsplit("/", 1)[-1].strip()
            if not sid or "/" in sid or ".." in sid:
                self.send_json({"ok": False, "error": "bad id"}, 400); return
            _q = parse_qs(urlparse(self.path).query)
            scope = (_q.get("scope", ["global"])[0] or "global").strip()
            try:
                base, _pn = _skills_base_dir(scope, _q.get("project_id", [""])[0])
            except Exception as e:
                self.send_json({"ok": False, "error": str(e)}); return
            target = (base / sid).resolve()
            try:
                target.relative_to(base.resolve())
            except ValueError:
                self.send_json({"ok": False, "error": "bad path"}, 400); return
            if not target.is_dir():
                self.send_json({"ok": False, "error": "설치되어 있지 않음"}); return
            try:
                shutil.rmtree(target)
                emit("plugins_changed", {"removed_skill": sid})
                self.send_json({"ok": True, "id": sid})
            except Exception as e:
                self.send_json({"ok": False, "error": str(e)})
            return

        # 설치된 Claude Agent 삭제: DELETE /api/claude/agents?rel=&scope=&project_id=
        # (에이전트는 파일이며 하위 폴더에 있을 수 있어 rel 은 쿼리로 받는다)
        if path == "/api/claude/agents":
            _q = parse_qs(urlparse(self.path).query)
            rel = (_q.get("rel", [""])[0] or "").strip()
            scope = (_q.get("scope", ["global"])[0] or "global").strip()
            if not rel:
                self.send_json({"ok": False, "error": "rel 필요"}, 400); return
            try:
                base, _pn = _agents_base_dir(scope, _q.get("project_id", [""])[0])
            except Exception as e:
                self.send_json({"ok": False, "error": str(e)}); return
            try:
                target = (base / rel).resolve()
                target.relative_to(base.resolve())
            except Exception:
                self.send_json({"ok": False, "error": "bad path"}, 400); return
            if not target.is_file():
                self.send_json({"ok": False, "error": "설치되어 있지 않음"}); return
            try:
                target.unlink()
                emit("plugins_changed", {"removed_agent": rel})
                self.send_json({"ok": True, "rel": rel})
            except Exception as e:
                self.send_json({"ok": False, "error": str(e)})
            return

        # 연결된 EP4(peer) 삭제: DELETE /api/peers/{id}
        if re.match(r'/api/peers/\d+$', path):
            try:
                peer_id = int(path.split("/")[3])
            except (IndexError, ValueError):
                self.send_json({"ok": False}, 400); return
            with sqlite3.connect(PROJECTS_DB) as conn:
                conn.execute("DELETE FROM ep4_peers WHERE id=?", (peer_id,))
                conn.commit()
            self.send_json({"ok": True, "peers": _list_peers()})
            return

        # 폴더 삭제: DELETE /api/projects/{pid}/folders/{fid}
        if re.match(r'/api/projects/\d+/folders/\d+$', path):
            parts = path.split("/")
            try:
                pid, fid = int(parts[3]), int(parts[5])
            except (IndexError, ValueError):
                self.send_response(400); self.end_headers(); return
            with sqlite3.connect(PROJECTS_DB) as conn:
                conn.execute(
                    "UPDATE project_tasks SET folder_id=NULL WHERE folder_id=? AND project_id=?",
                    (fid, pid)
                )
                conn.execute("DELETE FROM task_folders WHERE id=? AND project_id=?", (fid, pid))
                conn.commit()
            emit("tasks_changed", {"project_id": pid})
            self.send_json({"ok": True})
            return

        # 플러그인 삭제: DELETE /api/plugins/{id}
        if path.startswith("/api/plugins/") and len(path.split("/")) == 4:
            import shutil as _shutil
            pid = path.split("/")[3]
            installed_dir = INSTALLED_PLUGINS_DIR / pid
            builtin_dir   = PLUGINS_DIR / pid
            for check_dir in (installed_dir, builtin_dir):
                mf_path = check_dir / "plugin.json"
                if mf_path.exists():
                    try:
                        mf = json.loads(mf_path.read_text(encoding="utf-8"))
                        if mf.get("required"):
                            self.send_json({"ok": False, "error": "필수 플러그인은 삭제할 수 없습니다."}); return
                    except Exception:
                        pass
                    break
            if installed_dir.exists():
                _shutil.rmtree(installed_dir)
                with sqlite3.connect(PROJECTS_DB) as conn:
                    conn.execute("DELETE FROM installed_plugins WHERE id=?", (pid,))
                    conn.commit()
            else:
                # 폴더 없는 내장 에이전트: DB에 비활성 기록
                with sqlite3.connect(PROJECTS_DB) as conn:
                    conn.execute(
                        "INSERT INTO installed_plugins (id, type, enabled, sort_order) VALUES (?,?,0,99) "
                        "ON CONFLICT(id) DO UPDATE SET enabled=0",
                        (pid, "agent"))
                    conn.commit()
            emit("plugins_changed", {"uninstalled": pid})
            self.send_json({"ok": True, "id": pid})
            return

        if path.startswith("/api/sessions/"):
            parts = path.split("/")
            if len(parts) == 4:
                sid = parts[3]
                ok = session_kill(sid)
                self.send_json({"ok": ok})
            elif len(parts) == 5 and parts[4] == "output":
                # 출력 버퍼 삭제
                sid = parts[3]
                with _sessions_lock:
                    if sid in _sessions:
                        _sessions[sid]["output"] = []
                        _sessions[sid]["last_output"] = ""
                        _sessions[sid]["screen_html"] = ""
                        _sessions[sid]["screen_text"] = ""
                self.send_json({"ok": True})
            else:
                self.send_response(404); self.end_headers()
            return

        m = re.match(r'/api/tasks/(\d+)$', path)
        if m:
            tid = int(m.group(1))
            with state_lock:
                state["tasks"] = [t for t in state["tasks"] if t["id"] != tid]
                save_todos(state["tasks"])
            self.send_json({"ok": True})
        else:
            self.send_response(404)
            self.end_headers()


# ── 진입점 ─────────────────────────────────────────────
def _load_ep4_conf():
    base = Path(__file__).resolve().parent / "conf"
    conf: dict = {}
    for name in ("ep4.conf", "ep4.local.conf"):
        p = base / name
        if p.exists():
            try:
                conf.update(json.loads(p.read_text(encoding="utf-8-sig")))
            except Exception:
                pass
    return conf


def _ensure_auth_token(conf: dict) -> str:
    """conf에서 auth_token을 읽고, 없으면 새로 생성해 conf/ep4.local.conf에 저장한다.
    auth_enabled 가 명시적으로 False면 인증을 끄고 빈 문자열을 반환한다."""
    if conf.get("auth_enabled") is False:
        return ""
    tok = (conf.get("auth_token") or "").strip()
    if tok:
        return tok
    tok = secrets.token_urlsafe(32)
    base = Path(__file__).resolve().parent / "conf"
    base.mkdir(parents=True, exist_ok=True)
    local_p = base / "ep4.local.conf"
    data = {}
    if local_p.exists():
        try:
            data = json.loads(local_p.read_text(encoding="utf-8-sig"))
        except Exception:
            data = {}
    data["auth_token"] = tok
    try:
        local_p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass
    return tok


_PID_FILE = Path(__file__).resolve().parent / "server" / "ep4.pid"


def _write_pid(port: int):
    try:
        _PID_FILE.parent.mkdir(parents=True, exist_ok=True)
        _PID_FILE.write_text(json.dumps({"pid": os.getpid(), "port": port}))
    except Exception:
        pass


def _remove_pid():
    try:
        _PID_FILE.unlink(missing_ok=True)
    except Exception:
        pass


def main():
    global _EP4_RUNNING_PORT, _AUTH_TOKEN, _CLI_AUTO_COMMIT, _FIREBASE_DB
    ep4_conf = _load_ep4_conf()
    # Firebase 주소는 로컬 설정에서만 읽는다 (conf/ep4.local.conf — 저장소에 커밋되지 않음)
    _FIREBASE_DB = str(ep4_conf.get("firebase_db_url") or "").strip().rstrip("/")
    default_port = ep4_conf.get("port", 7788)
    default_bind = ep4_conf.get("bind", "localhost")
    port = int(sys.argv[1]) if len(sys.argv) > 1 else default_port
    bind = sys.argv[2] if len(sys.argv) > 2 else default_bind
    _AUTH_TOKEN = _ensure_auth_token(ep4_conf)   # 인바운드 API 인증 토큰 로드/생성
    _CLI_AUTO_COMMIT = bool(ep4_conf.get("cli_auto_commit", False))
    _EP4_RUNNING_PORT = port   # 스크린샷 재시작이 자기 포트를 죽이지 않도록 기록
    BASE_DIR.mkdir(parents=True, exist_ok=True)
    with state_lock:
        state["tasks"] = load_todos()

    start_all_sync_agents()   # gate 연동 프로젝트 수신 동기화 시작
    threading.Thread(target=_antigravity_history_watcher, daemon=True).start()  # Antigravity CLI 입력 감시
    _sync_peer_relays()       # 연결된 peer EP4 이벤트 릴레이 시작
    threading.Thread(target=_peer_push_loop, daemon=True).start()  # peer 로 내 프로젝트 목록 push (NAT 뒤 상대 표시용)

    server = ThreadedHTTPServer((bind, port), Handler)
    _write_pid(port)
    url = f"http://localhost:{port}"
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    _discover_manager()
    print()
    print("  +--------------------------------------+")
    print("  |   EasyProject4                       |")
    print(f"  |   {url:<36}|")
    print("  |   Press any key to stop              |")
    print("  +--------------------------------------+")
    if _AUTH_TOKEN:
        print()
        print("  [인증 토큰] 외부/모바일/훅 접속 시 아래 토큰이 필요합니다:")
        print(f"    {_AUTH_TOKEN}")
        print("    · 웹: 첫 접속 시 로그인 화면에 입력  · 훅/MCP: 환경변수 EP4_TOKEN 로 지정")
        print("    · 저장 위치: conf/ep4.local.conf (auth_token)")
    print()

    # 등록된 peer EP4 연결 상태를 시작 직후 콘솔에 표시 (성공/실패 모두)
    threading.Thread(target=_peer_startup_check, daemon=True).start()
    # 스킬 마켓 캐시 갱신 + 설명·SKILL.md 한국어 사전 번역 (백그라운드)
    threading.Thread(target=_skill_market_warmup, daemon=True).start()

    # 콘솔 없이 기동(헤드리스/백그라운드)할 때는 EP4_NO_WAIT_KEY=1 로 키 대기 스레드를
    # 띄우지 않는다. run.bat(포그라운드)에서는 설정하지 않으므로 키 입력으로 종료된다.
    if not os.environ.get("EP4_NO_WAIT_KEY"):
        def wait_for_key():
            try:
                import msvcrt
                time.sleep(0.3)
                while msvcrt.kbhit():
                    msvcrt.getch()
                # 실제 키 입력만 종료로 인정한다. 0xff(EOF/입력없음)·0x00·0xe0(특수키
                # 프리픽스)는 무시 — 스크린샷 등 서브프로세스가 콘솔을 건드려 getch 가
                # 가짜 EOF 를 반환하면 서버가 멋대로 종료되던 문제 방지.
                while True:
                    _ch = msvcrt.getch()
                    if _ch in (b'\x00', b'\xe0'):   # 함수/화살표 키 — 다음 바이트 소비 후 무시
                        msvcrt.getch()
                        continue
                    if _ch == b'\xff':              # EOF/입력 없음 — 무시하고 계속 대기
                        time.sleep(0.5)
                        continue
                    break
            except ImportError:
                input()
            print("\n  Stopping EasyProject4...")
            server.shutdown()

        threading.Thread(target=wait_for_key, daemon=True).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        _remove_pid()
    if not os.environ.get("EP4_NO_WAIT_KEY"):
        print("  EasyProject4 stopped.")


if __name__ == "__main__":
    main()

