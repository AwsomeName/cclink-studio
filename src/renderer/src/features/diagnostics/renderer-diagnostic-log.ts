import {
  formatDiagnosticArguments,
  type DiagnosticLogEntry,
  type DiagnosticLogLevel,
  type DiagnosticLogSnapshot,
} from '@shared/diagnostics'

interface MarkdownDiagnosticRecord {
  key: string
  filePath: string | null
  report: string
  updatedAt: string
}

const MAX_RENDERER_LOG_ENTRIES = 200
const MAX_MARKDOWN_REPORTS = 5

let installed = false
let droppedCount = 0
let entries: DiagnosticLogEntry[] = []
let markdownReports: MarkdownDiagnosticRecord[] = []

export function installRendererDiagnosticCapture(): void {
  if (installed) return
  installed = true
  wrapConsoleMethod('log', 'info')
  wrapConsoleMethod('warn', 'warn')
  wrapConsoleMethod('error', 'error')

  window.addEventListener('error', (event) => {
    recordRendererDiagnosticLog('error', [
      '[window.error]',
      event.error ?? `${event.message} (${event.filename}:${event.lineno}:${event.colno})`,
    ])
  })
  window.addEventListener('unhandledrejection', (event) => {
    recordRendererDiagnosticLog('error', ['[window.unhandledrejection]', event.reason])
  })
}

export function recordRendererDiagnosticLog(level: DiagnosticLogLevel, values: unknown[]): void {
  entries.push({
    timestamp: new Date().toISOString(),
    level,
    source: 'renderer',
    message: formatDiagnosticArguments(values),
  })
  if (entries.length > MAX_RENDERER_LOG_ENTRIES) {
    const overflow = entries.length - MAX_RENDERER_LOG_ENTRIES
    entries = entries.slice(overflow)
    droppedCount += overflow
  }
}

export function getRendererDiagnosticLogSnapshot(): DiagnosticLogSnapshot {
  return {
    capturedAt: new Date().toISOString(),
    entries: [...entries],
    droppedCount,
  }
}

export function publishMarkdownDiagnosticReport(input: {
  key: string
  filePath?: string
  report: string
}): void {
  const record: MarkdownDiagnosticRecord = {
    key: input.key,
    filePath: input.filePath ?? null,
    report: input.report,
    updatedAt: new Date().toISOString(),
  }
  markdownReports = [
    ...markdownReports.filter((candidate) => candidate.key !== input.key),
    record,
  ].slice(-MAX_MARKDOWN_REPORTS)
}

export function clearMarkdownDiagnosticReport(key: string): void {
  markdownReports = markdownReports.filter((record) => record.key !== key)
}

export function getMarkdownDiagnosticReport(
  activeFilePath?: string | null,
): MarkdownDiagnosticRecord | null {
  if (activeFilePath) {
    const matching = [...markdownReports]
      .reverse()
      .find((record) => record.filePath === activeFilePath)
    if (matching) return matching
  }
  return markdownReports.at(-1) ?? null
}

export function resetRendererDiagnosticsForTest(): void {
  entries = []
  droppedCount = 0
  markdownReports = []
}

function wrapConsoleMethod(method: 'log' | 'warn' | 'error', level: DiagnosticLogLevel): void {
  const original = console[method].bind(console)
  console[method] = (...values: unknown[]): void => {
    recordRendererDiagnosticLog(level, values)
    original(...values)
  }
}
