/**
 * 浏览器实例快照存储
 *
 * 浏览器 Tab 关闭时序列化其状态（URL / 设备模式 / 缩放），重启后通过「恢复上次会话」入口重建。
 *
 * 登录态（Cookie / localStorage）由 Electron 默认 session 持久化到磁盘，无需本存储——
 * 重建后访问同站仍保持登录。本存储只负责「回到你之前在的那个页面 + 视图模式」。
 *
 * 按 SettingsService 模板（key→value，pretty JSON，落盘 userData），数组形式 + 上限保护。
 * 注：不做 per-instance partition（多账号隔离）——那会把 view 移出默认 context、
 * 影响 Playwright 寻址，且非当前核心诉求；如需多账号隔离见 plan 的 Phase 3b。
 */

import { app } from 'electron'
import { join } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import type { BrowserHistoryEntry, BrowserInstanceSnapshot } from '../../shared/ipc/browser'
export type { BrowserHistoryEntry, BrowserInstanceSnapshot } from '../../shared/ipc/browser'

/** 快照数量上限（避免无限增长） */
const MAX_SNAPSHOTS = 30
const MAX_HISTORY = 200

export class BrowserInstanceStore {
  private readonly filePath: string
  private readonly historyFilePath: string
  private snapshots: BrowserInstanceSnapshot[] = []
  private history: BrowserHistoryEntry[] = []
  private loaded = false
  private historyLoaded = false
  private historyQueue: Promise<unknown> = Promise.resolve()

  constructor(filename = 'browser-snapshots.json') {
    this.filePath = join(app.getPath('userData'), filename)
    this.historyFilePath = join(app.getPath('userData'), 'browser-history.json')
  }

  /** 从磁盘加载（ENOENT 视为空） */
  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, 'utf-8')
      if (!raw.trim()) {
        this.snapshots = []
        return
      }
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        this.snapshots = parsed as BrowserInstanceSnapshot[]
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[BrowserInstanceStore] 加载失败:', (err as Error).message)
      }
      this.snapshots = []
    }
    this.loaded = true
  }

  /** 加载浏览历史（ENOENT 视为空） */
  private async loadHistory(): Promise<void> {
    try {
      const raw = await readFile(this.historyFilePath, 'utf-8')
      if (!raw.trim()) {
        this.history = []
        this.historyLoaded = true
        return
      }
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        this.history = parsed as BrowserHistoryEntry[]
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[BrowserInstanceStore] 加载历史失败:', (err as Error).message)
      }
      this.history = []
    }
    this.historyLoaded = true
  }

  /** 落盘 */
  private async save(): Promise<void> {
    try {
      await mkdir(join(this.filePath, '..'), { recursive: true })
      await writeFile(this.filePath, JSON.stringify(this.snapshots, null, 2), 'utf-8')
    } catch (err) {
      console.warn('[BrowserInstanceStore] 保存失败:', (err as Error).message)
    }
  }

  /** 保存浏览历史 */
  private async saveHistory(): Promise<void> {
    try {
      await mkdir(join(this.historyFilePath, '..'), { recursive: true })
      await writeFile(this.historyFilePath, JSON.stringify(this.history, null, 2), 'utf-8')
    } catch (err) {
      console.warn('[BrowserInstanceStore] 保存历史失败:', (err as Error).message)
    }
  }

  /** 记录一个关闭的实例快照（去重：同 URL 覆盖旧记录） */
  async record(snapshot: BrowserInstanceSnapshot): Promise<void> {
    if (!this.loaded) await this.load()
    // 同 URL 去重（重建会重新生成 id，但 URL 相同视为同一会话）
    this.snapshots = this.snapshots.filter((s) => s.url !== snapshot.url)
    this.snapshots.unshift(snapshot)
    // 上限保护（丢最旧的）
    if (this.snapshots.length > MAX_SNAPSHOTS) {
      this.snapshots = this.snapshots.slice(0, MAX_SNAPSHOTS)
    }
    await this.save()
  }

  /** 列出所有快照（最近在前） */
  async list(): Promise<BrowserInstanceSnapshot[]> {
    if (!this.loaded) await this.load()
    return [...this.snapshots]
  }

  /** 删除指定 id 的快照（已重建/不再需要时） */
  async remove(id: string): Promise<void> {
    if (!this.loaded) await this.load()
    this.snapshots = this.snapshots.filter((s) => s.id !== id)
    await this.save()
  }

  /** 清空所有快照 */
  async clear(): Promise<void> {
    this.snapshots = []
    await this.save()
  }

  /** Serialize lazy loading and writes so a stale read cannot replace a new visit. */
  private enqueueHistory<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.historyQueue.then(operation)
    this.historyQueue = pending.catch(() => undefined)
    return pending
  }

  /** 记录一次页面访问（同 URL 去重并移到最前） */
  recordHistory(entry: BrowserHistoryEntry): Promise<void> {
    return this.enqueueHistory(async () => {
      if (!this.historyLoaded) await this.loadHistory()
      this.history = this.history.filter((item) => item.url !== entry.url)
      this.history.unshift(entry)
      if (this.history.length > MAX_HISTORY) {
        this.history = this.history.slice(0, MAX_HISTORY)
      }
      await this.saveHistory()
    })
  }

  /** 列出最近浏览历史 */
  listHistory(limit = 50): Promise<BrowserHistoryEntry[]> {
    return this.enqueueHistory(async () => {
      if (!this.historyLoaded) await this.loadHistory()
      return this.history.slice(0, limit)
    })
  }

  /** 清空浏览历史 */
  clearHistory(): Promise<void> {
    return this.enqueueHistory(async () => {
      this.historyLoaded = true
      this.history = []
      await this.saveHistory()
    })
  }
}
