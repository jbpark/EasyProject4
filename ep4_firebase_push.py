#!/usr/bin/env python3
"""EP4 터널 URL을 Firebase Realtime DB에 저장."""
import sys
import json
import uuid
import socket
import datetime
from pathlib import Path


def load_conf(base: Path) -> dict:
    """conf/ep4.conf → conf/ep4.local.conf 순으로 읽어 병합 (local 이 우선)."""
    conf: dict = {}
    for name in ('ep4.conf', 'ep4.local.conf'):
        p = base / 'conf' / name
        if p.exists():
            try:
                conf.update(json.loads(p.read_text(encoding='utf-8-sig')))
            except Exception:
                pass
    return conf


def main():
    if len(sys.argv) < 2:
        print('[ERROR] Usage: python ep4_firebase_push.py <url>')
        sys.exit(1)

    url = sys.argv[1].strip()
    base = Path(__file__).parent

    # Firebase DB 주소 (conf/ep4.local.conf 의 firebase_db_url — 저장소에 커밋되지 않음)
    db_url = str(load_conf(base).get('firebase_db_url') or '').strip().rstrip('/')
    if not db_url:
        print('[SKIP] conf/ep4.local.conf 에 firebase_db_url 이 없어 터널 URL 공유를 건너뜁니다.')
        print('       설정 방법: conf/ep4.local.conf.example 참고')
        sys.exit(0)

    # EP4 ID 읽기 / 최초 생성
    id_file = base / 'ep4_id.txt'
    if id_file.exists():
        ep4_id = id_file.read_text(encoding='utf-8').strip()
    else:
        ep4_id = str(uuid.uuid4())
        id_file.write_text(ep4_id, encoding='utf-8')
        print(f'[EP4] 새 ID 생성: {ep4_id}')

    # EP4 표시 이름 (ep4_name.txt 있으면 사용, 없으면 호스트명)
    name_file = base / 'ep4_name.txt'
    name = name_file.read_text(encoding='utf-8').strip() if name_file.exists() else socket.gethostname()

    # Firebase 서비스 계정 키 (conf/*.json)
    key_files = list((base / 'conf').glob('*.json'))
    if not key_files:
        print('[ERROR] conf/*.json Firebase 키 파일을 찾을 수 없습니다.')
        sys.exit(1)
    key_file = key_files[0]

    data = {
        'url': url,
        'name': name,
        'pc': socket.gethostname(),
        'last_seen': datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ'),
    }

    try:
        import firebase_admin
        from firebase_admin import credentials, db as rtdb

        cred = credentials.Certificate(str(key_file))
        app = firebase_admin.initialize_app(cred, {'databaseURL': db_url})
        rtdb.reference(f'/ep4_tunnels/{ep4_id}').update(data)
        firebase_admin.delete_app(app)
    except ImportError:
        print('[WARN] firebase-admin 미설치 → pip install firebase-admin')
        sys.exit(1)
    except Exception as e:
        print(f'[ERROR] Firebase 저장 실패: {e}')
        sys.exit(1)

    print(f'[Firebase] /ep4_tunnels/{ep4_id} 업데이트 완료')
    print(f'[EP4 ID]   {ep4_id}')
    print(f'[NAME]     {name}')
    print(f'[URL]      {url}')


if __name__ == '__main__':
    main()
