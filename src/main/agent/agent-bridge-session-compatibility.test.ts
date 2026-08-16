import { describe, expect, it } from 'vitest'
import { resolveCompatibleClaudeSessionId } from './agent-bridge'

const FINGERPRINT_A = 'a'.repeat(64)
const FINGERPRINT_B = 'b'.repeat(64)

describe('resolveCompatibleClaudeSessionId', () => {
  it('restores only a session that the current main process observed', () => {
    expect(
      resolveCompatibleClaudeSessionId(' session-1 ', FINGERPRINT_A, FINGERPRINT_A, {
        sessionId: 'session-1',
        compatibilityFingerprint: FINGERPRINT_A,
      }),
    ).toBe('session-1')
  })

  it('rejects a session created by a different runtime configuration', () => {
    expect(
      resolveCompatibleClaudeSessionId('session-1', FINGERPRINT_A, FINGERPRINT_B, {
        sessionId: 'session-1',
        compatibilityFingerprint: FINGERPRINT_A,
      }),
    ).toBeNull()
  })

  it('rejects legacy sessions without provenance', () => {
    expect(
      resolveCompatibleClaudeSessionId('session-1', undefined, FINGERPRINT_A, {
        sessionId: 'session-1',
        compatibilityFingerprint: FINGERPRINT_A,
      }),
    ).toBeNull()
  })

  it('rejects an old session paired with the current renderer-visible fingerprint', () => {
    expect(
      resolveCompatibleClaudeSessionId('old-session', FINGERPRINT_A, FINGERPRINT_A, null),
    ).toBeNull()
    expect(
      resolveCompatibleClaudeSessionId('old-session', FINGERPRINT_A, FINGERPRINT_A, {
        sessionId: 'current-session',
        compatibilityFingerprint: FINGERPRINT_A,
      }),
    ).toBeNull()
  })
})
