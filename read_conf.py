#!/usr/bin/env python3
"""conf/ep4.conf + conf/ep4.local.conf 에서 키 하나를 읽어 표준출력으로 내보낸다.

배치 스크립트에서 설정 값을 꺼내 쓰기 위한 도우미.
    python read_conf.py firebase_db_url
키가 없으면 아무것도 출력하지 않고 종료 코드 1 을 반환한다.
"""
import json
import sys
from pathlib import Path


def load_conf(base: Path) -> dict:
    """ep4.conf → ep4.local.conf 순으로 병합 (local 이 우선)."""
    conf: dict = {}
    for name in ('ep4.conf', 'ep4.local.conf'):
        p = base / 'conf' / name
        if p.exists():
            try:
                conf.update(json.loads(p.read_text(encoding='utf-8-sig')))
            except Exception:
                pass
    return conf


def main() -> int:
    if len(sys.argv) < 2:
        print('Usage: python read_conf.py <key>', file=sys.stderr)
        return 2
    value = load_conf(Path(__file__).resolve().parent).get(sys.argv[1])
    if value is None or value == '':
        return 1
    print(value if isinstance(value, str) else json.dumps(value, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
