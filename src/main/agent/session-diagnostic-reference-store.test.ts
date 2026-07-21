import { describe, expect, it } from 'vitest'
import { SessionDiagnosticReferenceStore } from './session-diagnostic-reference-store'

describe('SessionDiagnosticReferenceStore', () => {
  it('keeps a stable process-local reference without exposing the session id', () => {
    const store = new SessionDiagnosticReferenceStore()
    const sessionId = 'raw-session-credential'
    const first = store.get(sessionId)

    expect(first).toMatch(/^session-[0-9a-f-]{36}$/)
    expect(first).not.toContain(sessionId)
    expect(store.get(sessionId)).toBe(first)
    expect(store.get('another-session')).not.toBe(first)
  })

  it('rotates references after deletion and clear', () => {
    const store = new SessionDiagnosticReferenceStore()
    const first = store.get('session-a')
    store.delete('session-a')
    const second = store.get('session-a')
    store.clear()

    expect(second).not.toBe(first)
    expect(store.get('session-a')).not.toBe(second)
    expect(store.get(null)).toBeNull()
  })
})
