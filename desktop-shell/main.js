import { app, BrowserWindow, shell } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_NAME = 'Harness Agent';
const APP_USER_MODEL_ID = 'com.wangguoai.harness.desktop';
const STUDIO_PORT = process.env.HARNESS_AGENT_PORT || '8090';
const STUDIO_URL = `http://127.0.0.1:${STUDIO_PORT}`;

if (process.platform === 'win32') {
  app.setAppUserModelId(APP_USER_MODEL_ID);
}

let mainWindow = null;
let backendProcess = null;

function resolveBackendJar() {
  const packagedJar = path.join(process.resourcesPath || '', 'backend', 'harness-agent.jar');
  if (fs.existsSync(packagedJar)) {
    return packagedJar;
  }
  return path.resolve(__dirname, '..', 'java-harness-studio', 'target', 'wg-harness-studio-0.3.0.jar');
}

function startEmbeddedJavaBackendIfNeeded() {
  const jarPath = resolveBackendJar();
  if (!fs.existsSync(jarPath)) return;
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
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#0d0d0f',
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
