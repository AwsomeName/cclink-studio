import { describe, expect, it } from 'vitest'
import { inferTaskIntent } from './resource-context'

describe('agent resource context intent inference', () => {
  it('recognizes Zhihu login tasks with expected hosts', () => {
    expect(inferTaskIntent('登录我的知乎')).toEqual({
      kind: 'browser_login',
      confidence: 'high',
      targetSite: 'zhihu',
      expectedHosts: ['www.zhihu.com', 'zhihu.com'],
      preferredUrl: 'https://www.zhihu.com/signin',
      reason: '用户要求登录 zhihu',
    })
  })

  it('recognizes publish workflows as browser publish tasks', () => {
    const intent = inferTaskIntent('帮我去微信公众号投稿')
    expect(intent.kind).toBe('browser_publish')
    expect(intent.targetSite).toBe('wechat_mp')
    expect(intent.expectedHosts).toEqual(['mp.weixin.qq.com'])
  })

  it('keeps vague messages as general tasks', () => {
    expect(inferTaskIntent('我们继续看看方案')).toMatchObject({
      kind: 'general',
      confidence: 'low',
    })
  })
})
