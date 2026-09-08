// EP4 데스크톱 앱 메인 프로세스.
// 앱 시작 시 run.bat 을 백그라운드로 실행해 EP4 서버를 띄우고,
// 서버가 준비되면 대시보드(http://127.0.0.1:{port})를 창에 로드한다.
// 앱 종료 시 서버 프로세스 트리를 정리한다.
const { app, BrowserWindow, Menu, dialog, shell, ipcMain } = require("electron");
const { spawn, spawnSync } = require("child_process");
const { StringDecoder } = require("string_decoder");
const path = require("path");
const fs = require("fs");
const http = require("http");

let win = null;
let serverProc = null;      // cmd.exe(run.bat) 자식 프로세스
let serverPort = 7788;
let ep4Root = null;
let quitting = false;
let restarting = false;
const logBuf = [];          // splash 로그 백로그 (최근 500줄)

const CONFIG_FILE = () => path.join(app.getPath("userData"), "ep4-desktop.json");

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8").replace(/^﻿/, ""));
  } catch {
    return null;
  }
}

function sendToSplash(channel, payload) {
  if (win && !win.isDestroyed()) {
    try { win.webContents.send(channel, payload); } catch {}
  }
}

function pushLog(text) {
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue;
    logBuf.push(line);
    if (logBuf.length > 500) logBuf.shift();
    sendToSplash("ep4-log", line);
  }
}

function setStatus(text) {
  sendToSplash("ep4-status", text);
}

// ---------------------------------------------------------------- EP4 루트 탐색
// server.py + run.bat 이 있는 폴더를 EP4 루트로 인정한다.
function isEp4Root(dir) {
  try {
    return fs.existsSync(path.join(dir, "server.py")) &&
           fs.existsSync(path.join(dir, "run.bat"));
  } catch {
    return false;
  }
}

function findEp4Root() {
  const cands = [];
  if (process.env.EP4_HOME) cands.push(process.env.EP4_HOME);
  // electron-builder portable: 원본 exe 가 놓인 폴더 (임시 언팩 폴더가 아님)
  if (process.env.PORTABLE_EXECUTABLE_DIR) cands.push(process.env.PORTABLE_EXECUTABLE_DIR);
  // 개발 모드: desktop/ 의 부모 = 저장소 루트
  cands.push(path.resolve(app.getAppPath(), ".."));
  cands.push(path.dirname(process.execPath));
  const saved = readJson(CONFIG_FILE());
  if (saved && saved.root) cands.push(saved.root);
  for (const c of cands) {
    if (c && isEp4Root(c)) return c;
  }
  return null;
}

function askEp4Root() {
  dialog.showMessageBoxSync({
    type: "info",
    title: "EP4 폴더 선택",
    message: "EasyProject4 폴더(server.py, run.bat 이 있는 폴더)를 선택해 주세요.",
  });
  const picked = dialog.showOpenDialogSync({
    title: "EasyProject4 폴더 선택",
    properties: ["openDirectory"],
  });
  if (picked && picked[0] && isEp4Root(picked[0])) {
    try {
      fs.mkdirSync(path.dirname(CONFIG_FILE()), { recursive: true });
      fs.writeFileSync(CONFIG_FILE(), JSON.stringify({ root: picked[0] }, null, 2));
    } catch {}
    return picked[0];
  }
  return null;
}

// ---------------------------------------------------------------- 서버 실행/정리
function readPort(root) {
  const conf = readJson(path.join(root, "conf", "ep4.conf"));
  return (conf && conf.port) || 7788;
}

function readToken(root) {
  const local = readJson(path.join(root, "conf", "ep4.local.conf"));
  if (local && local.auth_token) return String(local.auth_token);
  const conf = readJson(path.join(root, "conf", "ep4.conf"));
  if (conf && conf.auth_token) return String(conf.auth_token);
  return "";
}

function startServer() {
  setStatus("EP4 서버 시작 중… (run.bat)");
  pushLog(`[desktop] EP4 root: ${ep4Root}`);
  // 상대 이름("run.bat") 대신 절대 경로 + shell:true 를 쓴다 —
  // NoDefaultCurrentDirectoryInExePath 가 설정된 환경에서는 cmd 가
  // 현재 디렉토리의 배치 파일을 상대 이름으로 찾지 않는다.
  // shell:true 는 내부적으로 cmd.exe /d /s /c "<경로>" 를 구성하므로
  // 공백 포함 경로도 안전하다.
  const runBat = path.join(ep4Root, "run.bat");
  serverProc = spawn(runBat, [], {
    cwd: ep4Root,
    env: { ...process.env, EP4_NO_WAIT_KEY: "1" },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
  });
  const outDec = new StringDecoder("utf8");
  const errDec = new StringDecoder("utf8");
  serverProc.stdout.on("data", (d) => pushLog(outDec.write(d)));
  serverProc.stderr.on("data", (d) => pushLog(errDec.write(d)));
  serverProc.on("exit", (code) => {
    serverProc = null;
    if (quitting || restarting) return;
    pushLog(`[desktop] 서버 프로세스가 종료되었습니다 (code=${code})`);
    if (win && !win.isDestroyed()) {
      loadSplash("서버가 종료되었습니다. 메뉴에서 '서버 재시작'을 선택해 주세요.");
    }
  });
}

function killServer() {
  // 1) pid 파일에 기록된 python 서버 pid
  const pidInfo = readJson(path.join(ep4Root, "server", "ep4.pid"));
  if (pidInfo && pidInfo.pid) {
    spawnSync("taskkill", ["/PID", String(pidInfo.pid), "/T", "/F"], { windowsHide: true });
  }
  // 2) run.bat cmd 프로세스 트리
  if (serverProc && serverProc.pid) {
    spawnSync("taskkill", ["/PID", String(serverProc.pid), "/T", "/F"], { windowsHide: true });
  }
  serverProc = null;
  try { fs.unlinkSync(path.join(ep4Root, "server", "ep4.pid")); } catch {}
}

// 서버 준비 대기: / 가 응답할 때까지 폴링.
// 첫 실행은 conda 환경 생성 + pip install 로 수 분 걸릴 수 있어 넉넉히 기다린다.
function waitForServer(port, timeoutMs = 10 * 60 * 1000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (quitting) return reject(new Error("quit"));
      if (!serverProc) return reject(new Error("server-exited"));
      const req = http.get(
        { host: "127.0.0.1", port, path: "/", timeout: 2000 },
        (res) => {
          res.resume();
          resolve();
        }
      );
      req.on("error", () => {
        if (Date.now() > deadline) return reject(new Error("timeout"));
        setTimeout(tick, 700);
      });
      req.on("timeout", () => req.destroy());
    };
    tick();
  });
}

function dashboardUrl() {
  const token = readToken(ep4Root);
  const base = `http://127.0.0.1:${serverPort}/`;
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}

// ---------------------------------------------------------------- 창/메뉴
function loadSplash(status) {
  if (!win || win.isDestroyed()) return;
  win.loadFile(path.join(__dirname, "splash.html")).then(() => {
    if (status) setStatus(status);
  }).catch(() => {});
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 480,
    minHeight: 360,
    backgroundColor: "#0f1115",
    title: "EasyProject4",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.on("closed", () => { win = null; });

  // 새 창/외부 링크는 기본 브라우저로 연다.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url) && !url.startsWith(`http://127.0.0.1:${serverPort}`) &&
        !url.startsWith(`http://localhost:${serverPort}`)) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    const local = url.startsWith(`http://127.0.0.1:${serverPort}`) ||
                  url.startsWith(`http://localhost:${serverPort}`) ||
                  url.startsWith("file:");
    if (!local) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
}

async function restartServer() {
  if (restarting) return;
  restarting = true;
  try {
    loadSplash("서버 재시작 중…");
    killServer();
    await new Promise((r) => setTimeout(r, 800));
    startServer();
    await waitForServer(serverPort);
    setStatus("대시보드 로드 중…");
    if (win && !win.isDestroyed()) await win.loadURL(dashboardUrl());
  } catch (e) {
    setStatus(`서버 재시작 실패: ${e.message}`);
  } finally {
    restarting = false;
  }
}

function buildMenu() {
  const template = [
    {
      label: "EP4",
      submenu: [
        {
          label: "브라우저에서 열기",
          click: () => shell.openExternal(dashboardUrl()),
        },
        { label: "서버 재시작", click: () => restartServer() },
        { type: "separator" },
        { label: "종료", role: "quit", accelerator: "Alt+F4" },
      ],
    },
    {
      label: "보기",
      submenu: [
        { label: "새로고침", role: "reload", accelerator: "F5" },
        { label: "강력 새로고침", role: "forceReload" },
        { type: "separator" },
        { label: "확대", role: "zoomIn" },
        { label: "축소", role: "zoomOut" },
        { label: "원래 크기", role: "resetZoom" },
        { type: "separator" },
        { label: "전체 화면", role: "togglefullscreen", accelerator: "F11" },
        { label: "개발자 도구", role: "toggleDevTools", accelerator: "F12" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------- 앱 라이프사이클
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    ep4Root = findEp4Root() || askEp4Root();
    if (!ep4Root) {
      dialog.showErrorBox(
        "EP4 폴더를 찾을 수 없음",
        "server.py 와 run.bat 이 있는 EasyProject4 폴더가 필요합니다.\n" +
        "ep4.exe 를 EP4 폴더 안에 두거나, EP4_HOME 환경변수를 설정해 주세요."
      );
      app.quit();
      return;
    }
    serverPort = readPort(ep4Root);

    // splash 가 백로그를 요청하면 지금까지의 로그를 보내준다.
    ipcMain.on("ep4-log-request", (e) => {
      for (const line of logBuf) e.sender.send("ep4-log", line);
    });

    buildMenu();
    createWindow();
    loadSplash();
    startServer();
    try {
      await waitForServer(serverPort);
      setStatus("대시보드 로드 중…");
      if (win && !win.isDestroyed()) await win.loadURL(dashboardUrl());
    } catch (e) {
      if (e.message === "quit") return;
      setStatus(
        e.message === "server-exited"
          ? "서버 시작에 실패했습니다. 아래 로그를 확인해 주세요."
          : "서버 응답 대기 시간이 초과되었습니다. 아래 로그를 확인해 주세요."
      );
    }
  });

  app.on("before-quit", () => { quitting = true; });
  app.on("will-quit", () => {
    if (ep4Root) killServer();
  });
  app.on("window-all-closed", () => app.quit());
}
