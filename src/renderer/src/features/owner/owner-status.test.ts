import { describe, expect, it } from 'vitest'
import type { Affair } from './affair'
import { freshResearch } from './research-model'
import { groupOf, statusChips, waitsForMe } from './owner-status'

const base = (patch: Partial<Affair> = {}, research = {}): Affair => ({
  id: '11111111-1111-4111-8111-111111111111',
  title: '开源芯片 Ibex 调研',
  goal: '交付入门卡',
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
const plan = { scope: 's', output: 'o', repos: ['lowRISC/ibex'] }

describe('Owner list groups and status chips', () => {
  it('counts only affairs that need the user', () => {
    const ready = base({}, { plan, phase: 'ready' })
    expect(groupOf(ready, false)).toBe('confirm')
    expect(waitsForMe(ready, false)).toBe(true)
    const reading = base({ confirmed: true }, { plan, phase: 'reading' })
    expect(groupOf(reading, true)).toBe('active')
    expect(waitsForMe(reading, true)).toBe(false)
    // Interrupted work needs the user to resume; saved-file failures too.
    expect(groupOf(reading, false)).toBe('attention')
    const pending = base(
      { confirmed: true, directory: { path: '/x', revision: 2, files: [], error: '冲突' } },
      { plan, phase: 'done' },
    )
    expect(groupOf(pending, false)).toBe('attention')
    expect(groupOf(base({ confirmed: true }, { plan, phase: 'done' }), false)).toBe('done')
  })

  it('keeps affair state, Owner action and worker run separate', () => {
    const waiting = base(
      { confirmed: true },
      { plan, phase: 'reading', decisions: [{ kind: 'read', reason: 'r', workerRunId: 'run-1' }] },
    )
    expect(statusChips(waiting, true, true)).toMatchObject({
      state: '进行中',
      owner: '等 A 交回',
      worker: 'A · 第 1 次运行 · 运行中',
    })
    const checking = base(
      { confirmed: true },
      {
        plan,
        phase: 'checking',
        decisions: [{ kind: 'read', reason: 'r', workerRunId: 'run-1', workerReturned: true }],
      },
    )
    expect(statusChips(checking, true, false)).toMatchObject({
      owner: '核对证据',
      worker: 'A · 第 1 次运行 · 已完成',
    })
    expect(statusChips(base({}, { plan, phase: 'ready' }), false, false)).toMatchObject({
      tone: 'amber',
      owner: '等你确认约定',
      worker: '尚未派工',
    })
  })
})
