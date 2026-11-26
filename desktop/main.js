const { app, BrowserWindow, Menu, ipcMain, session, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const BASE_URL = process.env.CHIRI_APP_URL || "https://ck.uuoo.workers.dev";
const ALLOWED_HOST = new URL(BASE_URL).host;
const ICON_PATH = path.join(__dirname, "build", "icon.png");

// Allow AudioContext and speechSynthesis alerts immediately without requiring a click first.
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

let mainWindow = null;
let bridgeWindow = null;
let bridgeProc = null;
let bridgeState = "stopped";
const bridgeLogs = [];

function pushBridgeLog(line) {
  const clean = String(line || "").trim();
  if (!clean) return;
  bridgeLogs.push(`[${new Date().toLocaleTimeString()}] ${clean}`);
  if (bridgeLogs.length > 40) bridgeLogs.shift();
}

function bridgeConfigPath() {
  return path.join(app.getPath("userData"), "print-bridge.json");
}

function readBridgeConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(bridgeConfigPath(), "utf8"));
    return {
      url: String(raw.url || BASE_URL).trim() || BASE_URL,
      token: String(raw.token || "").trim(),
      enabled: raw.enabled !== false
    };
  } catch {
    return { url: BASE_URL, token: "", enabled: true };
  }
}

function writeBridgeConfig(next) {
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  fs.writeFileSync(bridgeConfigPath(), `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
}

function resolveBridgeScript() {
  const bundled = path.join(__dirname, "print-bridge.mjs");
  if (fs.existsSync(bundled)) return bundled;
  const repoScript = path.resolve(__dirname, "..", "server", "print-agent.mjs");
  return fs.existsSync(repoScript) ? repoScript : null;
}

function stopPrintBridge() {
  if (bridgeProc) {
    try { bridgeProc.kill(); } catch { /* ignore */ }
    bridgeProc = null;
  }
  bridgeState = "stopped";
}

function startPrintBridge() {
  stopPrintBridge();
  const cfg = readBridgeConfig();
  if (!cfg.token || !cfg.enabled) {
    bridgeState = cfg.token ? "stopped" : "unconfigured";
    return;
  }
  const script = resolveBridgeScript();
  if (!script) {
    bridgeState = "error";
    pushBridgeLog("Bundled print-bridge.mjs not found.");
    return;
  }
  bridgeState = "running";
  pushBridgeLog(`Starting print bridge (${cfg.url})...`);
  const child = spawn(process.execPath, [script], {
    cwd: app.getPath("userData"),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      PRINT_BRIDGE_URL: cfg.url,
      PRINT_BRIDGE_TOKEN: cfg.token
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  bridgeProc = child;
  const onData = (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) pushBridgeLog(line);
  };
  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);
  child.on("exit", (code) => {
    if (bridgeProc === child) {
      bridgeProc = null;
      bridgeState = code && code !== 0 ? "error" : "stopped";
    }
    pushBridgeLog(`Print bridge exited (code ${code ?? "null"})`);
  });
}

function openBridgeWindow() {
  if (bridgeWindow && !bridgeWindow.isDestroyed()) {
    bridgeWindow.focus();
    return;
  }
  bridgeWindow = new BrowserWindow({
    width: 480,
    height: 460,
    resizable: false,
    title: "打印桥设置 (Print Bridge)",
    ...(fs.existsSync(ICON_PATH) ? { icon: ICON_PATH } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "bridge-preload.js")
    }
  });
  bridgeWindow.setMenuBarVisibility(false);
  bridgeWindow.on("closed", () => { bridgeWindow = null; });
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#121517;color:#e7ecea;margin:0;padding:18px;font-size:13px}
h3{margin:0 0 8px;font-size:16px}
p{margin:0 0 12px;color:#9fb0aa;line-height:1.45}
label{display:block;margin-bottom:10px}
input{width:100%;box-sizing:border-box;padding:8px 10px;border-radius:6px;border:1px solid #303a38;background:#1a1f22;color:#fff;margin-top:4px;font-size:13px}
.row{display:flex;gap:8px;margin-top:12px}
button{padding:8px 12px;border-radius:6px;border:1px solid #394844;background:#1f2729;color:#e7ecea;cursor:pointer;font-size:13px}
button.primary{background:#8fb0a3;color:#0f1113;border-color:#8fb0a3;font-weight:600}
pre{margin:12px 0 0;background:#0b0d0e;border:1px solid #242b2d;border-radius:6px;padding:8px;height:135px;overflow:auto;font-size:11px;color:#b8c7c2;white-space:pre-wrap;word-break:break-all}
</style></head><body>
<h3>内置热敏打印桥</h3>
<p>在管理后台「打印 → 配对打印桥」复制令牌粘贴到下方。配置后开着桌面端即可自动出单，无需额外开终端。</p>
<label>服务地址 URL<input id="url" type="text"/></label>
<label>打印桥令牌 Token<input id="token" type="password" placeholder="粘贴 PRINT_BRIDGE_TOKEN"/></label>
<div id="status"></div>
<div class="row">
  <button class="primary" id="save">保存并启动</button>
  <button id="stop">停止打印桥</button>
  <button id="refresh">刷新日志</button>
</div>
<pre id="logs"></pre>
<script>
const $ = (id) => document.getElementById(id);
async function load() {
  const s = await window.bridgeConfig.get();
  $("url").value = s.url;
  $("token").value = s.token;
  const label = { running: "运行中", stopped: "已停止", unconfigured: "未配对", error: "异常退出" }[s.state] || s.state;
  $("status").textContent = "状态：" + label + (s.hasScript ? "" : "（仅云端打包或本地仓库可用）");
  $("logs").textContent = (s.logs || []).join("\\n") || "暂无日志";
}
$("save").onclick = async () => {
  await window.bridgeConfig.save({ url: $("url").value, token: $("token").value, enabled: true });
  await load();
};
$("stop").onclick = async () => {
  await window.bridgeConfig.stop();
  await load();
};
$("refresh").onclick = load;
load();
</script></body></html>`;
  bridgeWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

async function clearAppWebCache() {
  await session.defaultSession.clearCache();
  await session.defaultSession.clearStorageData({ storages: ["serviceworkers", "cachestorage"] });
}

function createWindow(route = "/pos.html") {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: "Chiri Kitchen",
    backgroundColor: "#0f1113",
    ...(fs.existsSync(ICON_PATH) ? { icon: ICON_PATH } : {}),
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
      label: "打印桥",
      submenu: [
        { label: "配对与状态…", click: () => openBridgeWindow() },
        { label: "重启内置打印桥", click: () => startPrintBridge() },
        { label: "停止内置打印桥", click: () => stopPrintBridge() }
      ]
    },
    {
      label: "视图",
      submenu: [
        { label: "刷新", accelerator: "CmdOrCtrl+R", click: () => mainWindow?.reload() },
        {
          label: "清缓存并强制刷新",
          accelerator: "CmdOrCtrl+Shift+R",
          click: async () => {
            await clearAppWebCache();
            mainWindow?.webContents.reloadIgnoringCache();
          }
        },
        { type: "separator" },
        { role: "togglefullscreen" }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle("print-bridge:get", () => ({
  ...readBridgeConfig(),
  state: bridgeState,
  hasScript: Boolean(resolveBridgeScript()),
  logs: bridgeLogs
}));

ipcMain.handle("print-bridge:save", (_event, payload) => {
  const next = {
    url: String(payload?.url || BASE_URL).trim() || BASE_URL,
    token: String(payload?.token || "").trim(),
    enabled: payload?.enabled !== false
  };
  writeBridgeConfig(next);
  startPrintBridge();
  return { state: bridgeState };
});

ipcMain.handle("print-bridge:stop", () => {
  const current = readBridgeConfig();
  writeBridgeConfig({ ...current, enabled: false });
  stopPrintBridge();
  return { state: bridgeState };
});

app.whenReady().then(async () => {
  buildMenu();
  await clearAppWebCache();
  createWindow("/pos.html");
  startPrintBridge();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow("/pos.html");
  });
});

app.on("before-quit", () => {
  stopPrintBridge();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
