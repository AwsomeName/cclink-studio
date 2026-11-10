import type { DiagnosticLogSnapshot } from '../diagnostics'
import type { CodexRuntimeDiagnostic } from '../codex-runtime'
import { defineNoArgsIpc } from './contract'

export interface DiagnosticsApiContract {
  getMainLogSnapshot: () => Promise<DiagnosticLogSnapshot>
  probeCodex: () => Promise<CodexRuntimeDiagnostic>
}

export const diagnosticsIpc = {
  getMainLogSnapshot: defineNoArgsIpc<DiagnosticLogSnapshot>('diagnostics:getMainLogSnapshot'),
  probeCodex: defineNoArgsIpc<CodexRuntimeDiagnostic>('diagnostics:probeCodex'),
} as const
