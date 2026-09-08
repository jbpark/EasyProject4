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
