import { describe, expect, it } from 'vitest'
import {
  describeWebServiceStartupFailure,
  formatWebServiceStartupDiagnostic,
  webServiceStartupFailureSchema,
} from './web-service-startup'

describe('web service startup IPC data', () => {
  const failure = {
    service: 'web-resources' as const,
    state: 'failed' as const,
    stage: 'read-state' as const,
    code: 'STORAGE_PERMISSION_DENIED' as const,
    recovery: 'check-permissions-and-restart' as const,
    occurredAt: '2026-10-16T01:00:00.000Z',
  }

  it('rejects free-form diagnostic data and unknown states', () => {
    expect(
      webServiceStartupFailureSchema.safeParse({ ...failure, message: 'token=secret' }).success,
    ).toBe(false)
    expect(webServiceStartupFailureSchema.safeParse({ ...failure, code: 'anything' }).success).toBe(
      false,
    )
    expect(
      webServiceStartupFailureSchema.safeParse({ ...failure, stage: 'anything' }).success,
    ).toBe(false)
  })

  it('provides a concrete recovery instruction and keeps copied data on an allowlist', () => {
    expect(describeWebServiceStartupFailure(failure)).toMatch(/读取状态文件.*权限.*重新启动 Studio/)
    const copied = formatWebServiceStartupDiagnostic(
      Object.assign({}, failure, { raw: 'token=secret' }),
    )
    expect(JSON.parse(copied)).toEqual(failure)
    expect(copied).not.toContain('secret')
  })
})
