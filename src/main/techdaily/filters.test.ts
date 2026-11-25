import { describe, expect, it } from 'vitest'
import type { TechDailyDomain } from '../../shared/techdaily/techdaily-types'
import { filterResults, guardPass, newFunnel, type KeptItem, type RawSearchItem } from './filters'
import { articleKey } from './url-rules'

const modelCap: TechDailyDomain = {
  id: 'model_cap',
  name: '模型能力',
  queries: { zh: ['DeepSeek 发布'], en: [] },
  match: [],
}
const aiChip: TechDailyDomain = {
  id: 'ai_chip',
  name: 'AI 芯片与显卡',
  queries: { zh: ['国产 GPU'], en: [] },
  match: [],
}

describe('guardPass (Argus 2026-09-21 audit cases)', () => {
  it('blocks an undated brand-only landing page', () => {
    expect(
      guardPass('DeepSeek | Into the Unknown', '', null, 'DeepSeek 发布', 'zh', modelCap),
    ).toBe(false)
  })

  it('passes a brand title with a scene word even undated', () => {
    expect(guardPass('DeepSeek 发布 V4.1 Flash', '', null, 'DeepSeek 发布', 'zh', modelCap)).toBe(
      true,
    )
  })

  it('topic query: content hit passes only with a date', () => {
    const title = '寒武纪思元590量产'
    const content = '国产 GPU 厂商寒武纪宣布……'
    expect(guardPass(title, content, '2026-11-24', '国产 GPU', 'zh', aiChip)).toBe(true)
    expect(guardPass(title, content, null, '国产 GPU', 'zh', aiChip)).toBe(false)
  })

  it('stop words alone never satisfy the guard', () => {
    expect(
      guardPass('新品发布会门票', '', '2026-11-24', '机器人 发布', 'zh', {
        ...aiChip,
        queries: { zh: [], en: [] },
      }),
    ).toBe(false)
  })
})

describe('filterResults', () => {
  const options = {
    today: '2026-11-25',
    freshnessDays: 3,
    keepUndated: true,
    excludeKeywords: ['招聘', '华为'],
    extraDenylist: ['spam.example'],
    engineAllowlist: ['bing', 'bing news', 'duckduckgo news'],
  }
  const item = (over: Partial<RawSearchItem>): RawSearchItem => ({
    title: 'DeepSeek 发布新模型',
    url: 'https://news.example.com/2026/11-24/1.html',
    content: '',
    published: null,
    engines: ['bing'],
    ...over,
  })

  it('counts every gate and merges the same URL inside a domain', () => {
    const seen = new Map<string, KeptItem>()
    const funnel = newFunnel(modelCap)
    filterResults(
      [
        item({}),
        item({
          url: 'https://news.example.com/2026/11-24/1.html?utm_source=x',
          engines: ['duckduckgo news'],
        }),
        item({ url: 'ftp://x' }),
        item({ url: 'https://baike.baidu.com/item/DeepSeek' }),
        item({ url: 'https://spam.example/2026/11-24/a' }),
        item({ url: 'https://a.com/2026/11-24/2', engines: ['google'] }),
        item({ url: 'https://a.com/2026/11-24/3', title: 'DeepSeek 发布招聘' }),
        item({ url: 'https://a.com/2026/11-01/4' }),
        item({ url: 'https://a.com/x5', title: '无关标题' }),
      ],
      'DeepSeek 发布',
      'zh',
      modelCap,
      options,
      seen,
      funnel,
      articleKey,
    )
    expect(funnel).toMatchObject({
      raw: 9,
      invalid: 1,
      denied: 2,
      engineRejected: 1,
      excluded: 1,
      stale: 1,
      guarded: 1,
      mergedInDomain: 1,
    })
    const [kept] = [...seen.values()]
    expect(seen.size).toBe(1)
    expect(kept.engines.sort()).toEqual(['bing', 'duckduckgo news'])
    expect(kept.date).toBe('2026-11-24')
  })

  it('applies no engine rule for providers without engines and can drop undated', () => {
    const seen = new Map<string, KeptItem>()
    const funnel = newFunnel(modelCap)
    filterResults(
      [item({ engines: null }), item({ url: 'https://b.com/x', engines: null })],
      'DeepSeek 发布',
      'zh',
      modelCap,
      { ...options, engineAllowlist: null, keepUndated: false },
      seen,
      funnel,
      articleKey,
    )
    expect(seen.size).toBe(1)
    expect(funnel.stale).toBe(1)
  })
})
