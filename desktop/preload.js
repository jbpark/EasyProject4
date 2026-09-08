// splash.html 전용 브리지: 서버 로그/상태 스트림 수신.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ep4desktop", {
  onLog: (cb) => ipcRenderer.on("ep4-log", (_e, line) => cb(line)),
  onStatus: (cb) => ipcRenderer.on("ep4-status", (_e, text) => cb(text)),
  requestBacklog: () => ipcRenderer.send("ep4-log-request"),
});
