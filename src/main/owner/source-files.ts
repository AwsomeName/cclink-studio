import { constants } from 'node:fs'
import { lstat, mkdir, open, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, normalize, sep } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { ReadmeResult } from '../../shared/ipc/owner-research'
import type { OwnerFileGrantResult, OwnerFileRequestResult } from '../../shared/ipc/owner-source'
import { fileKey, folderKey, localSourceUrl } from '../../shared/owner/research'
import { MAX_SOURCE_FILE_BYTES, type OwnerSourceDirectories } from './source-directories'
import { sourceWindow } from './source-window'

const fileGrant = z.object({
  id: z.string().uuid(),
  path: z.string().min(1),
  dev: z.number(),
  ino: z.number(),
  grantedAt: z.number(),
})
const record = z.object({
  version: z.literal(1),
  files: z.array(fileGrant).max(16),
  /** Paths whose request was skipped; only these may be granted later from the Owner page. */
  skipped: z.array(z.object({ path: z.string().min(1), at: z.number() })).max(32),
})
type Record_ = z.infer<typeof record>
export type FileDecision = 'approved' | 'denied' | 'timeout'
/** Asks through the shared permission mechanism (60 s, timeout counts as no). */
export type AskFileRead = (input: { conversationId: string; path: string }) => Promise<FileDecision>

const missing = (e: unknown) => (e as NodeJS.ErrnoException)?.code === 'ENOENT'
/** Shown to the user and stored in the affair record; never used to read. */
export function displayPath(path: string, home = homedir()) {
  return path === home || path.startsWith(home + sep) ? '~' + path.slice(home.length) : path
}

/**
 * Owner's single-file read grants: one local file outside the granted folders, read-only,
 * for one affair. A request asks the user through the shared permission prompt; a refusal or
 * timeout is remembered as skipped so the user can grant exactly that file later.
 */
export class OwnerSourceFiles {
  private tail: Promise<unknown> = Promise.resolve()
  constructor(
    private readonly registry: string,
    private readonly affairs: { location(id: string): Promise<string> },
    private readonly folders: Pick<OwnerSourceDirectories, 'list'>,
    private readonly home = homedir(),
  ) {}

  private serial<T>(fn: () => Promise<T>) {
    const job = this.tail.then(fn, fn)
    this.tail = job.catch(() => {})
    return job
  }
  private file(id: string) {
    return join(this.registry, id + '.files.json')
  }
  private async load(id: string): Promise<Record_> {
    try {
      const handle = await open(this.file(id), constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        return record.parse(JSON.parse(await handle.readFile('utf8')))
      } finally {
        await handle.close()
      }
    } catch (e) {
      if (missing(e)) return { version: 1, files: [], skipped: [] }
      throw e
    }
  }
  private async store(id: string, value: Record_) {
    await mkdir(this.registry, { recursive: true, mode: 0o700 })
    const target = this.file(id)
    const tmp = join(dirname(target), '.owner-files-' + randomUUID() + '.tmp')
    await writeFile(tmp, JSON.stringify(value), { flag: 'wx', mode: 0o600 })
    try {
      await rename(tmp, target)
    } finally {
      await unlink(tmp).catch(() => {})
    }
  }

  /** The exact file a note pointed at: absolute, no hidden or linked parts, a small text file. */
  async target(id: string, raw: string) {
    const text = raw.trim()
    const expanded = text === '~' || text.startsWith('~/') ? join(this.home, text.slice(1)) : text
    if (!isAbsolute(expanded)) throw Error('只接受绝对路径或 ~/ 开头的路径')
    const path = normalize(expanded)
    if (path.split(sep).some((part) => part.startsWith('.')))
      throw Error('不读取隐藏目录或隐藏文件')
    const stat = await lstat(path).catch((e) => {
      throw Error(missing(e) ? '文件不存在' : String((e as Error).message ?? e))
    })
    if (!stat.isFile()) throw Error('只能读取普通文件')
    if (stat.size > MAX_SOURCE_FILE_BYTES) throw Error('文件超过 2 MB')
    if ((await realpath(path)) !== path) throw Error('不读取链接或被替换的路径')
    const affair = await this.affairs.location(id)
    if (path.startsWith(affair + sep)) throw Error('这是本事务目录中的文件')
    return { path, stat, label: displayPath(path, this.home) }
  }

  /** A folder grant of this affair that already covers the path, if any. */
  private async inFolder(id: string, path: string) {
    for (const g of await this.folders.list(id)) {
      if (g.error) continue
      if (path.startsWith(g.path + sep))
        return {
          key: folderKey(g.id),
          rel: path
            .slice(g.path.length + 1)
            .split(sep)
            .join('/'),
        }
    }
    return null
  }

  /** Owner asks to read one file. Approval grants it; timeout or refusal records a skip. */
  async request(
    id: string,
    conversationId: string,
    raw: string,
    ask: AskFileRead,
  ): Promise<OwnerFileRequestResult> {
    let found: Awaited<ReturnType<OwnerSourceFiles['target']>>
    try {
      found = await this.target(id, raw)
    } catch (e) {
      return {
        ok: false,
        outcome: 'invalid',
        label: raw.slice(0, 300),
        error: String((e as Error).message ?? e),
      }
    }
    const { path, label } = found
    const folder = await this.inFolder(id, path)
    if (folder) return { ok: true, key: folder.key, label, path: folder.rel }
    const known = (await this.load(id)).files.find((f) => f.path === path)
    if (known) return { ok: true, key: fileKey(known.id), label }
    const decision = await ask({ conversationId, path })
    if (decision === 'approved') return this.grant(id, path, label)
    await this.serial(async () => {
      const current = await this.load(id)
      current.skipped = [
        ...current.skipped.filter((s) => s.path !== path),
        { path, at: Date.now() },
      ].slice(-32)
      await this.store(id, current)
    })
    return {
      ok: false,
      outcome: decision,
      label,
      error: decision === 'timeout' ? '60 秒无回应，已跳过' : '你拒绝了读取，已跳过',
    }
  }

  /** The user grants, from the Owner page, a file whose earlier request was skipped. */
  async grantSkipped(id: string, raw: string): Promise<OwnerFileGrantResult> {
    try {
      const { path, label } = await this.target(id, raw)
      if (!(await this.load(id)).skipped.some((s) => s.path === path))
        throw Error('只能授权本事务中被跳过的文件')
      return await this.grant(id, path, label)
    } catch (e) {
      return { ok: false, error: String((e as Error).message ?? e) }
    }
  }

  private grant(id: string, path: string, label: string) {
    return this.serial(async (): Promise<{ ok: true; key: string; label: string }> => {
      const stat = await lstat(path)
      const current = await this.load(id)
      const existing = current.files.find((f) => f.path === path)
      if (existing) return { ok: true, key: fileKey(existing.id), label }
      if (current.files.length >= 16) throw Error('每件事务最多单独授权 16 个文件')
      const grant = { id: randomUUID(), path, dev: stat.dev, ino: stat.ino, grantedAt: Date.now() }
      current.files.push(grant)
      current.skipped = current.skipped.filter((s) => s.path !== path)
      await this.store(id, current)
      console.log('[Owner] 已授权只读单个文件', { affairId: id, grantId: grant.id })
      return { ok: true, key: fileKey(grant.id), label }
    })
  }

  /** A bounded excerpt of a granted file, with the SHA-256 of the whole file at read time. */
  async excerpt(
    id: string,
    grantId: string,
    anchor: string,
    now = Date.now(),
  ): Promise<ReadmeResult> {
    try {
      await this.affairs.location(id)
      const grant = (await this.load(id)).files.find((f) => f.id === grantId)
      if (!grant) throw Error('该文件未授权给本事务')
      const handle = await open(
        grant.path,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      )
      let content: string
      try {
        const stat = await handle.stat()
        if (!stat.isFile() || stat.dev !== grant.dev || stat.ino !== grant.ino)
          throw Error('文件已移动或被替换，已停止读取')
        if (stat.size > MAX_SOURCE_FILE_BYTES) throw Error('文件超过 2 MB')
        const bytes = await handle.readFile()
        if (bytes.includes(0)) throw Error('二进制文件暂不读取')
        content = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      } finally {
        await handle.close()
      }
      const window = sourceWindow(content, anchor)
      return {
        ok: true,
        repo: fileKey(grantId),
        url: localSourceUrl(grantId, basename(grant.path)),
        sha: createHash('sha256').update(content, 'utf8').digest('hex'),
        at: now,
        ...window,
      }
    } catch (e) {
      return { ok: false, error: '单个文件读取失败：' + String((e as Error).message ?? e) }
    }
  }
}
