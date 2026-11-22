import { describe, expect, it } from 'vitest'
import type { Affair } from './affair'
import { freshResearch } from './research-model'
import { groupOf, sessionStatus, statusChips, waitsForMe } from './owner-status'

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

  describe('execution session row', () => {
    const run = (extra = {}) => ({
      id: crypto.randomUUID(),
      kind: 'read' as const,
      reason: 'r',
      workerRunId: 'run-1',
      workerReturned: true,
      ...extra,
    })
    const research = (decisions: object[], phase = 'reading') =>
      base({ confirmed: true }, { plan, phase, decisions }).research!

    it('waits for Owner only while the hand-back is the latest decision', () => {
      expect(sessionStatus(research([run()]), 'a', false)).toEqual({
        text: '已交回 · 待 Owner 核对',
        tone: 'run',
      })
    })

    it('resolves an unchecked hand-back once Owner delivers on it', () => {
      const r = research([run(), { id: 'd', kind: 'deliver', reason: '证据充分' }], 'done')
      expect(sessionStatus(r, 'a', false)).toEqual({
        text: '已交回 · Owner 已据此交付',
        tone: 'ok',
      })
    })

    it('does not keep waiting after Owner moves on without a recorded check', () => {
      const r = research([run(), run({ worker: 'b', workerChoice: 'new', workerReturned: false })])
      expect(sessionStatus(r, 'a', false).text).toBe('已交回 · 未记录核对结论')
    })

    it('reports a recorded check as Owner checking, not user acceptance', () => {
      const met = sessionStatus(research([run({ verdict: { met: true, note: '' } })]), 'a', false)
      expect(met).toEqual({ text: 'Owner 已核对 · 1 次运行', tone: 'ok' })
      const missed = sessionStatus(
        research([run({ verdict: { met: false, note: '缺 RTL' } })]),
        'a',
        false,
      )
      expect(missed.text).toBe('Owner 核对未通过 · 待补查')
      expect(met.text + missed.text).not.toContain('验收')
    })
  })
})
