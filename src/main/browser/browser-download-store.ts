import type { BrowserWindow } from 'electron'
import { app, shell } from 'electron'
import { basename, dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import {
  browserIpcEvents,
  type BrowserDownloadChangedPayload,
  type BrowserDownloadRecord,
} from '../../shared/ipc/browser'

interface StartDownloadOptions {
  id: string
  trigger: 'user' | 'agent'
  taskRunId?: string
  tabId: string
  workspaceKey: string | null
  sourceUrl: string
  suggestedFilename: string
}

export class BrowserDownloadStore {
  private readonly filePath = join(app.getPath('userData'), 'browser-downloads.json')
  private readonly downloads = new Map<string, BrowserDownloadRecord>()
  private loaded = false
  private pendingSave: Promise<void> = Promise.resolve()

  constructor(
    private readonly mainWindow: BrowserWindow,
    private readonly getWorkspacePath?: () => string | null | undefined,
  ) {}

  async load(): Promise<void> {
    const pendingRecords = new Map(this.downloads)
    try {
      const raw = await readFile(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        this.downloads.clear()
        for (const record of parsed) {
          if (record?.id && record?.suggestedFilename) {
            this.downloads.set(record.id, record as BrowserDownloadRecord)
          }
        }
      }
      for (const [id, record] of pendingRecords) {
        this.downloads.set(id, record)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[BrowserDownloadStore] 加载失败:', (error as Error).message)
      }
    }
    this.loaded = true
    this.persistSoon()
  }

  async startDownload(
    options: StartDownloadOptions,
  ): Promise<{ record: BrowserDownloadRecord; targetPath: string }> {
    const targetPath = await this.resolveInitialPath(options)
    const record: BrowserDownloadRecord = {
      id: options.id,
      trigger: options.trigger,
      retention: options.trigger === 'agent' ? 'temporary' : 'kept',
      taskRunId: options.taskRunId,
      tabId: options.tabId,
      workspaceKey: options.workspaceKey,
      sourceUrl: options.sourceUrl,
      suggestedFilename: options.suggestedFilename,
      tempPath: options.trigger === 'agent' ? targetPath : undefined,
      savedPath: options.trigger === 'user' ? targetPath : undefined,
      status: 'downloading',
      createdAt: Date.now(),
    }
    this.downloads.set(record.id, record)
    this.emitDownloadChanged(record)
    this.persistSoon()
    return { record: { ...record }, targetPath }
  }

  completeDownload(id: string, path: string): BrowserDownloadRecord {
    const record = this.requireDownload(id)
    record.status = 'completed'
    record.completedAt = Date.now()
    if (record.trigger === 'agent') {
      record.tempPath = path
    } else {
      record.savedPath = path
    }
    this.emitDownloadChanged(record)
    this.persistSoon()
    return { ...record }
  }

  markDownloadSavedAs(id: string, path: string): BrowserDownloadRecord {
    const record = this.requireDownload(id)
    record.savedPath = path
    record.retention = 'kept'
    record.status = 'completed'
    record.completedAt = record.completedAt ?? Date.now()
    this.emitDownloadChanged(record)
    this.persistSoon()
    return { ...record }
  }

  failDownload(id: string, error: unknown): BrowserDownloadRecord {
    const record = this.requireDownload(id)
    record.status = 'failed'
    record.errorMessage = error instanceof Error ? error.message : String(error)
    this.emitDownloadChanged(record)
    this.persistSoon()
    return { ...record }
  }

  listDownloads(): BrowserDownloadRecord[] {
    return Array.from(this.downloads.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((record) => this.serializeRecord(record))
  }

  getDownload(id: string): BrowserDownloadRecord | null {
    const record = this.downloads.get(id)
    return record ? this.serializeRecord(record) : null
  }

  async keepDownloadToWorkspace(id: string): Promise<BrowserDownloadRecord> {
    const record = this.requireDownload(id)
    const workspacePath = this.getWorkspacePath?.()
    if (!workspacePath) throw new Error('当前没有可保存的工作空间')
    const sourcePath = record.tempPath ?? record.savedPath
    if (!sourcePath) throw new Error('下载文件尚未保存，无法保留到工作空间')

    const folderName = record.taskRunId ?? 'manual'
    const targetDir = join(workspacePath, '.cclink-studio', 'downloads', folderName)
    const targetPath = await this.uniquePath(targetDir, record.suggestedFilename)
    await copyFile(sourcePath, targetPath)
    record.savedPath = targetPath
    record.retention = 'kept'
    record.status = 'completed'
    record.completedAt = record.completedAt ?? Date.now()
    this.emitDownloadChanged(record)
    this.persistSoon()
    return { ...record }
  }

  async saveDownloadAs(id: string, targetPath: string): Promise<BrowserDownloadRecord> {
    const record = this.requireDownload(id)
    const sourcePath = record.tempPath ?? record.savedPath
    if (!sourcePath) throw new Error('下载文件尚未保存，无法另存为')
    await mkdir(dirname(targetPath), { recursive: true })
    await copyFile(sourcePath, targetPath)
    record.savedPath = targetPath
    record.retention = 'kept'
    record.status = 'completed'
    record.completedAt = record.completedAt ?? Date.now()
    this.emitDownloadChanged(record)
    this.persistSoon()
    return { ...record }
  }

  async discardDownload(id: string): Promise<BrowserDownloadRecord> {
    const record = this.requireDownload(id)
    if (record.retention === 'temporary' && record.tempPath) {
      await unlink(record.tempPath).catch(() => {})
    }
    record.retention = 'discarded'
    record.status = 'cancelled'
    this.emitDownloadChanged(record)
    this.persistSoon()
    return { ...record }
  }

  async openDownload(id: string): Promise<void> {
    const path = this.resolveReadablePath(this.requireDownload(id))
    if (!path) throw new Error('下载文件尚未保存，无法打开')
    if (!existsSync(path)) throw new Error('下载文件已不存在，无法打开')
    const error = await shell.openPath(path)
    if (error) throw new Error(error)
  }

  revealDownload(id: string): void {
    const path = this.resolveReadablePath(this.requireDownload(id))
    if (!path) throw new Error('下载文件尚未保存，无法定位')
    if (!existsSync(path)) throw new Error('下载文件已不存在，无法定位')
    shell.showItemInFolder(path)
  }

  private async resolveInitialPath(options: StartDownloadOptions): Promise<string> {
    const folderName =
      options.trigger === 'agent'
        ? join(app.getPath('userData'), 'agent-downloads', options.taskRunId ?? 'unassigned')
        : app.getPath('downloads')
    return this.uniquePath(folderName, options.suggestedFilename)
  }

  private async uniquePath(folderPath: string, suggestedFilename: string): Promise<string> {
    await mkdir(folderPath, { recursive: true })
    const safeName = sanitizeFilename(suggestedFilename || 'download')
    const parsed = splitFilename(safeName)
    let candidate = join(folderPath, safeName)
    let index = 1
    while (await exists(candidate)) {
      candidate = join(folderPath, `${parsed.name}-${index}${parsed.ext}`)
      index += 1
    }
    return candidate
  }

  private requireDownload(id: string): BrowserDownloadRecord {
    const record = this.downloads.get(id)
    if (!record) throw new Error(`下载记录不存在: ${id}`)
    return record
  }

  private resolveReadablePath(record: BrowserDownloadRecord): string | null {
    if (record.retention === 'discarded') return null
    return record.savedPath ?? record.tempPath ?? null
  }

  private serializeRecord(record: BrowserDownloadRecord): BrowserDownloadRecord {
    const path = this.resolveReadablePath(record)
    return {
      ...record,
      fileMissing: Boolean(path && !existsSync(path)),
    }
  }

  private emitDownloadChanged(record: BrowserDownloadRecord): void {
    if (this.mainWindow.isDestroyed()) return
    const payload: BrowserDownloadChangedPayload = { download: this.serializeRecord(record) }
    this.mainWindow.webContents.send(browserIpcEvents.downloadChanged, payload)
  }

  private persistSoon(): void {
    this.pendingSave = this.pendingSave.then(
      () => this.save(),
      () => this.save(),
    )
  }

  async flushPersistence(): Promise<void> {
    await this.pendingSave
  }

  private async save(): Promise<void> {
    if (!this.loaded) return
    try {
      await mkdir(dirname(this.filePath), { recursive: true })
      const records = this.listDownloads().slice(0, 300)
      await writeFile(this.filePath, JSON.stringify(records, null, 2), 'utf-8')
    } catch (error) {
      console.warn('[BrowserDownloadStore] 保存失败:', (error as Error).message)
    }
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function sanitizeFilename(filename: string): string {
  const safe = basename(filename)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .trim()
  return safe || 'download'
}

function splitFilename(filename: string): { name: string; ext: string } {
  const dot = filename.lastIndexOf('.')
  if (dot <= 0) return { name: filename, ext: '' }
  return { name: filename.slice(0, dot), ext: filename.slice(dot) }
}
