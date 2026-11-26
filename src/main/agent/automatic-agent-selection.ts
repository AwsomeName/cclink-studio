import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import type { BackendConfig } from '../agent-core/backends/types'
import type { AgentRuntimeBinding } from '../../shared/agent-runtime'
import { probeCodexRuntime } from './codex-runtime-diagnostics'

export type LocalTaskRuntime = 'codex' | 'claude-code'

/**
 * Startup readiness only: never sends task content or retries a model/tool operation.
 * Runtimes are tried in `order` (Codex first by default, ADR 0023); the first ready one wins.
 */
export async function selectAutomaticTaskAgent(input: {
  workspacePath?: string
  claudeConfig: BackendConfig
  signal: AbortSignal
  order?: readonly LocalTaskRuntime[]
}): Promise<{ binding: AgentRuntimeBinding; reason: string }> {
  const order = input.order?.length ? input.order : (['codex', 'claude-code'] as const)
  const misses: string[] = []
  let codexMessage = '未检查'
  let claudeReason = '未检查'
  for (const kind of order) {
    input.signal.throwIfAborted()
    if (kind === 'codex') {
      const diagnostic = await probeCodexRuntime(
        AbortSignal.any([input.signal, AbortSignal.timeout(4_000)]),
        input.workspacePath,
      )
      input.signal.throwIfAborted()
      if (diagnostic.state === 'ready')
        return {
          binding: { kind: 'codex' },
          reason: misses.length ? misses.join(',') : 'CODEX_READY',
        }
      codexMessage = diagnostic.message
      misses.push('CODEX_UNAVAILABLE:' + diagnostic.code)
    } else {
      claudeReason = await claudeReadiness(input.claudeConfig)
      input.signal.throwIfAborted()
      if (!claudeReason)
        return {
          binding: { kind: 'claude-code' },
          reason: misses.length ? misses.join(',') : 'CLAUDE_READY',
        }
      misses.push('CLAUDE_UNAVAILABLE')
    }
  }
  throw new Error(`没有可用的本地 Agent。Codex：${codexMessage}；Claude Code：${claudeReason}`)
}

/** Empty string when Studio's Claude runtime can start; otherwise a credential-free reason. */
async function claudeReadiness(configured: BackendConfig): Promise<string> {
  const config = configured.type === 'local-claude-code' ? configured.claudeCode : null
  if (!config?.apiKey?.trim()) return '未配置 Studio Claude API Key'
  if (config.runtimeError || !config.claudeCodePath)
    return 'Claude 运行时未就绪，请检查 Studio 组件设置'
  try {
    await access(config.claudeCodePath, constants.X_OK)
    return ''
  } catch {
    return 'Claude 运行时未就绪，请检查 Studio 组件设置'
  }
}
