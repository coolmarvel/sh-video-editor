import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { runDiagnostics } from './diagnostics';
import { EngineSupervisor } from './engine-supervisor';
import { registerPickFilesIpc } from './pickFiles';

// 엔진(.node)은 utility process(src/engine-host)에 산다. main 은 띄우고 감시하고 렌더러를 포트로 이어 줄 뿐이다.
const engine = new EngineSupervisor();

/** 파일 대화상자(엔진 아님). 자동 저장·복구는 엔진 프로세스가 맡고 데이터 디렉토리는 userData/engine. */
function registerDialogIpc() {
  ipcMain.handle('dialog:pickSavePath', async (e, defaultName: string, filters?: Electron.FileFilter[]) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const options: Electron.SaveDialogOptions = { defaultPath: defaultName, filters: filters ?? [] };
    const r = await (win ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options));
    return r.canceled || !r.filePath ? null : r.filePath;
  });
  ipcMain.handle('dialog:pickOpenPath', async (e, filters?: Electron.FileFilter[]) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const options: Electron.OpenDialogOptions = { properties: ['openFile'], filters: filters ?? [] };
    const r = await (win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options));
    return r.canceled ? null : (r.filePaths[0] ?? null);
  });
  // 화면이 만든 바이트(스티커 PNG)를 임시 파일로 써 준다. 엔진 프로세스는 이 경로를 file.import 로 읽는다
  ipcMain.handle('host:writeTempFile', async (_e, name: string, bytes: Uint8Array) => {
    const dir = join(app.getPath('temp'), 'sh-video-editor');
    await mkdir(dir, { recursive: true });
    const safe =
      String(name)
        .replace(/[^\w.-]+/g, '_')
        .slice(-80) || 'file';
    const path = join(dir, `${Date.now()}-${safe}`);
    await writeFile(path, Buffer.from(bytes));
    return path;
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'SH Video Editor',
    // 개발 실행·Linux 창 아이콘. Windows 패키지는 exe 리소스 아이콘(build/icon.ico, electron-builder win.icon)을 쓴다
    icon: join(__dirname, '../../build/icon.png'),
    backgroundColor: '#2a2c32',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: false },
  });
  if (process.env['ELECTRON_RENDERER_URL']) void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));
  return win;
}

void app.whenReady().then(() => {
  // Electron 기본 메뉴(File/Edit/View/Window)를 없앤다. 메뉴와 단축키는 화면(packages/editor)이 그린다.
  // 입력란의 복사·붙여넣기는 Windows/Linux 에서 Chromium 이 메뉴 없이도 처리한다.
  Menu.setApplicationMenu(null);
  engine.start(join(app.getPath('userData'), 'engine'));
  registerPickFilesIpc();
  registerDialogIpc();
  const win = createWindow();
  runDiagnostics(win, engine);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// 정상 종료: 엔진에 shutdown 을 보내 복구 저널을 정리한 뒤 끝낸다(한 번만).
let quitting = false;
app.on('before-quit', (e) => {
  if (quitting) return;
  quitting = true;
  e.preventDefault();
  void engine.shutdown().finally(() => app.quit());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
