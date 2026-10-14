import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { runDiagnostics } from './diagnostics';
import { EngineSupervisor } from './engine-supervisor';

// 엔진(.node)은 utility process(src/engine-host)에 산다. main 은 띄우고 감시하고 렌더러를 포트로 이어 줄 뿐이다.
const engine = new EngineSupervisor();

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'SH Video Editor',
    backgroundColor: '#2a2c32',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: false },
  });
  if (process.env['ELECTRON_RENDERER_URL']) void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));
  return win;
}

void app.whenReady().then(() => {
  engine.start();
  const win = createWindow();
  runDiagnostics(win, engine);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => engine.stop());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
