import { constants } from 'node:fs'
import {
  mkdir,
  lstat,
  rmdir,
  open,
  realpath,
  rename,
  writeFile,
  link,
  unlink,
  readdir,
} from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { z } from 'zod'
import { affair, type Affair, type AffairRecord } from '../../shared/owner/affair'
import { additions, directoryFiles, shortName } from './directory-files'

const journalSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().positive(),
  pending: z.boolean(),
  record: affair,
  history: z.array(z.object({ at: z.number(), text: z.string() })),
  hashes: z.record(z.string(), z.string()),
})
type Journal = z.infer<typeof journalSchema>
const digest = (s: string) => createHash('sha256').update(s).digest('hex')
const missing = (e: unknown) => (e as NodeJS.ErrnoException)?.code === 'ENOENT'
async function regular(path: string) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > 12 * 1024 * 1024) throw Error('文件类型或大小异常：' + path)
    return await handle.readFile('utf8')
  } finally {
    await handle.close()
  }
}
async function atomic(path: string, content: string, create = false) {
  const tmp = join(dirname(path), '.owner-' + randomUUID() + '.tmp')
  await writeFile(tmp, content, { flag: 'wx', mode: 0o600 })
  try {
    if (create) await link(tmp, path)
    else await rename(tmp, path)
  } finally {
    await unlink(tmp).catch((e) => {
      if (!missing(e)) throw e
    })
  }
}
async function directory(path: string) {
  try {
    await mkdir(path, { mode: 0o700 })
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
  }
  if (!(await lstat(path)).isDirectory() || (await realpath(path)) !== path)
    throw Error('目录位置已改变：' + path)
}
export class AffairDirectoryService {
  private tail: Promise<unknown> = Promise.resolve()
  constructor(
    private readonly registry: string,
    private readonly personal: () => Promise<string>,
  ) {}
  private serial<T>(fn: () => Promise<T>) {
    const job = this.tail.then(fn, fn)
    this.tail = job.catch(() => {})
    return job
  }
  private async bind(j: Journal) {
    const a = j.record
    const root = join(await realpath(await this.personal()), 'Owner 事务')
    await directory(root)
    const title = shortName(a.title.split(/[，。；！？]/u)[0])
    await mkdir(this.registry, { recursive: true, mode: 0o700 })
    for (let n = 1; n <= 1000; n++) {
      const path = join(root, n === 1 ? title : title + ' (' + n + ')')
      try {
        await mkdir(path, { mode: 0o700 })
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'EEXIST') continue
        throw e
      }
      try {
        await atomic(join(path, '.owner.json'), JSON.stringify(j), true)
        const st = await lstat(path)
        await atomic(
          join(this.registry, a.id),
          JSON.stringify({ path, ino: st.ino, dev: st.dev }),
          true,
        )
      } catch (e) {
        await unlink(join(path, '.owner.json')).catch(() => {})
        await rmdir(path).catch(() => {})
        throw e
      }
      return path
    }
    throw Error('同名目录过多')
  }
  async location(id: string) {
    const { path, ino, dev } = z
      .object({ path: z.string(), ino: z.number(), dev: z.number() })
      .parse(JSON.parse(await regular(join(this.registry, id))))
    const stat = await lstat(path)
    if (
      !stat.isDirectory() ||
      stat.ino !== ino ||
      stat.dev !== dev ||
      (await realpath(path)) !== path
    )
      throw Error('请恢复原事务目录：' + path)
    return path
  }
  private async load(path: string, id: string) {
    const j = journalSchema.parse(JSON.parse(await regular(join(path, '.owner.json'))))
    if (j.record.id !== id || !j.record.research) throw Error('事务标识不匹配：' + path)
    return j
  }
  private view(path: string, j: Journal, error?: string): Affair {
    const { reportFile, files } = directoryFiles(j.record, j.history)
    return {
      ...j.record,
      directory: { path, revision: j.revision, files: Object.keys(files), reportFile, error },
    }
  }
  private async flush(path: string, j: Journal) {
    const marker = join(path, '.owner.json')
    const { files, reportFile } = directoryFiles(j.record, j.history)
    const publishing = reportFile && !j.hashes[reportFile]
    const hashes: Record<string, string> = {}
    try {
      for (const [name, content] of Object.entries(files)) {
        hashes[name] = digest(content)
        if (!publishing && j.hashes[name] === hashes[name]) continue
        const target = join(path, name)
        if (dirname(target) !== path) await directory(dirname(target))
        let original: string | undefined
        try {
          original = await regular(target)
        } catch (e) {
          if (!missing(e)) throw e
        }
        if (original === content) continue
        if (original !== undefined && digest(original) !== j.hashes[name])
          throw Error('文件已有其他修改，请先保留或移走该文件再重试：' + name)
        await atomic(target, content, original === undefined)
        if ((await regular(target)) !== content) throw Error('文件写入后核验失败：' + name)
      }
      const saved = { ...j, pending: false, hashes }
      await atomic(marker, JSON.stringify(saved))
      return this.view(path, saved)
    } catch (e) {
      return this.view(path, j, '文件待保存：' + (e instanceof Error ? e.message : String(e)))
    }
  }
  save(a: AffairRecord, revision: number) {
    return this.serial(async () => {
      if (!a.research) throw Error('当前仅支持调研事务目录')
      let path: string | undefined
      let old: Journal | undefined
      if (revision === 0) {
        if (
          await lstat(join(this.registry, a.id)).then(
            () => true,
            (e) => {
              if (missing(e)) return false
              throw e
            },
          )
        )
          throw Error('事务已建档，请重新打开')
      } else {
        path = await this.location(a.id)
        old = await this.load(path, a.id)
        if (old.pending || old.revision !== revision)
          throw Error('事务版本已变化，请恢复或重新打开')
      }
      const record = { ...a, updated: Date.now() }
      const history = [...(old?.history ?? []), ...additions(old?.record, record)]
      directoryFiles(record, history)
      const j: Journal = {
        version: 1,
        record,
        revision: revision + 1,
        history,
        pending: true,
        hashes: old?.hashes ?? {},
      }
      const serialized = JSON.stringify(j)
      if (Buffer.byteLength(serialized) > 12 * 1024 * 1024) throw Error('事务记录已达到保存上限')
      if (path) await atomic(join(path, '.owner.json'), serialized)
      else path = await this.bind(j)
      return this.flush(path, j)
    })
  }
  retry(id: string) {
    return this.serial(async () => {
      const path = await this.location(id)
      const j = await this.load(path, id)
      return j.pending ? this.flush(path, j) : this.view(path, j)
    })
  }
  list() {
    return this.serial(async () => {
      const items: Affair[] = [],
        errors: string[] = []
      const ids = await readdir(this.registry).catch((e) => {
        if (missing(e)) return []
        throw e
      })
      for (const id of ids.filter((id) => z.string().uuid().safeParse(id).success)) {
        try {
          const path = await this.location(id)
          const j = await this.load(path, id)
          items.push(this.view(path, j, j.pending ? '上次文件保存中断，请重试保存' : undefined))
        } catch (e) {
          errors.push(String(e))
        }
      }
      return { items, errors }
    })
  }
  async preview(id: string, name: string) {
    const path = await this.location(id),
      j = await this.load(path, id)
    if (!Object.hasOwn(directoryFiles(j.record, j.history).files, name))
      throw Error('文件不属于本事务')
    const file = join(path, name)
    if ((await realpath(file)) !== file) throw Error('文件已被替换')
    return regular(file)
  }
}
