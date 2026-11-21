import { describe, expect, it } from 'vitest'
import { assignWorker, decisionTitle, workersOf, type Research } from './research'

const base = (patch: Partial<Research> = {}): Research => ({
  plan: { scope: 's', output: 'o', repos: ['lowRISC/ibex', 'openhwgroup/cva6'] },
  phase: 'checking',
  log: [],
  chat: [],
  docs: [],
  report: null,
  ...patch,
})
const sheet = (worker: { use: string } | { new: string }) => ({
  worker,
  workerReason: '理由',
  ask: '本步问题',
})

describe('Owner execution sessions', () => {
  it('opens A first, continues dependent work, and opens B for independent work', () => {
    const r = base()
    expect(assignWorker(r, sheet({ new: 'Ibex 定位与流水线' }), 1)).toEqual({
      key: 'a',
      choice: 'new',
    })
    expect(assignWorker(r, sheet({ use: 'a' }))).toEqual({ key: 'a', choice: 'continue' })
    expect(assignWorker(r, sheet({ new: 'CVA6 定位' }), 2)).toEqual({ key: 'b', choice: 'new' })
    expect(r.workers!.map((w) => [w.key, w.purpose])).toEqual([
      ['a', 'Ibex 定位与流水线'],
      ['b', 'CVA6 定位'],
    ])
  })

  it('treats a first "continue" as opening A and rejects unknown sessions later', () => {
    const r = base()
    expect(assignWorker(r, sheet({ use: 'a' }))).toEqual({ key: 'a', choice: 'new' })
    expect(() => assignWorker(r, sheet({ use: 'c' }))).toThrow(/不存在/)
  })

  it('keeps legacy single-A records readable and continues them', () => {
    const r = base({ decisions: [{ kind: 'read', reason: 'r', workerRunId: 'run-1' }] })
    expect(workersOf(r).map((w) => w.key)).toEqual(['a'])
    expect(decisionTitle(r.decisions![0])).toBe('委派会话 A')
    expect(assignWorker(r, sheet({ use: 'a' }))).toEqual({ key: 'a', choice: 'continue' })
    expect(r.workers).toHaveLength(1)
  })

  it('caps an affair at eight execution sessions', () => {
    const r = base()
    for (let i = 0; i < 8; i++) assignWorker(r, sheet({ new: 'task ' + i }))
    expect(() => assignWorker(r, sheet({ new: 'one more' }))).toThrow(/上限 8/)
  })

  it('labels decisions by session and choice', () => {
    expect(decisionTitle({ kind: 'more', worker: 'b', workerChoice: 'new' })).toBe('新开执行会话 B')
    expect(decisionTitle({ kind: 'more', worker: 'a', workerChoice: 'continue' })).toBe(
      '续用执行会话 A',
    )
  })
})
