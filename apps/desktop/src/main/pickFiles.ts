import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron';

/** 렌더러의 "가져오기" 버튼이 부르는 파일 대화상자. 경로만 돌려주고 가져오기는 엔진 file.import 가 한다. */
export function registerPickFilesIpc() {
  ipcMain.handle('host:pickFiles', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const options: OpenDialogOptions = {
      title: '미디어 가져오기',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: '미디어 파일',
          extensions: [
            'mp4',
            'mov',
            'mkv',
            'webm',
            'avi',
            'm4v',
            'mxf',
            'mts',
            'png',
            'jpg',
            'jpeg',
            'gif',
            'bmp',
            'tif',
            'tiff',
            'webp',
            'mp3',
            'wav',
            'aac',
            'm4a',
            'flac',
            'ogg',
            'aiff',
          ],
        },
        { name: '영상', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'mxf', 'mts'] },
        { name: '사진', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'tif', 'tiff', 'webp'] },
        { name: '음악', extensions: ['mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg', 'aiff'] },
        { name: '모든 파일', extensions: ['*'] },
      ],
    };
    const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    return r.canceled ? [] : r.filePaths;
  });
}
