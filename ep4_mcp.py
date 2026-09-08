#!/usr/bin/env python3
"""EP4 MCP Server — EP4 REST API를 Claude CLI MCP 툴로 노출."""
import json
import sys
import os
import urllib.request
import urllib.error
from pathlib import Path

EP4_BASE_URL = os.environ.get("EP4_BASE_URL", "http://localhost:7788")


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


def _ep4_get(path):
    req = urllib.request.Request(f"{EP4_BASE_URL}{path}", headers=_auth_headers())
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read().decode())


def _ep4_post(path, body):
    data = json.dumps(body, ensure_ascii=False).encode()
    req = urllib.request.Request(
        f"{EP4_BASE_URL}{path}", data=data,
        headers=_auth_headers({"Content-Type": "application/json"}),
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read().decode())


def _find_project(cwd=None):
    cwd_path = Path(cwd or os.getcwd()).resolve()
    projects = _ep4_get("/api/projects")
    for proj in projects:
        root = (proj.get("project_root") or "").strip()
        if not root:
            continue
        try:
            proj_path = Path(root).resolve()
            if cwd_path == proj_path or str(cwd_path).startswith(str(proj_path) + os.sep):
                return proj
        except Exception:
            continue
    return None


# ── MCP 툴 정의 ────────────────────────────────────────────────
TOOLS = [
    {
        "name": "ep4_find_project",
        "description": (
            "현재 작업 디렉토리(또는 지정 경로)와 일치하는 EP4 프로젝트를 찾습니다. "
            "태스크 등록 전에 먼저 호출하여 project_id를 확인하세요."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "cwd": {"type": "string", "description": "검색 기준 경로 (생략 시 현재 디렉토리)"},
            },
        },
    },
    {
        "name": "ep4_create_task",
        "description": (
            "EP4 프로젝트에 태스크를 등록합니다. "
            "title은 현재 Claude에게 요청된 작업의 요약, prompt는 전체 지시 내용입니다."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "project_id": {"type": "integer", "description": "EP4 프로젝트 ID"},
                "title": {"type": "string", "description": "태스크 제목 (100자 이내 요약)"},
                "prompt": {"type": "string", "description": "상세 지시 내용"},
            },
            "required": ["project_id", "title"],
        },
    },
    {
        "name": "ep4_log_result",
        "description": (
            "작업 완료 후 결과를 EP4 실행 로그(task_runs)에 기록합니다. "
            "작업이 끝나면 반드시 호출하여 결과를 저장하세요."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "project_id": {"type": "integer"},
                "task_id": {"type": "integer"},
                "output": {"type": "string", "description": "작업 결과 요약"},
                "status": {
                    "type": "string",
                    "enum": ["done", "error"],
                    "description": "완료 여부",
                },
            },
            "required": ["project_id", "task_id", "output"],
        },
    },
    {
        "name": "ep4_list_projects",
        "description": "EP4에 등록된 프로젝트 목록과 각 project_root 경로를 반환합니다.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "ep4_list_menus",
        "description": (
            "EP4에 설치된 메뉴(플러그인) 목록과 각 메뉴의 설명·라우트를 반환합니다. "
            "사용자가 'EP4에서 무엇을 할 수 있어?', '메뉴 알려줘' 등을 물으면 호출하세요."
        ),
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "ep4_describe_menu",
        "description": (
            "특정 메뉴(플러그인)의 상세 설명과 사용 가능한 액션(action) 목록을 반환합니다. "
            "menu_id는 ep4_list_menus의 id를 사용합니다."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {"menu_id": {"type": "string", "description": "메뉴/플러그인 id"}},
            "required": ["menu_id"],
        },
    },
    {
        "name": "ep4_get_deeplink",
        "description": (
            "메뉴의 특정 액션에 대한 딥링크 URL을 생성합니다. 사용자에게 '여기를 누르세요' 식으로 "
            "안내할 때 사용합니다. params로 {id} 같은 템플릿 변수를 채웁니다."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "menu_id": {"type": "string"},
                "action": {"type": "string", "description": "액션 id (생략 시 메뉴 기본 라우트)"},
                "params": {"type": "object", "description": "딥링크 템플릿 변수 (예: {\"id\": 3})"},
            },
            "required": ["menu_id"],
        },
    },
    {
        "name": "ep4_run_action",
        "description": (
            "EP4 웹 대시보드에서 특정 메뉴/액션을 실제로 실행(화면 전환)합니다. "
            "대시보드가 열려 있는 브라우저가 해당 화면으로 이동합니다."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "menu_id": {"type": "string"},
                "action": {"type": "string"},
                "params": {"type": "object"},
            },
            "required": ["menu_id"],
        },
    },
]


def _fill_deeplink(template, params):
    """딥링크 템플릿의 {key}를 params 값으로 치환."""
    out = template or ""
    for k, v in (params or {}).items():
        out = out.replace("{" + str(k) + "}", str(v))
    return out


def _resolve_action(menu_id, action_id):
    """매니페스트에서 메뉴와 액션을 찾아 (menu, action) 반환."""
    data = _ep4_get("/api/plugins")
    menus = data.get("plugins", []) if isinstance(data, dict) else []
    menu = next((m for m in menus if m.get("id") == menu_id), None)
    if not menu:
        return None, None
    action = None
    if action_id:
        action = next((a for a in (menu.get("actions") or []) if a.get("id") == action_id), None)
    return menu, action


def _handle(name, args):
    if name == "ep4_find_project":
        proj = _find_project(args.get("cwd"))
        if proj:
            return {
                "found": True,
                "id": proj["id"],
                "name": proj["name"],
                "project_root": proj.get("project_root", ""),
                "status": proj.get("status", ""),
            }
        return {"found": False, "message": "현재 디렉토리와 일치하는 EP4 프로젝트가 없습니다."}

    elif name == "ep4_create_task":
        result = _ep4_post(
            f"/api/projects/{args['project_id']}/tasks",
            {
                "title": args["title"],
                "prompt": args.get("prompt", ""),
                "trigger_type": "claude_cli",
            },
        )
        return result

    elif name == "ep4_log_result":
        result = _ep4_post(
            f"/api/projects/{args['project_id']}/tasks/{args['task_id']}/log-result",
            {
                "output": args["output"],
                "status": args.get("status", "done"),
            },
        )
        return result

    elif name == "ep4_list_projects":
        projects = _ep4_get("/api/projects")
        return [
            {"id": p["id"], "name": p["name"], "project_root": p.get("project_root", "")}
            for p in projects
        ]

    elif name == "ep4_list_menus":
        data = _ep4_get("/api/plugins")
        menus = data.get("plugins", []) if isinstance(data, dict) else []
        return [
            {
                "id": m.get("id"), "name": m.get("name"), "type": m.get("type", "view"),
                "route": m.get("route", ""), "enabled": m.get("enabled", True),
                "description": m.get("description", ""),
            }
            for m in menus if m.get("enabled", True)
        ]

    elif name == "ep4_describe_menu":
        menu, _ = _resolve_action(args["menu_id"], None)
        if not menu:
            return {"found": False, "message": f"메뉴를 찾을 수 없습니다: {args['menu_id']}"}
        return {
            "found": True, "id": menu.get("id"), "name": menu.get("name"),
            "type": menu.get("type", "view"), "route": menu.get("route", ""),
            "description": menu.get("description", ""),
            "actions": [
                {"id": a.get("id"), "label": a.get("label"),
                 "description": a.get("description", ""),
                 "deeplink": a.get("deeplink", ""), "params": a.get("params", [])}
                for a in (menu.get("actions") or [])
            ],
        }

    elif name == "ep4_get_deeplink":
        menu, action = _resolve_action(args["menu_id"], args.get("action"))
        if not menu:
            return {"error": f"메뉴를 찾을 수 없습니다: {args['menu_id']}"}
        template = (action or {}).get("deeplink") or f"/#/view/{menu.get('route','')}"
        path = _fill_deeplink(template, args.get("params"))
        return {"url": f"{EP4_BASE_URL}{path}", "menu": menu.get("name"),
                "action": (action or {}).get("label", "열기")}

    elif name == "ep4_run_action":
        menu, action = _resolve_action(args["menu_id"], args.get("action"))
        if not menu:
            return {"error": f"메뉴를 찾을 수 없습니다: {args['menu_id']}"}
        result = _ep4_post("/api/shell/navigate", {
            "route": menu.get("route", ""),
            "action": args.get("action", ""),
            "params": args.get("params") or {},
        })
        return result

    else:
        return {"error": f"알 수 없는 툴: {name}"}


# ── MCP stdio 프로토콜 ─────────────────────────────────────────
def _send(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main():
    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        try:
            req = json.loads(raw)
        except json.JSONDecodeError:
            continue

        method = req.get("method", "")
        req_id = req.get("id")

        if method == "initialize":
            _send({
                "jsonrpc": "2.0", "id": req_id,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "ep4-mcp", "version": "1.0"},
                },
            })

        elif method in ("notifications/initialized", "initialized"):
            pass  # 응답 불필요

        elif method == "ping":
            _send({"jsonrpc": "2.0", "id": req_id, "result": {}})

        elif method == "tools/list":
            _send({"jsonrpc": "2.0", "id": req_id, "result": {"tools": TOOLS}})

        elif method == "tools/call":
            params = req.get("params", {})
            tool_name = params.get("name", "")
            arguments = params.get("arguments") or {}
            try:
                result = _handle(tool_name, arguments)
                text = json.dumps(result, ensure_ascii=False, indent=2)
            except urllib.error.URLError as e:
                text = json.dumps({"error": f"EP4 서버 연결 실패: {e}"}, ensure_ascii=False)
            except Exception as e:
                text = json.dumps({"error": str(e)}, ensure_ascii=False)
            _send({
                "jsonrpc": "2.0", "id": req_id,
                "result": {"content": [{"type": "text", "text": text}]},
            })

        elif req_id is not None:
            _send({
                "jsonrpc": "2.0", "id": req_id,
                "error": {"code": -32601, "message": f"Method not found: {method}"},
            })


if __name__ == "__main__":
    main()
