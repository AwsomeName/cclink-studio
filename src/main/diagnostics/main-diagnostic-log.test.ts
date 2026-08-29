import { beforeEach, describe, expect, it } from 'vitest'
import { runInNewContext } from 'node:vm'
import {
  getMainDiagnosticLogSnapshot,
  recordMainDiagnosticLog,
  resetMainDiagnosticLogForTest,
} from './main-diagnostic-log'

describe('main diagnostic log', () => {
  beforeEach(() => resetMainDiagnosticLogForTest())

  it('redacts sensitive values before retaining them', () => {
    recordMainDiagnosticLog('error', [
      'request failed',
      'token=secret-value',
      '{"sessionId":"raw-session","accessToken":"raw-access"}',
      '/Users/alice/project',
      'https://example.com/path?session=secret',
      'phone=13812345678 email=alice@example.com',
    ])

    const [entry] = getMainDiagnosticLogSnapshot().entries
    expect(entry.message).toContain('token=[REDACTED]')
    expect(entry.message).toContain('~/project')
    expect(entry.message).toContain('https://example.com/path')
    expect(entry.message).not.toContain('secret-value')
    expect(entry.message).not.toContain('alice')
    expect(entry.message).not.toContain('session=secret')
    expect(entry.message).not.toContain('raw-session')
    expect(entry.message).not.toContain('raw-access')
    expect(entry.message).toContain('138****5678')
    expect(entry.message).toContain('a***@example.com')
  })

  it('retains message and stack from errors created in an isolated VM realm', () => {
    const foreignError = runInNewContext('new ReferenceError("navigator is not defined")')

    recordMainDiagnosticLog('error', ['connection failed', foreignError])

    const [entry] = getMainDiagnosticLogSnapshot().entries
    expect(entry.message).toContain('ReferenceError: navigator is not defined')
    expect(entry.message).not.toContain('{}')
  })

  it('keeps a bounded ring and reports discarded entries', () => {
    for (let index = 0; index < 205; index += 1) {
      recordMainDiagnosticLog('info', [`entry-${index}`])
    }

    const snapshot = getMainDiagnosticLogSnapshot()
    expect(snapshot.entries).toHaveLength(200)
    expect(snapshot.droppedCount).toBe(5)
    expect(snapshot.entries[0].message).toBe('entry-5')
    expect(snapshot.entries.at(-1)?.message).toBe('entry-204')
  })
})
