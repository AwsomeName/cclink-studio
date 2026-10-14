import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { lstat, mkdir, realpath, rename, rm, stat } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { CompanyAccountsSnapshot } from '../../shared/company-accounts/company-accounts-types'
import type {
  CompanyBusiness,
  CompanyConfigureInput,
  CompanyConversationSource,
  CompanyCreateBusinessInput,
  CompanyLinkInput,
  CompanyPublishingSource,
  CompanyResourceLink,
  CompanyUnlinkInput,
  CompanyUpdateBusinessInput,
  CompanyWorkspaceErrorCode,
  CompanyWorkspaceSnapshot,
} from '../../shared/company-workspace/company-workspace-types'

export interface CompanyWorkspaceTarget {
  workspacePath: string
  workspaceId: string
}
interface Sources {
  finance(target: CompanyWorkspaceTarget, month: string): CompanyAccountsSnapshot | null
  conversations(target: CompanyWorkspaceTarget): Promise<CompanyConversationSource[]>
  publications(target: CompanyWorkspaceTarget): CompanyPublishingSource[] | null
  changed?(workspaceId: string, revision: number): void
}
type Row = Record<string, unknown>
export class CompanyWorkspaceError extends Error {
  constructor(
    readonly code: CompanyWorkspaceErrorCode,
    message: string,
  ) {
    super(message)
  }
}
export class CompanyWorkspaceService {
  private queue: Promise<unknown> = Promise.resolve()
  private disposed = false
  constructor(private readonly sources: Sources) {}
  async dispose(): Promise<void> {
    this.disposed = true
    await this.queue
  }
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (this.disposed)
      return Promise.reject(new CompanyWorkspaceError('SERVICE_UNAVAILABLE', '公司能力已停止'))
    const result = this.queue.then(operation)
    this.queue = result.catch(() => undefined)
    return result
  }
  getSnapshot(target: CompanyWorkspaceTarget, month: string): Promise<CompanyWorkspaceSnapshot> {
    return this.enqueue(() => this.snapshot(target, month))
  }
  configure(
    target: CompanyWorkspaceTarget,
    input: CompanyConfigureInput,
  ): Promise<CompanyWorkspaceSnapshot> {
    return this.enqueue(async () => {
      const path = await this.databasePath(target, input.enabled)
      if (!existsSync(path) && !input.enabled) return this.snapshot(target, input.month)
      await this.mutate(
        target,
        (db) => {
          db.prepare('UPDATE settings SET enabled=?, name=? WHERE id=1').run(
            Number(input.enabled),
            input.name,
          )
        },
        false,
      )
      return this.snapshot(target, input.month)
    })
  }
  createBusiness(
    target: CompanyWorkspaceTarget,
    input: CompanyCreateBusinessInput,
  ): Promise<CompanyWorkspaceSnapshot> {
    return this.enqueue(async () => {
      await this.verifyLedger(target, input.month, input.ledgerProjectId)
      await this.mutate(target, (db) => {
        if (
          Number((db.prepare('SELECT COUNT(*) AS n FROM business_projects').get() as Row).n) >= 500
        )
          throw new CompanyWorkspaceError('CONFLICT', '业务项目数量已达本版上限')
        const now = new Date().toISOString()
        db.prepare('INSERT INTO business_projects VALUES (?,?,?,?,?,?,?,?,?,?)').run(
          randomUUID(),
          1,
          input.name,
          input.goal,
          input.deliverable,
          input.dueDate,
          input.ledgerProjectId,
          0,
          now,
          now,
        )
      })
      return this.snapshot(target, input.month)
    })
  }
  updateBusiness(
    target: CompanyWorkspaceTarget,
    input: CompanyUpdateBusinessInput,
  ): Promise<CompanyWorkspaceSnapshot> {
    return this.enqueue(async () => {
      await this.verifyLedger(target, input.month, input.ledgerProjectId)
      await this.mutate(target, (db) => {
        this.business(db, input.businessId)
        const changed = db
          .prepare(
            'UPDATE business_projects SET version=version+1,name=?,goal=?,deliverable=?,due_date=?,ledger_project_id=?,archived=?,updated_at=? WHERE id=? AND version=?',
          )
          .run(
            input.name,
            input.goal,
            input.deliverable,
            input.dueDate,
            input.ledgerProjectId,
            Number(input.archived),
            new Date().toISOString(),
            input.businessId,
            input.expectedVersion,
          )
        if (!Number(changed.changes))
          throw new CompanyWorkspaceError('CONFLICT', '业务项目已变化，请刷新后重试')
      })
      return this.snapshot(target, input.month)
    })
  }
  linkResource(
    target: CompanyWorkspaceTarget,
    input: CompanyLinkInput,
  ): Promise<CompanyWorkspaceSnapshot> {
    return this.enqueue(async () => {
      let linkTarget = input.target
      let size: number | null = null
      let modified: number | null = null
      if (input.kind === 'file') {
        const path = await this.resourcePath(target.workspacePath, input.target)
        const info = await stat(path)
        if (!info.isFile())
          throw new CompanyWorkspaceError('INVALID_INPUT', '只能关联工作空间内的文件')
        linkTarget = relative(target.workspacePath, path)
        size = info.size
        modified = info.mtimeMs
      } else if (input.kind === 'conversation') {
        if (!(await this.sources.conversations(target)).some((item) => item.id === input.target))
          throw new CompanyWorkspaceError(
            'NOT_FOUND',
            '会话不存在或不属于当前工作空间，请刷新后选择',
          )
      } else if (
        !(this.sources.publications(target) ?? []).some((item) => item.id === input.target)
      ) {
        throw new CompanyWorkspaceError('NOT_FOUND', '发布任务不存在或不属于当前工作空间')
      }
      await this.mutate(target, (db) => {
        const business = this.business(db, input.businessId)
        if (business.archived)
          throw new CompanyWorkspaceError('CONFLICT', '请先重新打开已归档业务项目')
        if (Number((db.prepare('SELECT COUNT(*) AS n FROM resource_links').get() as Row).n) >= 2000)
          throw new CompanyWorkspaceError('CONFLICT', '资料关联数量已达本版上限')
        db.prepare('INSERT INTO resource_links VALUES (?,?,?,?,?,?,?)').run(
          randomUUID(),
          input.businessId,
          input.kind,
          linkTarget,
          size,
          modified,
          new Date().toISOString(),
        )
      })
      return this.snapshot(target, input.month)
    })
  }
  unlinkResource(
    target: CompanyWorkspaceTarget,
    input: CompanyUnlinkInput,
  ): Promise<CompanyWorkspaceSnapshot> {
    return this.enqueue(async () => {
      await this.mutate(target, (db) => {
        this.business(db, input.businessId)
        const result = db
          .prepare('DELETE FROM resource_links WHERE id=? AND business_id=?')
          .run(input.linkId, input.businessId)
        if (!Number(result.changes)) throw new CompanyWorkspaceError('NOT_FOUND', '资料关联不存在')
      })
      return this.snapshot(target, input.month)
    })
  }
  private async verifyLedger(
    target: CompanyWorkspaceTarget,
    month: string,
    id: string | null,
  ): Promise<void> {
    if (!id) return
    const source = this.sources.finance(target, month)
    if (!source || source.error || !source.projects.some((item) => item.id === id))
      throw new CompanyWorkspaceError('NOT_FOUND', '账目归属不存在或财务当前不可用')
  }
  private business(db: DatabaseSync, id: string): CompanyBusiness {
    const row = db.prepare('SELECT * FROM business_projects WHERE id=?').get(id) as Row | undefined
    if (!row) throw new CompanyWorkspaceError('NOT_FOUND', '业务项目不存在或不属于当前公司')
    return businessFromRow(row)
  }
  private async databasePath(target: CompanyWorkspaceTarget, initialize = false): Promise<string> {
    const root = await realpath(target.workspacePath)
    if (root !== target.workspacePath)
      throw new CompanyWorkspaceError('WORKSPACE_DENIED', '工作空间路径尚未规范化')
    let folder = root
    for (const segment of ['.cclink-studio', 'company-workspace']) {
      folder = join(folder, segment)
      if (existsSync(folder)) {
        if ((await lstat(folder)).isSymbolicLink() || (await realpath(folder)) !== folder)
          throw new CompanyWorkspaceError('WORKSPACE_DENIED', '公司数据目录不能是符号链接')
      } else if (initialize) await mkdir(folder, { mode: 0o700 })
    }
    const path = join(folder, 'company.sqlite')
    if (existsSync(path) && (await lstat(path)).isSymbolicLink())
      throw new CompanyWorkspaceError('WORKSPACE_DENIED', '公司数据库不能是符号链接')
    if (initialize && !existsSync(path)) {
      const temporary = join(folder, 'initialize-' + randomUUID() + '.sqlite')
      let db: DatabaseSync | null = null
      try {
        db = new DatabaseSync(temporary)
        db.exec(
          'BEGIN; CREATE TABLE settings(id INTEGER PRIMARY KEY CHECK(id=1), workspace_id TEXT NOT NULL, enabled INTEGER NOT NULL, name TEXT NOT NULL, revision INTEGER NOT NULL); CREATE TABLE business_projects(id TEXT PRIMARY KEY,version INTEGER NOT NULL,name TEXT NOT NULL,goal TEXT NOT NULL,deliverable TEXT NOT NULL,due_date TEXT,ledger_project_id TEXT UNIQUE,archived INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL); CREATE TABLE resource_links(id TEXT PRIMARY KEY,business_id TEXT NOT NULL REFERENCES business_projects(id),kind TEXT NOT NULL,target TEXT NOT NULL,size INTEGER,modified REAL,created_at TEXT NOT NULL,UNIQUE(business_id,kind,target)); PRAGMA user_version=1;',
        )
        db.prepare('INSERT INTO settings VALUES (1,?,0,?,0)').run(
          target.workspaceId,
          basename(root),
        )
        db.exec('COMMIT')
        db.close()
        db = null
        await rename(temporary, path)
      } finally {
        db?.close()
        await rm(temporary, { force: true })
      }
    }
    return path
  }
  private open(path: string, workspaceId: string, readOnly = false): DatabaseSync {
    const db = new DatabaseSync(path, { readOnly })
    try {
      db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1000;')
      if (Number((db.prepare('PRAGMA user_version').get() as Row).user_version) !== 1)
        throw new CompanyWorkspaceError('IO_ERROR', '公司数据版本不支持，原数据已保留')
      const settings = db.prepare('SELECT * FROM settings WHERE id=1').get() as Row | undefined
      if (!settings || settings.workspace_id !== workspaceId)
        throw new CompanyWorkspaceError('IO_ERROR', '公司数据与工作空间身份不一致，原数据已保留')
      return db
    } catch (error) {
      db.close()
      throw error
    }
  }
  private async mutate(
    target: CompanyWorkspaceTarget,
    operation: (db: DatabaseSync) => void,
    enabled = true,
  ): Promise<void> {
    const path = await this.databasePath(target)
    if (!existsSync(path)) throw new CompanyWorkspaceError('NOT_ENABLED', '请先启用公司视图')
    const db = this.open(path, target.workspaceId)
    try {
      if (enabled && !(db.prepare('SELECT enabled FROM settings WHERE id=1').get() as Row).enabled)
        throw new CompanyWorkspaceError('NOT_ENABLED', '请先启用公司视图')
      db.exec('BEGIN IMMEDIATE')
      try {
        operation(db)
        db.exec('UPDATE settings SET revision=revision+1 WHERE id=1; COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
      this.sources.changed?.(
        target.workspaceId,
        Number((db.prepare('SELECT revision FROM settings WHERE id=1').get() as Row).revision),
      )
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint'))
        throw new CompanyWorkspaceError('CONFLICT', '该账目归属已绑定其他业务，或资料已经关联')
      throw error
    } finally {
      db.close()
    }
  }
  private async resourcePath(root: string, target: string): Promise<string> {
    const path = await realpath(isAbsolute(target) ? target : resolve(root, target))
    const local = relative(root, path)
    if (
      !local ||
      local.startsWith('..' + sep) ||
      local === '..' ||
      isAbsolute(local) ||
      local.split(sep)[0] === '.cclink-studio'
    )
      throw new CompanyWorkspaceError('WORKSPACE_DENIED', '资料必须是当前工作空间内的用户文件')
    return path
  }
  private async snapshot(
    target: CompanyWorkspaceTarget,
    month: string,
  ): Promise<CompanyWorkspaceSnapshot> {
    const path = await this.databasePath(target)
    let name = basename(target.workspacePath)
    let enabled = false
    let revision = 0
    let projects: CompanyBusiness[] = []
    let rows: Row[] = []
    if (existsSync(path)) {
      const db = this.open(path, target.workspaceId, true)
      try {
        const settings = db.prepare('SELECT * FROM settings WHERE id=1').get() as Row
        name = String(settings.name)
        enabled = Boolean(settings.enabled)
        revision = Number(settings.revision)
        projects = (
          db
            .prepare('SELECT * FROM business_projects ORDER BY created_at,id LIMIT 501')
            .all() as Row[]
        ).map(businessFromRow)
        rows = db
          .prepare('SELECT * FROM resource_links ORDER BY created_at,id LIMIT 2001')
          .all() as Row[]
        if (projects.length > 500 || rows.length > 2000)
          throw new CompanyWorkspaceError('IO_ERROR', '公司资料超出本版范围，原数据已保留')
      } finally {
        db.close()
      }
    }
    let finance: CompanyWorkspaceSnapshot['finance'] = {
      state: 'unavailable',
      month,
      currency: 'CNY',
      projects: [],
      summary: null,
      issue: '账目能力暂不可用',
    }
    try {
      const source = this.sources.finance(target, month)
      if (source)
        finance = {
          state: source.error ? 'unavailable' : source.initialized ? 'ready' : 'not-initialized',
          month,
          currency: source.settings.defaultCurrency,
          projects: source.projects,
          summary: source.initialized && !source.error ? source.summary : null,
          issue: source.error,
        }
    } catch {
      finance.issue = '财务暂不可用，其他公司资料仍可查看'
    }
    let conversations: CompanyConversationSource[] = []
    let publications: CompanyPublishingSource[] = []
    let conversationUnavailable = false
    let publishingUnavailable = false
    try {
      conversations = await this.sources.conversations(target)
    } catch {
      conversationUnavailable = true
    }
    try {
      const source = this.sources.publications(target)
      publications = source ?? []
      publishingUnavailable = source === null
    } catch {
      publishingUnavailable = true
    }
    const links: CompanyResourceLink[] = await Promise.all(
      rows.map(async (row) => {
        const kind = row.kind as CompanyResourceLink['kind']
        const linkTarget = String(row.target)
        const item: CompanyResourceLink = {
          id: String(row.id),
          businessId: String(row.business_id),
          kind,
          target: linkTarget,
          createdAt: String(row.created_at),
          label: linkTarget,
          availability: 'missing',
        }
        if (kind === 'file') {
          try {
            const info = await stat(await this.resourcePath(target.workspacePath, linkTarget))
            item.availability = info.isFile()
              ? info.size === row.size && info.mtimeMs === row.modified
                ? 'available'
                : 'changed'
              : 'missing'
            item.label = basename(linkTarget)
          } catch {
            item.issue = '文件缺失或不再属于当前工作空间'
          }
        } else {
          const source =
            kind === 'conversation'
              ? conversations.find((value) => value.id === linkTarget)
              : publications.find((value) => value.id === linkTarget)
          item.availability = source ? 'available' : 'missing'
          item.label = source?.title ?? linkTarget
          if (!source)
            item.issue = (kind === 'conversation' ? conversationUnavailable : publishingUnavailable)
              ? '来源服务暂不可用'
              : '原记录已归档、删除或不可用'
        }
        return item
      }),
    )
    return {
      workspaceId: target.workspaceId,
      enabled,
      name,
      revision,
      projects,
      links,
      conversations,
      publications,
      sourceIssues: {
        conversations: conversationUnavailable ? '会话资料暂不可用' : undefined,
        publications: publishingUnavailable ? '发布能力暂不可用，其他业务资料仍可查看' : undefined,
      },
      finance,
    }
  }
}
function businessFromRow(row: Row): CompanyBusiness {
  return {
    id: String(row.id),
    version: Number(row.version),
    name: String(row.name),
    goal: String(row.goal),
    deliverable: String(row.deliverable),
    dueDate: row.due_date === null ? null : String(row.due_date),
    ledgerProjectId: row.ledger_project_id === null ? null : String(row.ledger_project_id),
    archived: Boolean(row.archived),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}
