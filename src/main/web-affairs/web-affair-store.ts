import { app } from 'electron'
import { createHash } from 'node:crypto'
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
  | { kind: 'valid'; snapshot: WebAffairSnapshot; discardedArticleCount: number }
  | { kind: 'missing' }
  | { kind: 'invalid'; error: Error }

interface RecoveryJournal {
  journalVersion: 2
  snapshotSchemaVersion: 7
  baseRevision: number
  targetRevision: number
  targetHash: string
  affairs: WebAffairSnapshot['affairs']
}

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
      if (primary.discardedArticleCount > 0) {
        await this.rewriteSanitizedSnapshot(this.filePath, primary.snapshot)
        console.warn('[WebAffairStore] 已删除旧版文章发布任务', {
          filePath: this.filePath,
          discardedArticleCount: primary.discardedArticleCount,
        })
      }
      const staleBackup = await this.readSnapshot(this.backupPath)
      if (staleBackup.kind === 'valid' && staleBackup.discardedArticleCount > 0) {
        await this.rewriteSanitizedSnapshot(this.backupPath, staleBackup.snapshot)
      }
      console.info('[WebAffairStore] 事务数据已加载', {
        filePath: this.filePath,
        revision: primary.snapshot.revision,
        affairCount: primary.snapshot.affairs.length,
      })
      return this.recoverFromJournal(primary.snapshot)
    }

    const backup = await this.readSnapshot(this.backupPath)
    if (backup.kind === 'valid') {
      if (backup.discardedArticleCount > 0) {
        await this.rewriteSanitizedSnapshot(this.backupPath, backup.snapshot)
      }
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
      const raw = JSON.parse(await readFile(path, 'utf8')) as unknown
      const rawAffairs =
        raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>)['affairs'])
          ? ((raw as Record<string, unknown>)['affairs'] as unknown[])
          : []
      const isLegacySnapshot =
        !raw || typeof raw !== 'object' || (raw as Record<string, unknown>)['schemaVersion'] !== 7
      const discardedArticleCount = isLegacySnapshot
        ? rawAffairs.filter(
            (item) =>
              item &&
              typeof item === 'object' &&
              (item as Record<string, unknown>)['kind'] === 'article-publishing',
          ).length
        : 0
      return {
        kind: 'valid',
        snapshot: parseWebAffairSnapshot(raw),
        discardedArticleCount,
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' }
      const normalized = error instanceof Error ? error : new Error(String(error))
      console.warn(`[WebAffairStore] 无法读取 ${path}:`, normalized.message)
      return { kind: 'invalid', error: normalized }
    }
  }

  private async rewriteSanitizedSnapshot(path: string, snapshot: WebAffairSnapshot): Promise<void> {
    const temporaryPath = `${path}.sanitize.tmp`
    await mkdir(dirname(path), { recursive: true })
    await writeFile(temporaryPath, JSON.stringify(snapshot, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    })
    await rename(temporaryPath, path)
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
    const journal = await this.readRecoveryJournal()
    if (journal.kind === 'missing') return snapshot
    if (journal.kind === 'invalid') {
      throw new Error('事务恢复日志损坏；原文件已保留，已停止发布写入')
    }
    if (journal.journal.targetRevision <= snapshot.revision) {
      await this.clearRecoveryJournal()
      return snapshot
    }
    if (journal.journal.baseRevision > snapshot.revision) {
      throw new Error('事务恢复日志与主文件 revision 不连续；已停止发布写入')
    }
    const affairs = new Map(snapshot.affairs.map((affair) => [affair.id, affair]))
    for (const affair of journal.journal.affairs) affairs.set(affair.id, affair)
    const recovered = parseWebAffairSnapshot({
      ...snapshot,
      revision: journal.journal.targetRevision,
      affairs: [...affairs.values()],
    })
    console.warn('[WebAffairStore] 已从固定恢复日志补回未完成的事务状态', {
      filePath: this.filePath,
      recoveryPath: this.recoveryPath,
      revision: recovered.revision,
      recoveredAffairCount: journal.journal.affairs.length,
    })
    await this.persist(recovered, false)
    await this.clearRecoveryJournal()
    return recovered
  }

  private async readRecoveryJournal(): Promise<
    | { kind: 'valid'; journal: RecoveryJournal }
    | { kind: 'missing' }
    | { kind: 'invalid'; error: Error }
  > {
    try {
      const metadata = await stat(this.recoveryPath)
      if (metadata.size > MAX_RECOVERY_BYTES) {
        throw new Error(`事务恢复日志超过 ${MAX_RECOVERY_BYTES} 字节限制`)
      }
      const raw = JSON.parse(await readFile(this.recoveryPath, 'utf8')) as Partial<RecoveryJournal>
      if (
        ![1, 2].includes(Number(raw.journalVersion)) ||
        !Number.isInteger(raw.baseRevision) ||
        !Number.isInteger(raw.targetRevision) ||
        typeof raw.targetHash !== 'string' ||
        !Array.isArray(raw.affairs)
      ) {
        throw new Error('事务恢复日志结构无效')
      }
      const rawAffairs = raw.affairs as WebAffairSnapshot['affairs']
      const targetRevision = Number(raw.targetRevision)
      const expectedHash = recoveryTargetHash(targetRevision, rawAffairs)
      if (expectedHash !== raw.targetHash) throw new Error('事务恢复日志目标 hash 不匹配')
      const sanitizedAffairs =
        raw.journalVersion === 2 && raw.snapshotSchemaVersion === 7
          ? rawAffairs
          : rawAffairs.filter((affair) => affair.kind !== 'article-publishing')
      const snapshot = parseWebAffairSnapshot({
        schemaVersion: 7,
        revision: targetRevision,
        affairs: sanitizedAffairs,
      })
      return {
        kind: 'valid',
        journal: {
          journalVersion: 2,
          snapshotSchemaVersion: 7,
          baseRevision: raw.baseRevision!,
          targetRevision: snapshot.revision,
          targetHash: raw.targetHash,
          affairs: snapshot.affairs,
        },
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' }
      const normalized = error instanceof Error ? error : new Error(String(error))
      console.warn('[WebAffairStore] 无法读取恢复日志:', normalized.message)
      return { kind: 'invalid', error: normalized }
    }
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
      schemaVersion: 7,
      revision: snapshot.revision,
      affairs: activeArticleAffairs,
    })
    while (
      recovery.affairs.length > 1 &&
      Buffer.byteLength(serializeRecoveryJournal(recovery), 'utf8') > MAX_RECOVERY_BYTES
    ) {
      recovery = { ...recovery, affairs: recovery.affairs.slice(0, -1) }
    }
    const serialized = serializeRecoveryJournal(recovery)
    if (Buffer.byteLength(serialized, 'utf8') > MAX_RECOVERY_BYTES) {
      throw new Error(`事务恢复日志超过 ${MAX_RECOVERY_BYTES} 字节限制`)
    }
    const temporaryPath = `${this.recoveryPath}.tmp`
    await mkdir(dirname(this.recoveryPath), { recursive: true })
    await writeFile(temporaryPath, serialized, { encoding: 'utf8', mode: 0o600 })
    await rename(temporaryPath, this.recoveryPath)
  }
}

function serializeRecoveryJournal(snapshot: WebAffairSnapshot): string {
  const journal: RecoveryJournal = {
    journalVersion: 2,
    snapshotSchemaVersion: 7,
    baseRevision: Math.max(0, snapshot.revision - 1),
    targetRevision: snapshot.revision,
    targetHash: recoveryTargetHash(snapshot.revision, snapshot.affairs),
    affairs: snapshot.affairs,
  }
  return JSON.stringify(journal)
}

function recoveryTargetHash(revision: number, affairs: WebAffairSnapshot['affairs']): string {
  return createHash('sha256').update(JSON.stringify({ revision, affairs })).digest('hex')
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
