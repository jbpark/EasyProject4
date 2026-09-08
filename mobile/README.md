# EP4 Mobile (Flutter)

EasyProject4를 모바일에서 사용하는 Flutter 앱.
**Cloudflare Tunnel**로 공개된 EP4 서버에 접속해 다음을 관리한다.

- 📁 **프로젝트** — 목록·상태·전체 실행/중지
- ✅ **태스크** — 목록·추가·수정·삭제·개별 실행·출력 보기 (실시간 상태 반영)
- 🧾 **실행 로그** — run 목록·필터(전체/실행중/완료/실패)·상세(로그 라인·출력)
- 🖥 **세션** — 목록·생성·터미널 출력·입력 전송·종료

SSE(`/api/events`)로 상태가 실시간 갱신된다.

---

## 1. 사전 준비 — EP4 서버를 Cloudflare Tunnel로 공개

EP4 서버는 PC에서 `localhost:7788`로 동작한다. 모바일(외부)에서 접속하려면 터널로 공개해야 한다.

### cloudflared 설치
- Windows: `winget install --id Cloudflare.cloudflared`
- macOS: `brew install cloudflared`
- Linux: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

### 1-A. 빠른 임시 터널 (계정 불필요)
EP4 서버를 켠 상태에서:
```bash
cloudflared tunnel --url http://localhost:7788
```
출력되는 `https://<랜덤>.trycloudflare.com` 주소를 앱의 **서버 주소**에 입력한다.
> 임시 터널은 실행할 때마다 주소가 바뀌고, 무인증 공개라 단기 테스트용이다.

### 1-B. 고정 도메인 + 인증 (권장)
1. Cloudflare 계정 + 도메인 등록
2. `cloudflared tunnel login`
3. `cloudflared tunnel create ep4`
4. `~/.cloudflared/config.yml`:
   ```yaml
   tunnel: <TUNNEL_ID>
   credentials-file: /path/to/<TUNNEL_ID>.json
   ingress:
     - hostname: ep4.example.com
       service: http://localhost:7788
     - service: http_status:404
   ```
5. `cloudflared tunnel route dns ep4 ep4.example.com`
6. `cloudflared tunnel run ep4`
→ 앱 서버 주소: `https://ep4.example.com`

> ⚠️ **보안**: EP4 서버 자체에는 인증이 없다. 외부 공개 시 **Cloudflare Zero Trust(Access)**로 접근 보호(이메일 OTP 등)를 거는 것을 강력히 권장한다.

---

## 2. 앱 빌드 / 실행

```bash
cd mobile
flutter pub get

# 연결된 기기/에뮬레이터에서 실행
flutter run

# 릴리스 APK 빌드 (안드로이드)
flutter build apk --release
# 결과물: build/app/outputs/flutter-apk/app-release.apk

# iOS (macOS + Xcode 필요)
flutter build ios --release
```

앱 첫 화면에서 **서버 주소**(터널 HTTPS 주소)를 입력하고 **연결**하면 된다.
주소는 기기에 저장되어 다음 실행 시 자동 입력된다.

> LAN 내에서 터널 없이 테스트하려면 `http://<PC-LAN-IP>:7788`도 가능하다
> (단, EP4 서버는 기본 `localhost` 바인딩이라 LAN 접속하려면 `server.py`의 바인드 주소를
> `0.0.0.0`으로 바꿔야 한다. 터널 방식은 변경 불필요).

---

## 3. 프로젝트 구조

```
mobile/
├─ lib/
│  ├─ main.dart                 앱 진입점 + 테마 + 라우팅
│  ├─ api/
│  │  ├─ api_client.dart        EP4 REST 클라이언트
│  │  └─ sse_client.dart        /api/events SSE 구독(자동 재접속)
│  ├─ models/                   project / task / run_log / session
│  ├─ state/app_state.dart      연결 상태 + API/SSE 보유 (provider)
│  ├─ screens/
│  │  ├─ connect_screen.dart    서버 연결
│  │  ├─ home_screen.dart       하단 탭(프로젝트/실행로그/세션)
│  │  ├─ projects_screen.dart
│  │  ├─ tasks_screen.dart
│  │  ├─ run_logs_screen.dart / run_log_detail_screen.dart
│  │  └─ sessions_screen.dart / session_detail_screen.dart
│  └─ widgets/status_chip.dart  상태 칩/점
└─ pubspec.yaml                 의존성: http, provider, shared_preferences
```

---

## 4. 사용하는 EP4 API

| 기능 | 엔드포인트 |
|------|-----------|
| 프로젝트 | `GET /api/projects`, `POST /api/projects/{id}/start\|stop\|reset` |
| 태스크 | `GET /api/projects/{id}/tasks`, `POST .../tasks`, `.../tasks/{tid}/update\|delete\|run` |
| 실행 로그 | `GET /api/runs?status=`, `GET /api/runs/{id}` |
| 세션 | `GET /api/sessions`, `GET .../{id}/output`, `POST /api/sessions`, `POST .../{id}/input`, `DELETE .../{id}` |
| 실시간 | `GET /api/events` (SSE) |

CORS는 네이티브 앱에는 적용되지 않으므로 별도 설정이 필요 없다.

---

## 5. 검증

`flutter analyze` → **No issues found** (정적 분석 통과).
간단 단위 테스트: `flutter test` (URL 정규화 검증).
