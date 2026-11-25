import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { DatabaseSync } from 'node:sqlite'
const state = vi.hoisted(() => ({ home: '' }))
vi.mock('electron', () => ({ app: { getPath: () => state.home } }))
import { GitExecutor } from '../git-backup/git-executor'
import { transferRepository } from '../git/git-transfer'
import { CompanyAccountsService } from '../company-accounts/company-accounts-service'
import {
  CompanyWorkspaceService,
  type CompanyWorkspaceTarget,
} from '../company-workspace/company-workspace-service'
import { companySyncHooks, describeRecordConflict } from './company-sync'
import type { GitTransferInput } from '../../shared/git'

const exec = promisify(execFile)
const roots: string[] = []
const services: CompanyWorkspaceService[] = []
afterEach(async () => {
  for (const s of services.splice(0)) await s.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
const month = '2026-11'

/** One “Mac”: a company project with real services and the sync hooks wired like the app. */
function computer(path: string, workspaceId: string) {
  const target: CompanyWorkspaceTarget = { workspacePath: path, workspaceId }
  const accounts = new CompanyAccountsService(() => path)
  const company = new CompanyWorkspaceService({
    finance: () => null,
    conversations: async () => [],
    publications: () => null,
  })
  services.push(company)
  const ledger = join(path, '.cclink-studio', 'company-accounts')
  const hooks = () => ({
    ...companySyncHooks(path, {
      company: {
        path: join(path, '.cclink-studio', 'company-workspace', 'company.sqlite'),
        create: async () => {
          await company.ensureDatabaseForSync(target)
        },
      },
      accounts: {
        path: join(ledger, 'accounts.sqlite'),
        documents: join(ledger, 'documents'),
        create: async () => accounts.initializeForWorkspace(path),
      },
    }),
    describeRecordConflict,
  })
  const scope = { workspaceRef: { kind: 'local' as const, path }, month }
  const ledgerDb = () => new DatabaseSync(join(ledger, 'accounts.sqlite'))
  return {
    path,
    target,
    company,
    accounts,
    scope,
    hooks,
    enable: () => company.configure(target, { ...scope, enabled: true, name: '蜗牛眼镜' }),
    cases: async () => (await company.getSnapshot(target, month)).cases,
    /** A statement line as the importer stores it (same bank line → same source_key). */
    addRecord(id: string, sourceKey: string, extra: Record<string, unknown> = {}) {
      const db = ledgerDb()
      const now = new Date().toISOString()
      db.prepare(
        `INSERT INTO records (id,date,month,record_type,direction,amount_minor,currency,account,
          counterparty,purpose,category,project_id,status,version,import_batch_id,source_key,
          suggestion_json,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,NULL,?,NULL,?,?)`,
      ).run(
        id,
        '2026-11-03',
        month,
        'expense',
        'expense',
        (extra.amount as number) ?? 18000,
        'CNY',
        '银行卡',
        '顺丰',
        '寄配件',
        '物流',
        (extra.status as string) ?? 'pending',
        (extra.version as number) ?? 1,
        sourceKey,
        now,
        now,
      )
      db.close()
    },
    records: () => {
      const db = ledgerDb()
      const rows = db.prepare('SELECT id, status, version FROM records ORDER BY id').all()
      db.close()
      return rows
    },
  }
}

async function setup() {
  state.home = await realpath(await mkdtemp(join(tmpdir(), 'company-sync-')))
  roots.push(state.home)
  const remote = join(state.home, 'remote.git')
  await exec('git', ['init', '--bare', '--initial-branch=main', remote])
  const pathA = join(state.home, 'a', '蜗牛眼镜')
  const pathB = join(state.home, 'b', '蜗牛眼镜')
  await mkdir(join(pathA, '.cclink-studio'), { recursive: true })
  await mkdir(pathB, { recursive: true })
  await writeFile(
    join(pathA, '.cclink-studio', 'workspace-settings.json'),
    JSON.stringify({ version: 1, name: '蜗牛眼镜', type: 'company' }),
  )
  const A = computer(pathA, 'project-a')
  const B = computer(pathB, 'project-b')
  const runner = new GitExecutor({ isolatedConfig: true })
  const sync = (mac: ReturnType<typeof computer>, extra: Partial<GitTransferInput> = {}) =>
    transferRepository(
      { action: 'project-sync', workspacePath: mac.path, url: remote, ...extra },
      { runner, project: mac.hooks() },
    )
  const download = async () => {
    await transferRepository({ action: 'clone', url: remote, destination: pathB }, { runner })
  }
  return { A, B, sync, download }
}

const caseInput = {
  kind: 'after-sales' as const,
  customer: '周先生',
  channel: '网店',
  summary: '镜腿松动',
  orderRef: 'XH-1108',
  nextStep: '寄回换件',
  businessId: null,
}

describe('company records in project sync (ADR 0026)', { timeout: 90_000 }, () => {
  it('a second computer reads in customer cases and statement lines after download', async () => {
    const { A, B, sync, download } = await setup()
    await A.enable()
    await A.company.createCase(A.target, { ...A.scope, ...caseInput })
    A.accounts.initialize(month)
    A.addRecord('rec-a', 'bank-line-1')
    await sync(A)
    await download()
    await sync(B)
    expect((await B.cases()).map((c) => c.customer)).toEqual(['周先生'])
    expect(B.records()).toEqual([{ id: 'rec-a', status: 'pending', version: 1 }])
    // The second computer's own edit comes back.
    const created = (await B.cases())[0]
    await B.enable()
    await B.company.updateCase(B.target, {
      ...B.scope,
      ...caseInput,
      caseId: created.id,
      expectedVersion: 1,
      status: 'resolved',
    })
    await sync(B)
    await sync(A)
    expect((await A.cases())[0].status).toBe('resolved')
  })

  it('pauses on a record changed on both computers and applies the chosen copy', async () => {
    const { A, B, sync, download } = await setup()
    await A.enable()
    const created = (await A.company.createCase(A.target, { ...A.scope, ...caseInput })).cases[0]
    await sync(A)
    await download()
    await sync(B)
    await B.enable()
    const update = (mac: typeof A, nextStep: string) =>
      mac.company.updateCase(mac.target, {
        ...mac.scope,
        ...caseInput,
        caseId: created.id,
        expectedVersion: 1,
        status: 'waiting-me',
        nextStep,
      })
    await update(B, '先退款')
    await sync(B)
    await update(A, '寄配件')

    const paused = await sync(A)
    const record = paused.conflictFiles?.find((c) => c.kind === 'record')
    expect(record?.label).toContain('客户与售后')
    expect(record?.fields).toEqual(
      expect.arrayContaining([{ name: 'next_step', local: '寄配件', remote: '先退款' }]),
    )
    // Nothing changes on this computer while the decision waits.
    expect((await A.cases())[0].nextStep).toBe('寄配件')

    await sync(A, {
      resolutions: { [record!.path]: 'remote' },
      expectedHead: paused.head,
      expectedTarget: paused.target,
    })
    expect((await A.cases())[0].nextStep).toBe('先退款')
    await sync(B)
    expect((await B.cases())[0].nextStep).toBe('先退款')
  })

  it('keeps one copy of a statement line imported on both computers', async () => {
    const { A, B, sync, download } = await setup()
    A.accounts.initialize(month)
    A.addRecord('rec-a', 'seed')
    await sync(A)
    await download()
    await sync(B)
    // Both import the same bank line; A also confirmed it.
    A.addRecord('rec-zz-a', 'bank-line-7', { status: 'confirmed', version: 2 })
    B.addRecord('rec-bb-b', 'bank-line-7')
    await sync(B)
    await sync(A)
    await sync(B)
    await sync(A)
    const expected = [
      { id: 'rec-a', status: 'pending', version: 1 },
      { id: 'rec-zz-a', status: 'confirmed', version: 2 },
    ]
    expect(A.records()).toEqual(expected)
    expect(B.records()).toEqual(expected)
  })

  it('leaves local records untouched when a read-in fails, and does not undo it later', async () => {
    const { A, B, sync, download } = await setup()
    A.accounts.initialize(month)
    A.addRecord('rec-a', 'seed')
    await sync(A)
    await download()
    await sync(B)
    // A newer Studio on B wrote a column this version does not know.
    const file = join(B.path, '.cclink-studio/shared/company/records/accounts/records/rec-a.json')
    const row = JSON.parse(await (await import('node:fs/promises')).readFile(file, 'utf8'))
    row.row.future_column = 1
    row.row.version = 9
    await writeFile(file, JSON.stringify(row) + '\n')
    await exec('git', [
      '-C',
      B.path,
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@t',
      'commit',
      '-qam',
      'x',
    ])
    await exec('git', [
      '-C',
      B.path,
      'push',
      '-q',
      join(B.path, '..', '..', 'remote.git'),
      'HEAD:main',
    ])

    await expect(sync(A)).rejects.toThrow('公司记录无法读入，本机数据保持原样')
    expect(A.records()).toEqual([{ id: 'rec-a', status: 'pending', version: 1 }])
    // The next round retries the read-in first instead of exporting the old row over it.
    await expect(sync(A)).rejects.toThrow('请先更新 Studio')
    expect(A.records()).toEqual([{ id: 'rec-a', status: 'pending', version: 1 }])
    const copies = await readdir(
      join(A.path, '.cclink-studio/shared/company/records/accounts/records'),
    )
    expect(copies).toEqual(['rec-a.json'])
  })
})
