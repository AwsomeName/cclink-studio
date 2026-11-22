import { describe, expect, it } from 'vitest'
import { sourceWindow } from './source-window'
it('lets A follow a register from its declaration to a later assignment using the real file line', () => {
  const lines = Array.from({ length: 900 }, (_, i) => '// subsequent source line ' + (i + 1))
  lines[5] = 'logic flag_q;'
  lines[745] = '      flag_q    <= next_value;'
  const raw = lines.join('\n')
  const first = sourceWindow(raw, 'flag_q')
  expect(first.text).not.toContain('next_value')
  expect(first.locations).toContain('@L746 flag_q    <= next_value;')
  const next = sourceWindow(raw, '@L746')
  expect(next.text.split('\n')[746 - next.startLine]).toBe(lines[745])
  expect(sourceWindow(raw, 'flag_q <= next_value').matchedAnchor).toBe(true)
  expect(() => sourceWindow(raw, '@L999')).toThrow('末尾')
})

import { githubRefusal, renamedRepositoryTarget } from './read-public-readme'
describe('GitHub rename redirect', () => {
  const base = 'https://api.github.com/repos/openhwgroup/cva6/readme'
  it('follows only a same-host /repositories/<id> hop', () => {
    expect(
      renamedRepositoryTarget('https://api.github.com/repositories/118652371/readme', base),
    ).toBe('https://api.github.com/repositories/118652371/readme')
    expect(renamedRepositoryTarget('/repositories/1/commits?per_page=1', base)).toBe(
      'https://api.github.com/repositories/1/commits?per_page=1',
    )
    expect(renamedRepositoryTarget('https://evil.example/repositories/1', base)).toBeUndefined()
    expect(renamedRepositoryTarget('https://api.github.com/user', base)).toBeUndefined()
    expect(renamedRepositoryTarget(null, base)).toBeUndefined()
  })
})

describe('GitHub refusals are explained, never read as missing material', () => {
  const now = 1_800_000_000_000
  const headers = (h: Record<string, string>) => new Headers(h)
  it('names exhausted quota, reset time and the existing token setting when unauthenticated', () => {
    const message = githubRefusal(
      403,
      headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(now / 1000 + 600) }),
      false,
      now,
    )
    expect(message).toContain('公开接口本小时额度已用完，约 10 分钟后恢复')
    expect(message).toContain('设置 → API 连接 → GitHub')
  })
  it('drops the token hint once the configured GitHub credential is used', () => {
    const message = githubRefusal(429, headers({ 'x-ratelimit-remaining': '0' }), true, now)
    expect(message).toContain('账号接口本小时额度已用完')
    expect(message).not.toContain('配置 Token')
  })
  it('explains secondary rate limits that still have quota left', () => {
    expect(
      githubRefusal(403, headers({ 'x-ratelimit-remaining': '4000', 'retry-after': '90' }), true),
    ).toContain('暂时限制了请求频率，约 2 分钟后恢复')
  })
  it('reports a rejected token instead of silently degrading', () => {
    expect(githubRefusal(401, headers({}), true)).toContain('GitHub Token 无效或已过期')
    expect(githubRefusal(401, headers({}), false)).toBeUndefined()
  })
  it('leaves ordinary failures to the caller', () => {
    expect(githubRefusal(404, headers({}), true)).toBeUndefined()
    expect(githubRefusal(403, headers({ 'x-ratelimit-remaining': '12' }), false)).toBeUndefined()
  })
})
