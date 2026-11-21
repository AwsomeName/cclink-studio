import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import {
  diffLines,
  type DiaryChangeReport,
  type DiaryUndoResult,
} from '../../shared/diary-change-report'
import { readWorkspaceSettings } from './workspace-settings-files'

const MAX_FILES = 5000
const MAX_FILE_BYTES = 512 * 1024
const MAX_TOTAL_BYTES = 32 * 1024 * 1024
const MAX_REPORTS = 30

type Snapshot = Map<string, { hash: string; content: string }> & { complete?: boolean }
interface StoredReport extends DiaryChangeReport {
  /** Exact contents needed to undo; never sent to the renderer. */
  restore: Array<{ path: string; before: string | null; afterHash: string | null }>
}

const hash = (value: string): string => createHash('sha256').update(value).digest('hex')

/**
 * Records what an AI conversation run changed in a diary project's Markdown so the user gets a
 * change report and can undo it. Only diary-type local projects are tracked; reports stay on
 * this device.
 */
export class DiaryChangeTracker {
  private readonly active = new Map<
    string,
    { workspacePath: string; conversationId: string; before: Snapshot }
  >()
  private reports: StoredReport[] | null = null
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly storePath: string) {}

  async beforeRun(input: {
    conversationId: string
    runId: string
    workspacePath?: string
  }): Promise<void> {
    if (!input.workspacePath) return
    const settings = await readWorkspaceSettings(input.workspacePath).catch(() => null)
    if (settings?.settings.type !== 'diary') return
    this.active.set(input.runId, {
      workspacePath: input.workspacePath,
      conversationId: input.conversationId,
      before: await snapshot(input.workspacePath),
    })
  }

  async afterRun(input: { runId: string }): Promise<DiaryChangeReport | null> {
    const run = this.active.get(input.runId)
    if (!run) return null
    this.active.delete(input.runId)
    const after = await snapshot(run.workspacePath)
    // A bounded snapshot cannot tell "deleted" from "not scanned": report nothing then.
    if (!run.before.complete || !after.complete) return null
    const files: DiaryChangeReport['files'] = []
    const restore: StoredReport['restore'] = []
    for (const path of new Set([...run.before.keys(), ...after.keys()])) {
      const old = run.before.get(path)
      const next = after.get(path)
      if (old?.hash === next?.hash) continue
      const { diff, added, removed } = diffLines(old?.content ?? '', next?.content ?? '')
      files.push({
        path,
        status: !old ? 'added' : !next ? 'deleted' : 'modified',
        diff,
        added,
        removed,
      })
      restore.push({ path, before: old?.content ?? null, afterHash: next?.hash ?? null })
    }
    if (!files.length) return null
    const report: StoredReport = {
      id: randomUUID(),
      workspacePath: run.workspacePath,
      conversationId: run.conversationId,
      runId: input.runId,
      createdAt: Date.now(),
      files: files.sort((a, b) => a.path.localeCompare(b.path)),
      undone: false,
      restore,
    }
    await this.mutate((reports) => [report, ...reports].slice(0, MAX_REPORTS))
    return publicReport(report)
  }

  async listAll(): Promise<DiaryChangeReport[]> {
    return (await this.load()).map(publicReport)
  }

  async list(workspacePath: string): Promise<DiaryChangeReport[]> {
    return (await this.load())
      .filter((report) => report.workspacePath === workspacePath)
      .map(publicReport)
  }

  /** Restores each file to its pre-run content unless it was changed again since. */
  async undo(reportId: string): Promise<DiaryUndoResult> {
    const report = (await this.load()).find((item) => item.id === reportId)
    if (!report) throw Error('改动报告不存在')
    if (report.undone) throw Error('这次修改已撤销')
    const result: DiaryUndoResult = { restored: [], skipped: [] }
    for (const file of report.restore) {
      const target = join(report.workspacePath, file.path)
      const current = await readFile(target, 'utf8').catch(() => null)
      if ((current === null ? null : hash(current)) !== file.afterHash) {
        result.skipped.push(file.path)
        continue
      }
      if (file.before === null) await unlink(target)
      else {
        await mkdir(dirname(target), { recursive: true })
        const temp = `${target}.${process.pid}.undo`
        await writeFile(temp, file.before, 'utf8')
        await rename(temp, target)
      }
      result.restored.push(file.path)
    }
    await this.mutate((reports) =>
      reports.map((item) =>
        item.id === reportId ? { ...item, undone: true, undoneAt: Date.now() } : item,
      ),
    )
    return result
  }

  private async load(): Promise<StoredReport[]> {
    if (!this.reports)
      this.reports = await readFile(this.storePath, 'utf8')
        .then((text) => JSON.parse(text) as StoredReport[])
        .catch(() => [])
    return this.reports
  }

  private mutate(update: (reports: StoredReport[]) => StoredReport[]): Promise<void> {
    const next = this.queue.then(async () => {
      this.reports = update(await this.load())
      await mkdir(dirname(this.storePath), { recursive: true })
      const temp = `${this.storePath}.${process.pid}.tmp`
      await writeFile(temp, JSON.stringify(this.reports), { encoding: 'utf8', mode: 0o600 })
      await rename(temp, this.storePath)
    })
    this.queue = next.catch(() => {})
    return next
  }
}

function publicReport(report: StoredReport): DiaryChangeReport {
  const { restore: _restore, ...rest } = report
  void _restore
  return rest
}

async function snapshot(root: string): Promise<Snapshot> {
  const result: Snapshot = new Map()
  result.complete = true
  let total = 0
  const walk = async (dir: string): Promise<void> => {
    if (result.size >= MAX_FILES || total > MAX_TOTAL_BYTES) {
      result.complete = false
      return
    }
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        const info = await lstat(path).catch(() => null)
        if (!info) continue
        if (info.size > MAX_FILE_BYTES) {
          result.complete = false
          continue
        }
        total += info.size
        const content = await readFile(path, 'utf8').catch(() => null)
        if (content === null) continue
        result.set(relative(root, path).split(sep).join('/'), { hash: hash(content), content })
      }
    }
  }
  await walk(root)
  return result
}
