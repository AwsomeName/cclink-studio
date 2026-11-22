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
import { evidenceSources } from '../../shared/owner/research'
import { additions, directoryFiles, shortName } from './directory-files'

import { configurationFile, scheduleFile } from './affair-documents'

const journalSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]),
  revision: z.number().int().positive(),
  pending: z.boolean(),
  record: affair,
  history: z.array(z.object({ at: z.number(), text: z.string() })),
  hashes: z.record(z.string(), z.string()),
})
type Journal = z.infer<typeof journalSchema>
const intentSchema = z.object({
  revision: z.number().int().positive(),
  record: affair,
  error: z.string().optional(),
  action: z.enum(['update', 'confirm']).optional(),
})
type Intent = z.infer<typeof intentSchema>
const pendingError = (e: unknown) => '文件待保存：' + (e instanceof Error ? e.message : String(e))
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
function validateUpdate(a: AffairRecord, before?: AffairRecord, confirm = false) {
  const r = a.research!
  if (a.confirmed !== (before?.confirmed || confirm || false))
    throw Error('需先确认当前版本的范围和交付物')
  if (
    a.confirmed &&
    (!r.plan ||
      JSON.stringify(r.plan) !== JSON.stringify(before?.research?.plan) ||
      a.goal !== before?.goal)
  )
    throw Error('已确认的调研约定不能由普通更新改写')
  if (
    !a.confirmed &&
    (r.docs.length ||
      r.decisions?.length ||
      r.report ||
      ['checking', 'reading', 'writing', 'done'].includes(r.phase))
  )
    throw Error('确认前不能派工、取证或交付')
  const sources = evidenceSources(r)
  if (
    r.docs.some((d) => !sources.includes(d.repo)) ||
    r.decisions?.some((d) => d.requests?.some((request) => !sources.includes(request.repo)))
  )
    throw Error('取证对象超出已确认的来源范围')
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
  if (!(await lstat(path)).isDirectory()) throw Error('需要在此创建目录，请先移走同名文件：' + path)
  if ((await realpath(path)) !== path) throw Error('目录位置已改变：' + path)
}
export class AffairDirectoryService {
  private tail: Promise<unknown> = Promise.resolve()
  private readonly unsaved = new Map<string, Intent>()
  constructor(
    private readonly registry: string,
    private readonly personal: () => Promise<string>,
    /** Owner settings may choose another parent; when absent, 我的空间/Owner 事务 is used. */
    private readonly parent?: () => Promise<{ path: string }>,
  ) {}
  private serial<T>(fn: () => Promise<T>) {
    const job = this.tail.then(fn, fn)
    this.tail = job.catch(() => {})
    return job
  }
  private async bind(j: Journal) {
    const a = j.record
    const root = this.parent
      ? (await this.parent()).path
      : join(await realpath(await this.personal()), 'Owner 事务')
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
  private async binding(id: string) {
    return z
      .object({ path: z.string(), ino: z.number(), dev: z.number() })
      .parse(JSON.parse(await regular(join(this.registry, id))))
  }
  async location(id: string) {
    const { path, ino, dev } = await this.binding(id)
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
    const { reportFile, files } = directoryFiles(j.record, j.history, path, j.revision, j.version)
    return {
      ...j.record,
      directory: {
        path,
        revision: j.revision,
        files: Object.keys(files).filter((name) => Object.hasOwn(j.hashes, name)),
        reportFile: reportFile && Object.hasOwn(j.hashes, reportFile) ? reportFile : undefined,
        error,
      },
    }
  }
  private async flush(path: string, j: Journal) {
    const marker = join(path, '.owner.json')
    const { files, reportFile } = directoryFiles(j.record, j.history, path, j.revision, j.version)
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
      return this.view(path, j, pendingError(e))
    }
  }
  private intentPath(id: string) {
    return join(this.registry, id + '.pending.json')
  }
  private async intent(id: string) {
    const cached = this.unsaved.get(id)
    if (cached) return cached
    try {
      const saved = intentSchema.parse(JSON.parse(await regular(this.intentPath(id))))
      if (saved.record.id !== id) throw Error('待保存事务标识不匹配')
      return saved
    } catch (e) {
      if (!missing(e)) throw e
    }
  }
  private journal(record: AffairRecord, old?: Journal): Journal {
    return {
      version: 2,
      record,
      revision: (old?.revision ?? 0) + 1,
      history: [...(old?.history ?? []), ...additions(old?.record, record)],
      pending: true,
      hashes: old?.hashes ?? {},
    }
  }
  private pendingView(path: string, intent: Intent, message: string) {
    return this.view(
      path,
      { ...this.journal(intent.record), revision: intent.revision + 1 },
      message,
    )
  }
  private async rememberFailure(path: string, intent: Intent, message: string) {
    const failed = { ...intent, error: message }
    this.unsaved.set(intent.record.id, failed)
    // The original intent remains recoverable even if recording the diagnostic fails.
    await atomic(this.intentPath(intent.record.id), JSON.stringify(failed)).catch(() => {})
    return this.pendingView(path, failed, message)
  }
  private async applyIntent(path: string, intent: Intent) {
    const { record, revision } = intent
    try {
      await this.location(record.id)
      let j = await this.load(path, record.id)
      if (j.revision === revision && !j.pending) {
        // Older versions staged explicit user confirmation without an action field.
        const legacyConfirmation =
          intent.action === undefined &&
          !j.record.confirmed &&
          j.record.research?.phase === 'ready' &&
          record.research?.phase === 'checking' &&
          record.research.chat.at(-1)?.who === '你' &&
          record.research.chat.at(-1)?.text === '确认目标和交付物，开始调研。'
        validateUpdate(record, j.record, intent.action === 'confirm' || legacyConfirmation)
        j = this.journal(record, j)
        const body = JSON.stringify(j)
        if (Buffer.byteLength(body) > 12 * 1024 * 1024) throw Error('事务记录已达到保存上限')
        await atomic(join(path, '.owner.json'), body)
      } else if (
        j.revision !== revision + 1 ||
        JSON.stringify(j.record) !== JSON.stringify(affair.parse(record))
      ) {
        throw Error('事务版本已变化，保留了原报告，请核对目录')
      }
      const result = j.pending ? await this.flush(path, j) : this.view(path, j)
      if (result.directory?.error) return this.rememberFailure(path, intent, result.directory.error)
      await unlink(this.intentPath(record.id)).catch((e) => {
        if (!missing(e)) throw e
      })
      this.unsaved.delete(record.id)
      return result
    } catch (e) {
      return this.rememberFailure(path, intent, pendingError(e))
    }
  }
  save(a: AffairRecord, revision: number) {
    return this.serial(async () => {
      if (!a.research) throw Error('当前仅支持调研事务目录')
      const record = affair.parse({ ...a, updated: Date.now() })
      directoryFiles(record, [], '', revision + 1)
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
        validateUpdate(record)
        const j = this.journal(record)
        if (Buffer.byteLength(JSON.stringify(j)) > 12 * 1024 * 1024)
          throw Error('事务记录已达到保存上限')
        return this.flush(await this.bind(j), j)
      }
      const { path } = await this.binding(a.id)
      if (await this.intent(a.id)) throw Error('事务待保存，请重试原操作')
      // Reject stale writers before accepting their work. An unreadable destination can still be retried.
      const old = await this.location(a.id)
        .then((p) => this.load(p, a.id))
        .catch(() => undefined)
      if (old && (old.pending || old.revision !== revision))
        throw Error('事务版本已变化，请恢复或重新打开')
      if (old) validateUpdate(record, old.record)
      return this.stage(path, { record, revision, action: 'update' })
    })
  }
  private async stage(path: string, intent: Intent) {
    const id = intent.record.id
    const body = JSON.stringify(intent)
    if (Buffer.byteLength(body) > 12 * 1024 * 1024) throw Error('事务记录已达到保存上限')
    this.unsaved.set(id, intent)
    try {
      await atomic(this.intentPath(id), body, true)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
        this.unsaved.delete(id)
        throw Error('事务待保存，请重试原操作')
      }
      return this.pendingView(path, intent, pendingError(e))
    }
    return this.applyIntent(path, intent)
  }
  confirm(id: string, revision: number) {
    return this.serial(async () => {
      const path = await this.location(id)
      const j = await this.load(path, id)
      if (j.revision !== revision || j.pending || (await this.intent(id)))
        throw Error('约定版本已变化，请重新查看并确认')
      const record = j.record,
        r = record.research!
      if (record.confirmed || !r.plan || r.phase !== 'ready') throw Error('没有等待确认的调研约定')
      record.confirmed = true
      record.updated = Date.now()
      r.phase = 'checking'
      r.chat = [...r.chat, { who: '你' as const, text: '确认目标和交付物，开始调研。' }].slice(-100)
      return this.stage(path, { revision, record, action: 'confirm' })
    })
  }
  retry(id: string) {
    return this.serial(async () => {
      const intent = await this.intent(id)
      if (intent) return this.applyIntent((await this.binding(id)).path, intent)
      const path = await this.location(id)
      const j = await this.load(path, id)
      if (j.pending) return this.flush(path, j)
      return this.view(path, j)
    })
  }
  upgrade(id: string, revision: number) {
    return this.serial(async () => {
      const path = await this.location(id)
      const j = await this.load(path, id)
      if (j.pending || (await this.intent(id))) throw Error('请先重试未完成的保存')
      if (Object.hasOwn(j.hashes, configurationFile) && Object.hasOwn(j.hashes, scheduleFile))
        return this.view(path, j)
      if (revision !== j.revision) throw Error('事务版本已变化，请重新查看')
      return this.stage(path, { revision, record: j.record, action: 'update' })
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
          const intent = await this.intent(id)
          if (intent) {
            items.push(
              this.pendingView(
                (await this.binding(id)).path,
                intent,
                intent.error ?? '上次文件保存中断，请重试保存',
              ),
            )
            continue
          }
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
    if (
      !Object.hasOwn(j.hashes, name) ||
      !Object.hasOwn(directoryFiles(j.record, j.history, path, j.revision, j.version).files, name)
    )
      throw Error('文件不属于本事务')
    const file = join(path, name)
    if ((await realpath(file)) !== file) throw Error('文件已被替换')
    return regular(file)
  }
}
