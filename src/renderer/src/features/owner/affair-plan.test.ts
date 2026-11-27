import { describe, expect, it } from 'vitest'
import type { Affair } from './affair'
import { freshResearch } from './research-model'
import { affairSteps, authorization, pendingCount } from './affair-plan'

const folder = 'folder:22222222-2222-4222-8222-222222222222'
const base = (patch: Partial<Affair> = {}, research = {}): Affair => ({
  id: '11111111-1111-4111-8111-111111111111',
  title: '对比笔记与 Ibex',
  goal: '对比我本地的设计笔记和 Ibex 的实现',
  sources: [],
  confirmed: false,
  updated: 0,
  attempt: null,
  run: null,
  issue: '',
  result: null,
  method: null,
  research: { ...freshResearch(), ...research },
  directory: { path: '/x', revision: 1, files: [] },
  ...patch,
})
const plan = {
  scope: 's',
  output: 'o',
  repos: ['lowRISC/ibex'],
  folders: [{ key: folder, label: 'chip-notes' }],
}

describe('affair authorization and steps', () => {
  it('puts agreed sources under direct, other files under ask and publishing under never', () => {
    const { caps, unused } = authorization(base({}, { plan, phase: 'ready' }))
    const tier = (t: string) => caps.filter((c) => c.tier === t).map((c) => c.name + ':' + c.scope)
    expect(tier('direct')).toEqual([
      '读本地资料:chip-notes（只读）',
      '查公开资料:GitHub lowRISC/ibex',
      '写事务目录:本事务目录',
    ])
    expect(tier('ask')).toEqual(['读约定外的本地文件:逐个文件问你'])
    expect(tier('never')).toEqual(['修改本地资料:chip-notes', '对外发布或发送:任何内容'])
    expect(unused).toEqual(['网站账号', '运行命令', '公开网页'])
  })

  it('shows each step with its runtime, capabilities and state, including skips', () => {
    const a = base(
      { confirmed: true },
      {
        plan,
        phase: 'decide',
        workers: [{ key: 'a', purpose: '核对假设', reason: '首次', agent: 'codex' }],
        decisions: [
          {
            kind: 'read',
            reason: 'r',
            ask: '逐条核对 5 条假设',
            doneWhen: '每条结论带行号',
            requests: [
              { repo: folder, terms: [] },
              { repo: 'lowRISC/ibex', terms: ['WritebackStage'] },
            ],
            workerReturned: true,
          },
        ],
        skips: [
          {
            id: '33333333-3333-4333-8333-333333333333',
            kind: 'file',
            path: '/notes/decoder-review.md',
            why: 'timeout',
            at: 1,
            status: 'skipped',
            required: true,
          },
        ],
      },
    )
    const steps = affairSteps(a, { ownerRuntime: 'Claude Code', active: false })
    expect(steps.map((s) => [s.who, s.runtime, s.state])).toEqual([
      ['Owner', 'Claude Code', 'done'],
      ['执行', 'Codex', 'done'],
      ['执行', 'Studio 读取', 'skip'],
      ['Studio 核验', '—', 'wait'],
    ])
    expect(steps[1].can).toEqual(['读本地资料 · 本地 chip-notes', '查公开资料 · lowRISC/ibex'])
    expect(steps[2].required).toBe(true)
    expect(pendingCount(a, false, 0)).toBe(1)
  })

  it('counts the agreement confirmation and live approval prompts as waiting on the user', () => {
    const a = base({}, { plan, phase: 'ready' })
    expect(affairSteps(a, { active: false })[0].state).toBe('wait')
    expect(pendingCount(a, true, 1)).toBe(2)
  })
})
