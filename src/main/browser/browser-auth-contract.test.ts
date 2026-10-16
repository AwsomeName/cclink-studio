import { describe, expect, it } from 'vitest'
import {
  BIGMODEL_AUTH_COOKIE,
  BROWSER_AUTH_CHILD_ARGUMENT,
  isBrowserAuthChildMessage,
  parseBrowserAuthChildOptions,
  isAllowedBrowserAuthCookie,
  isRetryableBrowserAuthFailure,
  isSupportedBrowserAuthRequest,
  resolveBrowserAuthReturnUrl,
  sanitizeBrowserAuthMainUrl,
} from './browser-auth-contract'

describe('browser auth contract', () => {
  it('only routes V2EX Google authentication through the clean process', () => {
    expect(
      isSupportedBrowserAuthRequest({
        tabId: 'v2ex-tab',
        profileId: 'v2ex',
        url: 'https://accounts.google.com/o/oauth2/v2/auth',
      }),
    ).toBe(true)
    expect(
      isSupportedBrowserAuthRequest({
        tabId: 'default-tab',
        profileId: 'default',
        url: 'https://accounts.google.com/o/oauth2/v2/auth',
      }),
    ).toBe(false)
  })

  it('only accepts cookies belonging to the target platform', () => {
    const baseCookie = {
      name: 'A2',
      value: 'secret',
      path: '/',
      secure: true,
      httpOnly: true,
      session: false,
      sameSite: 'unspecified' as const,
    }
    expect(isAllowedBrowserAuthCookie('v2ex', { ...baseCookie, domain: '.v2ex.com' })).toBe(true)
    expect(isAllowedBrowserAuthCookie('v2ex', { ...baseCookie, domain: '.google.com' })).toBe(false)
  })

  it('returns to a V2EX page and rejects an unrelated return URL', () => {
    expect(resolveBrowserAuthReturnUrl('v2ex', 'https://www.v2ex.com/mission/daily')).toBe(
      'https://www.v2ex.com/mission/daily',
    )
    expect(resolveBrowserAuthReturnUrl('v2ex', 'https://evil.example/')).toBe(
      'https://www.v2ex.com/',
    )
  })

  it('does not restore Google authentication pages inside the main V2EX tab', () => {
    expect(
      sanitizeBrowserAuthMainUrl(
        'v2ex',
        'https://accounts.google.com/v3/signin/rejected?app_domain=https://www.v2ex.com',
      ),
    ).toBe('https://www.v2ex.com/signup')
    expect(sanitizeBrowserAuthMainUrl('v2ex', 'https://www.v2ex.com/')).toBe(
      'https://www.v2ex.com/',
    )
  })

  it('retries a failed top-level V2EX Google callback without retrying unrelated failures', () => {
    const callback = 'https://www.v2ex.com/auth/google?code=redacted'
    expect(isRetryableBrowserAuthFailure('v2ex', callback, -100, true)).toBe(true)
    expect(isRetryableBrowserAuthFailure('v2ex', callback, -100, false)).toBe(false)
    expect(
      isRetryableBrowserAuthFailure(
        'v2ex',
        'https://accounts.google.com/o/oauth2/v2/auth',
        -100,
        true,
      ),
    ).toBe(true)
    expect(isRetryableBrowserAuthFailure('v2ex', 'https://www.v2ex.com/signup', -100, true)).toBe(
      false,
    )
  })
})

describe('BigModel isolated authentication contract', () => {
  const request = {
    requestId: 'auth-request-1',
    tabId: 'account-tab',
    profileId: 'web-draft-123',
    runtimeGeneration: 3,
    provider: 'bigmodel' as const,
    url: 'https://bigmodel.cn/login?redirect=%2Fcoding-plan%2Fpersonal%2Fusage',
  }
  const cookie = {
    name: BIGMODEL_AUTH_COOKIE,
    value: 'test-auth-state',
    domain: '.bigmodel.cn',
    path: '/',
    secure: true,
    httpOnly: false,
    session: false,
    sameSite: 'no_restriction' as const,
    expirationDate: Date.now() / 1000 + 3600,
  }
  const complete = {
    ...request,
    type: 'browser-auth-complete',
    returnUrl: 'https://bigmodel.cn/console',
    cookies: [cookie],
  }

  it('recognizes the exact HTTPS login page for saved and draft profiles', () => {
    expect(isSupportedBrowserAuthRequest(request)).toBe(true)
    for (const url of [
      'http://bigmodel.cn/login',
      'https://bigmodel.cn.evil.example/login',
      'https://user@bigmodel.cn/login',
      'https://bigmodel.cn:8443/login',
      'https://bigmodel.cn/console',
    ]) {
      expect(isSupportedBrowserAuthRequest({ ...request, url })).toBe(false)
    }
    for (const profileId of ['', '.', '..', '../escape']) {
      expect(isSupportedBrowserAuthRequest({ ...request, profileId })).toBe(false)
    }
    expect(isSupportedBrowserAuthRequest({ ...request, provider: 'v2ex' })).toBe(false)
  })

  it('only transfers the secure BigModel login cookie from the exact domain', () => {
    expect(isAllowedBrowserAuthCookie('bigmodel', cookie)).toBe(true)
    for (const overrides of [
      { name: 'captcha_token' },
      { domain: '.evilbigmodel.cn' },
      { domain: '.accounts.bigmodel.cn' },
      { secure: false },
      { path: '/login' },
    ]) {
      expect(isAllowedBrowserAuthCookie('bigmodel', { ...cookie, ...overrides })).toBe(false)
    }
  })

  it('bounds child messages to the original operation, runtime and profile', () => {
    expect(isBrowserAuthChildMessage(complete, request)).toBe(true)
    for (const overrides of [
      { requestId: 'old-request' },
      { runtimeGeneration: 2 },
      { profileId: 'another-account' },
      { provider: 'v2ex' },
      { tabId: 'another-tab' },
      { cookies: [{ ...cookie, value: 'x'.repeat(16_385) }] },
      { cookies: [null] },
      { cookies: [{ ...cookie, name: 'captcha_token' }] },
    ]) {
      expect(isBrowserAuthChildMessage({ ...complete, ...overrides }, request)).toBe(false)
    }
    expect(isBrowserAuthChildMessage(null, request)).toBe(false)
  })

  it('rejects malformed options before starting a child', () => {
    const options = { ...request, userDataPath: '/tmp/cclink-auth-test' }
    const parse = (value: unknown) =>
      parseBrowserAuthChildOptions([
        BROWSER_AUTH_CHILD_ARGUMENT + Buffer.from(JSON.stringify(value)).toString('base64url'),
      ])
    expect(parse(options)).toEqual(options)
    expect(parse({ ...options, userDataPath: '../relative' })).toBeNull()
    expect(parse({ ...options, provider: 'v2ex' })).toBeNull()
    expect(parse({ ...options, runtimeGeneration: 0 })).toBeNull()
    expect(parse(null)).toBeNull()
  })

  it('returns only to BigModel and never treats /login as the destination', () => {
    expect(resolveBrowserAuthReturnUrl('bigmodel', 'https://bigmodel.cn/console')).toBe(
      'https://bigmodel.cn/console',
    )
    for (const url of [
      request.url,
      'https://evil.example/',
      'https://user@bigmodel.cn/',
      'http://bigmodel.cn/',
    ]) {
      expect(resolveBrowserAuthReturnUrl('bigmodel', url)).toBe(
        'https://bigmodel.cn/coding-plan/personal/usage',
      )
    }
  })
})
