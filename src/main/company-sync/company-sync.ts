/**
 * Company records and accounts in project sync (ADR 0026 §8).
 *
 * The SQLite databases stay the only source of truth, owned by CompanyWorkspaceService and
 * CompanyAccountsService. Each round this module exports every row into a sync copy — one
 * single-line JSON file per row under `.cclink-studio/shared/company/` — so Git merges records
 * one by one, and reads incoming changes back in one transaction per database. Nothing else reads
 * the copy.
 */
import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { ScopedGit } from '../git/sync-diary'

export const COMPANY_COPY_DIR = '.cclink-studio/shared/company'
export const COMPANY_COPY_FORMAT = 1
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
const STATE_FILE = '.cclink-studio/company-sync.json'

type Row = Record<string, unknown>
type DbName = 'company' | 'accounts'

interface TableSpec {
  db: DbName
  table: string
  key: string[]
  /** Shown in conflicts and counts. */
  label: string
  /** Columns pointing at another synced table, rewritten when duplicates are merged. */
  refs?: Record<string, string>
  /** Natural unique key used to recognise the same item created on two computers. */
  natural?: string
}

/** Parents before children; read-in runs with deferred foreign keys anyway. */
export const COMPANY_TABLES: TableSpec[] = [
  { db: 'company', table: 'business_projects', key: ['id'], label: '业务项目' },
  {
    db: 'company',
    table: 'resource_links',
    key: ['id'],
    label: '资料关联',
    refs: { business_id: 'company.business_projects' },
  },
  {
    db: 'company',
    table: 'customer_cases',
    key: ['id'],
    label: '客户与售后',
    refs: { business_id: 'company.business_projects' },
  },
  { db: 'company', table: 'decisions', key: ['id'], label: '经营决策' },
  { db: 'accounts', table: 'settings', key: ['key'], label: '账目设置' },
  { db: 'accounts', table: 'projects', key: ['id'], label: '账目归属', natural: 'name' },
  { db: 'accounts', table: 'import_batches', key: ['id'], label: '导入批次' },
  { db: 'accounts', table: 'documents', key: ['id'], label: '流水原件', natural: 'hash' },
  {
    db: 'accounts',
    table: 'records',
    key: ['id'],
    label: '流水',
    natural: 'source_key',
    refs: { project_id: 'accounts.projects', import_batch_id: 'accounts.import_batches' },
  },
  {
    db: 'accounts',
    table: 'record_documents',
    key: ['record_id', 'document_id', 'role'],
    label: '流水与原件',
    refs: { record_id: 'accounts.records', document_id: 'accounts.documents' },
  },
  {
    db: 'accounts',
    table: 'record_events',
    key: ['id'],
    label: '流水修改历史',
    refs: { record_id: 'accounts.records' },
  },
]

/** Where each database lives and how to create it when records arrive first. */
export interface CompanyDatabases {
  company: { path: string; create(): Promise<void> }
  accounts: { path: string; documents: string; create(): Promise<void> }
  /** Lets open views refresh after a read-in. */
  changed?(): void
}

export interface CompanySyncCounts {
  received: Record<string, number>
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/

export function rowFile(spec: TableSpec, row: Row): string {
  const key = spec.key.map((k) => String(row[k]))
  const name =
    key.length === 1 && SAFE_ID.test(key[0])
      ? key[0]
      : createHash('sha256').update(JSON.stringify(key)).digest('hex')
  return `${COMPANY_COPY_DIR}/records/${spec.db}/${spec.table}/${name}.json`
}

/** One line, sorted keys: any two edits of the same row meet on the same line. */
export function serializeRow(spec: TableSpec, row: Row): string {
  const sorted = Object.fromEntries(
    Object.keys(row)
      .sort()
      .map((k) => [k, row[k]]),
  )
  return JSON.stringify({ table: spec.table, row: sorted }) + '\n'
}

function parseRowFile(text: string): { table: string; row: Row } {
  const value = JSON.parse(text) as { table?: unknown; row?: unknown }
  if (typeof value.table !== 'string' || !value.row || typeof value.row !== 'object')
    throw Error('同步副本中的记录格式无效')
  return { table: value.table, row: value.row as Row }
}

function specForPath(path: string): TableSpec | null {
  const m =
    /^\.cclink-studio\/shared\/company\/records\/(company|accounts)\/([a-z_]+)\/[^/]+\.json$/.exec(
      path,
    )
  return m ? (COMPANY_TABLES.find((s) => s.db === m[1] && s.table === m[2]) ?? null) : null
}

/** Allowed paths inside the company sync copy (path policy). */
export function isCompanyCopyPathStrict(path: string): boolean {
  return (
    path === `${COMPANY_COPY_DIR}/manifest.json` ||
    Boolean(specForPath(path)) ||
    /^\.cclink-studio\/shared\/company\/originals\/[0-9a-f]{64}$/.test(path)
  )
}

/** Field-by-field view of a conflicted record for the conflict page. */
export function describeRecordConflict(
  path: string,
  local: string,
  remote: string,
): { label: string; fields: Array<{ name: string; local: string; remote: string }> } | null {
  const spec = specForPath(path)
  if (!spec) return null
  try {
    const a = parseRowFile(local).row
    const b = parseRowFile(remote).row
    const names = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
      (n) => JSON.stringify(a[n]) !== JSON.stringify(b[n]),
    )
    const show = (v: unknown) => (v === null || v === undefined ? '' : String(v)).slice(0, 300)
    const title =
      a.customer ?? a.name ?? a.question ?? a.counterparty ?? a.purpose ?? a.original_name ?? ''
    return {
      label: `${spec.label}${title ? ' · ' + show(title).slice(0, 40) : ''}`,
      fields: names
        .slice(0, 30)
        .map((name) => ({ name, local: show(a[name]), remote: show(b[name]) })),
    }
  } catch {
    return null
  }
}

interface LocalState {
  companyId?: string
  /** Git tree of the copy that the databases reflect. */
  importedTree?: string
}

async function readState(root: string): Promise<LocalState> {
  try {
    return JSON.parse(await readFile(join(root, STATE_FILE), 'utf8')) as LocalState
  } catch {
    return {}
  }
}
async function writeState(root: string, state: LocalState): Promise<void> {
  await writeFile(join(root, STATE_FILE), JSON.stringify(state, null, 2) + '\n', { mode: 0o600 })
}

function openDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;')
  return db
}

function tableColumns(db: DatabaseSync, table: string): Set<string> {
  return new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as Row[]).map((r) => String(r.name)),
  )
}

/**
 * Hooks for one project sync round. `beforeCommit` reads in anything the databases have not yet
 * seen, then exports them; `afterUpdate` reads in what the merge brought.
 */
export function companySyncHooks(root: string, databases: CompanyDatabases) {
  const exists = (db: DbName) => existsSync(databases[db].path)
  const copyTree = async (git: ScopedGit, rev: string) =>
    (
      await git(['rev-parse', '--verify', '-q', `${rev}:${COMPANY_COPY_DIR}`]).catch(() => '')
    ).trim()

  /**
   * Reads the copy changes between two trees of the copy directory into the databases. A row is
   * applied only when this computer still has what `fromTree` recorded (or already has the
   * incoming version); a row edited here meanwhile stops the read-in instead of being overwritten.
   */
  async function readIn(git: ScopedGit, fromTree: string, toTree: string) {
    const listing = (
      await git(['diff-tree', '-r', '--no-renames', '--name-status', '-z', fromTree, toTree])
    ).split('\0')
    const changes: Array<{ status: string; rel: string; path: string }> = []
    for (let i = 0; i + 1 < listing.length; i += 2)
      if (listing[i])
        changes.push({
          status: listing[i],
          rel: listing[i + 1],
          path: `${COMPANY_COPY_DIR}/${listing[i + 1]}`,
        })
    const show = (tree: string, rel: string) =>
      tree === EMPTY_TREE ? Promise.resolve('') : git(['show', `${tree}:${rel}`]).catch(() => '')
    const manifestText = await show(toTree, 'manifest.json')
    if (manifestText) {
      const manifest = JSON.parse(manifestText) as { format?: number; companyId?: string }
      if ((manifest.format ?? 0) > COMPANY_COPY_FORMAT)
        throw Error('另一台电脑的 Studio 更新，公司记录格式更新了。请先更新 Studio 再同步。')
      const state = await readState(root)
      if (state.companyId && manifest.companyId && state.companyId !== manifest.companyId)
        throw Error('这个仓库里是另一家公司的记录，已暂停同步。请把仓库下载到新文件夹。')
    }
    const byDb = new Map<DbName, Array<{ spec: TableSpec; status: string; rel: string }>>()
    for (const change of changes) {
      const spec = specForPath(change.path)
      if (!spec) continue
      byDb.set(spec.db, [...(byDb.get(spec.db) ?? []), { spec, ...change }])
    }
    for (const [dbName, items] of byDb) {
      if (!exists(dbName)) await databases[dbName].create()
      const db = openDb(databases[dbName].path)
      const alias = new Map<string, Map<string, string>>()
      const documents: Row[] = []
      try {
        db.exec('BEGIN IMMEDIATE; PRAGMA defer_foreign_keys=ON;')
        const order = (s: TableSpec) => COMPANY_TABLES.indexOf(s)
        // Deletions children-first, upserts parents-first.
        const deletions = items
          .filter((i) => i.status === 'D')
          .sort((a, b) => order(b.spec) - order(a.spec))
        const upserts = items
          .filter((i) => i.status !== 'D')
          .sort((a, b) => order(a.spec) - order(b.spec))
        for (const item of deletions) {
          const before = await show(fromTree, item.rel)
          if (!before) continue
          const { row } = parseRowFile(before)
          const current = currentRow(db, item.spec, row)
          if (!current) continue
          if (serializeRow(item.spec, current) !== before)
            throw Error('同步期间这台电脑改了同一条公司记录，请继续同步')
          db.prepare(
            `DELETE FROM ${item.spec.table} WHERE ${item.spec.key.map((k) => k + '=?').join(' AND ')}`,
          ).run(...(item.spec.key.map((k) => row[k]) as never[]))
        }
        for (const item of upserts) {
          const text = await show(toTree, item.rel)
          const { table, row } = parseRowFile(text)
          if (table !== item.spec.table) throw Error('同步副本中的记录位置无效')
          const current = currentRow(db, item.spec, row)
          if (current) {
            const now = serializeRow(item.spec, current)
            if (now === text) continue
            const before = await show(fromTree, item.rel)
            if (before && now !== before)
              throw Error('同步期间这台电脑改了同一条公司记录，请继续同步')
          }
          for (const [column, target] of Object.entries(item.spec.refs ?? {})) {
            const mapped = alias.get(target)?.get(String(row[column]))
            if (mapped) row[column] = mapped
          }
          if (upsert(db, item.spec, row, alias) && item.spec.table === 'documents')
            documents.push(row)
        }
        for (const row of documents) await restoreOriginal(row)
        if (dbName === 'company') db.exec('UPDATE settings SET revision=revision+1 WHERE id=1')
        const violations = db.prepare('PRAGMA foreign_key_check').all() as Row[]
        if (violations.length) throw Error(`公司记录引用不完整（${String(violations[0].table)}）`)
        db.exec('COMMIT')
      } catch (error) {
        try {
          db.exec('ROLLBACK')
        } catch {
          /* already rolled back */
        }
        throw Error(
          '公司记录无法读入，本机数据保持原样：' +
            (error instanceof Error ? error.message : String(error)),
        )
      } finally {
        db.close()
      }
    }
    if (byDb.size) databases.changed?.()
  }

  function currentRow(db: DatabaseSync, spec: TableSpec, row: Row): Row | undefined {
    return db
      .prepare(`SELECT * FROM ${spec.table} WHERE ${spec.key.map((k) => k + '=?').join(' AND ')}`)
      .get(...(spec.key.map((k) => row[k]) as never[])) as Row | undefined
  }

  /** Returns true when the incoming row was written (not merged into an existing duplicate). */
  function upsert(
    db: DatabaseSync,
    spec: TableSpec,
    row: Row,
    alias: Map<string, Map<string, string>>,
  ): boolean {
    const columns = tableColumns(db, spec.table)
    const unknown = Object.keys(row).filter((c) => !columns.has(c))
    if (unknown.length) throw Error('公司记录来自更新版本的 Studio，请先更新 Studio')
    if (spec.natural && row[spec.natural] !== undefined) {
      const other = db
        .prepare(`SELECT * FROM ${spec.table} WHERE ${spec.natural}=? AND id<>?`)
        .get(row[spec.natural] as never, row.id as never) as Row | undefined
      if (other) {
        // The same transaction, original or ledger project created on both computers: keep the
        // one with more edits (then the smaller id) so both computers converge on the same row.
        const incomingWins =
          Number(row.version ?? 0) > Number(other.version ?? 0) ||
          (Number(row.version ?? 0) === Number(other.version ?? 0) &&
            String(row.id) < String(other.id))
        const [winner, loser] = incomingWins
          ? [String(row.id), String(other.id)]
          : [String(other.id), String(row.id)]
        const key = `${spec.db}.${spec.table}`
        alias.set(key, (alias.get(key) ?? new Map()).set(loser, winner))
        if (incomingWins) {
          // Foreign keys are deferred, so children can point at the winner before it exists.
          repoint(db, spec, loser, winner)
          db.prepare(`DELETE FROM ${spec.table} WHERE id=?`).run(loser)
          insertOrUpdate(db, spec, row)
          return true
        }
        repoint(db, spec, loser, winner)
        db.prepare(`DELETE FROM ${spec.table} WHERE id=?`).run(loser)
        return false
      }
    }
    insertOrUpdate(db, spec, row)
    return true
  }

  function insertOrUpdate(db: DatabaseSync, spec: TableSpec, row: Row) {
    const cols = Object.keys(row)
    const update = cols.filter((c) => !spec.key.includes(c))
    db.prepare(
      `INSERT INTO ${spec.table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})` +
        ` ON CONFLICT(${spec.key.join(',')}) DO ` +
        (update.length
          ? `UPDATE SET ${update.map((c) => `${c}=excluded.${c}`).join(',')}`
          : 'NOTHING'),
    ).run(...(cols.map((c) => row[c]) as never[]))
  }

  /** Children of a merged duplicate move to the kept row. */
  function repoint(db: DatabaseSync, spec: TableSpec, loser: string, winner: string) {
    const target = `${spec.db}.${spec.table}`
    for (const child of COMPANY_TABLES.filter((t) => t.db === spec.db))
      for (const [column, ref] of Object.entries(child.refs ?? {}))
        if (ref === target) {
          db.prepare(`UPDATE OR IGNORE ${child.table} SET ${column}=? WHERE ${column}=?`).run(
            winner,
            loser,
          )
          db.prepare(`DELETE FROM ${child.table} WHERE ${column}=?`).run(loser)
        }
  }

  async function restoreOriginal(row: Row) {
    const stored = String(row.stored_name)
    if (!/^[A-Za-z0-9_.-]{1,120}$/.test(stored) || stored.startsWith('.'))
      throw Error('流水原件名称无效')
    const target = join(databases.accounts.documents, stored)
    if (existsSync(target)) return
    const hash = String(row.hash)
    if (!/^[0-9a-f]{64}$/.test(hash)) throw Error('流水原件校验值无效')
    const source = join(root, COMPANY_COPY_DIR, 'originals', hash)
    if (!existsSync(source)) throw Error('另一台电脑的流水原件尚未同步完成')
    const bytes = await readFile(source)
    if (createHash('sha256').update(bytes).digest('hex') !== hash) throw Error('流水原件已损坏')
    await mkdir(databases.accounts.documents, { recursive: true })
    await writeFile(target, bytes)
  }

  /** Writes every row of every existing database and removes files for rows that are gone. */
  async function exportAll(companyId: string) {
    const dir = join(root, COMPANY_COPY_DIR)
    const anyDb = exists('company') || exists('accounts')
    if (!anyDb) return
    await mkdir(dir, { recursive: true })
    const manifestPath = join(dir, 'manifest.json')
    const manifest = JSON.stringify({ format: COMPANY_COPY_FORMAT, companyId }) + '\n'
    if ((await readFile(manifestPath, 'utf8').catch(() => '')) !== manifest)
      await writeFile(manifestPath, manifest)
    const wanted = new Set<string>()
    const originals = new Set<string>()
    for (const dbName of ['company', 'accounts'] as const) {
      if (!exists(dbName)) continue
      const db = new DatabaseSync(databases[dbName].path, { readOnly: true })
      try {
        for (const spec of COMPANY_TABLES.filter((t) => t.db === dbName)) {
          const tableDir = join(root, COMPANY_COPY_DIR, 'records', dbName, spec.table)
          const exportedHere = new Set<string>()
          for (const row of db.prepare(`SELECT * FROM ${spec.table}`).all() as Row[]) {
            const rel = rowFile(spec, row)
            exportedHere.add(rel)
            const file = join(root, rel)
            const text = serializeRow(spec, row)
            if ((await readFile(file, 'utf8').catch(() => '')) !== text) {
              await mkdir(dirname(file), { recursive: true })
              await writeFile(file, text)
            }
            if (spec.table === 'documents') {
              const hash = String(row.hash)
              originals.add(hash)
              const copy = join(dir, 'originals', hash)
              const source = join(databases.accounts.documents, String(row.stored_name))
              if (/^[0-9a-f]{64}$/.test(hash) && !existsSync(copy) && existsSync(source)) {
                await mkdir(dirname(copy), { recursive: true })
                await copyFile(source, copy)
              }
            }
          }
          for (const name of await readdir(tableDir).catch(() => [] as string[])) {
            const rel = `${COMPANY_COPY_DIR}/records/${dbName}/${spec.table}/${name}`
            if (!exportedHere.has(rel)) await rm(join(root, rel), { force: true })
          }
          for (const rel of exportedHere) wanted.add(rel)
        }
      } finally {
        db.close()
      }
    }
    if (exists('accounts'))
      for (const name of await readdir(join(dir, 'originals')).catch(() => [] as string[]))
        if (!originals.has(name)) await rm(join(dir, 'originals', name), { force: true })
  }

  return {
    async beforeCommit(git: ScopedGit) {
      const state = await readState(root)
      const tree = await copyTree(git, 'HEAD')
      // Anything committed that the databases have not seen yet (a download, or a read-in that
      // failed last round) is read in before the export, so the export never undoes it.
      if (tree && tree !== state.importedTree)
        await readIn(git, state.importedTree || EMPTY_TREE, tree)
      const manifestText = await readFile(
        join(root, COMPANY_COPY_DIR, 'manifest.json'),
        'utf8',
      ).catch(() => '')
      const fromCopy = manifestText
        ? (JSON.parse(manifestText) as { companyId?: string }).companyId
        : undefined
      const companyId = state.companyId ?? fromCopy ?? randomUUID()
      await exportAll(companyId)
      await writeState(root, { ...state, companyId, importedTree: tree || undefined })
    },
    async afterUpdate(git: ScopedGit, previousHead: string, head: string) {
      const state = await readState(root)
      const before = previousHead ? await copyTree(git, previousHead) : ''
      const after = await copyTree(git, head)
      if (after && after !== before) await readIn(git, before || EMPTY_TREE, after)
      await writeState(root, { ...state, importedTree: after || undefined })
    },
  }
}

/** Row counts per kind for the preview; read-only, missing databases count as empty. */
export function countCompanyRows(databases: Pick<CompanyDatabases, 'company' | 'accounts'>) {
  const counts: Array<{ label: string; count: number }> = []
  for (const dbName of ['company', 'accounts'] as const) {
    if (!existsSync(databases[dbName].path)) continue
    const db = new DatabaseSync(databases[dbName].path, { readOnly: true })
    try {
      for (const spec of COMPANY_TABLES.filter((t) => t.db === dbName)) {
        if (
          ['settings', 'record_documents', 'import_batches', 'resource_links'].includes(spec.table)
        )
          continue
        const row = db.prepare(`SELECT COUNT(*) AS n FROM ${spec.table}`).get() as Row
        counts.push({ label: spec.label, count: Number(row.n) })
      }
    } finally {
      db.close()
    }
  }
  return counts
}
