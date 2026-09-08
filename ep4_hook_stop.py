#!/usr/bin/env python3
"""Stop hook — Claude CLI 응답 완료 시 EP4 실행 로그에 결과 기록."""
import json
import sys
import os
import urllib.request
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
# 호출 CLI 구분 (prompt 훅과 동일 규칙)
TRIGGER_TYPE = (sys.argv[1] if len(sys.argv) > 1 else
                os.environ.get("EP4_TRIGGER_TYPE", "claude_cli")).strip() or "claude_cli"


def _parse_transcript(transcript_path: str) -> dict:
    """JSONL 트랜스크립트에서 세션 정보, 실행 단계, 최종 응답을 추출합니다."""
    result = {
        "session_id": "", "model": "", "version": "", "git_branch": "",
        "first_prompt": "", "log_lines": [], "output": "", "duration_ms": 0,
    }
    if not transcript_path:
        return result
    try:
        p = Path(transcript_path)
        if not p.exists():
            return result
        last_text = ""
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except Exception:
                continue
            t = obj.get("type", "")
            if not result["session_id"] and obj.get("sessionId"):
                result["session_id"] = obj["sessionId"]
            if not result["version"] and obj.get("version"):
                result["version"] = obj["version"]
            if not result["git_branch"] and obj.get("gitBranch"):
                result["git_branch"] = obj["gitBranch"]
            ts_hm = obj.get("timestamp", "")[11:16]  # HH:MM from ISO
            if t == "user" and not result["first_prompt"]:
                content = obj.get("message", {}).get("content", "")
                if isinstance(content, str):
                    result["first_prompt"] = content.strip()[:200]
                elif isinstance(content, list):
                    texts = [c.get("text", "") for c in content if c.get("type") == "text"]
                    result["first_prompt"] = " ".join(texts).strip()[:200]
            if t == "assistant":
                msg = obj.get("message", {})
                if not result["model"] and msg.get("model"):
                    result["model"] = msg["model"]
                for c in msg.get("content", []):
                    ct = c.get("type", "")
                    if ct == "tool_use":
                        name = c.get("name", "")
                        inp = c.get("input", {})
                        if name in ("Read", "Edit", "Write"):
                            desc = inp.get("file_path", "")
                        elif name in ("Bash", "PowerShell"):
                            desc = inp.get("command", "")[:80]
                        elif name == "Glob":
                            desc = inp.get("pattern", "")
                        elif name == "Grep":
                            desc = f"{inp.get('pattern', '')} in {inp.get('path', '.')}"
                        else:
                            desc = json.dumps(inp, ensure_ascii=False)[:80]
                        result["log_lines"].append(
                            {"level": "INFO", "msg": f"[{name}] {desc}", "ts": ts_hm, "span_id": ""}
                        )
                    elif ct == "text":
                        text = c.get("text", "").strip()
                        if text:
                            last_text = text
            elif t == "system" and obj.get("subtype") == "turn_duration":
                result["duration_ms"] = obj.get("durationMs", 0)
        if result["first_prompt"]:
            result["log_lines"].insert(0, {
                "level": "INFO", "msg": f"[User] {result['first_prompt']}", "ts": "", "span_id": ""
            })
        result["output"] = last_text[:8000]
    except Exception:
        pass
    return result


def main():
    # EP4 서버 내부 호출(번역·챗·하네스 실행 등)은 로그를 기록하지 않는다.
    if os.environ.get("EP4_INTERNAL_CALL"):
        return

    try:
        payload = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    except Exception:
        return

    session_id = payload.get("session_id") or "default"
    transcript_path = payload.get("transcript_path") or ""

    state_file = TEMP_DIR / f"ep4_{session_id}.json"
    if not state_file.exists():
        return

    # 상태 파일은 삭제하지 않는다 — 백그라운드 에이전트 알림 등으로 턴이 여러 번
    # 이어지는 경우, 이후 Stop 훅이 같은 태스크의 답변을 최신 내용으로 갱신한다.
    # 새 사용자 프롬프트가 오면 prompt 훅이 상태 파일을 새 태스크로 덮어쓴다.
    try:
        info = json.loads(state_file.read_text(encoding="utf-8"))
    except Exception:
        return

    project_id = info.get("project_id")
    task_id = info.get("task_id")
    if not project_id or not task_id:
        return

    tr = _parse_transcript(transcript_path)

    # 답변은 answer 필드로 따로 보내 project_tasks.output 에 저장되고,
    # 합성 로그(full_output)는 task_runs.output(8000자 절단) 용도로 구성한다.
    # 최종 응답이 잘리지 않도록 응답을 먼저 확보하고 실행 과정은 남는 예산만큼만 넣는다.
    MAX_TOTAL = 8000

    head = []
    if tr["session_id"]:
        head.append(f"세션 ID : {tr['session_id']}")
    if tr["model"]:
        head.append(f"모델    : {tr['model']}")
    if tr["git_branch"]:
        head.append(f"브랜치  : {tr['git_branch']}")
    if tr["duration_ms"]:
        head.append(f"소요시간: {tr['duration_ms'] / 1000:.1f}초")
    if tr["first_prompt"]:
        head.append("")
        head.append("── 첫 메시지 ──")
        head.append(f"  {tr['first_prompt']}")

    tail = []
    if tr["output"]:
        tail.append("")
        tail.append("── 최종 응답 ──")
        tail.append(tr["output"][:6000])

    steps = []
    budget = MAX_TOTAL - len("\n".join(head)) - len("\n".join(tail)) - 40
    if tr["log_lines"] and budget > 0:
        steps.append("")
        steps.append("── 실행 과정 ──")
        used = sum(len(s) + 1 for s in steps)
        omitted = 0
        for i, l in enumerate(tr["log_lines"], 1):
            line = f"  {i}. {l}"
            if used + len(line) + 1 > budget:
                omitted = len(tr["log_lines"]) - i + 1
                break
            steps.append(line)
            used += len(line) + 1
        if omitted:
            steps.append(f"  … 이후 {omitted}개 단계 생략")

    full_output = "\n".join(head + steps + tail) or "(출력 없음)"

    try:
        body = json.dumps(
            {"output": full_output, "answer": tr["output"], "status": "done",
             "model": tr["model"], "log_lines": tr["log_lines"],
             "claude_session_id": tr["session_id"],
             "trigger_type": TRIGGER_TYPE},
            ensure_ascii=False,
        ).encode()
        req = urllib.request.Request(
            f"{EP4_BASE_URL}/api/projects/{project_id}/tasks/{task_id}/log-result",
            data=body,
            headers=_auth_headers({"Content-Type": "application/json"}),
        )
        with urllib.request.urlopen(req, timeout=5) as r:
            pass
    except Exception:
        pass


if __name__ == "__main__":
    main()
