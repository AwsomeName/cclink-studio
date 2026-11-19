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
  it('文件读取只接受仓库内的路径和提交版本', () => {
    const sha = 'a'.repeat(40)
    for (const path of ['../secrets', '/etc/passwd', 'doc/%2e%2e/file', 'doc/test?token=x']) {
      expect(() => ownerResearchIpc.readFile.parseArgs(['lowRISC/ibex', path, '', sha])).toThrow()
    }
    expect(() =>
      ownerResearchIpc.findPaths.parseArgs(['lowRISC/ibex', ['rtl'], 'ref?other=1']),
    ).toThrow()
    expect(
      ownerResearchIpc.readFile.parseArgs([
        'lowRISC/ibex',
        'rtl/ibex_if_stage.sv',
        'always_ff',
        sha,
      ]),
    ).toHaveLength(4)
  })
  it('同仓库的概览不能给另一个源码文件的结论作引文', () => {
    const repo = 'a/b',
      base = 'https://github.com/a/b/blob/' + 'a'.repeat(40) + '/'
    const docs = ['README.md', 'rtl/core.sv'].map((path, i) => ({
      repo,
      path,
      url: base + path,
      sha: 'a'.repeat(40),
      at: 0,
      text: ['project overview', 'always_ff @(posedge clk_i)'][i],
    }))
    const r = {
      ...freshResearch(),
      plan: { scope: '定位和寄存器', output: '入门卡', repos: [repo] },
      docs,
    }
    const items = docs.map((d) => ({ repo, url: d.url, finding: d.path, quote: d.text }))
    r.docs[1] = { ...docs[1], text: '// register\n' + docs[1].text }
    const snapshots = r.docs.map((d) => ({ ...d, startLine: 120 }))
    const checked = checkReport(
      { ...r, docs: snapshots },
      {
        conclusion: '入门卡',
        items: [items[0], { ...items[1], url: docs[1].url + '#L999', line: 999 }],
      },
    )
    expect(checked.items[1]).toMatchObject({ url: docs[1].url, line: 121 })
    expect(() =>
      checkReport(r, {
        conclusion: '入门卡',
        items: [items[0], { ...items[1], url: docs[0].url }],
      }),
    ).toThrow()
  })
  it('重复语句不能错误定位到首个匹配行，重叠快照的同一行仍可引用', () => {
    const repo = 'a/b',
      url = 'https://github.com/a/b/blob/' + 'a'.repeat(40) + '/rtl.sv'
    const doc = { repo, url, text: 'flag <= value;', at: 0, sha: 'a'.repeat(40), startLine: 65 }
    const r = {
      ...freshResearch(),
      plan: { scope: '源码', output: '卡片', repos: [repo] },
      docs: [doc, { ...doc, startLine: 64, text: '// decode\nflag <= value;' }],
    }
    const report = {
      conclusion: '寄存器',
      items: [{ repo, url, finding: '使能', quote: doc.text }],
    }
    expect(checkReport(r, report).items[0].line).toBe(65)
    r.docs.push({ ...doc, startLine: 98 })
    expect(() => checkReport(r, report)).toThrow('多处出现')
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
