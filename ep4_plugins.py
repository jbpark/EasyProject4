"""
EP4 플러그인 프레임워크 (pluggy 기반)

서버(server.py)의 흩어져 있던 플러그인 스캔/에이전트/토글 로직을 pluggy 훅으로 통합한다.
- hookspec: 확장 지점 정의 (EP4Spec)
- CorePlugin: 기본 동작 구현 (폴더 스캔, 내장 에이전트 목록)
- 각 plugins/<id>/backend.py 가 있으면 선택적으로 로드해 백엔드 훅을 등록한다.

플러그인 작성자는 backend.py 에서 다음과 같이 훅을 구현한다:

    from ep4_plugins import hookimpl

    @hookimpl
    def ep4_register_routes():
        def handler(ctx):
            return {"ok": True, "items": [...]}
        return [{"method": "GET", "path": "/api/myplugin/items", "handler": handler}]

    @hookimpl
    def ep4_on_task_done(run):
        ...  # run dict: run_id, project_id, status, project_root ...
"""

import re
import json
import importlib.util
from pathlib import Path

import pluggy

PROJECT_NAME = "ep4"

hookspec = pluggy.HookspecMarker(PROJECT_NAME)
hookimpl = pluggy.HookimplMarker(PROJECT_NAME)

_ROOT = Path(__file__).resolve().parent
BUNDLED_PLUGINS_DIR   = _ROOT / "dist" / "plugins"   # 번들드 플러그인
INSTALLED_PLUGINS_DIR = _ROOT / "plugins"            # 설치된 플러그인

# 카테고리 폴더 이름 (plugins/View/, plugins/MCP/ 등)
CATEGORY_DIRS = {"View", "MCP", "Data", "Helper"}


def _iter_plugin_dirs(base_dir: Path):
    """base_dir 내 plugin.json 을 가진 디렉토리를 순서대로 yield 한다.
    카테고리 하위 구조(View/, MCP/, Data/, Helper/)도 투명하게 지원한다."""
    if not base_dir.exists():
        return
    for d in sorted(base_dir.iterdir()):
        if not d.is_dir():
            continue
        if (d / "plugin.json").exists():
            yield d          # 플랫 구조: plugins/<id>/
        elif d.name in CATEGORY_DIRS:
            for sub in sorted(d.iterdir()):  # 카테고리 구조: plugins/<Cat>/<id>/
                if sub.is_dir() and (sub / "plugin.json").exists():
                    yield sub


# ── 훅 명세 (확장 지점) ───────────────────────────────────
class EP4Spec:
    """EP4 플러그인 훅 명세."""

    @hookspec
    def ep4_collect_manifests(self):
        """플러그인 매니페스트(dict)들의 리스트를 반환한다.
        여러 구현의 결과는 모두 합쳐지며, 같은 id 는 나중 항목이 우선한다."""

    @hookspec
    def ep4_collect_agents(self):
        """에이전트(마스코트) 정의(dict)들의 리스트를 반환한다."""

    @hookspec
    def ep4_register_routes(self):
        """백엔드 HTTP 라우트 디스크립터 리스트를 반환한다.
        각 항목: {"method": "GET"|"POST"|..., "path": "/api/...", "handler": fn}
        path 는 {name} 플레이스홀더를 쓸 수 있고, handler(ctx) 시그니처를 따른다.
        ctx = {method, path, query(dict[list]), body(dict), params(dict), headers}
        handler 반환값: dict | (status_int, dict) | None(=처리 안 함)"""

    @hookspec
    def ep4_on_task_done(self, run):
        """태스크 실행 완료 시 호출된다. run: 실행 결과 dict."""

    @hookspec
    def ep4_on_plugin_toggle(self, plugin_id, enabled):
        """플러그인이 활성/비활성으로 토글될 때 호출된다."""


# ── 기본 구현 (코어 플러그인) ─────────────────────────────
class CorePlugin:
    """폴더 스캔 매니페스트 + 내장 에이전트 목록을 제공하는 기본 플러그인."""

    @hookimpl
    def ep4_collect_manifests(self):
        out = []
        # 번들드 먼저, 설치됨 나중 (같은 id 는 설치본이 우선)
        for base_dir in (BUNDLED_PLUGINS_DIR, INSTALLED_PLUGINS_DIR):
            is_builtin = (base_dir == BUNDLED_PLUGINS_DIR)
            for plugin_dir in _iter_plugin_dirs(base_dir):
                try:
                    manifest = json.loads((plugin_dir / "plugin.json").read_text(encoding="utf-8"))
                    pid = manifest.get("id") or plugin_dir.name
                    manifest["id"] = pid
                    manifest["bundled"] = is_builtin
                    out.append(manifest)
                except Exception:
                    continue
        return out

    @hookimpl
    def ep4_collect_agents(self):
        """plugins/Helper/ 폴더에서 type=agent 인 매니페스트를 수집한다."""
        agents = []
        for base_dir in (BUNDLED_PLUGINS_DIR, INSTALLED_PLUGINS_DIR):
            helper_dir = base_dir / "Helper"
            if not helper_dir.exists():
                continue
            for d in sorted(helper_dir.iterdir()):
                mf = d / "plugin.json"
                if not d.is_dir() or not mf.exists():
                    continue
                try:
                    manifest = json.loads(mf.read_text(encoding="utf-8"))
                    if manifest.get("type") == "agent":
                        manifest.setdefault("id", d.name)
                        manifest.setdefault("enabled", True)
                        agents.append(manifest)
                except Exception:
                    continue
        return agents


# ── 플러그인 매니저 (싱글톤) ──────────────────────────────
_PM = None
_plugin_load_errors: dict = {}  # pid -> 에러 메시지 (backend.py 로드 실패 추적)


def _discover_backend_modules(pm: "pluggy.PluginManager") -> None:
    """plugins/<id>/backend.py 들을 동적 로드해 훅 구현으로 등록한다.
    카테고리 하위 구조(View/, MCP/ 등)도 지원한다.
    하나가 실패해도 서버는 계속 동작하며, 에러는 _plugin_load_errors 에 기록된다."""
    global _plugin_load_errors
    _plugin_load_errors = {}
    seen = set()
    for base_dir in (INSTALLED_PLUGINS_DIR, BUNDLED_PLUGINS_DIR):
        for plugin_dir in _iter_plugin_dirs(base_dir):
            backend = plugin_dir / "backend.py"
            if not backend.exists():
                continue
            pid = plugin_dir.name
            if pid in seen:
                continue   # 설치본이 번들드보다 우선
            seen.add(pid)
            mod_name = f"ep4_plugin_{pid}_backend"
            try:
                spec = importlib.util.spec_from_file_location(mod_name, backend)
                module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(module)
                pm.register(module, name=mod_name)
            except Exception as e:
                _plugin_load_errors[pid] = str(e)
                print(f"[plugins] backend 로드 실패 · {pid}: {e}")


def get_plugin_manager(reload: bool = False) -> "pluggy.PluginManager":
    """EP4 플러그인 매니저 싱글톤을 반환한다."""
    global _PM, _route_cache
    if _PM is not None and not reload:
        return _PM
    pm = pluggy.PluginManager(PROJECT_NAME)
    pm.add_hookspecs(EP4Spec)
    pm.register(CorePlugin(), name="ep4_core")
    _discover_backend_modules(pm)
    _PM = pm
    _route_cache = None   # 라우트 캐시 무효화
    return pm


def get_plugin_load_errors() -> dict:
    """backend.py 로드에 실패한 플러그인의 {pid: error} 딕셔너리를 반환한다."""
    return dict(_plugin_load_errors)


def invalidate_route_cache() -> None:
    """라우트 캐시를 무효화한다. 플러그인 토글·설치·제거 후 호출해야 한다."""
    global _route_cache
    _route_cache = None


# ── 활성 플러그인 체커 (server.py 에서 주입) ─────────────
_enabled_checker = None


def register_enabled_checker(fn) -> None:
    """활성 plugin_id 집합을 반환하는 함수를 등록한다.
    dispatch_route 호출 시 비활성 플러그인의 라우트를 자동으로 건너뛴다.
    server.py 초기화 시점에 _get_plugins 가 정의된 후 호출한다."""
    global _enabled_checker
    _enabled_checker = fn


# ── 라우트 매칭/디스패치 ──────────────────────────────────
def _compile_path(pattern: str):
    """'/api/x/{id}/items' → 컴파일된 정규식. {name} 은 named group 으로 변환."""
    parts = re.split(r"(\{[a-zA-Z_][a-zA-Z0-9_]*\})", pattern)
    rx = ""
    for p in parts:
        if p.startswith("{") and p.endswith("}"):
            name = p[1:-1]
            rx += f"(?P<{name}>[^/]+)"
        else:
            rx += re.escape(p)
    return re.compile("^" + rx + "$")


def _extract_plugin_id(name: str) -> "str | None":
    """'ep4_plugin_{pid}_backend' 형태의 등록 이름에서 pid를 추출한다.
    코어·알 수 없는 플러그인은 None 반환 (항상 활성으로 취급)."""
    prefix, suffix = "ep4_plugin_", "_backend"
    if name and name.startswith(prefix) and name.endswith(suffix):
        return name[len(prefix):-len(suffix)]
    return None


_route_cache = None


def _collect_routes(pm: "pluggy.PluginManager") -> list:
    """모든 플러그인의 라우트를 (method, compiled_regex, handler, plugin_id) 리스트로 캐시.
    hookimpl 별로 순회해 각 라우트에 등록 플러그인 id를 연결한다."""
    global _route_cache
    if _route_cache is not None:
        return _route_cache
    routes = []
    for hi in reversed(pm.hook.ep4_register_routes.get_hookimpls()):
        pid = _extract_plugin_id(hi.plugin_name)
        try:
            route_list = hi.function() or []
        except Exception as e:
            print(f"[plugins] 라우트 수집 오류 · {hi.plugin_name}: {e}")
            continue
        for r in route_list:
            try:
                method = (r.get("method") or "GET").upper()
                path = r["path"]
                handler = r["handler"]
                routes.append((method, _compile_path(path), handler, pid))
            except Exception as e:
                print(f"[plugins] 라우트 등록 오류: {e}")
    _route_cache = routes
    return routes


def dispatch_route(pm, method: str, path: str, ctx: dict):
    """플러그인 라우트를 찾아 실행한다.
    _enabled_checker 가 등록된 경우 비활성 플러그인의 라우트를 건너뛴다.
    반환: (handled: bool, status: int, payload: dict)"""
    routes = _collect_routes(pm)
    if not routes:
        return False, 404, {}
    enabled_ids = _enabled_checker() if _enabled_checker else None
    for rmethod, rx, handler, pid in routes:
        if rmethod != method.upper():
            continue
        # pid 가 None 인 라우트(코어)는 항상 통과
        if pid is not None and enabled_ids is not None and pid not in enabled_ids:
            continue
        m = rx.match(path)
        if not m:
            continue
        ctx = dict(ctx)
        ctx["params"] = m.groupdict()
        try:
            result = handler(ctx)
        except Exception as e:
            return True, 500, {"ok": False, "error": str(e)}
        if result is None:
            return True, 204, {}
        if isinstance(result, tuple) and len(result) == 2:
            return True, int(result[0]), result[1]
        return True, 200, result
    return False, 404, {}
