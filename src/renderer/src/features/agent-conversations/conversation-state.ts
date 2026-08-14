import type { AgentContextUsageSnapshot } from '@shared/agent-protocol'
import type { WorkspaceRef } from '@shared/workspace-ref'
import type { AgentImageAttachment } from '@shared/ipc/agent'
import { DEFAULT_AGENT_RUNTIME_BINDING, type AgentRuntimeBinding } from '@shared/agent-runtime'
import {
  createDefaultAgentConversationConfiguration,
  type AgentConversationConfiguration,
  type AgentConversationConfigurationEvent,
  type AgentRoleRef,
  type AgentRunConfigurationReceipt,
} from '@shared/agent-role'
import type {
  AgentBackendState,
  AgentMessage,
  AgentMountedResource,
  AgentMountedSkill,
  AgentScope,
  ConversationRuntimeRef,
  ConversationSurface,
} from '../../types'

export type AgentRunStatus =
  | 'idle'
  | 'starting'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted'

export type AgentRunTerminalReason =
  | 'completed'
  | 'error'
  | 'stream-ended'
  | 'cancelled'
  | 'runtime-lost'
  | 'runtime-unavailable'

export interface AgentContextCompactionState {
  status: 'idle' | 'compacting' | 'completed' | 'failed'
  trigger: 'manual' | 'auto' | null
  preTokens: number | null
  postTokens: number | null
  error: string | null
  updatedAt: number | null
}

export interface AgentConversationState {
  id: string
  title: string
  surface: ConversationSurface
  runtime: ConversationRuntimeRef
  runtimeBinding?: AgentRuntimeBinding
  configuration: AgentConversationConfiguration
  configurationEvents: AgentConversationConfigurationEvent[]
  lastRunConfigurationReceipt: AgentRunConfigurationReceipt | null
  messages: AgentMessage[]
  input: string
  loading: boolean
  backendState: AgentBackendState
  runStatus?: AgentRunStatus
  activeRunId?: string | null
  lastRunEventAt?: number | null
  lastRunTerminalReason?: AgentRunTerminalReason | null
  sessionId: string | null
  /** 创建 sessionId 时的运行时/API/模型指纹；旧快照可缺省。 */
  sessionCompatibilityFingerprint?: string | null
  streamingMessageId: string | null
  lastCost: number | null
  contextUsage: AgentContextUsageSnapshot | null
  contextCompaction: AgentContextCompactionState
  scope: AgentScope
  mountedResources: AgentMountedResource[]
  /** Full image data is transient and is removed before workspace persistence. */
  pendingImages?: AgentImageAttachment[]
  mountedSkills: AgentMountedSkill[]
  createdAt: number
  updatedAt: number
  archivedAt: number | null
}

export const DEFAULT_CONVERSATION_ID = 'agent-default'

function createWelcomeMessage(): AgentMessage {
  return {
    id: 'welcome',
    role: 'assistant',
    content: [
      {
        type: 'text',
        text: '你好！我是 CCLink Studio 的本地 Agent。\n\n你可以用自然语言和我对话，我会帮你完成代码、文档和本地工作区任务。新 Thread 默认使用 Claude Code，也可以在发送第一条消息前选择 Codex ACP。',
      },
    ],
    rawText:
      '你好！我是 CCLink Studio 的本地 Agent。\n\n你可以用自然语言和我对话，我会帮你完成代码、文档和本地工作区任务。新 Thread 默认使用 Claude Code，也可以在发送第一条消息前选择 Codex ACP。',
    timestamp: Date.now(),
  }
}

export function createAgentConversationState(
  id = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  options: {
    surface?: ConversationSurface
    runtime?: ConversationRuntimeRef
    runtimeBinding?: AgentRuntimeBinding
    workspaceRef?: WorkspaceRef
    roleRef?: AgentRoleRef
    input?: string
    mountedResources?: AgentMountedResource[]
    mountedSkills?: AgentMountedSkill[]
  } = {},
): AgentConversationState {
  const now = Date.now()
  const runtime = options.runtime ?? {
    location: 'local',
    transport: 'local',
    backend: 'cclink-studio-agent',
    ...(options.workspaceRef ? { workspaceRef: options.workspaceRef } : {}),
  }
  return {
    id,
    title: '新会话',
    surface: options.surface ?? 'assistant-panel',
    runtime,
    runtimeBinding: options.runtimeBinding ?? DEFAULT_AGENT_RUNTIME_BINDING,
    configuration: createDefaultAgentConversationConfiguration(now, options.roleRef),
    configurationEvents: [],
    lastRunConfigurationReceipt: null,
    messages: [createWelcomeMessage()],
    input: options.input ?? '',
    loading: false,
    backendState: 'disconnected',
    runStatus: 'idle',
    activeRunId: null,
    lastRunEventAt: null,
    lastRunTerminalReason: null,
    sessionId: null,
    sessionCompatibilityFingerprint: null,
    streamingMessageId: null,
    lastCost: null,
    contextUsage: null,
    contextCompaction: {
      status: 'idle',
      trigger: null,
      preTokens: null,
      postTokens: null,
      error: null,
      updatedAt: null,
    },
    scope: { kind: 'all' },
    mountedResources: options.mountedResources ?? [],
    pendingImages: [],
    mountedSkills: options.mountedSkills ?? [],
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  }
}
