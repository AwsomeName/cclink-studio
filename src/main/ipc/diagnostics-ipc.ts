import { diagnosticsIpc } from '../../shared/ipc/diagnostics'
import { getMainDiagnosticLogSnapshot } from '../diagnostics/main-diagnostic-log'
import { registerTrustedIpcContract, type TrustedRendererGuard } from './trusted-renderer-guard'
import { probeCodexRuntime } from '../agent/codex-runtime-diagnostics'

export function registerDiagnosticsIpc(
  trustedRendererGuard: TrustedRendererGuard,
): () => Promise<void> {
  const lifetime = new AbortController()
  let pendingProbe: ReturnType<typeof probeCodexRuntime> | null = null
  registerTrustedIpcContract(diagnosticsIpc.probeCodex, trustedRendererGuard, () => {
    lifetime.signal.throwIfAborted()
    pendingProbe ??= probeCodexRuntime(lifetime.signal).finally(() => {
      pendingProbe = null
    })
    return pendingProbe
  })
  registerTrustedIpcContract(
    diagnosticsIpc.getMainLogSnapshot,
    trustedRendererGuard,
    getMainDiagnosticLogSnapshot,
  )
  return async () => {
    lifetime.abort()
    await pendingProbe
  }
}
