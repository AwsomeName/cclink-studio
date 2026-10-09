import type { WorkspaceRef } from '@shared/workspace-ref'
import { useAgentStore } from '../../stores/agent-store'
import { useTabStore } from '../../stores/tab-store'
import { useWorkspaceStore } from '../../stores/workspace-store'

export interface CadAutoOpenStreamEvent {
  protocol?: 'studio-agent-event-v1'
  type?: string
  conversationId?: string
  runId?: string
  message?: {
    content?: Array<{
      type?: string
      tool_use_id?: string
      content?: unknown
      is_error?: boolean
    }>
  }
  event?: {
    type?: string
    toolCallId?: string
    name?: string
    status?: string | null
    output?: unknown
  }
}

interface CadModificationResultEnvelope {
  kind: 'cad-modification-result'
  success: true
  outputPath: string
}

interface CadAutoOpenRuntime {
  activeConversationId: string
  activeRunId?: string | null
  workspaceRef: WorkspaceRef
  findToolName: (toolUseId: string) => string | undefined
  openModel: (outputPath: string, workspaceRef: WorkspaceRef) => void
  consumedToolUseIds: Set<string>
}

const consumedToolUseIds = new Set<string>()

function isCadModifyToolName(toolName: string | undefined): boolean {
  return toolName === 'cad_modify_step' || toolName?.endsWith('__cad_modify_step') === true
}

function parseJsonString(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function findCadResult(value: unknown, depth = 0): CadModificationResultEnvelope | null {
  if (depth > 4) return null
  if (typeof value === 'string') return findCadResult(parseJsonString(value), depth + 1)
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = findCadResult(item, depth + 1)
      if (result) return result
    }
    return null
  }
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (
    record.kind === 'cad-modification-result' &&
    record.success === true &&
    typeof record.outputPath === 'string'
  ) {
    return record as unknown as CadModificationResultEnvelope
  }
  if ('text' in record) {
    const result = findCadResult(record.text, depth + 1)
    if (result) return result
  }
  if ('structuredContent' in record) {
    const result = findCadResult(record.structuredContent, depth + 1)
    if (result) return result
  }
  if ('content' in record) return findCadResult(record.content, depth + 1)
  return null
}

function normalizeAbsolutePath(value: string): string | null {
  const normalized = value.replaceAll('\\', '/').replace(/\/+$/u, '') || '/'
  if (!normalized.startsWith('/')) return null
  const segments: string[] = []
  for (const segment of normalized.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (segments.length === 0) return null
      segments.pop()
    } else {
      segments.push(segment)
    }
  }
  return `/${segments.join('/')}`
}

function isWithinWorkspace(workspaceRoot: string, outputPath: string): boolean {
  const root = normalizeAbsolutePath(workspaceRoot)
  const target = normalizeAbsolutePath(outputPath)
  if (!root || !target) return false
  return target === root || target.startsWith(`${root}/`)
}

function defaultRuntime(): CadAutoOpenRuntime {
  const agent = useAgentStore.getState()
  const activeConversation = agent.conversations[agent.activeConversationId]
  return {
    activeConversationId: agent.activeConversationId,
    activeRunId: activeConversation?.activeRunId,
    workspaceRef: useWorkspaceStore.getState().activeWorkspaceRef,
    findToolName: (toolUseId) => {
      for (const message of activeConversation?.messages ?? []) {
        for (const block of message.content) {
          if (block.type === 'tool_use' && block.id === toolUseId) return block.name
        }
      }
      return undefined
    },
    openModel: (outputPath, workspaceRef) => {
      const title = outputPath.split('/').filter(Boolean).at(-1) ?? outputPath
      useTabStore.getState().openTab({
        type: 'model',
        title,
        icon: '⚙',
        filePath: outputPath,
        workspaceRef,
      })
    },
    consumedToolUseIds,
  }
}

export function handleCadModificationStreamEvent(
  event: CadAutoOpenStreamEvent,
  runtime: CadAutoOpenRuntime = defaultRuntime(),
): boolean {
  if (
    !event.conversationId ||
    event.conversationId !== runtime.activeConversationId ||
    !event.runId ||
    event.runId !== runtime.activeRunId ||
    runtime.workspaceRef.kind !== 'local'
  ) {
    return false
  }

  const candidates: Array<{ toolUseId: string; toolName?: string; output: unknown }> = []
  if (
    event.protocol === 'studio-agent-event-v1' &&
    event.event?.type === 'tool' &&
    event.event.toolCallId &&
    event.event.status === 'completed'
  ) {
    candidates.push({
      toolUseId: event.event.toolCallId,
      toolName: event.event.name ?? runtime.findToolName(event.event.toolCallId),
      output: event.event.output,
    })
  } else if (event.type === 'user') {
    for (const block of event.message?.content ?? []) {
      if (block.type !== 'tool_result' || !block.tool_use_id || block.is_error === true) continue
      candidates.push({
        toolUseId: block.tool_use_id,
        toolName: runtime.findToolName(block.tool_use_id),
        output: block.content,
      })
    }
  }

  for (const candidate of candidates) {
    if (
      !isCadModifyToolName(candidate.toolName) ||
      runtime.consumedToolUseIds.has(candidate.toolUseId)
    ) {
      continue
    }
    const result = findCadResult(candidate.output)
    if (!result || !isWithinWorkspace(runtime.workspaceRef.path, result.outputPath)) continue
    runtime.openModel(result.outputPath, runtime.workspaceRef)
    runtime.consumedToolUseIds.add(candidate.toolUseId)
    return true
  }
  return false
}

export function resetCadModificationAutoOpenForTests(): void {
  consumedToolUseIds.clear()
}
