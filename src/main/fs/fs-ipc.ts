import { shell, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { FileService } from './file-service'
import { SettingsService } from '../settings/settings-service'
import { homedir } from 'os'
import { randomUUID } from 'crypto'
import type { TrustedRendererGuard } from '../ipc/trusted-renderer-guard'
import { registerTrustedIpcContract } from '../ipc/trusted-renderer-guard'
import type { IpcInvokeContract } from '../../shared/ipc/contract'
import { fsIpcContracts as fsIpc } from '../../shared/ipc/fs-contract'
import { fsIpcEvents, type FsWatchDirEvent } from '../../shared/ipc/fs'

/**
 * 注册文件系统相关的 IPC 处理器
 */
export function registerFsIpc(
  fs: FileService,
  settingsService: SettingsService,
  trustedRendererGuard: TrustedRendererGuard,
): void {
  const handle = <Args extends unknown[], Result>(
    contract: IpcInvokeContract<Args, Result>,
    handler: (event: IpcMainInvokeEvent, ...args: Args) => Result | Promise<Result>,
  ): void => registerTrustedIpcContract(contract, trustedRendererGuard, handler)
  const watchers = new Map<
    string,
    { stop: () => void; sender: WebContents; onSenderDestroyed: () => void }
  >()

  const stopWatcher = (watchId: string): boolean => {
    const watcher = watchers.get(watchId)
    if (!watcher) return false
    watchers.delete(watchId)
    watcher.sender.removeListener('destroyed', watcher.onSenderDestroyed)
    watcher.stop()
    return true
  }

  // 获取用户 Home 目录路径
  handle(fsIpc.getHomePath, () => {
    return homedir()
  })

  // 读取目录内容（根据设置决定是否显示隐藏文件）
  handle(fsIpc.readDir, async (_event, dirPath) => {
    return fs.readDir(dirPath, {
      showHiddenFiles: settingsService.getAll().showHiddenFiles,
    })
  })

  // 读取文件内容
  handle(fsIpc.readFile, async (_event, filePath) => {
    return fs.readFile(filePath)
  })

  handle(fsIpc.readTextDocument, async (_event, filePath) => {
    return fs.readTextDocument(filePath)
  })

  // 渲染只读文件预览
  handle(fsIpc.renderFile, async (_event, filePath) => {
    return fs.renderFile(filePath)
  })

  // 写入文件
  handle(fsIpc.writeFile, async (_event, filePath, content) => {
    await fs.writeFile(filePath, content)
  })

  handle(fsIpc.createFile, async (_event, filePath) => {
    await fs.createFile(filePath)
  })

  handle(fsIpc.saveTextDocument, async (_event, input) => fs.saveTextDocument(input))

  handle(fsIpc.importDocumentAsset, async (_event, documentPath, sourcePath) => {
    return fs.importDocumentAsset(documentPath, sourcePath)
  })

  handle(fsIpc.saveDocumentAsset, async (_event, input) => fs.saveDocumentAsset(input))

  handle(fsIpc.inspectMarkdownDocument, async (_event, documentPath) => {
    return fs.inspectMarkdownDocument(documentPath)
  })

  handle(fsIpc.saveMarkdownDocumentAs, async (_event, input) => fs.saveMarkdownDocumentAs(input))

  handle(fsIpc.relocateMarkdownDocument, async (_event, input) =>
    fs.relocateMarkdownDocument(input),
  )

  handle(fsIpc.exportMarkdownDocumentZip, async (_event, input) => {
    return fs.exportMarkdownDocumentZip(input)
  })

  handle(fsIpc.trashMarkdownDocument, async (_event, input) => fs.trashMarkdownDocument(input))

  handle(fsIpc.trashPath, async (_event, input) => fs.trashPath(input))

  handle(fsIpc.revealPath, (_event, input) => fs.revealPath(input))

  // 获取文件/目录元数据
  handle(fsIpc.stat, async (_event, filePath) => {
    return fs.stat(filePath)
  })

  handle(fsIpc.isDirectory, async (_event, filePath) => {
    return fs.isDirectory(filePath)
  })

  // 创建目录
  handle(fsIpc.mkdir, async (_event, dirPath) => {
    await fs.mkdir(dirPath)
  })

  // 重命名
  handle(fsIpc.rename, async (_event, oldPath, newPath) => {
    await fs.rename(oldPath, newPath)
  })

  // 移动文件/目录（不覆盖目标中的同名项）
  handle(fsIpc.move, async (_event, oldPath, newPath) => {
    await fs.move(oldPath, newPath)
  })

  handle(fsIpc.copyEntry, async (_event, input) => {
    return fs.copyEntry(input)
  })

  // 删除文件
  handle(fsIpc.delete, async (_event, filePath) => {
    await fs.delete(filePath)
  })

  // 解压 zip 到同级同名目录
  handle(fsIpc.extractZip, async (_event, filePath) => {
    return fs.extractZip(filePath)
  })

  // 用系统文件管理器打开路径
  handle(fsIpc.openPath, async (_event, path) => {
    const error = await shell.openPath(path)
    if (error) throw new Error(error)
  })

  handle(fsIpc.watchDirStart, (event, dirPath) => {
    const watchId = randomUUID()
    const sender = event.sender
    const watcher = fs.watchDir(dirPath, (changeEvent, filePath) => {
      if (sender.isDestroyed()) {
        stopWatcher(watchId)
        return
      }
      const payload: FsWatchDirEvent = { watchId, event: changeEvent, filePath }
      sender.send(fsIpcEvents.watchDirChanged, payload)
    })
    const onSenderDestroyed = (): void => {
      stopWatcher(watchId)
    }
    watchers.set(watchId, { ...watcher, sender, onSenderDestroyed })
    sender.once('destroyed', onSenderDestroyed)
    return watchId
  })

  handle(fsIpc.watchDirStop, (_event, watchId) => {
    return stopWatcher(watchId)
  })
}
