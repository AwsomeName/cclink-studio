import { describe, it, expect } from 'vitest'
import { freshResearch, checkReport, planSchema } from './research-model'
import { ownerResearchIpc } from '@shared/ipc/owner-research'
describe('公开调研的确认与交付边界', () => {
  it('拒绝 URL、额外参数、私有路径和重复仓库', () => {
    for (const bad of ['https://example.com', 'a/../escape', 'a/b?ref=main', '127.0.0.1:8080'])
      expect(() => ownerResearchIpc.readReadme.parseArgs([bad])).toThrow()
    expect(() => ownerResearchIpc.readReadme.parseArgs(['lowRISC/ibex', 'auth'])).toThrow()
    expect(() => planSchema.parse({ scope: 'x', output: 'y', repos: ['X/Y', 'x/y'] })).toThrow()
  })
  it('要求每个已约定仓库都有属于自己的原文证据', () => {
    const repos = ['a/x', 'a/y'],
      r = {
        ...freshResearch(),
        plan: { scope: '对比', output: '报告', repos },
        docs: repos.map((repo, i) => ({
          repo,
          text: 'processor design ' + i,
          url: 'https://github.com/' + repo,
          sha: 'a'.repeat(40),
          at: 123,
        })),
      }
    const items = repos.map((repo, i) => ({
      repo,
      finding: '定位',
      quote: 'processor design ' + i,
    }))
    expect(checkReport(r, { conclusion: '比较', items }).items).toHaveLength(2)
    expect(() => checkReport(r, { conclusion: 'x', items: [items[0], items[0]] })).toThrow()
    expect(() =>
      checkReport(r, {
        conclusion: 'x',
        items: [items[0], { ...items[1], quote: items[0].quote }],
      }),
    ).toThrow()
  })
})
