const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bridgeConfig", {
  get: () => ipcRenderer.invoke("print-bridge:get"),
  save: (payload) => ipcRenderer.invoke("print-bridge:save", payload),
  stop: () => ipcRenderer.invoke("print-bridge:stop")
});
