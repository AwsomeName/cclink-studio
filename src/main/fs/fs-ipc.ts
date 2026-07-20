import { ipcMain, shell } from 'electron'
import { FileService } from './file-service'
import { SettingsService } from '../settings/settings-service'
import { homedir } from 'os'
import { randomUUID } from 'crypto'

/**
 * 注册文件系统相关的 IPC 处理器
 */
export function registerFsIpc(fs: FileService, settingsService: SettingsService): void {
  const watchers = new Map<string, { stop: () => void }>()

  const stopWatcher = (watchId: string): boolean => {
    const watcher = watchers.get(watchId)
    if (!watcher) return false
    watcher.stop()
    watchers.delete(watchId)
    return true
  }

  // 获取用户 Home 目录路径
  ipcMain.handle('fs:getHomePath', () => {
    return homedir()
  })

  // 读取目录内容（根据设置决定是否显示隐藏文件）
  ipcMain.handle('fs:readDir', async (_event, dirPath: string) => {
    return fs.readDir(dirPath, { showHiddenFiles: settingsService.getAll().showHiddenFiles })
  })

  // 读取文件内容
  ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
    return fs.readFile(filePath)
  })

  ipcMain.handle('fs:readTextDocument', async (_event, filePath: string) => {
    return fs.readTextDocument(filePath)
  })

  // 渲染只读文件预览
  ipcMain.handle('fs:renderFile', async (_event, filePath: string) => {
    return fs.renderFile(filePath)
  })

  // 写入文件
  ipcMain.handle('fs:writeFile', async (_event, filePath: string, content: string) => {
    await fs.writeFile(filePath, content)
  })

  ipcMain.handle(
    'fs:saveTextDocument',
    async (
      _event,
      input: { filePath: string; content: string; expectedHash?: string; force?: boolean },
    ) => fs.saveTextDocument(input),
  )

  ipcMain.handle(
    'fs:importDocumentAsset',
    async (_event, documentPath: string, sourcePath: string) =>
      fs.importDocumentAsset(documentPath, sourcePath),
  )

  ipcMain.handle(
    'fs:saveDocumentAsset',
    async (
      _event,
      input: {
        documentPath: string
        fileName: string
        mimeType: string
        content: string
        encoding: 'base64'
      },
    ) => fs.saveDocumentAsset(input),
  )

  ipcMain.handle('fs:inspectMarkdownDocument', async (_event, documentPath: string) => {
    return fs.inspectMarkdownDocument(documentPath)
  })

  ipcMain.handle(
    'fs:saveMarkdownDocumentAs',
    async (_event, input: { sourcePath?: string; targetPath: string; content: string }) =>
      fs.saveMarkdownDocumentAs(input),
  )

  ipcMain.handle(
    'fs:relocateMarkdownDocument',
    async (_event, input: { sourcePath: string; targetPath: string }) =>
      fs.relocateMarkdownDocument(input),
  )

  ipcMain.handle(
    'fs:exportMarkdownDocumentZip',
    async (_event, input: { documentPath: string; targetPath: string }) =>
      fs.exportMarkdownDocumentZip(input),
  )

  ipcMain.handle(
    'fs:trashMarkdownDocument',
    async (_event, input: { documentPath: string; includeAssets: boolean }) =>
      fs.trashMarkdownDocument(input),
  )

  // 获取文件/目录元数据
  ipcMain.handle('fs:stat', async (_event, filePath: string) => {
    return fs.stat(filePath)
  })

  ipcMain.handle('fs:isDirectory', async (_event, dirPath: string) => {
    return fs.isDirectory(dirPath)
  })

  // 创建目录
  ipcMain.handle('fs:mkdir', async (_event, dirPath: string) => {
    await fs.mkdir(dirPath)
  })

  // 重命名
  ipcMain.handle('fs:rename', async (_event, oldPath: string, newPath: string) => {
    await fs.rename(oldPath, newPath)
  })

  // 移动文件/目录（不覆盖目标中的同名项）
  ipcMain.handle('fs:move', async (_event, oldPath: string, newPath: string) => {
    await fs.move(oldPath, newPath)
  })

  // 删除文件
  ipcMain.handle('fs:delete', async (_event, filePath: string) => {
    await fs.delete(filePath)
  })

  // 解压 zip 到同级同名目录
  ipcMain.handle('fs:extractZip', async (_event, filePath: string) => {
    return fs.extractZip(filePath)
  })

  // 用系统文件管理器打开路径
  ipcMain.handle('fs:openPath', async (_event, path: string) => {
    const error = await shell.openPath(path)
    if (error) throw new Error(error)
  })

  ipcMain.handle('fs:watchDirStart', (event, dirPath: string) => {
    const watchId = randomUUID()
    const sender = event.sender
    const watcher = fs.watchDir(dirPath, (changeEvent, filePath) => {
      if (sender.isDestroyed()) {
        stopWatcher(watchId)
        return
      }
      sender.send('fs:watchDirChanged', { watchId, event: changeEvent, filePath })
    })
    watchers.set(watchId, watcher)
    sender.once('destroyed', () => stopWatcher(watchId))
    return watchId
  })

  ipcMain.handle('fs:watchDirStop', (_event, watchId: string) => {
    return stopWatcher(watchId)
  })
}
