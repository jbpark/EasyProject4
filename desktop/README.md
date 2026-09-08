# EP4 데스크톱 앱 (desktop/)

orca(https://github.com/stablyai/orca) 데스크톱 앱과 같은 Electron 셸에
EP4 서버 실행(run.bat)을 내장한 데스크톱 앱이다.

## 동작

1. 앱 시작 → EP4 루트(server.py + run.bat 폴더) 탐색
   - 탐색 순서: `EP4_HOME` 환경변수 → ep4.exe 가 놓인 폴더 → (개발 모드) `desktop/..`
     → 이전에 선택한 폴더 → 폴더 선택 다이얼로그
2. `run.bat` 을 숨김 콘솔로 실행 (`EP4_NO_WAIT_KEY=1` — 키 입력 종료 비활성)
   - conda 환경 생성 / requirements 설치 / 포트 정리까지 run.bat 로직 그대로 수행
3. 서버가 응답하면 대시보드(`http://127.0.0.1:{port}/?token=…`)를 창에 로드
   - 포트는 `conf/ep4.conf`, 토큰은 `conf/ep4.local.conf` 에서 읽는다
4. 앱 종료 시 서버 프로세스 트리(taskkill /T)와 `server/ep4.pid` 정리

메뉴: 브라우저에서 열기 / 서버 재시작 / 새로고침(F5) / 개발자 도구(F12) 등.
외부 링크는 기본 브라우저로 열린다.

## 개발 모드 실행

```bat
desktop.bat          # 저장소 루트에서 (npm install 후 electron 실행)
```

또는 직접:

```bat
cd desktop
npm install
npm start
```

## ep4.exe 빌드

```bat
cd desktop
npm run dist         # release/ep4.exe 생성 (electron-builder portable)
```

생성된 `release/ep4.exe` 를 EP4 저장소 루트에 복사해 두고 더블클릭하면
그 폴더의 서버를 실행한다. 다른 위치에 두는 경우 `EP4_HOME` 을 설정하거나
첫 실행 시 폴더 선택 다이얼로그에서 EP4 폴더를 지정한다.

## 아이콘

기본 Electron 아이콘을 사용한다. 커스텀 아이콘을 쓰려면 256x256 이상
`desktop/build/icon.ico` 를 추가하고 `package.json` 의 `build.win.icon` 에
`"build/icon.ico"` 를 지정한 뒤 다시 빌드한다.
