import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import type { AffairRecord } from '../../shared/owner/affair'
import { AffairDirectoryService } from './affair-directory'

const dirs: string[] = []
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'owner-directory-'))
  dirs.push(dir)
  const service = () => new AffairDirectoryService(join(dir, 'index'), async () => dir)
  const affair: AffairRecord = {
    id: randomUUID(),
    title: 'Ibex',
    goal: '寄存器入门卡',
    sources: [],
    confirmed: false,
    updated: 1,
    attempt: null,
    run: null,
    issue: '',
    result: null,
    method: null,
    research: { plan: null, phase: 'draft', chat: [], log: [], docs: [], report: null },
  }
  return { service, affair }
}
async function confirmPlan(store: AffairDirectoryService, a: AffairRecord, repo: string) {
  a.research!.plan = { scope: 'RTL', output: '入门卡', repos: [repo] }
  a.research!.phase = 'ready'
  const proposal = await store.save(a, 1)
  const confirmed = await store.confirm(a.id, proposal.directory!.revision)
  Object.assign(a, confirmed)
  return confirmed.directory!.revision
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { force: true, recursive: true })))
})
it('stores evidence before delivery, preserves an edited file and finishes pending delivery after restart', async () => {
  const { service, affair } = await setup(),
    store = service()
  const first = await store.save(affair, 0),
    path = first.directory!.path
  expect((await readdir(path)).sort()).toEqual(
    ['.owner.json', '事务.md', '事务配置.md', '调度.md', '工作记录.md'].sort(),
  )
  const repo = 'a/b',
    url = 'https://github.com/a/b/blob/' + '1'.repeat(40) + '/rtl.sv'
  const revision = await confirmPlan(store, affair, repo)
  const r = affair.research!
  r.phase = 'reading'
  r.plan = { scope: 'RTL', output: '入门卡', repos: [repo] }
  r.docs = [
    { repo, path: 'rtl.sv', sha: 'a'.repeat(40), url, at: 1, text: 'q <= d;', startLine: 80 },
  ]
  r.decisions = [{ kind: 'more', reason: '需要源码核对', workerTicket: randomUUID() }]
  const second = await store.save(affair, revision)
  expect(await store.preview(affair.id, '调度.md')).toContain('尚未取得 A 的运行编号')
  expect(await readFile(join(path, '工作记录.md'), 'utf8')).toContain(
    '续用会话 A 补查：需要源码核对',
  )
  expect(await store.preview(affair.id, '资料/01-rtl.sv.md')).toContain('q <= d;')
  await expect(store.save(affair, 1)).rejects.toThrow('版本')
  await mkdir(join(path, '交付物'))
  const target = join(path, '交付物', '入门卡.md')
  await writeFile(target, '用户已有文件')
  r.phase = 'done'
  r.report = { conclusion: '# 入门卡', items: [{ repo, url, finding: '采样', quote: 'q <= d;' }] }
  const pending = await store.save(affair, second.directory!.revision)
  expect(pending.directory!.error).toContain('其他修改')
  expect(await readFile(target, 'utf8')).toBe('用户已有文件')
  const restarted = service()
  expect((await restarted.list()).items[0].directory!.error).toContain('其他修改')
  await rename(target, target + '.bak')
  const done = await restarted.retry(affair.id)
  expect(done.directory!.error).toBeUndefined()
  expect(await readFile(target, 'utf8')).toContain('#L80')
  expect(await restarted.retry(affair.id)).toEqual(done)
})
it('keeps independent directory identities for equal titles and refuses unknown preview files', async () => {
  const { service, affair } = await setup(),
    store = service()
  const first = await store.save(affair, 0)
  const next = await store.save({ ...affair, id: randomUUID() }, 0)
  expect(first.directory!.path).not.toBe(next.directory!.path)
  await expect(store.preview(affair.id, '.owner.json')).rejects.toThrow('不属于')
})

it('recovers the exact final report when the destination journal was unreadable before saving', async () => {
  const { service, affair } = await setup()
  const first = await service().save(affair, 0)
  const folder = first.directory!.path
  const marker = join(folder, '.owner.json')
  const repo = 'lowRISC/ibex'
  const url = 'https://github.com/lowRISC/ibex/blob/' + '1'.repeat(40) + '/rtl/example.sv'
  const revision = await confirmPlan(service(), affair, repo)
  affair.research = {
    ...affair.research!,
    plan: affair.research!.plan,
    phase: 'done',
    docs: [
      {
        repo,
        url,
        at: 1,
        path: 'rtl/example.sv',
        sha: 'a'.repeat(40),
        startLine: 90,
        text: 'always_ff @(posedge clk)\n  q <= d;',
      },
    ],
    report: {
      conclusion: '# 入门卡\n\n示例寄存器',
      items: [{ repo, url, finding: '更新赋值', quote: 'q <= d;' }],
    },
  }
  await rename(marker, marker + '.bak')
  await mkdir(marker)
  const blocked = await service().save(affair, revision)
  expect(blocked.directory?.error).toBeTruthy()
  const restarted = service()
  expect((await restarted.list()).items[0].research).toEqual(blocked.research)
  expect((await restarted.retry(affair.id)).directory?.error).toBeTruthy()
  await rm(marker, { recursive: true })
  await rename(marker + '.bak', marker)
  const saved = await restarted.retry(affair.id)
  expect(saved.directory?.error).toBeUndefined()
  expect(saved.research).toEqual(affair.research)
  expect(await readFile(join(folder, saved.directory!.reportFile!), 'utf8')).toContain(
    '[本地证据](../' + encodeURI('资料/01-example.sv.md') + '#L91)',
  )
  expect(await service().retry(affair.id)).toEqual(saved)
})

it('binds approval to a persisted proposal and rejects worker activity or scope changes outside it', async () => {
  const { service, affair: a } = await setup(),
    store = service()
  const created = await store.save(a, 0)
  await expect(store.confirm(a.id, 1)).rejects.toThrow('没有等待确认')
  const r = a.research!
  r.phase = 'reading'
  await expect(store.save(a, 1)).rejects.toThrow('确认前')
  r.phase = 'ready'
  r.plan = { scope: '只查 RTL', output: '卡片', repos: ['lowRISC/ibex'] }
  await store.save(a, 1)
  await expect(store.confirm(a.id, 1)).rejects.toThrow('版本')
  await expect(store.save({ ...a, confirmed: true }, 2)).rejects.toThrow('先确认')
  const confirmed = await store.confirm(a.id, 2)
  await expect(store.confirm(a.id, 2)).rejects.toThrow('版本')
  expect(await store.preview(a.id, '事务配置.md')).toContain(created.directory!.path)
  r.plan.output = '擅自更改交付物'
  await expect(store.save({ ...a, confirmed: true }, 3)).rejects.toThrow('改写')
  confirmed.research!.decisions = [
    { kind: 'read', reason: '查源码', requests: [{ repo: 'outside/scope', terms: [] }] },
  ]
  await expect(store.save(confirmed, 3)).rejects.toThrow('超出')
})
it('only lists committed files for older affairs; explicitly backfills without changing the research or overwriting user files', async () => {
  const { service, affair: a } = await setup(),
    store = service()
  const folder = (await store.save(a, 0)).directory!.path
  const marker = join(folder, '.owner.json'),
    j = JSON.parse(await readFile(marker, 'utf8'))
  j.version = 1
  for (const name of ['事务配置.md', '调度.md']) {
    delete j.hashes[name]
    await rm(join(folder, name))
  }
  await writeFile(marker, JSON.stringify(j))
  await writeFile(join(folder, '调度.md'), '我的旧笔记')
  expect((await store.list()).items[0].directory!.files).not.toContain('调度.md')
  await expect(store.preview(a.id, '调度.md')).rejects.toThrow('不属于')
  const previousRevision = (await store.list()).items[0].directory!.revision
  const retry = await store.retry(a.id)
  expect(retry.directory!.revision).toBe(previousRevision)
  expect(retry.directory!.error).toBeUndefined()
  await expect(store.upgrade(a.id, previousRevision + 1)).rejects.toThrow('版本')
  const conflict = await store.upgrade(a.id, previousRevision)
  expect(conflict.directory!.error).toContain('其他修改')
  expect(await readFile(join(folder, '调度.md'), 'utf8')).toBe('我的旧笔记')
  await rename(join(folder, '调度.md'), join(folder, '个人笔记.md'))
  const saved = await service().retry(a.id)
  expect(saved.directory!.error).toBeUndefined()
  expect(saved.research).toEqual(a.research)
  expect(saved.directory!.files).toContain('调度.md')
  expect(await store.retry(a.id)).toEqual(saved)
})

it('replays a pre-upgrade confirmation intent while keeping ordinary writes behind the approval gate', async () => {
  const { service, affair: a } = await setup()
  const store = service()
  await store.save(a, 0)
  a.research!.phase = 'ready'
  a.research!.plan = { scope: 'RTL', output: '卡片', repos: ['lowRISC/ibex'] }
  const ready = await store.save(a, 1)
  const root = join(ready.directory!.path, '..', '..')
  a.confirmed = true
  a.research!.phase = 'checking'
  a.research!.chat.push({ who: '你', text: '确认目标和交付物，开始调研。' })
  await writeFile(
    join(root, 'index', a.id + '.pending.json'),
    JSON.stringify({ revision: 2, record: a }),
  )
  const restored = await service().retry(a.id)
  expect(restored.directory!.error).toBeUndefined()
  expect(restored.confirmed).toBe(true)
  expect(restored.research!.decisions).toBeUndefined()
  expect(await store.preview(a.id, '事务.md')).toContain('revision: 3')
  expect(await store.retry(a.id)).toEqual(restored)
})

it('finishes partially written v1 Markdown in its original format before upgrading', async () => {
  const { service, affair: a } = await setup()
  const store = service(),
    initial = await store.save(a, 0),
    folder = initial.directory!.path
  const marker = join(folder, '.owner.json'),
    journal = JSON.parse(await readFile(marker, 'utf8'))
  journal.version = 1
  journal.pending = true
  journal.record.goal = '旧版已经写了一半的交办'
  for (const name of ['调度.md', '事务配置.md']) {
    delete journal.hashes[name]
    await rm(join(folder, name))
  }
  const legacySummary =
    [
      '# Ibex',
      '## 目标',
      journal.record.goal,
      '## 待确认的约定',
      '等待 Owner 提出范围与交付物。',
      '## 最近一次记录的状态',
      '待交办 · 在右侧告诉 Owner 想调研什么',
      '[查看工作记录](工作记录.md)',
    ].join('\n\n') + '\n'
  await writeFile(join(folder, '事务.md'), legacySummary)
  await writeFile(marker, JSON.stringify(journal))
  const recovered = await service().retry(a.id)
  expect(recovered.directory!.error).toBeUndefined()
  expect(await store.preview(a.id, '事务.md')).toBe(legacySummary)
  expect(recovered.directory!.files).not.toContain('调度.md')
  const upgraded = await service().upgrade(a.id, recovered.directory!.revision)
  expect(upgraded.directory!.files).toContain('调度.md')
  expect(upgraded.research).toEqual(recovered.research)
})
