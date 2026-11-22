import { describe, expect, it } from 'vitest'
import {
  checkReport,
  citationCounts,
  citationPlace,
  folderKey,
  localSourceUrl,
  planSchema,
  planSources,
  researchRequest,
  type Research,
} from './research'

const grant = '33333333-3333-4333-8333-333333333333'
const notes = folderKey(grant)
const gh = 'https://github.com/lowRISC/ibex/blob/' + '1'.repeat(40) + '/rtl/ibex_if_stage.sv'
const plan = {
  scope: '对比笔记与实现',
  output: '对比简报',
  repos: ['lowRISC/ibex'],
  folders: [{ key: notes, label: 'chip-notes' }],
}
const research = (): Research => ({
  plan,
  phase: 'checking',
  chat: [],
  log: [],
  report: null,
  docs: [
    {
      repo: notes,
      path: '设计/流水线笔记.md',
      startLine: 10,
      text: '# 取指\n假设：取指使用两级预取缓冲。',
      url: localSourceUrl(grant, '设计/流水线笔记.md'),
      sha: 'b'.repeat(64),
      at: 1,
    },
    {
      repo: 'lowRISC/ibex',
      path: 'rtl/ibex_if_stage.sv',
      startLine: 200,
      text: 'module ibex_if_stage;\n  ibex_prefetch_buffer prefetch_buffer_i (',
      url: gh,
      sha: 'a'.repeat(40),
      at: 1,
    },
  ],
})

describe('local folders as research sources', () => {
  it('accepts folder-only, repo-only and mixed agreements but not an empty one', () => {
    expect(planSources(planSchema.parse(plan))).toEqual(['lowRISC/ibex', notes])
    expect(planSchema.safeParse({ ...plan, repos: [] }).success).toBe(true)
    expect(planSchema.safeParse({ ...plan, folders: undefined }).success).toBe(true)
    expect(planSchema.safeParse({ ...plan, repos: [], folders: [] }).success).toBe(false)
    expect(
      planSchema.safeParse({ ...plan, folders: [{ key: '/Users/x', label: 'x' }] }).success,
    ).toBe(false)
    expect(researchRequest.safeParse({ repo: notes, terms: ['流水线'] }).success).toBe(true)
  })

  it('verifies local and GitHub citations, locates lines and requires every source', () => {
    const r = research()
    const report = checkReport(r, {
      conclusion: '# 对比',
      items: [
        { repo: notes, finding: '笔记假设两级预取', quote: '取指使用两级预取缓冲' },
        {
          repo: 'lowRISC/ibex',
          url: gh,
          finding: '实现有预取缓冲',
          quote: 'ibex_prefetch_buffer prefetch_buffer_i',
        },
      ],
    })
    expect(report.items.map((i) => i.line)).toEqual([11, 201])
    expect(citationCounts(report.items)).toEqual({ local: 1, github: 1 })
    expect(citationPlace(r, report.items[0])).toBe('本地 chip-notes/设计/流水线笔记.md 第 11 行')
    expect(citationPlace(r, report.items[1])).toBe(gh + '#L201')
    expect(() =>
      checkReport(r, {
        conclusion: '# 对比',
        items: [
          {
            repo: 'lowRISC/ibex',
            url: gh,
            finding: 'x',
            quote: 'ibex_prefetch_buffer prefetch_buffer_i',
          },
        ],
      }),
    ).toThrow('没有覆盖本次研究的所有来源')
    expect(() =>
      checkReport(r, {
        conclusion: '# 对比',
        items: [
          { repo: notes, finding: '编造', quote: '取指使用三级预取缓冲' },
          {
            repo: 'lowRISC/ibex',
            url: gh,
            finding: 'x',
            quote: 'ibex_prefetch_buffer prefetch_buffer_i',
          },
        ],
      }),
    ).toThrow('本地 chip-notes：引文与标明的来源不匹配')
  })
})
