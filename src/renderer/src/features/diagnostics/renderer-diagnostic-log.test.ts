import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearMarkdownDiagnosticReport,
  getMarkdownDiagnosticReport,
  getRendererDiagnosticLogSnapshot,
  publishMarkdownDiagnosticReport,
  recordRendererDiagnosticLog,
  resetRendererDiagnosticsForTest,
} from './renderer-diagnostic-log'

describe('renderer diagnostic log', () => {
  beforeEach(() => resetRendererDiagnosticsForTest())

  it('retains only the newest log entries and redacts credentials', () => {
    for (let index = 0; index < 202; index += 1) {
      recordRendererDiagnosticLog('error', [`token=value-${index}`])
    }

    const snapshot = getRendererDiagnosticLogSnapshot()
    expect(snapshot.entries).toHaveLength(200)
    expect(snapshot.droppedCount).toBe(2)
    expect(snapshot.entries[0].message).toBe('token=[REDACTED]')
  })

  it('selects the active Markdown report and clears it by tab key', () => {
    publishMarkdownDiagnosticReport({
      key: 'tab-a',
      filePath: '/tmp/a.md',
      report: 'report-a',
    })
    publishMarkdownDiagnosticReport({
      key: 'tab-b',
      filePath: '/tmp/b.md',
      report: 'report-b',
    })

    expect(getMarkdownDiagnosticReport('/tmp/a.md')?.report).toBe('report-a')
    expect(getMarkdownDiagnosticReport('/tmp/missing.md')?.report).toBe('report-b')

    clearMarkdownDiagnosticReport('tab-b')
    expect(getMarkdownDiagnosticReport('/tmp/b.md')?.report).toBe('report-a')
  })
})
