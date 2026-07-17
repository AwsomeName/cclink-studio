import { describe, expect, it } from 'vitest'
import type { BrowserSessionDiagnosticSummary } from '@shared/ipc/browser'
import type { ProjectOpsPlatform } from '@shared/ipc/project-ops'
import {
  formatProjectOperationsLoginStatus,
  resolveProjectOperationsLoginStatus,
} from './project-operations-status'

const zhihu: ProjectOpsPlatform = {
  id: 'zhihu',
  name: '知乎',
  url: 'https://www.zhihu.com',
  browserProfile: 'zhihu',
}

function session(
  partition: string,
  authCookie?: { session: boolean; name?: string },
): BrowserSessionDiagnosticSummary {
  return {
    partition,
    persistent: true,
    cookieStoreFlushed: true,
    cookieCount: authCookie ? 1 : 0,
    persistentCookieCount: authCookie?.session === false ? 1 : 0,
    expiredCookieCount: 0,
    likelyAuthCookies: authCookie
      ? [
          {
            name: authCookie.name ?? 'z_c0',
            domain: '.zhihu.com',
            path: '/',
            secure: true,
            httpOnly: true,
            session: authCookie.session,
            expiresAt: authCookie.session ? undefined : Date.now() + 60_000,
            likelyAuth: true,
          },
        ]
      : [],
    cookieNames: authCookie ? [authCookie.name ?? 'z_c0'] : [],
    recentCookieChanges: [],
  }
}

describe('project operations login status', () => {
  it('prefers the configured profile when it is authenticated', () => {
    const status = resolveProjectOperationsLoginStatus(
      zhihu,
      session('persist:cclink-studio-profile-zhihu', { session: false }),
      session('default', { session: false }),
    )

    expect(status.profileId).toBe('zhihu')
    expect(status.profileMismatch).toBe(false)
    expect(formatProjectOperationsLoginStatus(status)).toBe('已登录并已保存 · zhihu')
  })

  it('detects an authenticated default session when the configured profile is empty', () => {
    const status = resolveProjectOperationsLoginStatus(
      zhihu,
      session('persist:cclink-studio-profile-zhihu'),
      session('default', { session: false }),
    )

    expect(status.profileId).toBeNull()
    expect(status.authenticated).toBe(true)
    expect(status.profileMismatch).toBe(true)
    expect(formatProjectOperationsLoginStatus(status)).toContain('配置为 zhihu')
  })

  it('does not treat unrelated likely-auth cookies as a Zhihu login', () => {
    const unrelated = session('default')
    unrelated.likelyAuthCookies = [
      {
        name: 'SESSIONID',
        domain: 'www.zhihu.com',
        path: '/',
        secure: false,
        httpOnly: false,
        session: true,
        likelyAuth: true,
      },
    ]

    const status = resolveProjectOperationsLoginStatus(
      zhihu,
      session('persist:cclink-studio-profile-zhihu'),
      unrelated,
    )

    expect(status.authenticated).toBe(false)
  })

  it('recognizes the V2EX A2 cookie in its dedicated profile', () => {
    const v2ex: ProjectOpsPlatform = {
      id: 'v2ex',
      name: 'V2EX',
      url: 'https://www.v2ex.com',
      browserProfile: 'v2ex',
    }

    const status = resolveProjectOperationsLoginStatus(
      v2ex,
      session('persist:cclink-studio-profile-v2ex', { session: false, name: 'A2' }),
      session('default'),
    )

    expect(status.authenticated).toBe(true)
    expect(status.profileId).toBe('v2ex')
  })
})
