import {
  formatDiagnosticArguments,
  type DiagnosticLogEntry,
  type DiagnosticLogLevel,
  type DiagnosticLogSnapshot,
} from '../../shared/diagnostics'

const MAX_MAIN_LOG_ENTRIES = 200

let installed = false
let droppedCount = 0
let entries: DiagnosticLogEntry[] = []

export function installMainDiagnosticCapture(): void {
  if (installed) return
  installed = true
  wrapConsoleMethod('log', 'info')
  wrapConsoleMethod('warn', 'warn')
  wrapConsoleMethod('error', 'error')
}

export function recordMainDiagnosticLog(level: DiagnosticLogLevel, values: unknown[]): void {
  entries.push({
    timestamp: new Date().toISOString(),
    level,
    source: 'main',
    message: formatDiagnosticArguments(values),
  })
  if (entries.length > MAX_MAIN_LOG_ENTRIES) {
    const overflow = entries.length - MAX_MAIN_LOG_ENTRIES
    entries = entries.slice(overflow)
    droppedCount += overflow
  }
}

export function getMainDiagnosticLogSnapshot(): DiagnosticLogSnapshot {
  return {
    capturedAt: new Date().toISOString(),
    entries: [...entries],
    droppedCount,
  }
}

export function resetMainDiagnosticLogForTest(): void {
  entries = []
  droppedCount = 0
}

function wrapConsoleMethod(method: 'log' | 'warn' | 'error', level: DiagnosticLogLevel): void {
  const original = console[method].bind(console)
  console[method] = (...values: unknown[]): void => {
    recordMainDiagnosticLog(level, values)
    original(...values)
  }
}
