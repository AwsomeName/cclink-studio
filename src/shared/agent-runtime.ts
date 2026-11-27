export type AgentRuntimeBinding =
  | { kind: 'codex' }
  | { kind: 'claude-code' }
  | { kind: 'acp'; implementationId: 'codex-acp' }

/** ADR 0028: conversations bound to the retired Codex ACP runtime keep history but cannot run. */
export const RETIRED_ACP_MESSAGE =
  'Codex ACP 已停用。请在运行时菜单切换到 Codex 或 Claude Code 后继续，历史消息会保留。'

export const DEFAULT_AGENT_RUNTIME_BINDING: AgentRuntimeBinding = { kind: 'claude-code' }
/** Default for new local chats and the preferred engine of automatic tasks. Legacy data remains Claude. */
export const NEW_LOCAL_AGENT_RUNTIME_BINDING: AgentRuntimeBinding = { kind: 'codex' }

export function normalizeAgentRuntimeBinding(value: unknown): AgentRuntimeBinding {
  if (!value || typeof value !== 'object') return DEFAULT_AGENT_RUNTIME_BINDING
  const candidate = value as { kind?: unknown; implementationId?: unknown }
  if (candidate.kind === 'codex') return { kind: 'codex' }
  if (candidate.kind === 'acp' && candidate.implementationId === 'codex-acp') {
    return { kind: 'acp', implementationId: 'codex-acp' }
  }
  return DEFAULT_AGENT_RUNTIME_BINDING
}

export function agentRuntimeBindingsEqual(
  left: AgentRuntimeBinding,
  right: AgentRuntimeBinding,
): boolean {
  return (
    left.kind === right.kind &&
    (left.kind !== 'acp' ||
      (right.kind === 'acp' && left.implementationId === right.implementationId))
  )
}
