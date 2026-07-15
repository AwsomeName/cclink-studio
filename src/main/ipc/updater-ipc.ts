/**
 * updater-ipc — 更新检查 + 下载的 IPC 通道
 *
 * 通道：
 * - updater:check     — 手动触发一次检查（返回完整结果，无更新也返回）
 * - updater:download  — 下载最新 dmg 到 ~/Downloads 并自动打开（挂载）
 *
 * 主进程 → 渲染进程推送：
 * - updater:update-available — 周期检查发现新版本时推送 { latest }
 */

import { ipcMain, app, shell, net, type BrowserWindow } from 'electron'
import { createWriteStream } from 'fs'
import { join } from 'path'
import { checkForUpdates, startPeriodicCheck, type UpdateCheckResult } from '../updater/update-checker'

/** 缓存最近一次发现的更新（供 download 通道使用） */
let latestResult: UpdateCheckResult | null = null

export function registerUpdaterIpc(mainWindow: BrowserWindow): void {
  // 周期性检查：发现新版本时推送给渲染进程
  startPeriodicCheck((r) => {
    latestResult = r
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater:update-available', { latest: r.latest })
    }
  })

  /** 手动检查一次（UI 可主动调用，如「检查更新」按钮） */
  ipcMain.handle('updater:check', async () => {
    const r = await checkForUpdates()
    if (r && r.hasUpdate) {
      latestResult = r
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('updater:update-available', { latest: r.latest })
      }
    }
    return r
  })

  /** 下载 dmg 并打开（macOS 自动挂载到 Finder，用户拖进 Applications 替换） */
  ipcMain.handle('updater:download', async () => {
    if (!latestResult?.downloadUrl) {
      return { success: false, error: '无可用更新' }
    }
    const url = latestResult.downloadUrl
    const dmgName = url.split('/').pop() ?? 'CCLink-Studio.dmg'
    const savePath = join(app.getPath('downloads'), dmgName)

    try {
      await downloadFile(url, savePath)
      // 打开 dmg → macOS 自动挂载 → 用户拖进 Applications 替换
      await shell.openPath(savePath)
      return { success: true, path: savePath }
    } catch (err) {
      console.error('[UpdaterIPC] 下载失败:', err)
      return { success: false, error: String(err) }
    }
  })

  console.log('[UpdaterIPC] 更新检查 IPC 已注册')
}

/** 用 Electron net 模块下载文件到指定路径 */
function downloadFile(url: string, savePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = net.request(url)
    request.on('response', (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`))
        return
      }
      const stream = createWriteStream(savePath)
      ;(response as unknown as NodeJS.ReadableStream).pipe(stream)
      stream.on('finish', () => {
        stream.close()
        resolve()
      })
      stream.on('error', reject)
    })
    request.on('error', reject)
    request.end()
  })
}
