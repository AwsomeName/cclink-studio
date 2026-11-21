import { constants } from 'node:fs'
import { access, lstat, mkdir, open, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type {
  OwnerPreferenceUpdate,
  OwnerPreferencesView,
  OwnerRootPurpose,
} from '../../shared/ipc/owner-preferences'

const rootSchema = z.object({
  id: z.string().uuid(),
  purpose: z.enum(['reference', 'output']),
  label: z.string().min(1).max(200),
  path: z.string().min(1),
  dev: z.number(),
  ino: z.number(),
  registeredAt: z.number(),
})
const fileSchema = z.object({
  version: z.literal(1),
  roots: z.array(rootSchema).max(32),
  defaultParentId: z.string().uuid().nullable(),
  sources: z.object({ github: z.boolean(), docs: z.boolean(), thirdParty: z.boolean() }),
  reminders: z.object({ topbarCount: z.boolean() }),
})
type Prefs = z.infer<typeof fileSchema>
export type OwnerRootRecord = z.infer<typeof rootSchema>
const defaults = (): Prefs => ({
  version: 1,
  roots: [],
  defaultParentId: null,
  sources: { github: true, docs: true, thirdParty: false },
  reminders: { topbarCount: true },
})
const missing = (e: unknown) => (e as NodeJS.ErrnoException)?.code === 'ENOENT'
export const PERSONAL_AFFAIR_FOLDER = 'Owner 事务'

/**
 * Owner-wide defaults in `userData/owner-directories/preferences.json`, written only here.
 * Directories enter this registry only through the main-process system dialog. Registering a
 * reference directory never makes it readable; an output directory only allows creating new
 * affair subfolders inside it.
 */
export class OwnerPreferences {
  private tail: Promise<unknown> = Promise.resolve()
  constructor(
    private readonly registry: string,
    private readonly personal: () => Promise<string>,
    private readonly pick: (purpose: OwnerRootPurpose) => Promise<string | undefined>,
    private readonly grantedAffairs: (dev: number, ino: number) => Promise<number>,
  ) {}
  private serial<T>(fn: () => Promise<T>) {
    const job = this.tail.then(fn, fn)
    this.tail = job.catch(() => {})
    return job
  }
  private file() {
    return join(this.registry, 'preferences.json')
  }
  private async load(): Promise<Prefs> {
    try {
      const handle = await open(this.file(), constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        return fileSchema.parse(JSON.parse(await handle.readFile('utf8')))
      } finally {
        await handle.close()
      }
    } catch (e) {
      if (missing(e)) return defaults()
      throw Error('Owner 设置无法读取，已保留原文件：' + this.file())
    }
  }
  private async store(p: Prefs) {
    await mkdir(this.registry, { recursive: true, mode: 0o700 })
    const tmp = join(dirname(this.file()), '.owner-prefs-' + randomUUID() + '.tmp')
    await writeFile(tmp, JSON.stringify(p), { flag: 'wx', mode: 0o600 })
    try {
      await rename(tmp, this.file())
    } finally {
      await unlink(tmp).catch(() => {})
    }
  }
  private async check(root: OwnerRootRecord) {
    const stat = await lstat(root.path).catch((e) => {
      throw Error(missing(e) ? '目录不存在：' + root.path : String(e))
    })
    if (!stat.isDirectory() || stat.dev !== root.dev || stat.ino !== root.ino)
      throw Error('目录已移动或被替换：' + root.path)
    if ((await realpath(root.path)) !== root.path) throw Error('目录位置已改变：' + root.path)
    if (root.purpose === 'output') await access(root.path, constants.W_OK)
  }
  private async personalFolder() {
    return join(await realpath(await this.personal()), PERSONAL_AFFAIR_FOLDER)
  }
  private async view(p: Prefs): Promise<OwnerPreferencesView> {
    const roots: OwnerPreferencesView['roots'] = await Promise.all(
      p.roots.map(async (r) => {
        const base = {
          id: r.id,
          purpose: r.purpose,
          label: r.label,
          path: r.path,
          registeredAt: r.registeredAt,
          grantedAffairs: r.purpose === 'reference' ? await this.grantedAffairs(r.dev, r.ino) : 0,
        }
        try {
          await this.check(r)
          return base
        } catch (e) {
          return { ...base, error: e instanceof Error ? e.message : String(e) }
        }
      }),
    )
    const chosen = roots.find((r) => r.id === p.defaultParentId)
    let saveLocation: OwnerPreferencesView['saveLocation']
    if (chosen) saveLocation = { path: chosen.path, custom: true, error: chosen.error }
    else
      saveLocation = await this.personalFolder().then(
        (path) => ({ path, custom: false }),
        (e) => ({ path: '我的空间 / ' + PERSONAL_AFFAIR_FOLDER, custom: false, error: String(e) }),
      )
    return {
      roots,
      defaultParentId: chosen ? p.defaultParentId : null,
      saveLocation,
      sources: p.sources,
      reminders: p.reminders,
    }
  }

  async get() {
    return this.view(await this.load())
  }

  /** Where the next affair folder is created. Never falls back silently from a chosen parent. */
  async affairParent(): Promise<{ path: string; custom: boolean }> {
    const p = await this.load()
    const chosen = p.roots.find((r) => r.id === p.defaultParentId && r.purpose === 'output')
    if (!chosen) return { path: await this.personalFolder(), custom: false }
    try {
      await this.check(chosen)
    } catch (e) {
      throw Error(
        '默认保存位置不可用，已保留交办草稿；请在 Owner 设置中重新选择：' +
          (e instanceof Error ? e.message : String(e)),
      )
    }
    return { path: chosen.path, custom: true }
  }

  /** A registered reference directory, for granting it to one affair. */
  async reference(id: string) {
    const root = (await this.load()).roots.find((r) => r.id === id && r.purpose === 'reference')
    if (!root) throw Error('该目录未在 Owner 设置中登记')
    await this.check(root)
    return root
  }

  register(purpose: OwnerRootPurpose) {
    return this.serial(async () => {
      const p = await this.load()
      if (p.roots.length >= 32) throw Error('最多登记 32 个目录')
      const picked = await this.pick(purpose)
      if (!picked) return null
      const path = await realpath(picked)
      const stat = await lstat(path)
      if (!stat.isDirectory()) throw Error('请选择目录：' + path)
      if (path === sep) throw Error('不能登记整个磁盘根目录')
      if (purpose === 'output') await access(path, constants.W_OK)
      const existing = p.roots.find(
        (r) => r.purpose === purpose && r.dev === stat.dev && r.ino === stat.ino,
      )
      const id = existing?.id ?? randomUUID()
      if (!existing)
        p.roots.push({
          id,
          purpose,
          label: basename(path) || path,
          path,
          dev: stat.dev,
          ino: stat.ino,
          registeredAt: Date.now(),
        })
      if (purpose === 'output') p.defaultParentId = id
      await this.store(p)
      console.log('[Owner] 已登记目录', { purpose, rootId: id })
      return this.view(p)
    })
  }

  remove(id: string) {
    return this.serial(async () => {
      const p = await this.load()
      p.roots = p.roots.filter((r) => r.id !== id)
      if (p.defaultParentId === id) p.defaultParentId = null
      await this.store(p)
      return this.view(p)
    })
  }

  setDefaultParent(id: string | null) {
    return this.serial(async () => {
      const p = await this.load()
      if (id) {
        const root = p.roots.find((r) => r.id === id && r.purpose === 'output')
        if (!root) throw Error('请先登记保存位置')
        await this.check(root)
      }
      p.defaultParentId = id
      await this.store(p)
      return this.view(p)
    })
  }

  update(change: OwnerPreferenceUpdate) {
    return this.serial(async () => {
      const p = await this.load()
      if (change.sources) p.sources = change.sources
      if (change.reminders) p.reminders = change.reminders
      await this.store(p)
      return this.view(p)
    })
  }
}
