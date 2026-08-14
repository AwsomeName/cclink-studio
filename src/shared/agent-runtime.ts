export type AgentRuntimeBinding =
  | { kind: 'claude-code' }
  | { kind: 'acp'; implementationId: 'codex-acp' }

export const DEFAULT_AGENT_RUNTIME_BINDING: AgentRuntimeBinding = { kind: 'claude-code' }

export function normalizeAgentRuntimeBinding(value: unknown): AgentRuntimeBinding {
  if (!value || typeof value !== 'object') return DEFAULT_AGENT_RUNTIME_BINDING
  const candidate = value as { kind?: unknown; implementationId?: unknown }
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
