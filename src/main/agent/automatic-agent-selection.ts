import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import type { BackendConfig } from '../agent-core/backends/types'
import type { AgentRuntimeBinding } from '../../shared/agent-runtime'
import { probeCodexRuntime } from './codex-runtime-diagnostics'

/** Startup readiness only: never sends task content or retries a model/tool operation. */
export async function selectAutomaticTaskAgent(input: {
  workspacePath?: string
  claudeConfig: BackendConfig
  signal: AbortSignal
}): Promise<{ binding: AgentRuntimeBinding; reason: string }> {
  input.signal.throwIfAborted()
  const diagnostic = await probeCodexRuntime(
    AbortSignal.any([input.signal, AbortSignal.timeout(4_000)]),
    input.workspacePath,
  )
  input.signal.throwIfAborted()
  if (diagnostic.state === 'ready') {
    return { binding: { kind: 'codex' }, reason: 'CODEX_READY' }
  }

  const config =
    input.claudeConfig.type === 'local-claude-code' ? input.claudeConfig.claudeCode : null
  let claudeReason = '未配置 Studio Claude API Key'
  if (config?.apiKey?.trim()) {
    claudeReason = 'Claude 运行时未就绪，请检查 Studio 组件设置'
    if (!config.runtimeError && config.claudeCodePath) {
      try {
        await access(config.claudeCodePath, constants.X_OK)
        input.signal.throwIfAborted()
        return { binding: { kind: 'claude-code' }, reason: `CODEX_UNAVAILABLE:${diagnostic.code}` }
      } catch {
        input.signal.throwIfAborted()
      }
    }
  }
  throw new Error(
    `没有可用的本地 Agent。Codex：${diagnostic.message}；Claude Code：${claudeReason}`,
  )
}
