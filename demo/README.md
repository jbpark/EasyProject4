# EasyProject4 데모 페이지

EasyProject4(EP4) 웹 대시보드의 **메뉴 구조와 기능을 소개하는 정적 데모 사이트**입니다.
모든 프로젝트·태스크·실행 로그·세션은 `data.js`에 들어 있는 **Mock 데이터**이며, 실제 서버·저장소·Claude CLI 실행 기록이 아닙니다.
백엔드 호출이 전혀 없어 브라우저만 있으면 어디서든 열립니다.

## 구성

| 파일 | 역할 |
|------|------|
| `index.html` | 셸(데모 배너, 사이드바, 헤더, 메인, 안내 상자, 모달, 도우미) |
| `style.css` | 실제 대시보드(`dist/index.html`)와 같은 테마 팔레트 (다크·라이트·미드나잇·포레스트·선셋) |
| `data.js` | Mock 데이터 (프로젝트, 태스크, 실행 로그, 세션, 플러그인, 마켓, 통계, 도우미 Q&A) |
| `app.js` | 메뉴별 화면 렌더링, 안내문, 하네스 실행 시뮬레이션, 데모 상호작용 |
| `_headers` | Cloudflare Pages 보안 헤더 |

메뉴는 해시 라우팅(`#/dashboard`, `#/todo`, `#/log` …)으로 이동하므로 특정 화면을 링크로 공유할 수 있습니다.
실제 대시보드의 라우트 이름(`dashboard` · `plugins` · `projects` · `todo` · `log` · `sessions` · `help`)을 그대로 사용합니다.

## 메뉴별 데모 내용

| 메뉴 | 데모에서 볼 수 있는 것 |
|------|------|
| 대시보드 | 프로젝트 수·태스크 상태별 개수, 최근 7일 실행 횟수, 프로젝트별 진행률, 최근 실행, 시스템 상태 |
| 확장 | 설치됨(유형 필터·활성 토글·삭제), 마켓플레이스(설치), 📦 Data(보존 데이터 삭제·복원), 설정(마스킹된 마켓 연동) |
| 프로젝트 | 프로젝트 카드(모델·엔진·타임아웃·세션·worktree 여부·진행률), 새 프로젝트, 설정 모달 |
| 태스크 | 상태 필터, 트리거/모델 태그, 펼치면 프롬프트·출력·브랜치, 추가·수정·삭제, 단일 실행 |
| 실행 로그 | 실행 내역 타임라인, [harness]/[git]/[claude]/[hook] 로그, 변경 파일 +/−, 커밋, 오류 사례 |
| 세션 | PTY·Claude CLI·Antigravity CLI 세션 목록, 터미널 미리보기, 새 세션·프롬프트 보내기·종료 |
| 도움말 | 개요, 세션, REST API(인증·엔드포인트·curl 예시), CLI 훅·MCP 도구 |

왼쪽 **실행** 을 누르면 선택한 프로젝트의 대기 태스크가 가짜로 실행됩니다. 로그가 흘러가고 완료되면 실행 로그에 기록되며, `auto_run` 프로젝트는 다음 태스크를 이어서 실행합니다.
각 화면 오른쪽 안내 상자에 "무엇을 보여주나 / 사용 순서 / 실제 시스템에서는 / 데모에서 해볼 것"이 표시됩니다.

## 로컬에서 보기

```bash
python -m http.server 8090 --directory demo
```

브라우저에서 http://localhost:8090 을 엽니다. 빌드 단계는 없습니다.
`index.html` 을 더블클릭해 `file://` 로 열어도 동작합니다.

## Cloudflare Pages 배포

### 방법 A. 직접 업로드 (저장소 연동 없음, 가장 간단)

1. Cloudflare 대시보드 → **Workers & Pages** → **Create** → **Pages** → **Upload assets**
2. 프로젝트 이름 입력 (예: `easyproject4-demo`)
3. `demo/` 폴더 안의 파일들을 드래그 앤 드롭 (폴더 자체가 아니라 안의 파일들을 올려야 `index.html`이 루트에 옵니다)
4. **Deploy site**

갱신할 때는 같은 프로젝트에서 **Create new deployment**로 다시 업로드합니다.

### 방법 B. Wrangler CLI

```bash
npm install -g wrangler
wrangler login
wrangler pages deploy demo --project-name easyproject4-demo
```

### 방법 C. Git 연동 (자동 배포)

1. **Workers & Pages** → **Create** → **Pages** → **Connect to Git**에서 이 저장소 선택
2. 빌드 설정
   - Framework preset: `None`
   - Build command: (비움)
   - Build output directory: `demo`
3. `main`에 push할 때마다 자동 배포됩니다.

## 데이터 수정

`data.js`의 `DEMO.*` 객체만 바꾸면 화면이 따라 바뀝니다. 새 화면을 추가할 때는 `app.js`의 `VIEWS`(메뉴), `GUIDE`(안내문), `R.<key>`(렌더러) 세 곳에 항목을 추가합니다.

## 주의

- 실제 서버 주소, 인증 토큰, 마켓 GitHub 토큰, 실제 저장소 경로가 이 폴더에 들어가지 않도록 유지하세요. 데모의 경로(`D:\work\…`)·커밋 해시·세션 이름은 모두 예시입니다.
- 데모 배너와 "Mock 데이터" 문구는 실제 시스템과의 혼동을 막기 위한 것이므로 지우지 마세요.
- EP4 UI 규칙에 따라 브라우저 네이티브 `alert/confirm/prompt` 를 쓰지 않고 커스텀 모달을 사용합니다.
