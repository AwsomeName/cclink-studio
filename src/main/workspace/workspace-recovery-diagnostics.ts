import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type {
  WorkspaceRecoveryTraceEntry,
  WorkspaceRecoveryTraceSnapshot,
} from '../../shared/ipc/workspace-state'

interface WorkspaceRecoveryTraceFile {
  version: 1
  droppedCount: number
  entries: WorkspaceRecoveryTraceEntry[]
}

const MAX_TRACE_ENTRIES = 500

export type WorkspaceRecoveryTraceInput = Omit<
  WorkspaceRecoveryTraceEntry,
  'timestamp' | 'appVersion'
>

/**
 * 跨重启保留的工作台恢复轨迹。只接收结构统计和不可逆引用，不接收正文、路径或 Session ID。
 */
export class WorkspaceRecoveryDiagnostics {
  private entries: WorkspaceRecoveryTraceEntry[] = []
  private droppedCount = 0
  private documentStatus: WorkspaceRecoveryTraceSnapshot['documentStatus'] = 'pending'
  private saveQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly filePath: string,
    private readonly documentFilePath: string,
    private readonly appVersion: string,
  ) {}

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(
        await readFile(this.filePath, 'utf-8'),
      ) as Partial<WorkspaceRecoveryTraceFile>
      if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return
      this.entries = parsed.entries.slice(-MAX_TRACE_ENTRIES)
      this.droppedCount = Math.max(0, Number(parsed.droppedCount) || 0)
      if (parsed.entries.length > MAX_TRACE_ENTRIES) {
        this.droppedCount += parsed.entries.length - MAX_TRACE_ENTRIES
      }
    } catch {
      // 诊断轨迹损坏或不存在不能阻断工作台状态恢复。
    }
  }

  record(input: WorkspaceRecoveryTraceInput): void {
    this.entries.push({
      ...input,
      timestamp: new Date().toISOString(),
      appVersion: this.appVersion,
    })
    if (this.entries.length > MAX_TRACE_ENTRIES) {
      const overflow = this.entries.length - MAX_TRACE_ENTRIES
      this.entries = this.entries.slice(overflow)
      this.droppedCount += overflow
    }
    this.saveQueue = this.saveQueue.then(
      () => this.save(),
      () => this.save(),
    )
  }

  async flush(): Promise<void> {
    await this.saveQueue.catch(() => {})
  }

  getSnapshot(): WorkspaceRecoveryTraceSnapshot {
    return {
      filePath: this.filePath,
      documentFilePath: this.documentFilePath,
      documentStatus: this.documentStatus,
      retainedEntries: this.entries.length,
      droppedCount: this.droppedCount,
      entries: [...this.entries],
    }
  }

  private async save(): Promise<void> {
    const [traceResult, documentResult] = await Promise.allSettled([
      this.saveTraceFile(),
      this.saveDocumentFile(),
    ])
    this.documentStatus = documentResult.status === 'fulfilled' ? 'ok' : 'unavailable'
    if (documentResult.status === 'rejected') {
      const errorCode =
        documentResult.reason && typeof documentResult.reason === 'object'
          ? String((documentResult.reason as { code?: unknown }).code ?? 'unknown')
          : 'unknown'
      console.warn(`[WorkspaceRecoveryDiagnostics] 固定诊断文档写入失败: ${errorCode}`)
    }
    if (traceResult.status === 'rejected') throw traceResult.reason
  }

  private async saveTraceFile(): Promise<void> {
    const tempPath = `${this.filePath}.tmp`
    const payload: WorkspaceRecoveryTraceFile = {
      version: 1,
      droppedCount: this.droppedCount,
      entries: this.entries,
    }
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(tempPath, JSON.stringify(payload, null, 2), 'utf-8')
    await rename(tempPath, this.filePath)
  }

  private async saveDocumentFile(): Promise<void> {
    const tempPath = `${this.documentFilePath}.tmp`
    await mkdir(dirname(this.documentFilePath), { recursive: true })
    await writeFile(
      tempPath,
      formatWorkspaceRecoveryDocument(this.entries, this.droppedCount),
      'utf-8',
    )
    await rename(tempPath, this.documentFilePath)
  }
}

function formatWorkspaceRecoveryDocument(
  entries: WorkspaceRecoveryTraceEntry[],
  droppedCount: number,
): string {
  const lines = [
    '# CCLink Studio 会话恢复日志',
    '',
    '> 本文件由 CCLink Studio 自动维护，更新或重装应用时不会主动删除。',
    '> 只记录数量、状态和不可逆哈希，不记录对话正文、项目路径、会话 ID 或 Session ID。',
    '',
    `- 更新时间：${new Date().toISOString()}`,
    `- 当前保留：${entries.length}`,
    `- 已滚动删除旧记录：${droppedCount}`,
    '',
    '## 最近事件',
  ]

  if (entries.length === 0) {
    lines.push('', '- 暂无记录')
    return `${lines.join('\n')}\n`
  }

  for (const entry of entries) {
    const summary = entry.summary
      ? `会话=${entry.summary.storedConversationCount}/${entry.summary.orderedConversationCount} 消息=${entry.summary.messageCount} 字符=${entry.summary.textCharacterCount} session=${entry.summary.sessionBackedConversationCount} active=${entry.summary.activeConversationPresent}`
      : '无会话摘要'
    const previous = entry.previousSummary
      ? ` previous=会话${entry.previousSummary.storedConversationCount}/${entry.previousSummary.orderedConversationCount},消息${entry.previousSummary.messageCount},字符${entry.previousSummary.textCharacterCount}`
      : ''
    lines.push(
      '',
      `- ${entry.timestamp} · v${entry.appVersion} · ${entry.event}/${entry.outcome} · workspace=${entry.workspaceRef ?? 'global'} owner=${entry.ownerRef ?? 'none'} source=${entry.source ?? 'none'} primary=${entry.primaryStatus ?? 'n/a'} backup=${entry.backupStatus ?? 'n/a'} · ${summary}${previous}`,
    )
  }

  return `${lines.join('\n')}\n`
}

export function createWorkspaceRecoveryRef(value: string | null | undefined): string | null {
  if (!value) return null
  return createHash('sha256').update(value).digest('hex').slice(0, 12)
}
