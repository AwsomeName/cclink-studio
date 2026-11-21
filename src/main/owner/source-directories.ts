import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type {
  OwnerSourceEntry,
  OwnerSourceFile,
  OwnerSourceGrant,
} from '../../shared/ipc/owner-source'
import { ownerSourceRelative } from '../../shared/ipc/owner-source'

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
  ) {}

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

  /** Opens the system directory picker; returns null when the user cancels. */
  add(id: string) {
    return this.serial(async () => {
      const affairPath = await this.affairs.location(id)
      const grants = await this.load(id)
      if (grants.length >= MAX_SOURCE_GRANTS)
        throw Error('每件事务最多授权 ' + MAX_SOURCE_GRANTS + ' 个参考目录')
      const picked = await this.pick()
      if (!picked) return null
      const path = await realpath(picked)
      const stat = await lstat(path)
      if (!stat.isDirectory()) throw Error('请选择目录：' + path)
      if (path === sep) throw Error('不能授权整个磁盘根目录')
      if (path === affairPath || affairPath.startsWith(path + sep))
        throw Error('不能把包含本事务目录的位置设为参考目录')
      const existing = grants.find((g) => g.dev === stat.dev && g.ino === stat.ino)
      if (existing) return this.views(grants)
      const next = [
        ...grants,
        {
          id: randomUUID(),
          label: basename(path) || path,
          path,
          dev: stat.dev,
          ino: stat.ino,
          grantedAt: Date.now(),
        },
      ]
      await this.store(id, next)
      console.log('[Owner] 已授权只读参考目录', { affairId: id, grantId: next.at(-1)!.id })
      return this.views(next)
    })
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
