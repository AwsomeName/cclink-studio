import { inflateSync } from 'node:zlib'

export class CclinkCloudError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode: number,
    readonly traceId?: string,
  ) {
    super(message)
    this.name = 'CclinkCloudError'
  }
}

export async function callCclinkCloud<T>(
  baseUrl: string | null,
  type: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  if (!baseUrl) throw new CclinkCloudError('CCLink 远程服务未配置', 'NOT_CONFIGURED', 503)
  const response = await fetch(baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, ...payload }),
  })
  const raw = await response.text()
  let body: { code?: string; message?: string; data?: T; traceId?: string }
  try {
    body = raw ? JSON.parse(raw) : {}
  } catch {
    body = { code: 'INVALID_RESPONSE', message: raw.slice(0, 512) }
  }
  if (!response.ok || body.code !== 'OK') {
    const code = body.code || `HTTP_${response.status}`
    throw new CclinkCloudError(
      body.message || `CCLink 云服务请求失败（${response.status}）`,
      code,
      response.ok ? codeToStatus(code) : response.status,
      body.traceId,
    )
  }
  return (body.data ?? {}) as T
}

export function decodeUserSigUserId(token: string): string | null {
  try {
    const normalized = token.replace(/\*/gu, '+').replace(/-/gu, '/').replace(/_/gu, '=')
    const doc = JSON.parse(inflateSync(Buffer.from(normalized, 'base64')).toString()) as Record<
      string,
      unknown
    >
    return typeof doc['TLS.identifier'] === 'string' ? doc['TLS.identifier'] : null
  } catch {
    return null
  }
}

export function isTerminalAuthError(error: unknown): boolean {
  if (!(error instanceof CclinkCloudError)) return false
  return (
    error.statusCode === 401 ||
    error.statusCode === 403 ||
    [
      'AUTH_REQUIRED',
      'TOKEN_INVALID',
      'TOKEN_EXPIRED',
      'INVALID_TOKEN',
      'UNAUTHORIZED',
      'USER_NOT_FOUND',
    ].includes(error.code)
  )
}

function codeToStatus(code: string): number {
  if (
    ['AUTH_REQUIRED', 'TOKEN_INVALID', 'TOKEN_EXPIRED', 'INVALID_TOKEN', 'UNAUTHORIZED'].includes(
      code,
    )
  )
    return 401
  if (code === 'FORBIDDEN') return 403
  return 502
}
