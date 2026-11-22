import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join, sep } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type {
  OwnerSourceCandidate,
  OwnerSourceEntry,
  OwnerSourceFile,
  OwnerSourceGrant,
  OwnerSourcePaths,
} from '../../shared/ipc/owner-source'
import { ownerSourceRelative } from '../../shared/ipc/owner-source'
import type { ReadmeResult } from '../../shared/ipc/owner-research'
import { folderKey, localSourceUrl } from '../../shared/owner/research'
import { sourceWindow } from './source-window'

const grantSchema = z.object({
  id: z.string().uuid(),
  label: z.string().min(1).max(200),
  path: z.string().min(1),
  dev: z.number(),
  ino: z.number(),
  grantedAt: z.number(),
})
const fileSchema = z.object({ version: z.literal(1), grants: z.array(grantSchema).max(8) })
type Grant = z.infer<typeof grantSchema>

export const MAX_SOURCE_GRANTS = 8
export const MAX_SOURCE_ENTRIES = 500
export const MAX_SOURCE_FILE_BYTES = 2 * 1024 * 1024
export const MAX_SEARCH_DIRECTORIES = 300
export const MAX_SEARCH_RESULTS = 40

const missing = (e: unknown) => (e as NodeJS.ErrnoException)?.code === 'ENOENT'

/**
 * Owns the per-affair read-only source directory grants under
 * `userData/owner-directories/<affair UUID>.sources.json`.
 *
 * A directory becomes readable for one affair only after the user picks it in the
 * main-process system dialog. Every read re-checks the bound identity (realpath, dev, inode),
 * rejects `..`, symlinks and anything outside the root, and never writes to the directory.
 */
export class OwnerSourceDirectories {
  private tail: Promise<unknown> = Promise.resolve()
  constructor(
    private readonly registry: string,
    private readonly affairs: { location(id: string): Promise<string> },
    private readonly pick: () => Promise<string | undefined>,
    private readonly registered: (rootId: string) => Promise<{ path: string }> = async () => {
      throw Error('没有已登记的目录')
    },
  ) {}
  private readonly candidates = new Map<
    string,
    { affairId: string; path: string; dev: number; ino: number; label: string; at: number }
  >()

  private serial<T>(fn: () => Promise<T>) {
    const job = this.tail.then(fn, fn)
    this.tail = job.catch(() => {})
    return job
  }
  private file(id: string) {
    return join(this.registry, id + '.sources.json')
  }
  private async load(id: string): Promise<Grant[]> {
    let raw: string
    try {
      const handle = await open(this.file(id), constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        raw = await handle.readFile('utf8')
      } finally {
        await handle.close()
      }
    } catch (e) {
      if (missing(e)) return []
      throw e
    }
    return fileSchema.parse(JSON.parse(raw)).grants
  }
  private async store(id: string, grants: Grant[]) {
    await mkdir(this.registry, { recursive: true, mode: 0o700 })
    const target = this.file(id)
    const tmp = join(dirname(target), '.owner-source-' + randomUUID() + '.tmp')
    await writeFile(tmp, JSON.stringify({ version: 1, grants }), { flag: 'wx', mode: 0o600 })
    try {
      await rename(tmp, target)
    } finally {
      await unlink(tmp).catch(() => {})
    }
  }
  private async check(g: Grant) {
    const stat = await lstat(g.path)
    if (!stat.isDirectory() || stat.dev !== g.dev || stat.ino !== g.ino)
      throw Error('参考目录已移动或被替换，已停止读取：' + g.path)
    if ((await realpath(g.path)) !== g.path) throw Error('参考目录位置已改变：' + g.path)
  }
  private async view(g: Grant): Promise<OwnerSourceGrant> {
    const base = { id: g.id, label: g.label, path: g.path, grantedAt: g.grantedAt }
    try {
      await this.check(g)
      return base
    } catch (e) {
      return {
        ...base,
        error: missing(e) ? '参考目录不存在：' + g.path : String((e as Error).message ?? e),
      }
    }
  }
  private async views(grants: Grant[]) {
    return Promise.all(grants.map((g) => this.view(g)))
  }

  async list(id: string) {
    await this.affairs.location(id)
    return this.views(await this.load(id))
  }

  /**
   * Step 1 of a grant: choose a directory (system picker, or one registered in Owner settings)
   * and describe its exact scope. Nothing is readable until `confirm` with the returned token.
   */
  prepare(id: string, rootId?: string): Promise<OwnerSourceCandidate | null> {
    return this.serial(async () => {
      const affairPath = await this.affairs.location(id)
      const grants = await this.load(id)
      if (grants.length >= MAX_SOURCE_GRANTS)
        throw Error('每件事务最多授权 ' + MAX_SOURCE_GRANTS + ' 个参考目录')
      const picked = rootId ? (await this.registered(rootId)).path : await this.pick()
      if (!picked) return null
      const path = await realpath(picked)
      const stat = await lstat(path)
      if (!stat.isDirectory()) throw Error('请选择目录：' + path)
      if (path === sep) throw Error('不能授权整个磁盘根目录')
      if (path === affairPath || affairPath.startsWith(path + sep))
        throw Error('不能把包含本事务目录的位置设为参考目录')
      const existing = grants.find((g) => g.dev === stat.dev && g.ino === stat.ino)
      const { files, truncated } = await countFiles(path)
      const token = randomUUID()
      const label = basename(path) || path
      for (const [key, c] of this.candidates)
        if (Date.now() - c.at > 10 * 60_000) this.candidates.delete(key)
      this.candidates.set(token, {
        affairId: id,
        path,
        dev: stat.dev,
        ino: stat.ino,
        label,
        at: Date.now(),
      })
      return { token, path, label, files, truncated, alreadyGranted: !!existing }
    })
  }

  /** Step 2: the user confirmed the exact scope shown for this token. */
  confirm(id: string, token: string) {
    return this.serial(async () => {
      await this.affairs.location(id)
      const c = this.candidates.get(token)
      this.candidates.delete(token)
      if (!c || c.affairId !== id) throw Error('授权确认已失效，请重新选择目录')
      const stat = await lstat(c.path)
      if (!stat.isDirectory() || stat.dev !== c.dev || stat.ino !== c.ino)
        throw Error('目录在确认前已被移动或替换，请重新选择')
      const grants = await this.load(id)
      if (grants.some((g) => g.dev === c.dev && g.ino === c.ino)) return this.views(grants)
      if (grants.length >= MAX_SOURCE_GRANTS)
        throw Error('每件事务最多授权 ' + MAX_SOURCE_GRANTS + ' 个参考目录')
      const grant = {
        id: randomUUID(),
        label: c.label,
        path: c.path,
        dev: c.dev,
        ino: c.ino,
        grantedAt: Date.now(),
      }
      const next = [...grants, grant]
      await this.store(id, next)
      console.log('[Owner] 已授权只读参考目录', { affairId: id, grantId: grant.id })
      return this.views(next)
    })
  }

  /** Test and legacy helper: pick and confirm in one step. */
  async add(id: string) {
    const candidate = await this.prepare(id)
    return candidate ? this.confirm(id, candidate.token) : null
  }

  /** How many affairs hold a grant on this directory identity (for Owner settings). */
  async grantedAffairs(dev: number, ino: number) {
    const names = await readdir(this.registry).catch((e) => {
      if (missing(e)) return [] as string[]
      throw e
    })
    let count = 0
    for (const name of names) {
      const match = /^([0-9a-f-]{36})\.sources\.json$/.exec(name)
      if (!match) continue
      const grants = await this.load(match[1]).catch(() => [])
      if (grants.some((g) => g.dev === dev && g.ino === ino)) count++
    }
    return count
  }

  revoke(id: string, grantId: string) {
    return this.serial(async () => {
      await this.affairs.location(id)
      const grants = await this.load(id)
      const next = grants.filter((g) => g.id !== grantId)
      if (next.length !== grants.length) {
        await this.store(id, next)
        console.log('[Owner] 已撤销只读参考目录', { affairId: id, grantId })
      }
      return this.views(next)
    })
  }

  private async resolve(id: string, grantId: string, relative: string) {
    await this.affairs.location(id)
    const rel = ownerSourceRelative.parse(relative)
    const grant = (await this.load(id)).find((g) => g.id === grantId)
    if (!grant) throw Error('该目录未授权给本事务，或已撤销')
    await this.check(grant)
    const target = rel ? join(grant.path, ...rel.split('/')) : grant.path
    if (target !== grant.path && !target.startsWith(grant.path + sep))
      throw Error('路径越出参考目录')
    // Rejects symlinks at any level: the canonical path must equal the literal one.
    if ((await realpath(target)) !== target) throw Error('不读取链接或被替换的路径：' + rel)
    return target
  }

  async entries(id: string, grantId: string, relative: string): Promise<OwnerSourceEntry[]> {
    const target = await this.resolve(id, grantId, relative)
    const items = await readdir(target, { withFileTypes: true })
    const out: OwnerSourceEntry[] = []
    for (const item of items) {
      if (item.name.startsWith('.') || item.isSymbolicLink()) continue
      if (item.isDirectory()) out.push({ name: item.name, dir: true })
      else if (item.isFile()) {
        const size = await lstat(join(target, item.name)).then(
          (s) => s.size,
          () => undefined,
        )
        out.push({ name: item.name, dir: false, size })
      }
    }
    out.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name))
    return out.slice(0, MAX_SOURCE_ENTRIES)
  }

  async read(id: string, grantId: string, relative: string): Promise<OwnerSourceFile> {
    const target = await this.resolve(id, grantId, relative)
    const handle = await open(
      target,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    )
    try {
      const stat = await handle.stat()
      if (!stat.isFile()) throw Error('只能预览普通文件')
      if (stat.size > MAX_SOURCE_FILE_BYTES) throw Error('文件超过 2 MB，暂不预览')
      const bytes = await handle.readFile()
      if (bytes.includes(0)) throw Error('二进制文件暂不预览')
      let content: string
      try {
        content = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      } catch {
        throw Error('不是 UTF-8 文本，暂不预览')
      }
      return { content, size: stat.size }
    } finally {
      await handle.close()
    }
  }
}

/**
 * Owner evidence reads. Both go through the same grant check as previews, so revoking the
 * folder stops them, and both return relative paths only.
 */
export async function findSourceFiles(
  sources: Pick<OwnerSourceDirectories, 'entries'>,
  id: string,
  grantId: string,
  terms: string[],
): Promise<OwnerSourcePaths> {
  try {
    const files: string[] = []
    const queue = ['']
    let visited = 0
    let truncated = false
    while (queue.length) {
      if (++visited > MAX_SEARCH_DIRECTORIES) {
        truncated = true
        break
      }
      const dir = queue.shift()!
      for (const entry of await sources.entries(id, grantId, dir)) {
        const rel = dir ? dir + '/' + entry.name : entry.name
        if (entry.dir) queue.push(rel)
        else if ((entry.size ?? 0) <= MAX_SOURCE_FILE_BYTES) files.push(rel)
      }
    }
    const words = terms.map((t) => t.toLowerCase())
    const ranked = files
      .map((path) => ({
        path,
        hits: words.filter((w) => path.toLowerCase().includes(w)).length,
      }))
      .filter((f) => !words.length || f.hits > 0)
      .sort(
        (a, b) =>
          b.hits - a.hits ||
          a.path.split('/').length - b.path.split('/').length ||
          a.path.localeCompare(b.path),
      )
    return {
      ok: true,
      paths: ranked.slice(0, MAX_SEARCH_RESULTS).map((f) => f.path),
      truncated: truncated || ranked.length > MAX_SEARCH_RESULTS,
    }
  } catch (e) {
    return { ok: false, error: '本地目录检索失败：' + (e instanceof Error ? e.message : String(e)) }
  }
}

export async function readSourceExcerpt(
  sources: Pick<OwnerSourceDirectories, 'read'>,
  id: string,
  grantId: string,
  relative: string,
  anchor: string,
  now = Date.now(),
): Promise<ReadmeResult> {
  try {
    const { content } = await sources.read(id, grantId, relative)
    const window = sourceWindow(content, anchor)
    if (!window.text.trim()) return { ok: false, error: relative + ' 是空文件' }
    return {
      ok: true,
      repo: folderKey(grantId),
      url: localSourceUrl(grantId, relative),
      sha: createHash('sha256').update(content, 'utf8').digest('hex'),
      at: now,
      ...window,
    }
  } catch (e) {
    return {
      ok: false,
      error: relative + ' 读取失败：' + (e instanceof Error ? e.message : String(e)),
    }
  }
}

async function countFiles(root: string, limit = 5000) {
  let files = 0
  const queue = [root]
  while (queue.length) {
    const dir = queue.shift()!
    const items = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const item of items) {
      if (item.name.startsWith('.') || item.isSymbolicLink()) continue
      if (item.isDirectory()) queue.push(join(dir, item.name))
      else if (item.isFile() && ++files >= limit) return { files, truncated: true }
    }
  }
  return { files, truncated: false }
}
