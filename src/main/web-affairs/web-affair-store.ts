import { app } from 'electron'
import { copyFile, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  EMPTY_WEB_AFFAIR_SNAPSHOT,
  type WebAffairSnapshot,
} from '../../shared/web-affairs/web-affair-types'
import { parseWebAffairSnapshot } from '../../shared/web-affairs/web-affair-schema'

const STORE_HIGH_WATER_BYTES = 7 * 1024 * 1024
const MAX_STORE_BYTES = 64 * 1024 * 1024
const MAX_RECOVERY_BYTES = 2 * 1024 * 1024
const COMPACTED_EVENT_LIMIT = 500
const RECOVERY_AFFAIR_LIMIT = 8

type SnapshotReadResult =
  | { kind: 'valid'; snapshot: WebAffairSnapshot }
  | { kind: 'missing' }
  | { kind: 'invalid'; error: Error }

export class WebAffairStore {
  readonly filePath: string
  readonly backupPath: string
  readonly recoveryPath: string
  private saveQueue: Promise<void> = Promise.resolve()

  constructor(filePath = join(app.getPath('userData'), 'web-affairs', 'web-affairs.json')) {
    this.filePath = filePath
    this.backupPath = `${filePath}.bak`
    this.recoveryPath = `${filePath}.recovery`
  }

  async load(): Promise<WebAffairSnapshot> {
    const primary = await this.readSnapshot(this.filePath)
    if (primary.kind === 'valid') {
      console.info('[WebAffairStore] 事务数据已加载', {
        filePath: this.filePath,
        revision: primary.snapshot.revision,
        affairCount: primary.snapshot.affairs.length,
      })
      return this.recoverFromJournal(primary.snapshot)
    }

    const backup = await this.readSnapshot(this.backupPath)
    if (backup.kind === 'valid') {
      await this.persist(backup.snapshot, false)
      console.warn('[WebAffairStore] 主文件不可用，已从备份恢复事务数据', {
        filePath: this.filePath,
        backupPath: this.backupPath,
        revision: backup.snapshot.revision,
        affairCount: backup.snapshot.affairs.length,
      })
      return this.recoverFromJournal(backup.snapshot)
    }

    if (primary.kind === 'invalid' || backup.kind === 'invalid') {
      throw new Error('事务数据文件损坏；原文件已保留，请从诊断或备份恢复')
    }
    console.info('[WebAffairStore] 未找到事务数据，以空历史启动', {
      filePath: this.filePath,
    })
    return this.recoverFromJournal(structuredClone(EMPTY_WEB_AFFAIR_SNAPSHOT))
  }

  async save(snapshot: WebAffairSnapshot): Promise<WebAffairSnapshot> {
    const compacted = compactSnapshot(parseWebAffairSnapshot(snapshot), STORE_HIGH_WATER_BYTES)
    await this.persistRecoveryJournal(compacted)
    await this.persist(compacted, true)
    await this.clearRecoveryJournal()
    return compacted
  }

  async flush(): Promise<void> {
    await this.saveQueue
  }

  private async readSnapshot(path: string): Promise<SnapshotReadResult> {
    try {
      const metadata = await stat(path)
      if (metadata.size > MAX_STORE_BYTES) {
        throw new Error(`事务文件超过 ${MAX_STORE_BYTES} 字节限制`)
      }
      return {
        kind: 'valid',
        snapshot: parseWebAffairSnapshot(JSON.parse(await readFile(path, 'utf8'))),
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' }
      const normalized = error instanceof Error ? error : new Error(String(error))
      console.warn(`[WebAffairStore] 无法读取 ${path}:`, normalized.message)
      return { kind: 'invalid', error: normalized }
    }
  }

  private async persist(snapshot: WebAffairSnapshot, preservePrimary: boolean): Promise<void> {
    const serialized = JSON.stringify(snapshot, null, 2)
    if (Buffer.byteLength(serialized, 'utf8') > MAX_STORE_BYTES) {
      throw new Error(`事务文件超过 ${MAX_STORE_BYTES} 字节限制`)
    }
    const temporaryPath = `${this.filePath}.tmp`
    const persist = async (): Promise<void> => {
      await mkdir(dirname(this.filePath), { recursive: true })
      if (preservePrimary && (await this.readSnapshot(this.filePath)).kind === 'valid') {
        await copyFile(this.filePath, this.backupPath)
      }
      await writeFile(temporaryPath, serialized, { encoding: 'utf8', mode: 0o600 })
      await rename(temporaryPath, this.filePath)
      console.info('[WebAffairStore] 事务数据已持久化', {
        filePath: this.filePath,
        revision: snapshot.revision,
        affairCount: snapshot.affairs.length,
      })
    }
    const pending = this.saveQueue.then(persist, persist)
    this.saveQueue = pending.catch(() => undefined)
    await pending
  }

  private async recoverFromJournal(snapshot: WebAffairSnapshot): Promise<WebAffairSnapshot> {
    const journal = await this.readSnapshot(this.recoveryPath)
    if (journal.kind !== 'valid' || journal.snapshot.revision <= snapshot.revision) return snapshot
    const affairs = new Map(snapshot.affairs.map((affair) => [affair.id, affair]))
    for (const affair of journal.snapshot.affairs) affairs.set(affair.id, affair)
    const recovered = parseWebAffairSnapshot({
      ...snapshot,
      revision: journal.snapshot.revision,
      affairs: [...affairs.values()],
    })
    console.warn('[WebAffairStore] 已从固定恢复日志补回未完成的事务状态', {
      filePath: this.filePath,
      recoveryPath: this.recoveryPath,
      revision: recovered.revision,
      recoveredAffairCount: journal.snapshot.affairs.length,
    })
    await this.persist(recovered, false)
    await this.clearRecoveryJournal()
    return recovered
  }

  private async clearRecoveryJournal(): Promise<void> {
    try {
      await unlink(this.recoveryPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(
          '[WebAffairStore] 恢复日志清理失败；主文件已提交，下次加载会按 revision 忽略',
          {
            recoveryPath: this.recoveryPath,
            error: error instanceof Error ? error.message : String(error),
          },
        )
      }
    }
  }

  private async persistRecoveryJournal(snapshot: WebAffairSnapshot): Promise<void> {
    const activeArticleAffairs = snapshot.affairs
      .filter(
        (affair) =>
          affair.kind === 'article-publishing' &&
          affair.articlePublishing &&
          affair.articlePublishing.execution.status !== 'draft',
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, RECOVERY_AFFAIR_LIMIT)
      .map((affair) => compactAffairHistory(affair, 100, 20))
    if (activeArticleAffairs.length === 0) return
    let recovery = parseWebAffairSnapshot({
      schemaVersion: 5,
      revision: snapshot.revision,
      affairs: activeArticleAffairs,
    })
    while (
      recovery.affairs.length > 1 &&
      Buffer.byteLength(JSON.stringify(recovery), 'utf8') > MAX_RECOVERY_BYTES
    ) {
      recovery = { ...recovery, affairs: recovery.affairs.slice(0, -1) }
    }
    const serialized = JSON.stringify(recovery)
    if (Buffer.byteLength(serialized, 'utf8') > MAX_RECOVERY_BYTES) {
      throw new Error(`事务恢复日志超过 ${MAX_RECOVERY_BYTES} 字节限制`)
    }
    const temporaryPath = `${this.recoveryPath}.tmp`
    await mkdir(dirname(this.recoveryPath), { recursive: true })
    await writeFile(temporaryPath, serialized, { encoding: 'utf8', mode: 0o600 })
    await rename(temporaryPath, this.recoveryPath)
  }
}

function compactSnapshot(snapshot: WebAffairSnapshot, targetBytes: number): WebAffairSnapshot {
  if (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') <= targetBytes) return snapshot
  let compacted = {
    ...snapshot,
    affairs: snapshot.affairs.map((affair) => compactAffairHistory(affair, COMPACTED_EVENT_LIMIT)),
  }
  if (Buffer.byteLength(JSON.stringify(compacted), 'utf8') <= targetBytes) {
    return parseWebAffairSnapshot(compacted)
  }
  compacted = {
    ...compacted,
    affairs: compacted.affairs.map((affair) => compactAffairHistory(affair, 100, 20)),
  }
  return parseWebAffairSnapshot(compacted)
}

function compactAffairHistory(
  affair: WebAffairSnapshot['affairs'][number],
  eventLimit: number,
  evidenceLimit?: number,
): WebAffairSnapshot['affairs'][number] {
  const events =
    affair.events.length <= eventLimit
      ? affair.events
      : [
          {
            id: affair.events[0].id,
            type: 'node-status-changed' as const,
            summary: `已压缩 ${affair.events.length - eventLimit + 1} 条较早诊断事件`,
            occurredAt: affair.events[0].occurredAt,
          },
          ...affair.events.slice(-(eventLimit - 1)),
        ]
  const attempts = evidenceLimit
    ? affair.attempts.map((attempt) => ({
        ...attempt,
        evidence: attempt.evidence.slice(-evidenceLimit),
        processedRuntimeEventIds: attempt.processedRuntimeEventIds?.slice(-100),
      }))
    : affair.attempts
  return { ...affair, events, attempts }
}
