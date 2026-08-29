export type DiagnosticLogLevel = 'info' | 'warn' | 'error'
export type DiagnosticLogSource = 'main' | 'renderer'

export interface DiagnosticLogEntry {
  timestamp: string
  level: DiagnosticLogLevel
  source: DiagnosticLogSource
  message: string
}

export interface DiagnosticLogSnapshot {
  capturedAt: string
  entries: DiagnosticLogEntry[]
  droppedCount: number
}

const SECRET_ASSIGNMENT =
  /(\b(?:password|passwd|pwd|token|access[-_ ]?token|refresh[-_ ]?token|secret|api[-_ ]?key|authorization|cookie|session(?:[-_ ]?id)?|credential|private[-_ ]?key)\b\s*[:=]\s*)(["']?)[^\s,;}"']+\2/gi
const JSON_SECRET =
  /("(?:password|passwd|pwd|token|access[-_ ]?token|refresh[-_ ]?token|secret|api[-_ ]?key|authorization|cookie|session(?:[-_ ]?id)?|credential|private[-_ ]?key)"\s*:\s*)"[^"]*"/gi
const BEARER_SECRET = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi
const URL_WITH_QUERY = /\b(https?:\/\/[^\s?#)]+)(?:\?[^\s#)]*)?(?:#[^\s)]*)?/gi
const HOME_PATH = /\/Users\/[^/\s]+(?=\/|$)/g
const PHONE_NUMBER = /\b(1\d{2})\d{4}(\d{4})\b/g
const EMAIL_ADDRESS = /\b([A-Z0-9._%+-])[A-Z0-9._%+-]*(@[A-Z0-9.-]+\.[A-Z]{2,})\b/gi

export function sanitizeDiagnosticText(value: string, maxLength = 2_000): string {
  const sanitized = value
    .replace(JSON_SECRET, '$1"[REDACTED]"')
    .replace(SECRET_ASSIGNMENT, '$1[REDACTED]')
    .replace(BEARER_SECRET, 'Bearer [REDACTED]')
    .replace(URL_WITH_QUERY, '$1')
    .replace(HOME_PATH, '~')
    .replace(PHONE_NUMBER, '$1****$2')
    .replace(EMAIL_ADDRESS, '$1***$2')
    .replace(/\u0000/g, '\\0')
  return sanitized.length <= maxLength ? sanitized : `${sanitized.slice(0, maxLength)}…[truncated]`
}

export function formatDiagnosticArguments(values: unknown[]): string {
  return sanitizeDiagnosticText(values.map(formatDiagnosticValue).join(' '))
}

function formatDiagnosticValue(value: unknown): string {
  if (value instanceof Error || isErrorLike(value)) {
    const name = typeof value.name === 'string' && value.name.trim() ? value.name : 'Error'
    const message = typeof value.message === 'string' ? value.message : ''
    return typeof value.stack === 'string' && value.stack.trim()
      ? value.stack
      : `${name}: ${message}`
  }
  if (typeof value === 'string') return value
  if (typeof value === 'bigint') return `${value.toString()}n`
  if (typeof value === 'symbol') return value.toString()
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`
  try {
    const seen = new WeakSet<object>()
    return JSON.stringify(value, (_key, nestedValue: unknown) => {
      if (typeof nestedValue === 'bigint') return `${nestedValue.toString()}n`
      if (nestedValue && typeof nestedValue === 'object') {
        if (seen.has(nestedValue)) return '[Circular]'
        seen.add(nestedValue)
      }
      return nestedValue
    })
  } catch {
    return String(value)
  }
}

function isErrorLike(
  value: unknown,
): value is { name?: unknown; message?: unknown; stack?: unknown } {
  return Boolean(
    value &&
    typeof value === 'object' &&
    ('stack' in value ||
      ('message' in value &&
        typeof (value as { message?: unknown }).message === 'string' &&
        'name' in value)),
  )
}
