import { companyLinkedWorkspaceSchema } from '../../shared/company-workspace/company-workspace-schema'
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
  CompanyCreateCaseInput,
  CompanyCreateDecisionInput,
  CompanyCustomerCase,
  CompanyUpdateDecisionInput,
  CompanyUpdateCaseInput,
  CompanyLinkInput,
  CompanyPublishingSource,
  CompanyResourceLink,
  CompanyUnlinkInput,
  CompanyUpdateBusinessInput,
  CompanyWorkspaceErrorCode,
  CompanyWorkspaceSnapshot,
} from '../../shared/company-workspace/company-workspace-types'
import type { CompanyDecision } from '../../shared/company-workspace/company-decision'
import {
  applyDecisionChange,
  DECISION_COLUMNS,
  DECISION_UPDATE,
  decisionFromRow,
  decisionToRow,
  decisionUpdateArgs,
  DECISIONS_DDL,
  MAX_DECISIONS,
  newDecision,
} from './company-decisions'

export interface CompanyWorkspaceTarget {
  workspacePath: string
  workspaceId: string
}
interface Sources {
  workspace?(path: string, id: string): Promise<void>
  finance(target: CompanyWorkspaceTarget, month: string): CompanyAccountsSnapshot | null
  conversations(target: CompanyWorkspaceTarget): Promise<CompanyConversationSource[]>
  publications(target: CompanyWorkspaceTarget): CompanyPublishingSource[] | null
  changed?(workspaceId: string, revision: number): void
}
type Row = Record<string, unknown>
const SCHEMA_VERSION = 3
const SUPPORTED_VERSIONS = new Set([1, 2, SCHEMA_VERSION])
const MAX_CASES = 5000
/** v2 adds locally recorded customer inquiries and after-sales cases. */
const CUSTOMER_CASES_DDL =
  "CREATE TABLE IF NOT EXISTS customer_cases(id TEXT PRIMARY KEY,version INTEGER NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('lead','after-sales')),status TEXT NOT NULL CHECK(status IN ('waiting-me','waiting-customer','resolved')),customer TEXT NOT NULL,channel TEXT NOT NULL,summary TEXT NOT NULL,order_ref TEXT NOT NULL,next_step TEXT NOT NULL,business_id TEXT REFERENCES business_projects(id),waiting_since TEXT,resolved_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);"
export class CompanyWorkspaceError extends Error {
  constructor(
    readonly code: CompanyWorkspaceErrorCode,
    message: string,
  ) {
    super(message)
  }
}
export class CompanyWorkspaceService {
  /** Compatibility probe: never creates, repairs, migrates, or opens other domains. */
  static async describeExisting(
    target: CompanyWorkspaceTarget,
  ): Promise<{ name: string; enabled: boolean } | null> {
    let path = await realpath(target.workspacePath)
    if (path !== target.workspacePath) throw new Error('公司目录尚未规范化')
    for (const segment of ['.cclink-studio', 'company-workspace', 'company.sqlite']) {
      path = join(path, segment)
      const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null
        throw error
      })
      if (!info) return null
      if (info.isSymbolicLink()) throw new Error('公司资料路径不能是符号链接，原资料已保留')
    }
    const db = new DatabaseSync(path, { readOnly: true })
    try {
      if (
        !SUPPORTED_VERSIONS.has(
          Number((db.prepare('PRAGMA user_version').get() as Row).user_version),
        )
      )
        throw new Error('公司数据版本不支持，原资料已保留')
      const row = db.prepare('SELECT workspace_id,name,enabled FROM settings WHERE id=1').get() as
        | Row
        | undefined
      if (!row || row.workspace_id !== target.workspaceId || typeof row.name !== 'string')
        throw new Error('公司数据与原工作空间身份不一致，原资料已保留')
      return { name: row.name.slice(0, 128), enabled: Boolean(row.enabled) }
    } finally {
      db.close()
    }
  }
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
      if (input.kind === 'workspace') {
        const link = companyLinkedWorkspaceSchema.parse(JSON.parse(input.target))
        if (!this.sources.workspace)
          throw new CompanyWorkspaceError('SERVICE_UNAVAILABLE', '工程关联暂不可用')
        await this.sources.workspace(link.workspacePath, link.workspaceId)
        linkTarget = JSON.stringify(link)
      } else if (input.kind === 'file') {
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
  createCase(
    target: CompanyWorkspaceTarget,
    input: CompanyCreateCaseInput,
  ): Promise<CompanyWorkspaceSnapshot> {
    return this.enqueue(async () => {
      await this.mutate(target, (db) => {
        if (input.businessId) this.business(db, input.businessId)
        if (
          Number((db.prepare('SELECT COUNT(*) AS n FROM customer_cases').get() as Row).n) >=
          MAX_CASES
        )
          throw new CompanyWorkspaceError('CONFLICT', '客户记录数量已达本版上限')
        const now = new Date().toISOString()
        db.prepare(
          'INSERT INTO customer_cases(id,version,kind,status,customer,channel,summary,order_ref,next_step,business_id,waiting_since,resolved_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        ).run(
          randomUUID(),
          1,
          input.kind,
          'waiting-me',
          input.customer,
          input.channel,
          input.summary,
          input.orderRef,
          input.nextStep,
          input.businessId,
          now,
          null,
          now,
          now,
        )
      })
      return this.snapshot(target, input.month)
    })
  }
  updateCase(
    target: CompanyWorkspaceTarget,
    input: CompanyUpdateCaseInput,
  ): Promise<CompanyWorkspaceSnapshot> {
    return this.enqueue(async () => {
      await this.mutate(target, (db) => {
        const before = db.prepare('SELECT * FROM customer_cases WHERE id=?').get(input.caseId) as
          | Row
          | undefined
        if (!before) throw new CompanyWorkspaceError('NOT_FOUND', '客户记录不存在或不属于当前公司')
        if (input.businessId) this.business(db, input.businessId)
        const now = new Date().toISOString()
        const previous = caseFromRow(before)
        // Waiting time restarts only when the case newly becomes the user's turn.
        const waitingSince =
          input.status !== 'waiting-me'
            ? null
            : previous.status === 'waiting-me'
              ? previous.waitingSince
              : now
        const resolvedAt =
          input.status !== 'resolved'
            ? null
            : previous.status === 'resolved'
              ? previous.resolvedAt
              : now
        const changed = db
          .prepare(
            'UPDATE customer_cases SET version=version+1,kind=?,status=?,customer=?,channel=?,summary=?,order_ref=?,next_step=?,business_id=?,waiting_since=?,resolved_at=?,updated_at=? WHERE id=? AND version=?',
          )
          .run(
            input.kind,
            input.status,
            input.customer,
            input.channel,
            input.summary,
            input.orderRef,
            input.nextStep,
            input.businessId,
            waitingSince,
            resolvedAt,
            now,
            input.caseId,
            input.expectedVersion,
          )
        if (!Number(changed.changes))
          throw new CompanyWorkspaceError('CONFLICT', '客户记录已变化，请刷新后重试')
      })
      return this.snapshot(target, input.month)
    })
  }
  createDecision(
    target: CompanyWorkspaceTarget,
    input: CompanyCreateDecisionInput,
  ): Promise<CompanyWorkspaceSnapshot> {
    return this.enqueue(async () => {
      await this.mutate(target, (db) => {
        if (
          Number((db.prepare('SELECT COUNT(*) AS n FROM decisions').get() as Row).n) >=
          MAX_DECISIONS
        )
          throw new CompanyWorkspaceError('CONFLICT', '经营决策数量已达本版上限')
        if (db.prepare('SELECT 1 FROM decisions WHERE id=?').get(input.decisionId))
          throw new CompanyWorkspaceError('CONFLICT', '这条决策已存在，请刷新后重试')
        const decision = newDecision(input, new Date().toISOString())
        db.prepare(
          `INSERT INTO decisions(${DECISION_COLUMNS}) VALUES (${DECISION_COLUMNS.split(',')
            .map(() => '?')
            .join(',')})`,
        ).run(...(decisionToRow(decision) as never[]))
      })
      return this.snapshot(target, input.month)
    })
  }
  /** Only changes the decision record; never touches ledger, cases, or publishing. */
  updateDecision(
    target: CompanyWorkspaceTarget,
    input: CompanyUpdateDecisionInput,
  ): Promise<CompanyWorkspaceSnapshot> {
    return this.enqueue(async () => {
      await this.mutate(target, (db) => {
        const row = db.prepare('SELECT * FROM decisions WHERE id=?').get(input.decisionId) as
          | Row
          | undefined
        if (!row) throw new CompanyWorkspaceError('NOT_FOUND', '决策不存在或不属于当前公司')
        const current = decisionFromRow(row)
        const result = applyDecisionChange(current, input.change, new Date().toISOString())
        if (!result.ok) throw new CompanyWorkspaceError(result.code, result.message)
        const changed = db
          .prepare(DECISION_UPDATE)
          .run(...(decisionUpdateArgs(result.next, current.version) as never[]))
        if (!Number(changed.changes))
          throw new CompanyWorkspaceError('CONFLICT', '决策已变化，请刷新后重试')
      })
      return this.snapshot(target, input.month)
    })
  }
  /**
   * Project sync (ADR 0026): records can arrive from another computer before 启用公司视图 here.
   * Creates the (not yet enabled) database bound to this project's identity.
   */
  async ensureDatabaseForSync(target: CompanyWorkspaceTarget): Promise<string> {
    await this.sources.workspace?.(target.workspacePath, target.workspaceId)
    const path = await this.databasePath(target, true)
    this.open(path, target.workspaceId).close()
    return path
  }

  /** Tells open views that a sync read-in changed the records. */
  async notifySynced(target: CompanyWorkspaceTarget): Promise<void> {
    const path = await this.databasePath(target)
    if (!existsSync(path)) return
    const db = this.open(path, target.workspaceId, true)
    try {
      this.sources.changed?.(
        target.workspaceId,
        Number((db.prepare('SELECT revision FROM settings WHERE id=1').get() as Row).revision),
      )
    } finally {
      db.close()
    }
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
          'BEGIN; CREATE TABLE settings(id INTEGER PRIMARY KEY CHECK(id=1), workspace_id TEXT NOT NULL, enabled INTEGER NOT NULL, name TEXT NOT NULL, revision INTEGER NOT NULL); CREATE TABLE business_projects(id TEXT PRIMARY KEY,version INTEGER NOT NULL,name TEXT NOT NULL,goal TEXT NOT NULL,deliverable TEXT NOT NULL,due_date TEXT,ledger_project_id TEXT UNIQUE,archived INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL); CREATE TABLE resource_links(id TEXT PRIMARY KEY,business_id TEXT NOT NULL REFERENCES business_projects(id),kind TEXT NOT NULL,target TEXT NOT NULL,size INTEGER,modified REAL,created_at TEXT NOT NULL,UNIQUE(business_id,kind,target)); ' +
            CUSTOMER_CASES_DDL +
            DECISIONS_DDL +
            ` PRAGMA user_version=${SCHEMA_VERSION};`,
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
      const version = Number((db.prepare('PRAGMA user_version').get() as Row).user_version)
      if (!SUPPORTED_VERSIONS.has(version))
        throw new CompanyWorkspaceError('IO_ERROR', '公司数据版本不支持，原数据已保留')
      const settings = db.prepare('SELECT * FROM settings WHERE id=1').get() as Row | undefined
      if (!settings || settings.workspace_id !== workspaceId)
        throw new CompanyWorkspaceError('IO_ERROR', '公司数据与工作空间身份不一致，原数据已保留')
      if (version < SCHEMA_VERSION && !readOnly)
        db.exec(
          'BEGIN IMMEDIATE; ' +
            CUSTOMER_CASES_DDL +
            DECISIONS_DDL +
            ` PRAGMA user_version=${SCHEMA_VERSION}; COMMIT;`,
        )
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
    let cases: CompanyCustomerCase[] = []
    let decisions: CompanyDecision[] = []
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
        // A v1 database opened read-only has no case table until its first write migrates it.
        if (Number((db.prepare('PRAGMA user_version').get() as Row).user_version) >= 2)
          cases = (
            db
              .prepare(
                "SELECT * FROM customer_cases ORDER BY status='resolved', COALESCE(waiting_since, updated_at), id LIMIT ?",
              )
              .all(MAX_CASES) as Row[]
          ).map(caseFromRow)
        // Older databases opened read-only gain the table on their first write.
        if (Number((db.prepare('PRAGMA user_version').get() as Row).user_version) >= 3)
          decisions = (
            db
              .prepare('SELECT * FROM decisions ORDER BY updated_at DESC, id LIMIT ?')
              .all(MAX_DECISIONS) as Row[]
          ).map(decisionFromRow)
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
        if (kind === 'workspace') {
          try {
            const link = companyLinkedWorkspaceSchema.parse(JSON.parse(linkTarget))
            item.label = basename(link.workspacePath)
            if (!this.sources.workspace) throw Error('工程来源暂不可用')
            await this.sources.workspace(link.workspacePath, link.workspaceId)
            item.availability = 'available'
          } catch {
            item.issue = '工程失联或身份变化，请重新关联；原记录保留'
          }
        } else if (kind === 'file') {
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
      cases,
      decisions,
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
function caseFromRow(row: Row): CompanyCustomerCase {
  return {
    id: String(row.id),
    version: Number(row.version),
    kind: row.kind === 'lead' ? 'lead' : 'after-sales',
    status:
      row.status === 'resolved'
        ? 'resolved'
        : row.status === 'waiting-customer'
          ? 'waiting-customer'
          : 'waiting-me',
    customer: String(row.customer),
    channel: String(row.channel),
    summary: String(row.summary),
    orderRef: String(row.order_ref),
    nextStep: String(row.next_step),
    businessId: row.business_id === null ? null : String(row.business_id),
    waitingSince: row.waiting_since === null ? null : String(row.waiting_since),
    resolvedAt: row.resolved_at === null ? null : String(row.resolved_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}
