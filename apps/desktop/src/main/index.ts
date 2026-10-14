import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
import * as engine from '@sh-video-editor/engine-node';
import { registerPickFilesIpc } from './pickFiles';

// 엔진은 당장은 메인 프로세스에 산다. 마일스톤 1 에서 utility process 로 옮겨 크래시를 격리한다(ADR-0002).
let session: engine.Engine | null = null;
function getSession(): engine.Engine {
  if (!session) session = new engine.Engine();
  return session;
}

function registerEngineIpc() {
  ipcMain.handle('engine:version', () => engine.engineVersion());
  ipcMain.handle('engine:commands', () => engine.commandCatalog());
  ipcMain.handle('engine:execute', (_e, id: string, paramsJson?: string) => getSession().execute(id, paramsJson));
  ipcMain.handle('engine:isEnabled', (_e, id: string) => getSession().isEnabled(id));
  ipcMain.handle('engine:undo', () => getSession().undo());
  ipcMain.handle('engine:redo', () => getSession().redo());
  ipcMain.handle('engine:playhead', () => getSession().playhead());
  ipcMain.handle('engine:setPlayhead', (_e, tick: number) => getSession().setPlayhead(tick));
  ipcMain.handle('engine:pumpJobs', (_e, budgetMs: number) => getSession().pumpJobs(budgetMs));
  ipcMain.handle('engine:renderFrame', (_e, tick: number, scale: number) => {
    const f = getSession().renderFrame(tick, scale);
    if (!f) return null;
    // Buffer 는 구조적 복제로 Uint8Array 가 되어 렌더러에 넘어간다
    return { width: f.width, height: f.height, rgba: new Uint8Array(f.rgba) };
  });
}

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
  registerEngineIpc();
  registerPickFilesIpc();
  const win = createWindow();
  // 스모크 테스트(scripts/smoke.cjs): 창이 뜨고 엔진이 응답하면 "smoke: ok" 를 찍고 끝낸다.
  if (process.env['SH_SMOKE']) {
    win.webContents.once('did-finish-load', () => {
      const count = JSON.parse(engine.commandCatalog()).length as number;
      console.log(`smoke: ok (${engine.engineVersion()}, commands ${count})`);
      app.exit(0);
    });
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
