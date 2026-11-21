import { describe, expect, it } from 'vitest'
import type { Affair } from './affair'
import { formatOwnerDiagnostics, relevantLogs } from './owner-diagnostics'

const id = '11111111-1111-4111-8111-111111111111'
const affair: Affair = {
  id,
  title: '开源芯片 Ibex 调研',
  goal: '交付入门卡',
  sources: [],
  confirmed: true,
  updated: 0,
  attempt: null,
  run: null,
  issue: '',
  result: null,
  method: null,
  research: {
    plan: { scope: '只读 lowRISC/ibex', output: '中文入门卡', repos: ['lowRISC/ibex'] },
    phase: 'done',
    log: ['执行会话 A 已接收本轮委托'],
    chat: [
      { who: '你', text: '私密聊天正文 token=abc123' },
      {
        who: '你',
        text: '为什么？',
        questionId: '22222222-2222-4222-8222-222222222222',
        answerError: '模型超时',
      },
    ],
    docs: [
      {
        repo: 'lowRISC/ibex',
        path: 'rtl/ibex_if_stage.sv',
        startLine: 600,
        text: 'always_ff 证据原文不应出现',
        url: 'https://github.com/lowRISC/ibex/blob/3d524f19/rtl/ibex_if_stage.sv',
        sha: '3d524f19ee8e464b3fb0e29c77dc9ff45934815a',
        at: 0,
      },
    ],
    decisions: [
      {
        kind: 'read',
        reason: '先查流水线',
        workerRunId: 'run-1',
        workerReturned: true,
        filesProcessed: 2,
      },
      { kind: 'deliver', reason: '证据足够' },
    ],
    report: {
      conclusion: '交付正文不应出现',
      items: [{ repo: 'lowRISC/ibex', finding: 'f', quote: 'quote 原文不应出现' }],
    },
  },
  directory: {
    path: '/Users/alice/CCLink Studio/我的空间/Owner 事务/开源芯片 Ibex 调研',
    revision: 9,
    files: ['事务.md', '交付物/Ibex 源码入门卡.md'],
    reportFile: '交付物/Ibex 源码入门卡.md',
    error: '文件待保存：文件已有其他修改',
  },
}

describe('Owner diagnostics', () => {
  const text = formatOwnerDiagnostics({
    affair,
    active: false,
    workerLoading: false,
    grants: [{ id: 'g', label: 'notes', path: '/Users/alice/notes', grantedAt: 0 }],
    runs: { 'run-1': { status: 'succeeded' } },
    logs: [
      {
        timestamp: '2026-11-21T10:00:00Z',
        level: 'warn',
        source: 'renderer',
        message: '[Owner] 执行停止 ' + id,
      },
    ],
    now: Date.UTC(2026, 10, 21),
  })

  it('includes facts needed to diagnose this affair', () => {
    expect(text).toContain('事务 ID：' + id)
    expect(text).toContain('修订号：9')
    expect(text).toContain('待保存：文件待保存：文件已有其他修改')
    expect(text).toContain('运行：run-1 · succeeded')
    expect(text).toContain('rtl/ibex_if_stage.sv · 3d524f19ee · 起始行 600')
    expect(text).toContain('提问失败：模型超时')
    expect(text).toContain('[Owner] 执行停止')
  })

  it('leaves out chat, evidence and deliverable text, and redacts the home user', () => {
    for (const secret of [
      '私密聊天正文',
      'abc123',
      '证据原文不应出现',
      '交付正文不应出现',
      'quote 原文',
      'alice',
    ])
      expect(text).not.toContain(secret)
    expect(text).toContain('~/CCLink Studio/我的空间')
  })

  it('keeps only relevant log lines, newest 50', () => {
    const entries = Array.from({ length: 70 }, (_, i) => ({
      timestamp: '2026-11-21T10:' + String(i).padStart(2, '0') + ':00Z',
      level: 'info' as const,
      source: 'main' as const,
      message: i % 2 ? '[Owner] 已登记目录 ' + i : '[Browser] unrelated ' + i,
    }))
    const kept = relevantLogs(entries, id)
    expect(kept).toHaveLength(35)
    expect(kept.every((e) => e.message.startsWith('[Owner]'))).toBe(true)
  })
})
