import { formatCodexDiagnostic } from '@shared/codex-diagnostic-report'

export { formatCodexDiagnostic }

export async function collectCodexDiagnostic(): Promise<string> {
  return formatCodexDiagnostic(await window.cclinkStudio.diagnostics.probeCodex())
}
