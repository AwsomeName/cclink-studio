import { describe, expect, it } from 'vitest'
import { UpdateAssetVerificationError, verificationFailure } from './update-verification-error'

describe('bounded update verification diagnostics', () => {
  it('keeps stdout-only command errors without copying command arguments', () => {
    const error = verificationFailure(
      '挂载候选：应用声明读取',
      Object.assign(new Error('command /private/sensitive'), {
        cmd: '/usr/bin/plutil /private/sensitive',
        code: 1,
        stderr: '',
        stdout: 'Could not extract required value',
      }),
    )
    expect(error.diagnostic?.detail).toBe('Could not extract required value')
    expect(error.diagnostic?.detail).not.toContain('sensitive')
  })
  it('retains the real stage, exit status and sanitized stderr without leaking it to the user message', () => {
    const error = verificationFailure(
      '暂存候选：应用安全评估',
      Object.assign(new Error('command with private arguments'), {
        code: 1,
        signal: 'SIGTERM',
        killed: true,
        stderr: '/opt/private/candidate.app: rejected token=secret\n' + '许可条款'.repeat(3_000),
      }),
    )
    expect(error.code).toBe('verification_failed')
    expect(error.diagnostic).toMatchObject({
      step: '暂存候选：应用安全评估',
      systemCode: 1,
      signal: 'SIGTERM',
      timedOut: true,
    })
    expect(Buffer.byteLength(error.diagnostic!.detail)).toBeLessThanOrEqual(1_802)
    expect(error.diagnostic!.detail).toContain('rejected')
    expect(error.diagnostic!.detail).not.toContain('secret')
    expect(error.diagnostic!.detail).not.toContain('/Users/alice')
    expect(error.diagnostic!.detail).not.toContain('/opt/private')
    expect(error.message).not.toContain('private')
    expect(error.message).not.toContain('许可条款')
    expect(verificationFailure('外层步骤', error)).toBe(error)
  })

  it('keeps confirmed asset error codes rather than turning them into incomplete verification', () => {
    const error = verificationFailure(
      '挂载候选：身份读取',
      new UpdateAssetVerificationError('publisher_mismatch', '身份不匹配'),
    )
    expect(error).toMatchObject({
      code: 'publisher_mismatch',
      message: '身份不匹配',
      diagnostic: { step: '挂载候选：身份读取' },
    })
  })
})
