import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { CompanyAccountsService } from '../company-accounts/company-accounts-service'
import { CompanyWorkspaceService, type CompanyWorkspaceTarget } from './company-workspace-service'

let root: string
let a: CompanyWorkspaceTarget
let b: CompanyWorkspaceTarget
let service: CompanyWorkspaceService
let accounts: CompanyAccountsService
const month = '2026-09'
const changes: Array<{ id: string; revision: number }> = []
const scope = () => ({ workspaceRef: { kind: 'local' as const, path: a.workspacePath }, month })
const create = (name = 'AR 眼镜一代', ledgerProjectId: string | null = null) => ({
  ...scope(),
  name,
  goal: '完成试戴记录',
  deliverable: '真实记录可查看',
  dueDate: null,
  ledgerProjectId,
})
const sources = () => ({
  finance: (target: CompanyWorkspaceTarget, period: string) =>
    accounts.getSnapshotForWorkspace(target.workspacePath, period),
  conversations: async (target: CompanyWorkspaceTarget) =>
    target.workspaceId === a.workspaceId ? [{ id: 'conversation-a', title: '眼镜定位讨论' }] : [],
  publications: (target: CompanyWorkspaceTarget) =>
    target.workspaceId === a.workspaceId
      ? [{ id: 'publication-a', title: '产品介绍', status: 'result-unknown' }]
      : [],
  changed: (id: string, revision: number) => {
    changes.push({ id, revision })
  },
})
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'company-workspace-test-')))
  await mkdir(join(root, 'a'))
  await mkdir(join(root, 'b'))
  a = { workspaceId: 'workspace-a', workspacePath: join(root, 'a') }
  b = { workspaceId: 'workspace-b', workspacePath: join(root, 'b') }
  accounts = new CompanyAccountsService(() => a.workspacePath)
  service = new CompanyWorkspaceService(sources())
  changes.length = 0
})
afterEach(async () => {
  await service.dispose()
  await rm(root, { recursive: true, force: true })
})
async function enable(target = a): Promise<void> {
  await service.configure(target, {
    ...scope(),
    workspaceRef: { kind: 'local', path: target.workspacePath },
    enabled: true,
    name: '示例公司',
  })
}

describe('company workspace first loop', () => {
  it('enables only the three necessary tables and restores independently across workspaces', async () => {
    expect((await service.getSnapshot(a, month)).enabled).toBe(false)
    await enable()
    const first = await service.createBusiness(a, create())
    expect(first.projects).toHaveLength(1)
    expect((await service.getSnapshot(b, month)).projects).toHaveLength(0)
    const db = new DatabaseSync(
      join(a.workspacePath, '.cclink-studio/company-workspace/company.sqlite'),
    )
    expect(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all()
        .map((row) => row.name),
    ).toEqual(['business_projects', 'resource_links', 'settings'])
    db.close()
    await service.dispose()
    service = new CompanyWorkspaceService(sources())
    expect((await service.getSnapshot(a, month)).projects[0].id).toBe(first.projects[0].id)
    await service.configure(a, { ...scope(), name: '示例公司', enabled: false })
    expect((await service.getSnapshot(a, month)).projects).toHaveLength(1)
    await expect(service.createBusiness(a, create('关闭后不能写'))).rejects.toMatchObject({
      code: 'NOT_ENABLED',
    })
  })
  it('binds the actual ledger once, rejects stale edits, and never copies financial records', async () => {
    accounts.initialize(month)
    const project = accounts.createProject('眼镜研发')
    const csv = join(a.workspacePath, '流水.csv')
    await writeFile(
      csv,
      '日期,收支,金额,账户,交易对方,用途,交易号\n2026-09-01,支出,180,银行卡,测试服务商,测试服务,order1\n',
    )
    accounts.importFiles({ month, filePaths: [csv] })
    let ledger = accounts.getSnapshot(month)
    const record = ledger.records[0]
    ledger = accounts.updateRecord({
      recordId: record.id,
      expectedVersion: record.version,
      date: record.date,
      recordType: record.recordType,
      direction: record.direction,
      amountMinor: record.amountMinor,
      currency: record.currency,
      account: record.account,
      counterparty: record.counterparty,
      purpose: record.purpose,
      category: '研发服务',
      projectId: project.id,
      documentIds: [],
    })
    accounts.confirmRecord(record.id, ledger.records[0].version)
    await enable()
    const first = await service.createBusiness(a, create('眼镜一代', project.id))
    expect(first.finance.summary?.projectSpending[0].spentMinor).toBe(18000)
    await expect(service.createBusiness(a, create('另一业务', project.id))).rejects.toMatchObject({
      code: 'CONFLICT',
    })
    const original = first.projects[0]
    await service.updateBusiness(a, {
      ...create('新名称', project.id),
      businessId: original.id,
      expectedVersion: original.version,
      archived: false,
    })
    await expect(
      service.updateBusiness(a, {
        ...create('旧表单', project.id),
        businessId: original.id,
        expectedVersion: original.version,
        archived: false,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(accounts.getSnapshot(month).records).toHaveLength(1)
    expect((await service.getSnapshot(b, month)).finance.state).toBe('not-initialized')
  })
  it('keeps original file, conversation and publishing refs and detects missing or changed materials', async () => {
    await enable()
    let snapshot = await service.createBusiness(a, create())
    const businessId = snapshot.projects[0].id
    const file = join(a.workspacePath, '规格.md')
    await writeFile(file, '# 产品规格')
    const input = { ...scope(), businessId }
    snapshot = await service.linkResource(a, { ...input, kind: 'file', target: file })
    expect(snapshot.links[0]).toMatchObject({ target: '规格.md', availability: 'available' })
    await writeFile(file, '# 新版产品规格\n更新内容')
    expect((await service.getSnapshot(a, month)).links[0].availability).toBe('changed')
    await service.linkResource(a, { ...input, kind: 'conversation', target: 'conversation-a' })
    snapshot = await service.linkResource(a, {
      ...input,
      kind: 'publishing',
      target: 'publication-a',
    })
    expect(snapshot.publications[0].status).toBe('result-unknown')
    await rm(file)
    snapshot = await service.getSnapshot(a, month)
    expect(snapshot.links.find((item) => item.kind === 'file')?.availability).toBe('missing')
    await service.unlinkResource(a, { ...input, linkId: snapshot.links[0].id })
    expect((await service.getSnapshot(a, month)).links).toHaveLength(2)
  })
  it('rejects outside files, internal data, symbolic links and cross-company records', async () => {
    await enable()
    await enable(b)
    const snapshot = await service.createBusiness(a, create())
    const input = { ...scope(), businessId: snapshot.projects[0].id, kind: 'file' as const }
    const outside = join(b.workspacePath, '别的公司.md')
    await writeFile(outside, '# B')
    await expect(service.linkResource(a, { ...input, target: outside })).rejects.toMatchObject({
      code: 'WORKSPACE_DENIED',
    })
    const alias = join(a.workspacePath, '外部链接.md')
    await symlink(outside, alias)
    await expect(service.linkResource(a, { ...input, target: alias })).rejects.toMatchObject({
      code: 'WORKSPACE_DENIED',
    })
    await expect(
      service.linkResource(a, {
        ...input,
        target: join(a.workspacePath, '.cclink-studio/company-workspace/company.sqlite'),
      }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_DENIED' })
    await expect(
      service.updateBusiness(b, {
        ...create('跨公司'),
        businessId: input.businessId,
        expectedVersion: 1,
        archived: false,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(
      service.linkResource(b, { ...input, kind: 'conversation', target: 'conversation-a' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
  it('preserves corrupted data and isolates unavailable optional sources', async () => {
    await enable()
    const path = join(a.workspacePath, '.cclink-studio/company-workspace/company.sqlite')
    await writeFile(path, 'corrupted database')
    await expect(
      service.configure(a, { ...scope(), enabled: true, name: '不能覆盖' }),
    ).rejects.toThrow()
    expect(await readFile(path, 'utf8')).toBe('corrupted database')
    expect((await service.getSnapshot(b, month)).enabled).toBe(false)
    await service.dispose()
    service = new CompanyWorkspaceService({
      ...sources(),
      finance: () => null,
      publications: () => null,
      conversations: async () => {
        throw new Error('offline')
      },
    })
    const snapshot = await service.getSnapshot(b, month)
    expect(snapshot.finance.state).toBe('unavailable')
    expect(snapshot.sourceIssues.publications).toBeTruthy()
    expect(snapshot.sourceIssues.conversations).toBeTruthy()
  })
})
