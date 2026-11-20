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
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { force: true, recursive: true })))
})
it('stores evidence before delivery, preserves an edited file and finishes pending delivery after restart', async () => {
  const { service, affair } = await setup(),
    store = service()
  const first = await store.save(affair, 0),
    path = first.directory!.path
  expect((await readdir(path)).sort()).toEqual(['.owner.json', '事务.md', '工作记录.md'].sort())
  const repo = 'a/b',
    url = 'https://github.com/a/b/blob/' + '1'.repeat(40) + '/rtl.sv'
  affair.confirmed = true
  const r = affair.research!
  r.phase = 'reading'
  r.plan = { scope: 'RTL', output: '入门卡', repos: [repo] }
  r.docs = [
    { repo, path: 'rtl.sv', sha: 'a'.repeat(40), url, at: 1, text: 'q <= d;', startLine: 80 },
  ]
  r.decisions = [{ kind: 'more', reason: '需要源码核对' }]
  const second = await store.save(affair, 1)
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
  affair.confirmed = true
  affair.research = {
    ...affair.research!,
    plan: { scope: '寄存器', output: '入门卡', repos: [repo] },
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
  const blocked = await service().save(affair, first.directory!.revision)
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
