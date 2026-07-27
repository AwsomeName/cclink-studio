import { diagnosticsIpc } from '../../shared/ipc/diagnostics'
import { getMainDiagnosticLogSnapshot } from '../diagnostics/main-diagnostic-log'
import { registerTrustedIpcContract, type TrustedRendererGuard } from './trusted-renderer-guard'

export function registerDiagnosticsIpc(trustedRendererGuard: TrustedRendererGuard): void {
  registerTrustedIpcContract(
    diagnosticsIpc.getMainLogSnapshot,
    trustedRendererGuard,
    getMainDiagnosticLogSnapshot,
  )
}
