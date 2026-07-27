import type { DiagnosticLogSnapshot } from '../diagnostics'
import { defineNoArgsIpc } from './contract'

export interface DiagnosticsApiContract {
  getMainLogSnapshot: () => Promise<DiagnosticLogSnapshot>
}

export const diagnosticsIpc = {
  getMainLogSnapshot: defineNoArgsIpc<DiagnosticLogSnapshot>('diagnostics:getMainLogSnapshot'),
} as const
