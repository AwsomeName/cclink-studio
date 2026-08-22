import { describe, expect, it } from 'vitest'
import type { BrowserSessionDiagnosticSummary } from '@shared/ipc/browser'
import {
  formatWebResourceLoginStatus,
  getWebResourceLoginStatus,
  observeWebResourceLogin,
} from './web-resource-view-model'

function summary(
  options: { cookieCount?: number; authCookie?: boolean } = {},
): BrowserSessionDiagnosticSummary {
  const cookieCount = options.cookieCount ?? 0
  return {
    partition: 'persist:cclink-studio-profile-test',
    persistent: true,
    cookieStoreFlushed: true,
    cookieCount,
    persistentCookieCount: cookieCount,
    expiredCookieCount: 0,
    likelyAuthCookies: options.authCookie
      ? [
          {
            name: 'session_id',
            domain: '.example.com',
            path: '/',
            secure: true,
            httpOnly: true,
            session: false,
            expiresAt: Date.now() + 60_000,
            likelyAuth: true,
          },
        ]
      : [],
    cookieNames: cookieCount > 0 ? ['analytics_id'] : [],
    recentCookieChanges: [],
  }
}

describe('web resource login status', () => {
  it('does not turn ordinary cookies into an authenticated status after user confirmation', () => {
    const observation = observeWebResourceLogin(summary({ cookieCount: 3 }))

    expect(getWebResourceLoginStatus(observation, '2026-08-21T12:00:00.000Z')).toBe('session-data')
    expect(formatWebResourceLoginStatus(observation, '2026-08-21T12:00:00.000Z')).toBe('待确认')
  })

  it('requires both user confirmation and an active authentication signal', () => {
    const observation = observeWebResourceLogin(summary({ cookieCount: 2, authCookie: true }))

    expect(getWebResourceLoginStatus(observation)).toBe('session-data')
    expect(getWebResourceLoginStatus(observation, '2026-08-21T12:00:00.000Z')).toBe('authenticated')
  })

  it('marks a previously confirmed account for re-login when its Session is empty', () => {
    const observation = observeWebResourceLogin(summary())

    expect(formatWebResourceLoginStatus(observation, '2026-08-21T12:00:00.000Z')).toBe('需重新登录')
  })
})
