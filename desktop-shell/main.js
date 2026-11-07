import { app, BrowserWindow, shell } from 'electron';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_NAME = 'WG CodeX Studio';
const APP_USER_MODEL_ID = 'com.wangguoai.codex.desktop';
const STUDIO_PORT = process.env.WG_CODEX_PORT || '8090';
const STUDIO_URL = `http://127.0.0.1:${STUDIO_PORT}`;

if (process.platform === 'win32') {
  app.setAppUserModelId(APP_USER_MODEL_ID);
}

let mainWindow = null;
let backendProcess = null;

function startEmbeddedJavaBackendIfNeeded() {
  const jarPath = path.resolve(__dirname, '..', 'java-harness-studio', 'target', 'wg-harness-studio-0.3.0.jar');
  backendProcess = spawn('java', ['-jar', jarPath, `--server.port=${STUDIO_PORT}`], {
    stdio: 'ignore',
    windowsHide: true,
  });
}

function createDesktopWindow() {
  mainWindow = new BrowserWindow({
    title: APP_NAME,
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: '#09090b',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(STUDIO_URL);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  startEmbeddedJavaBackendIfNeeded();
  setTimeout(createDesktopWindow, 1200);
});

app.on('window-all-closed', () => {
  if (backendProcess) {
    backendProcess.kill();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
