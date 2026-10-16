import type { UpdateErrorCode } from '../../shared/update'
import { sanitizeDiagnosticText } from '../../shared/diagnostics'

interface VerificationDiagnostic {
  step: string
  systemCode?: string | number
  signal?: string
  timedOut: boolean
  detail: string
}

export class UpdateAssetVerificationError extends Error {
  constructor(
    readonly code: UpdateErrorCode,
    message: string,
    readonly diagnostic?: VerificationDiagnostic,
  ) {
    super(message)
    this.name = 'UpdateAssetVerificationError'
  }
}

export function verificationFailure(
  step: string,
  error: unknown,
  code: UpdateErrorCode = 'verification_failed',
): UpdateAssetVerificationError {
  if (error instanceof UpdateAssetVerificationError && error.diagnostic) return error
  const cause = error as {
    code?: string | number
    signal?: string
    killed?: boolean
    stderr?: string
    stdout?: string
    message?: string
  } | null
  // Do not log execFile's message: it includes the full command and its arguments.
  const commandFailure = cause && typeof cause === 'object' && 'cmd' in cause
  const output = cause?.stderr?.trim() || cause?.stdout || (commandFailure ? '' : cause?.message)
  const detail = sanitizeDiagnosticText(String(output ?? '')).replace(
    /(^|[\s"'(])\/[^:\r\n]*/g,
    '$1[path]',
  )
  return new UpdateAssetVerificationError(
    error instanceof UpdateAssetVerificationError ? error.code : code,
    error instanceof UpdateAssetVerificationError
      ? error.message
      : code === 'download_corrupt'
        ? '更新缓存完整性检查失败，请重新检查并下载'
        : `更新校验未完成（${step}），当前版本未退出，请重试`,
    {
      step,
      systemCode: error instanceof UpdateAssetVerificationError ? undefined : cause?.code,
      signal: cause?.signal,
      timedOut: cause?.killed === true || cause?.code === 'ETIMEDOUT',
      detail: Buffer.from(detail).subarray(0, 1_800).toString('utf8'),
    },
  )
}

export function logVerificationFailure(operationId: string | null, error: unknown): void {
  if (!(error instanceof UpdateAssetVerificationError)) return
  console.warn('[UpdateVerification]', { operationId, code: error.code, ...error.diagnostic })
}
