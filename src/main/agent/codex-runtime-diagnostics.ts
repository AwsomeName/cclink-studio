import { tmpdir } from 'node:os'
import { CodexAppServer } from '../agent-core/backends/codex-app-server'
import { assertNativeChatgptConfiguration } from '../agent-core/backends/codex-runtime-policy'
import type { CodexRuntimeDiagnostic } from '../../shared/codex-runtime'

/** Explicit local probe: no model turn, MCP session, login/logout or credential migration. */
export async function probeCodexRuntime(signal?: AbortSignal): Promise<CodexRuntimeDiagnostic> {
  const server = new CodexAppServer(
    () => {},
    () => {},
    5_000,
  )
  const abort = () => server.close()
  signal?.addEventListener('abort', abort, { once: true })
  try {
    signal?.throwIfAborted()
    await server.start(tmpdir())
    const account = await server.request('account/read', { refreshToken: false })
    server.recordAccount(account)
    assertNativeChatgptConfiguration(account, {})
    const loaded = await server.request('config/read', { cwd: tmpdir(), includeLayers: false })
    assertNativeChatgptConfiguration(account, (loaded.config ?? {}) as Record<string, unknown>)
    server.markReady()
    return server.getDiagnostic()
  } catch (error) {
    return server.getDiagnostic(error)
  } finally {
    signal?.removeEventListener('abort', abort)
    await server.stop()
  }
}
