import { describe, expect, it } from 'vitest'
import {
  BROWSER_HTTP_AUTH_CHILD_ARGUMENT,
  classifyBrowserHttpAuthTransport,
  createBrowserHttpAuthRequest,
  encodeBrowserHttpAuthChildOptions,
  isBrowserHttpAuthChildMessage,
  parseBrowserHttpAuthChildOptions,
  parseBrowserHttpAuthRendererResponse,
  sanitizeBrowserHttpAuthRealm,
} from './browser-http-auth'

describe('browser HTTP auth contract', () => {
  it('accepts only non-proxy Basic challenges on HTTP(S) origins', () => {
    expect(
      createBrowserHttpAuthRequest({
        requestId: 'request-1',
        tabId: 'tab-1',
        runtimeGeneration: 3,
        url: 'http://example.com:7500/dashboard',
        scheme: 'basic',
        isProxy: false,
        realm: 'Restricted',
      }),
    ).toMatchObject({
      origin: 'http://example.com:7500',
      transport: 'insecure-http',
      realm: 'Restricted',
    })
    expect(
      createBrowserHttpAuthRequest({
        requestId: 'request-1',
        tabId: 'tab-1',
        runtimeGeneration: 3,
        url: 'https://example.com/',
        scheme: 'digest',
        isProxy: false,
        realm: 'Restricted',
      }),
    ).toBeNull()
    expect(
      createBrowserHttpAuthRequest({
        requestId: 'request-1',
        tabId: 'tab-1',
        runtimeGeneration: 3,
        url: 'https://example.com/',
        scheme: 'basic',
        isProxy: true,
        realm: 'Restricted',
      }),
    ).toBeNull()
  })

  it('distinguishes secure, loopback, and public plaintext transports', () => {
    expect(classifyBrowserHttpAuthTransport('https://example.com')).toBe('https')
    expect(classifyBrowserHttpAuthTransport('http://127.0.0.1:7500')).toBe('loopback-http')
    expect(classifyBrowserHttpAuthTransport('http://[::1]:7500')).toBe('loopback-http')
    expect(classifyBrowserHttpAuthTransport('http://example.com:7500')).toBe('insecure-http')
  })

  it('sanitizes attacker-controlled realms before display or diagnostics', () => {
    expect(sanitizeBrowserHttpAuthRealm('  Restricted\nInjected\u0000  ')).toBe(
      'Restricted Injected',
    )
    expect(sanitizeBrowserHttpAuthRealm('')).toBe('Restricted')
    expect(sanitizeBrowserHttpAuthRealm('x'.repeat(300))).toHaveLength(128)
  })

  it('round-trips bounded child options and rejects tampering', () => {
    const options = {
      requestId: 'request-1',
      tabId: 'tab-1',
      runtimeGeneration: 3,
      url: 'https://example.com/private',
      origin: 'https://example.com',
      realm: 'Restricted',
      transport: 'https' as const,
      attempt: 2,
      userDataPath: '/tmp/cclink-http-auth-test',
    }
    const encoded = encodeBrowserHttpAuthChildOptions(options)
    expect(
      parseBrowserHttpAuthChildOptions([`${BROWSER_HTTP_AUTH_CHILD_ARGUMENT}${encoded}`]),
    ).toEqual(options)

    const tampered = encodeBrowserHttpAuthChildOptions({
      ...options,
      origin: 'https://evil.example',
    })
    expect(
      parseBrowserHttpAuthChildOptions([`${BROWSER_HTTP_AUTH_CHILD_ARGUMENT}${tampered}`]),
    ).toBeNull()
  })

  it('validates renderer and child messages without logging or transforming secrets', () => {
    expect(
      parseBrowserHttpAuthRendererResponse({
        action: 'submit',
        requestId: 'request-1',
        username: 'admin',
        password: 'secret:value',
        allowInsecure: true,
      }),
    ).toEqual({
      action: 'submit',
      requestId: 'request-1',
      username: 'admin',
      password: 'secret:value',
      allowInsecure: true,
    })
    expect(
      parseBrowserHttpAuthRendererResponse({
        action: 'submit',
        requestId: 'request-1',
        username: 'admin:other',
        password: 'secret',
        allowInsecure: true,
      }),
    ).toBeNull()
    expect(
      isBrowserHttpAuthChildMessage({
        type: 'browser-http-auth-submitted',
        requestId: 'request-1',
        tabId: 'tab-1',
        runtimeGeneration: 3,
        username: 'admin',
        password: 'secret',
      }),
    ).toBe(true)
  })
})
