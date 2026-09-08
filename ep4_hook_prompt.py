#!/usr/bin/env python3
"""UserPromptSubmit hook — Claude CLI 입력을 EP4 태스크로 자동 등록."""
import json
import sys
import os
import urllib.request
import urllib.error
from pathlib import Path

EP4_BASE_URL = os.environ.get("EP4_BASE_URL", "http://localhost:7788")
TEMP_DIR = Path(os.environ.get("TEMP", os.environ.get("TMP", "/tmp")))


def _load_token() -> str:
    """인증 토큰: 환경변수 EP4_TOKEN → conf/ep4.local.conf(auth_token) 순으로 탐색."""
    tok = os.environ.get("EP4_TOKEN", "").strip()
    if tok:
        return tok
    conf = Path(__file__).resolve().parent / "conf" / "ep4.local.conf"
    try:
        return (json.loads(conf.read_text(encoding="utf-8")).get("auth_token") or "").strip()
    except Exception:
        return ""


EP4_TOKEN = _load_token()


def _auth_headers(extra=None):
    h = dict(extra or {})
    if EP4_TOKEN:
        h["Authorization"] = "Bearer " + EP4_TOKEN
    return h
# 호출 CLI 구분: 인자 > 환경변수 > 기본(claude_cli). gemini/Antigravity 훅은
# "antigravity_cli" 를 넘긴다.
TRIGGER_TYPE = (sys.argv[1] if len(sys.argv) > 1 else
                os.environ.get("EP4_TRIGGER_TYPE", "claude_cli")).strip() or "claude_cli"


def main():
    # EP4 서버 내부 호출(번역·챗·하네스 실행 등)은 태스크로 등록하지 않는다.
    if os.environ.get("EP4_INTERNAL_CALL"):
        return

    try:
        payload = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    except Exception:
        return

    prompt = (payload.get("prompt") or "").strip()
    session_id = payload.get("session_id") or "default"
    cwd = payload.get("cwd") or os.getcwd()

    if not prompt:
        return

    # 하네스가 주입한 자동 메시지(백그라운드 에이전트 완료 알림 등)는 새 태스크로 등록하지 않는다.
    # 상태 파일을 그대로 두어 Stop 훅이 원래 태스크의 답변을 계속 갱신하게 한다.
    injected_prefixes = ("<task-notification>", "<system-reminder>",
                         "<local-command-stdout>", "<command-name>",
                         "<local-command-caveat>")
    if prompt.startswith(injected_prefixes):
        return

    try:
        req = urllib.request.Request(f"{EP4_BASE_URL}/api/projects", headers=_auth_headers())
        with urllib.request.urlopen(req, timeout=5) as r:
            projects = json.loads(r.read().decode())
    except Exception:
        return  # EP4 서버가 없으면 조용히 종료

    cwd_path = Path(cwd).resolve()
    matched = None
    for proj in projects:
        root = (proj.get("project_root") or "").strip()
        if not root:
            continue
        try:
            proj_path = Path(root).resolve()
            if cwd_path == proj_path or str(cwd_path).startswith(str(proj_path) + os.sep):
                matched = proj
                break
        except Exception:
            continue

    if not matched:
        # 매칭 프로젝트 없음 — CWD 기반으로 자동 생성
        proj_name = cwd_path.name or "Claude CLI 프로젝트"
        try:
            body = json.dumps(
                {"name": proj_name, "project_root": str(cwd_path)},
                ensure_ascii=False,
            ).encode()
            req = urllib.request.Request(
                f"{EP4_BASE_URL}/api/projects",
                data=body,
                headers=_auth_headers({"Content-Type": "application/json"}),
            )
            with urllib.request.urlopen(req, timeout=5) as r:
                result = json.loads(r.read().decode())
            if not result.get("ok"):
                return
            matched = {"id": result["id"], "name": proj_name}
        except Exception:
            return

    title = prompt.split("\n")[0].strip()[:100] or "Claude CLI 작업"

    try:
        body = json.dumps(
            {"title": title, "prompt": prompt, "trigger_type": TRIGGER_TYPE},
            ensure_ascii=False,
        ).encode()
        req = urllib.request.Request(
            f"{EP4_BASE_URL}/api/projects/{matched['id']}/tasks",
            data=body,
            headers=_auth_headers({"Content-Type": "application/json"}),
        )
        with urllib.request.urlopen(req, timeout=5) as r:
            result = json.loads(r.read().decode())
    except Exception:
        return

    task_id = result.get("id")
    if not task_id:
        return

    # Stop 훅에서 사용할 세션 정보 저장
    state_file = TEMP_DIR / f"ep4_{session_id}.json"
    try:
        state_file.write_text(
            json.dumps({
                "project_id": matched["id"],
                "task_id": task_id,
                "project_name": matched.get("name", ""),
            }),
            encoding="utf-8",
        )
    except Exception:
        pass


if __name__ == "__main__":
    main()
