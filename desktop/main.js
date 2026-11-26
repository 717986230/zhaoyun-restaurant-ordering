const { app, BrowserWindow, Menu, shell } = require("electron");

const BASE_URL = process.env.CHIRI_APP_URL || "https://ck.uuoo.workers.dev";
const ALLOWED_HOST = new URL(BASE_URL).host;

// Allow AudioContext and speechSynthesis alerts immediately without requiring a click first.
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

let mainWindow = null;

function createWindow(route = "/pos.html") {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: "Chiri Kitchen",
    backgroundColor: "#0f1113",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.loadURL(`${BASE_URL}${route}`);
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      if (new URL(url).host === ALLOWED_HOST) {
        return { action: "allow" };
      }
    } catch { /* ignore invalid url */ }
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (!mainWindow) {
    mainWindow = win;
    win.on("closed", () => { mainWindow = null; });
  }
  return win;
}

function buildMenu() {
  const template = [
    ...(process.platform === "darwin" ? [{
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "quit" }
      ]
    }] : []),
    {
      label: "切换页面",
      submenu: [
        { label: "POS 收银 / 跑堂", accelerator: "CmdOrCtrl+1", click: () => mainWindow?.loadURL(`${BASE_URL}/pos.html`) },
        { label: "Admin 管理后台", accelerator: "CmdOrCtrl+2", click: () => mainWindow?.loadURL(`${BASE_URL}/admin.html`) },
        { label: "厨房看板 (KDS)", accelerator: "CmdOrCtrl+3", click: () => mainWindow?.loadURL(`${BASE_URL}/pos.html?view=kitchen`) },
        { label: "顾客菜单预览", accelerator: "CmdOrCtrl+4", click: () => mainWindow?.loadURL(`${BASE_URL}/`) },
        { type: "separator" },
        { label: "新建窗口 (管理后台)", click: () => createWindow("/admin.html") }
      ]
    },
    {
      label: "视图",
      submenu: [
        { label: "刷新", accelerator: "CmdOrCtrl+R", click: () => mainWindow?.reload() },
        { label: "清缓存并强制刷新", accelerator: "CmdOrCtrl+Shift+R", click: () => mainWindow?.webContents.reloadIgnoringCache() },
        { type: "separator" },
        { role: "togglefullscreen" }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  buildMenu();
  createWindow("/pos.html");
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow("/pos.html");
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
