import type { Cookie } from 'electron'
import { isAbsolute } from 'node:path'
import { normalizeBrowserProfileId } from '../../shared/browser-profile'

export const BROWSER_AUTH_CHILD_ARGUMENT = '--cclink-browser-auth='
export const V2EX_SIGNUP_URL = 'https://www.v2ex.com/signup'
export const BIGMODEL_AUTH_COOKIE = 'bigmodel_token_production'
export type BrowserAuthProvider = 'v2ex' | 'bigmodel'

export interface BrowserAuthIdentity {
  requestId: string
  tabId: string
  profileId: string
  runtimeGeneration: number
  provider: BrowserAuthProvider
}

export interface BrowserAuthRequest extends BrowserAuthIdentity {
  url: string
}

export interface BrowserAuthChildOptions extends BrowserAuthRequest {
  userDataPath: string
}

export interface BrowserAuthCookie {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
  session: boolean
  sameSite: Cookie['sameSite']
  expirationDate?: number
}

export interface BrowserAuthCompleteMessage extends BrowserAuthIdentity {
  type: 'browser-auth-complete'
  returnUrl: string
  cookies: BrowserAuthCookie[]
}

export interface BrowserAuthCancelledMessage extends BrowserAuthIdentity {
  type: 'browser-auth-cancelled'
}

export type BrowserAuthChildMessage = BrowserAuthCompleteMessage | BrowserAuthCancelledMessage

export interface BrowserAuthAcknowledgement {
  type: 'browser-auth-ack'
  requestId: string
}

export interface BrowserAuthFocusMessage {
  type: 'browser-auth-focus'
  requestId: string
}

export function encodeBrowserAuthChildOptions(options: BrowserAuthChildOptions): string {
  return Buffer.from(JSON.stringify(options), 'utf8').toString('base64url')
}

export function parseBrowserAuthChildOptions(argv: string[]): BrowserAuthChildOptions | null {
  const argument = argv.find((value) => value.startsWith(BROWSER_AUTH_CHILD_ARGUMENT))
  if (!argument) return null

  try {
    const encoded = argument.slice(BROWSER_AUTH_CHILD_ARGUMENT.length)
    const value = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8'),
    ) as Partial<BrowserAuthChildOptions>
    if (
      !isBrowserAuthIdentity(value) ||
      typeof value.url !== 'string' ||
      value.url.length > 16_384 ||
      !isSupportedBrowserAuthRequest(value as BrowserAuthRequest) ||
      typeof value.userDataPath !== 'string' ||
      !isAbsolute(value.userDataPath)
    )
      return null
    return value as BrowserAuthChildOptions
  } catch {
    return null
  }
}

/** Only these two login entry points may leave the normal browser process. */
export function resolveBrowserAuthProvider(request: {
  profileId: string
  url: string
}): BrowserAuthProvider | null {
  try {
    const profileId = normalizeBrowserProfileId(request.profileId)
    if (!profileId || profileId === '.' || profileId === '..') return null
    const url = new URL(request.url)
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      (url.port && url.port !== '443')
    )
      return null
    if (profileId === 'v2ex' && url.hostname === 'accounts.google.com') return 'v2ex'
    if (url.hostname === 'bigmodel.cn' && /^\/login\/?$/.test(url.pathname)) return 'bigmodel'
  } catch {
    /* Invalid URLs and profiles never start authentication. */
  }
  return null
}

export function isSupportedBrowserAuthRequest(request: {
  tabId?: string
  profileId: string
  url: string
  provider?: BrowserAuthProvider
}): boolean {
  const provider = resolveBrowserAuthProvider(request)
  return provider !== null && (request.provider === undefined || request.provider === provider)
}

export function browserAuthCookieName(provider: BrowserAuthProvider): string {
  return provider === 'bigmodel' ? BIGMODEL_AUTH_COOKIE : 'A2'
}

export function isAllowedBrowserAuthCookie(provider: string, cookie: BrowserAuthCookie): boolean {
  const domain = cookie.domain.replace(/^\./, '').toLowerCase()
  if (provider === 'bigmodel') {
    return (
      domain === 'bigmodel.cn' &&
      cookie.name === BIGMODEL_AUTH_COOKIE &&
      cookie.secure &&
      cookie.path === '/'
    )
  }
  return provider === 'v2ex' && (domain === 'v2ex.com' || domain.endsWith('.v2ex.com'))
}

export function resolveBrowserAuthReturnUrl(provider: string, value: string): string {
  const fallback =
    provider === 'v2ex'
      ? 'https://www.v2ex.com/'
      : provider === 'bigmodel'
        ? 'https://bigmodel.cn/coding-plan/personal/usage'
        : 'about:blank'
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return fallback
    if (provider === 'v2ex' && isV2exHost(url.hostname)) return url.toString()
    if (
      provider === 'bigmodel' &&
      url.hostname === 'bigmodel.cn' &&
      !/^\/login\/?$/.test(url.pathname)
    )
      return url.toString()
  } catch {
    /* Return only to the authenticated site. */
  }
  return fallback
}

function isBrowserAuthIdentity<T extends Partial<BrowserAuthIdentity>>(
  value: T,
): value is T & BrowserAuthIdentity {
  if (
    typeof value.requestId !== 'string' ||
    !/^[a-zA-Z0-9-]{1,64}$/.test(value.requestId) ||
    typeof value.tabId !== 'string' ||
    value.tabId.length === 0 ||
    value.tabId.length > 256 ||
    typeof value.runtimeGeneration !== 'number' ||
    !Number.isSafeInteger(value.runtimeGeneration) ||
    value.runtimeGeneration < 1 ||
    (value.provider !== 'v2ex' && value.provider !== 'bigmodel') ||
    typeof value.profileId !== 'string'
  )
    return false
  try {
    return !!normalizeBrowserProfileId(value.profileId) && !['.', '..'].includes(value.profileId)
  } catch {
    return false
  }
}

/** Credentials stay on the main/child IPC channel and are never projected to renderer. */
export function isBrowserAuthChildMessage(
  value: unknown,
  expected: BrowserAuthRequest,
): value is BrowserAuthChildMessage {
  if (!value || typeof value !== 'object') return false
  const message = value as Partial<BrowserAuthChildMessage>
  if (
    !isBrowserAuthIdentity(message) ||
    message.requestId !== expected.requestId ||
    message.tabId !== expected.tabId ||
    message.profileId !== expected.profileId ||
    message.provider !== expected.provider ||
    message.runtimeGeneration !== expected.runtimeGeneration
  )
    return false
  if (message.type === 'browser-auth-cancelled') return true
  if (
    message.type !== 'browser-auth-complete' ||
    typeof message.returnUrl !== 'string' ||
    message.returnUrl.length > 16_384 ||
    !Array.isArray(message.cookies) ||
    message.cookies.length > 64
  )
    return false
  let bytes = 0
  return message.cookies.every((cookie: BrowserAuthCookie) => {
    if (
      !cookie ||
      typeof cookie.name !== 'string' ||
      typeof cookie.value !== 'string' ||
      typeof cookie.domain !== 'string' ||
      typeof cookie.path !== 'string' ||
      typeof cookie.secure !== 'boolean' ||
      typeof cookie.httpOnly !== 'boolean' ||
      typeof cookie.session !== 'boolean' ||
      !['unspecified', 'no_restriction', 'lax', 'strict'].includes(cookie.sameSite) ||
      (cookie.expirationDate !== undefined && !Number.isFinite(cookie.expirationDate))
    )
      return false
    bytes += cookie.name.length + cookie.value.length + cookie.domain.length + cookie.path.length
    return (
      cookie.name.length <= 256 &&
      cookie.value.length <= 16_384 &&
      cookie.domain.length <= 253 &&
      cookie.path.length <= 2048 &&
      bytes <= 262_144 &&
      isAllowedBrowserAuthCookie(expected.provider, cookie)
    )
  })
}

export function sanitizeBrowserAuthMainUrl(profileId: string | null, value: string): string {
  if (profileId !== 'v2ex') return value
  try {
    return new URL(value).hostname === 'accounts.google.com' ? V2EX_SIGNUP_URL : value
  } catch {
    return value
  }
}

const RETRYABLE_NETWORK_ERRORS = new Set([-100, -101, -102, -105, -106, -118, -130])

export function isRetryableBrowserAuthFailure(
  profileId: string,
  value: string,
  errorCode: number,
  isMainFrame: boolean,
): boolean {
  if (profileId !== 'v2ex' || !isMainFrame || !RETRYABLE_NETWORK_ERRORS.has(errorCode)) {
    return false
  }
  try {
    const url = new URL(value)
    if (url.hostname === 'accounts.google.com') return true
    return isV2exHost(url.hostname) && url.pathname === '/auth/google'
  } catch {
    return false
  }
}

function isV2exHost(hostname: string): boolean {
  return hostname === 'v2ex.com' || hostname.endsWith('.v2ex.com')
}
