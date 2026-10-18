import {
  webServiceStartupFailureSchema,
  type WebServiceName,
  type WebServiceStartupFailure,
} from '../../shared/web-service-startup'

type FailureCode = WebServiceStartupFailure['code']
type FailureStage = WebServiceStartupFailure['stage']

export class WebServiceStartupError extends Error {
  constructor(
    readonly stage: FailureStage,
    readonly code: FailureCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause })
    this.name = 'WebServiceStartupError'
  }
}

export function classifyWebServiceStartupError(
  error: unknown,
  stage: FailureStage,
  fallback: FailureCode = 'INITIALIZATION_FAILED',
): WebServiceStartupError {
  if (error instanceof WebServiceStartupError) return error
  const osCode = error && typeof error === 'object' && 'code' in error ? error.code : undefined
  const code =
    osCode === 'EACCES' || osCode === 'EPERM'
      ? 'STORAGE_PERMISSION_DENIED'
      : osCode === 'ENOSPC' || osCode === 'EDQUOT'
        ? 'STORAGE_FULL'
        : typeof osCode === 'string' && /^E[A-Z]+$/.test(osCode)
          ? 'STORAGE_UNAVAILABLE'
          : fallback
  return new WebServiceStartupError(stage, code, '网页服务启动失败', error)
}

export function createWebServiceStartupFailure(
  service: WebServiceName,
  error: unknown,
): WebServiceStartupFailure {
  const classified = classifyWebServiceStartupError(error, 'initialize')
  const recovery: WebServiceStartupFailure['recovery'] =
    classified.code === 'STATE_INVALID' || classified.code === 'STATE_TOO_LARGE'
      ? 'restore-backup-and-restart'
      : classified.code === 'STORAGE_PERMISSION_DENIED'
        ? 'check-permissions-and-restart'
        : classified.code === 'STORAGE_FULL'
          ? 'free-disk-and-restart'
          : classified.code === 'STORAGE_UNAVAILABLE'
            ? 'check-storage-and-restart'
            : 'restart-and-copy-diagnostics'
  return webServiceStartupFailureSchema.parse({
    service,
    state: 'failed',
    stage: classified.stage,
    code: classified.code,
    recovery,
    occurredAt: new Date().toISOString(),
  })
}
