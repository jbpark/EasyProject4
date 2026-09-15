import json, sys, os

cmd = sys.argv[1] if len(sys.argv) > 1 else ""

if cmd == "port":
    conf = {}
    if os.path.exists("conf/ep4.conf"):
        try:
            conf = json.load(open("conf/ep4.conf", encoding="utf-8-sig"))
        except Exception:
            pass
    print(conf.get("port", 7788))

elif cmd == "pid":
    pid_file = "server/ep4.pid"
    if os.path.exists(pid_file):
        try:
            d = json.load(open(pid_file))
            print(d["pid"])
        except Exception:
            pass

elif cmd == "killport":
    # 지정 포트를 LISTEN 중인 모든 프로세스를 종료한다(좀비/다중 인스턴스 정리).
    import subprocess, re
    port = sys.argv[2] if len(sys.argv) > 2 else "7788"
    try:
        out = subprocess.run(["netstat", "-ano", "-p", "TCP"],
                             capture_output=True, text=True).stdout
    except Exception:
        out = ""
    pids = set()
    for line in out.splitlines():
        parts = line.split()
        # 예: TCP  127.0.0.1:7788  0.0.0.0:0  LISTENING  13492
        if len(parts) >= 5 and parts[3] == "LISTENING":
            local = parts[1]
            if local.endswith(":" + port):
                pid = parts[4]
                if pid.isdigit() and pid != "0":
                    pids.add(pid)
    for pid in pids:
        subprocess.run(["taskkill", "/PID", pid, "/F"],
                       capture_output=True, text=True)
        print(f"killed {pid}")

elif cmd == "mcp":
    # ~/.claude.json 의 mcpServers.ep4 가 이 저장소를 가리키는지 점검하고 없으면 추가한다.
    # run.bat 이 서버 기동 전에 호출한다.
    #
    # 훅(~/.claude/settings.json)과 MCP(~/.claude.json)는 파일이 서로 다르다.
    # 인증 토큰은 ep4_mcp.py 가 자기 옆의 conf/ep4.local.conf 에서 스스로 읽으므로
    # 환경변수로 심지 않는다 (설정 파일에 토큰을 남기지 않기 위함).
    import datetime
    import pathlib

    ROOT = pathlib.Path(__file__).resolve().parent
    MCP_SCRIPT = ROOT / "ep4_mcp.py"
    CLAUDE_JSON = pathlib.Path.home() / ".claude.json"

    if not MCP_SCRIPT.is_file():
        print(f"[EP4] {MCP_SCRIPT.name} 이 없어 MCP 설정을 건너뜁니다.")
        sys.exit(0)

    # 포트는 conf/ep4.conf 를 따른다 (기본 7788)
    port = 7788
    try:
        port = int(json.loads((ROOT / "conf" / "ep4.conf").read_text(encoding="utf-8-sig"))
                   .get("port", 7788))
    except Exception:
        pass
    want_args = [str(MCP_SCRIPT)]
    want_url = f"http://localhost:{port}"

    if not CLAUDE_JSON.is_file():
        # Claude CLI 가 한 번도 실행되지 않은 상태. 이 파일은 CLI 가 자기 상태를 담아
        # 관리하므로 우리가 새로 만들지 않는다.
        print(f"[EP4] {CLAUDE_JSON} 이 없어 MCP 설정을 건너뜁니다 (Claude CLI 최초 실행 후 다시 시도).")
        sys.exit(0)

    try:
        raw = CLAUDE_JSON.read_text(encoding="utf-8-sig")
        data = json.loads(raw)
    except Exception as e:
        print(f"[EP4] {CLAUDE_JSON} 을 읽을 수 없어 MCP 설정을 건너뜁니다: {e}")
        sys.exit(0)
    if not isinstance(data, dict):
        print(f"[EP4] {CLAUDE_JSON} 형식이 예상과 달라 MCP 설정을 건너뜁니다.")
        sys.exit(0)

    servers = data.get("mcpServers")
    if not isinstance(servers, dict):
        servers = {}
    cur = servers.get("ep4")
    changed, action = False, ""

    if not isinstance(cur, dict):
        servers["ep4"] = {"type": "stdio", "command": "python",
                          "args": want_args, "env": {"EP4_BASE_URL": want_url}}
        changed, action = True, "추가"
    else:
        if cur.get("args") != want_args:
            print("[EP4] MCP 서버가 다른 경로를 가리켜 갱신합니다:")
            print(f"        이전: {cur.get('args')}")
            print(f"        이후: {want_args}")
            cur["args"] = want_args
            changed, action = True, "경로 갱신"
        env = cur.get("env")
        if not isinstance(env, dict):
            env = {}
        if env.get("EP4_BASE_URL") != want_url:
            print(f"[EP4] MCP 주소 갱신: {env.get('EP4_BASE_URL')} -> {want_url}")
            env["EP4_BASE_URL"] = want_url
            cur["env"] = env
            changed = True
            action = action or "주소 갱신"
        cur.setdefault("type", "stdio")
        cur.setdefault("command", "python")

    if not changed:
        print("[EP4] Claude CLI MCP 설정 정상 (변경 없음)")
        sys.exit(0)

    data["mcpServers"] = servers
    try:
        stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        backup = CLAUDE_JSON.with_name(f".claude.json.ep4bak_{stamp}")
        backup.write_text(raw, encoding="utf-8")
        # Claude CLI 가 이 파일을 동시에 쓸 수 있으므로 임시 파일에 쓴 뒤 교체한다.
        tmp = CLAUDE_JSON.with_name(f".claude.json.ep4tmp_{stamp}")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(tmp, CLAUDE_JSON)
        print(f"[EP4] 기존 설정 백업: {backup.name}")
    except Exception as e:
        print(f"[EP4] MCP 설정 저장 실패 (건너뜀): {e}")
        sys.exit(0)

    print(f"[EP4] Claude CLI MCP 설정 {action}: {CLAUDE_JSON}")
    print("[EP4] 이미 떠 있는 Claude CLI 세션은 재시작해야 반영됩니다.")

elif cmd == "hooks":
    # ~/.claude/settings.json 의 EP4 훅을 점검하고 없으면 추가한다.
    # run.bat 이 서버 기동 전에 호출한다. 이미 이 저장소를 가리키면 아무것도 하지 않는다.
    #
    # 훅이 있어야 터미널에서 친 Claude CLI 프롬프트가 EP4 태스크·실행 로그로 자동 기록된다.
    # 훅은 EP4 서버가 꺼져 있으면 조용히 종료하므로 CLI 동작에는 영향이 없다.
    import datetime
    import pathlib

    ROOT = pathlib.Path(__file__).resolve().parent
    SETTINGS = pathlib.Path.home() / ".claude" / "settings.json"
    # 훅 이벤트 → 이 저장소의 스크립트
    WANT = {
        "UserPromptSubmit": ROOT / "ep4_hook_prompt.py",
        "Stop":             ROOT / "ep4_hook_stop.py",
    }

    def hook_cmd(script):
        return f'python "{script}"'

    def is_ep4(command, script_name):
        """경로와 무관하게 EP4 훅인지 판별 (다른 EP4 설치본도 잡는다)."""
        return isinstance(command, str) and script_name in command.replace("/", "\\")

    missing_scripts = [s for s in WANT.values() if not s.is_file()]
    if missing_scripts:
        for s in missing_scripts:
            print(f"[EP4] 훅 스크립트 없음: {s.name} - 훅 설정을 건너뜁니다.")
        sys.exit(0)

    data, existed = {}, SETTINGS.is_file()
    if existed:
        try:
            data = json.loads(SETTINGS.read_text(encoding="utf-8-sig"))
        except Exception as e:
            # 손상된 설정을 덮어쓰면 사용자의 다른 설정을 잃는다. 건드리지 않는다.
            print(f"[EP4] {SETTINGS} 를 읽을 수 없어 훅 설정을 건너뜁니다: {e}")
            sys.exit(0)
    if not isinstance(data, dict):
        print(f"[EP4] {SETTINGS} 형식이 예상과 달라 훅 설정을 건너뜁니다.")
        sys.exit(0)

    hooks = data.get("hooks")
    if not isinstance(hooks, dict):
        hooks = {}

    changed, added, updated = False, [], []
    for event, script in WANT.items():
        want_cmd = hook_cmd(script)
        groups = hooks.get(event)
        if not isinstance(groups, list):
            groups = []

        found = False
        for group in groups:
            if not isinstance(group, dict):
                continue
            entries = group.get("hooks")
            if not isinstance(entries, list):
                continue
            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                if is_ep4(entry.get("command"), script.name):
                    found = True
                    if entry.get("command") != want_cmd:
                        # 다른 EP4 설치본을 가리키고 있다 — 지금 실행 중인 이쪽으로 맞춘다.
                        print(f"[EP4] {event} 훅이 다른 경로를 가리켜 갱신합니다:")
                        print(f"        이전: {entry.get('command')}")
                        print(f"        이후: {want_cmd}")
                        entry["command"] = want_cmd
                        changed = True
                        updated.append(event)
                    break
            if found:
                break

        if not found:
            # 같은 이벤트의 다른 훅(사용자가 쓰던 것)은 그대로 두고 뒤에 덧붙인다.
            groups.append({"matcher": "", "hooks": [{"type": "command", "command": want_cmd}]})
            hooks[event] = groups
            changed = True
            added.append(event)

    if not changed:
        print("[EP4] Claude CLI 훅 설정 정상 (변경 없음)")
        sys.exit(0)

    data["hooks"] = hooks
    try:
        SETTINGS.parent.mkdir(parents=True, exist_ok=True)
        if existed:
            stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            backup = SETTINGS.with_name(f"settings.json.ep4bak_{stamp}")
            backup.write_bytes(SETTINGS.read_bytes())
            print(f"[EP4] 기존 설정 백업: {backup.name}")
        SETTINGS.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n",
                            encoding="utf-8")
    except Exception as e:
        print(f"[EP4] 훅 설정 저장 실패 (건너뜀): {e}")
        sys.exit(0)

    if added:
        print(f"[EP4] Claude CLI 훅 추가: {', '.join(added)}")
    if updated:
        print(f"[EP4] Claude CLI 훅 경로 갱신: {', '.join(updated)}")
    print(f"[EP4] 적용 위치: {SETTINGS}")
    print("[EP4] 이미 떠 있는 Claude CLI 세션은 재시작해야 훅이 적용됩니다.")
