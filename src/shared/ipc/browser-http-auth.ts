export const BROWSER_HTTP_AUTH_CHILD_ARGUMENT = '--cclink-browser-http-auth='
export const BROWSER_HTTP_AUTH_RESPONSE_CHANNEL = 'browser-http-auth:respond'

export type BrowserHttpAuthTransport = 'https' | 'loopback-http' | 'insecure-http'
export type BrowserHttpAuthOutcome =
  | 'prompted'
  | 'submitted'
  | 'rejected'
  | 'cancelled'
  | 'authenticated'

export interface BrowserHttpAuthDiagnosticSummary {
  timestamp: number
  tabId: string
  runtimeGeneration: number
  origin: string
  realm: string
  transport: BrowserHttpAuthTransport
  attempt: number
  outcome: BrowserHttpAuthOutcome
  reason?: string
}

export interface BrowserHttpAuthRequest {
  requestId: string
  tabId: string
  runtimeGeneration: number
  url: string
  origin: string
  realm: string
  transport: BrowserHttpAuthTransport
}

export interface BrowserHttpAuthChildOptions extends BrowserHttpAuthRequest {
  attempt: number
  userDataPath: string
}

export type BrowserHttpAuthRendererResponse =
  | {
      action: 'submit'
      requestId: string
      username: string
      password: string
      allowInsecure: boolean
    }
  | { action: 'cancel'; requestId: string }

export type BrowserHttpAuthChildMessage =
  | {
      type: 'browser-http-auth-submitted'
      requestId: string
      tabId: string
      runtimeGeneration: number
      username: string
      password: string
    }
  | {
      type: 'browser-http-auth-cancelled'
      requestId: string
      tabId: string
      runtimeGeneration: number
    }

export interface BrowserHttpAuthAcknowledgement {
  type: 'browser-http-auth-ack'
  requestId: string
}

export function encodeBrowserHttpAuthChildOptions(options: BrowserHttpAuthChildOptions): string {
  return Buffer.from(JSON.stringify(options), 'utf8').toString('base64url')
}

export function parseBrowserHttpAuthChildOptions(
  argv: string[],
): BrowserHttpAuthChildOptions | null {
  const argument = argv.find((value) => value.startsWith(BROWSER_HTTP_AUTH_CHILD_ARGUMENT))
  if (!argument) return null

  try {
    const encoded = argument.slice(BROWSER_HTTP_AUTH_CHILD_ARGUMENT.length)
    const value = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8'),
    ) as Partial<BrowserHttpAuthChildOptions>
    if (
      !isIdentifier(value.requestId) ||
      !isIdentifier(value.tabId) ||
      !Number.isInteger(value.runtimeGeneration) ||
      value.runtimeGeneration! < 1 ||
      typeof value.url !== 'string' ||
      typeof value.origin !== 'string' ||
      resolveBrowserHttpAuthOrigin(value.url) !== value.origin ||
      typeof value.realm !== 'string' ||
      value.realm !== sanitizeBrowserHttpAuthRealm(value.realm) ||
      value.transport !== classifyBrowserHttpAuthTransport(value.origin) ||
      !Number.isInteger(value.attempt) ||
      value.attempt! < 1 ||
      value.attempt! > 3 ||
      typeof value.userDataPath !== 'string' ||
      value.userDataPath.length < 1 ||
      value.userDataPath.length > 4_096
    ) {
      return null
    }
    return value as BrowserHttpAuthChildOptions
  } catch {
    return null
  }
}

export function createBrowserHttpAuthRequest(input: {
  requestId: string
  tabId: string
  runtimeGeneration: number
  url: string
  scheme: string
  isProxy: boolean
  realm: string
}): BrowserHttpAuthRequest | null {
  if (
    input.scheme.toLowerCase() !== 'basic' ||
    input.isProxy ||
    !isIdentifier(input.requestId) ||
    !isIdentifier(input.tabId) ||
    !Number.isInteger(input.runtimeGeneration) ||
    input.runtimeGeneration < 1
  ) {
    return null
  }
  const origin = resolveBrowserHttpAuthOrigin(input.url)
  if (!origin) return null
  const transport = classifyBrowserHttpAuthTransport(origin)
  if (!transport) return null
  return {
    requestId: input.requestId,
    tabId: input.tabId,
    runtimeGeneration: input.runtimeGeneration,
    url: input.url,
    origin,
    realm: sanitizeBrowserHttpAuthRealm(input.realm),
    transport,
  }
}

export function resolveBrowserHttpAuthOrigin(value: string): string | null {
  if (value.length > 16_384) return null
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
    return url.origin
  } catch {
    return null
  }
}

export function classifyBrowserHttpAuthTransport(origin: string): BrowserHttpAuthTransport | null {
  try {
    const url = new URL(origin)
    if (url.protocol === 'https:') return 'https'
    if (url.protocol !== 'http:') return null
    return isLoopbackHostname(url.hostname) ? 'loopback-http' : 'insecure-http'
  } catch {
    return null
  }
}

export function sanitizeBrowserHttpAuthRealm(value: string): string {
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 128)
  return normalized || 'Restricted'
}

export function parseBrowserHttpAuthRendererResponse(
  value: unknown,
): BrowserHttpAuthRendererResponse | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<BrowserHttpAuthRendererResponse>
  if (!isIdentifier(candidate.requestId)) return null
  if (candidate.action === 'cancel') {
    return { action: 'cancel', requestId: candidate.requestId }
  }
  if (
    candidate.action !== 'submit' ||
    typeof candidate.username !== 'string' ||
    candidate.username.length < 1 ||
    candidate.username.length > 512 ||
    /[:\u0000\r\n]/.test(candidate.username) ||
    typeof candidate.password !== 'string' ||
    candidate.password.length > 4_096 ||
    /[\u0000\r\n]/.test(candidate.password) ||
    typeof candidate.allowInsecure !== 'boolean'
  ) {
    return null
  }
  return {
    action: 'submit',
    requestId: candidate.requestId,
    username: candidate.username,
    password: candidate.password,
    allowInsecure: candidate.allowInsecure,
  }
}

export function isBrowserHttpAuthChildMessage(
  value: unknown,
): value is BrowserHttpAuthChildMessage {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<BrowserHttpAuthChildMessage>
  if (
    !isIdentifier(candidate.requestId) ||
    !isIdentifier(candidate.tabId) ||
    !Number.isInteger(candidate.runtimeGeneration) ||
    candidate.runtimeGeneration! < 1
  ) {
    return false
  }
  if (candidate.type === 'browser-http-auth-cancelled') return true
  return (
    candidate.type === 'browser-http-auth-submitted' &&
    typeof candidate.username === 'string' &&
    candidate.username.length > 0 &&
    candidate.username.length <= 512 &&
    !/[:\u0000\r\n]/.test(candidate.username) &&
    typeof candidate.password === 'string' &&
    candidate.password.length <= 4_096 &&
    !/[\u0000\r\n]/.test(candidate.password)
  )
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256
}

function isLoopbackHostname(value: string): boolean {
  const hostname = value.replace(/^\[|\]$/g, '').toLowerCase()
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '::1' ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname)
  )
}
