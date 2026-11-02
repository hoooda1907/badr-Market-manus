const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
/* global __dirname */
const { app, BrowserWindow, dialog, session } = require("electron");

const PORT = 43173;
const HOST = "127.0.0.1";
const ORIGIN = `http://${HOST}:${PORT}`;
const UI_ROOT = path.join(__dirname, "ui");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
};

function sendFile(req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, ORIGIN).pathname);
  } catch {
    res.writeHead(400).end("Bad request");
    return;
  }
  const requested = path.resolve(UI_ROOT, `.${pathname}`);
  if (requested !== UI_ROOT && !requested.startsWith(`${UI_ROOT}${path.sep}`)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  let target = requested;
  try {
    if (fs.statSync(target).isDirectory()) target = path.join(target, "index.html");
    if (!fs.statSync(target).isFile()) throw new Error("not a file");
  } catch {
    target = path.join(UI_ROOT, "index.html");
  }
  if (!fs.existsSync(target)) {
    res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" }).end("أسواق بدر: ملفات الواجهة غير موجودة. أعد بناء نسخة Windows.");
    return;
  }
  res.writeHead(200, {
    "Content-Type": MIME[path.extname(target).toLowerCase()] || "application/octet-stream",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'self'; connect-src 'self' data: blob:; img-src 'self' data: blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-eval'; worker-src 'self' blob:; media-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-src 'none'",
  });
  if (req.method === "HEAD") res.end();
  else fs.createReadStream(target).pipe(res);
}

let localServer;
let mainWindow;
function openWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#f3f7f4",
    icon: path.join(__dirname, "app.ico"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    try {
      if (new URL(url).origin !== ORIGIN) event.preventDefault();
    } catch { event.preventDefault(); }
  });
  void mainWindow.loadURL(ORIGIN);
  mainWindow.on("closed", () => { mainWindow = null; });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(() => {
    session.defaultSession.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (details, callback) => {
      let allowed = details.url.startsWith("data:") || details.url.startsWith("blob:");
      try { allowed = allowed || new URL(details.url).origin === ORIGIN; }
      catch { allowed = false; }
      callback({ cancel: !allowed });
    });
    if (!fs.existsSync(path.join(UI_ROOT, "index.html"))) {
      dialog.showErrorBox("أسواق بدر", "ملفات الواجهة غير موجودة. أعد إنشاء حزمة Windows.");
      app.quit();
      return;
    }
    localServer = http.createServer((req, res) => sendFile(req, res));
    localServer.once("error", () => {
      dialog.showErrorBox("أسواق بدر", `تعذر فتح منفذ الواجهة المحلي ${PORT}. أغلق النسخة الأخرى أو التطبيق الذي يستخدم المنفذ ثم أعد المحاولة.`);
      app.quit();
    });
    localServer.listen(PORT, HOST, openWindow);
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => localServer?.close());
}
