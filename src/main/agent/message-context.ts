import type {
  AgentConversationContinuity,
  AgentImageAttachment,
  AgentSendResource,
} from '../../shared/ipc/agent'
import type { AgentResourceContextSnapshot } from '../../shared/agent-resource-context'
import type { WorkspaceRef } from '../../shared/workspace-ref'
import type { AgentConversationConfiguration } from '../../shared/agent-role'
import type { AgentSkillRef } from '../../shared/agent-role'
import type { AgentRuntimeBinding } from '../../shared/agent-runtime'

export interface AgentSendMessageContext {
  runtimeBinding?: AgentRuntimeBinding
  resources?: AgentSendResource[]
  skills?: AgentSkillRef[]
  images?: AgentImageAttachment[]
  runId?: string
  sessionId?: string | null
  sessionCompatibilityFingerprint?: string | null
  configuration?: AgentConversationConfiguration
  workspaceRef?: WorkspaceRef
  resourceContext?: AgentResourceContextSnapshot
  continuity?: AgentConversationContinuity
  /** main-owned exact MCP allowlist for product runs. */
  allowedTools?: string[]
  /** Disable backend-native file/shell/network tools for product runs. */
  disableBuiltinTools?: boolean
  /** main-owned product policy; renderer IPC never accepts this field. */
  articlePublishingPolicy?: import('../agent-core/tools/types.js').ToolExecutionContext['articlePublishingPolicy']
  /**
   * BrowserTask 已创建、但 Agent 尚未获得 MCP 工具前调用。产品编排必须在这里
   * 先持久化 Runtime binding，禁止“先执行、结束后才登记 owner”。
   */
  onRunPrepared?: (input: {
    conversationId: string
    runId: string
    browserTaskRunId: string | null
  }) => Promise<void>
}

type AgentCompiledMessageContext = Omit<AgentSendMessageContext, 'skills'> & {
  skills?: AgentResolvedSkillContext[]
}

export interface AgentResolvedSkillContext {
  skillId: string
  version: number
  label: string
  description: string
  source: 'builtin' | 'user' | 'workspace'
  contentHash: string
  markdown: string
}

const MAX_CONTEXT_RESOURCES = 20
const MAX_CONTEXT_SKILLS = 8
const MAX_FIELD_LENGTH = 180
const MAX_FILE_RANGE_BYTES = 32 * 1024
const MAX_MESSAGE_FILE_RANGE_BYTES = 64 * 1024

export function buildAgentMessageWithContext(
  message: string,
  context?: AgentCompiledMessageContext,
): string {
  const resources = normalizeResources(context?.resources)
  const skills = normalizeSkills(context?.skills)
  if (resources.length === 0 && skills.length === 0) return message

  return [
    'CCLink Studio 会话上下文:',
    '以下是用户显式挂载到当前消息的资源索引和 Skill。不要把资源索引当作资源正文。需要读取文件、查看网页或操作 Tab 时，必须使用可用工具并遵守权限确认。Skill 表示用户希望本轮遵循的流程风格，不代表可以执行未授权代码。',
    JSON.stringify(
      {
        mountedResources: resources,
        mountedSkills: skills,
      },
      null,
      2,
    ),
    '',
    '用户消息:',
    message,
  ].join('\n')
}

function normalizeResources(resources?: AgentSendResource[]): AgentSendResource[] {
  let rangeBytes = 0
  return (resources ?? []).slice(0, MAX_CONTEXT_RESOURCES).flatMap((resource) => {
    const snapshot = resource.ref.sourceSnapshot ?? ''
    if (resource.kind === 'file-range') {
      const bytes = Buffer.byteLength(snapshot, 'utf-8')
      if (
        !snapshot ||
        bytes > MAX_FILE_RANGE_BYTES ||
        rangeBytes + bytes > MAX_MESSAGE_FILE_RANGE_BYTES
      ) {
        return []
      }
      rangeBytes += bytes
    }
    return [
      {
        id: truncate(resource.id),
        kind: resource.kind,
        label: truncate(resource.label),
        ...(resource.detail ? { detail: truncate(resource.detail) } : {}),
        ref: {
          type: resource.ref.type,
          ...(resource.ref.path ? { path: truncate(resource.ref.path) } : {}),
          ...(resource.ref.tabId ? { tabId: truncate(resource.ref.tabId) } : {}),
          ...(resource.ref.workspaceKey !== undefined
            ? {
                workspaceKey: resource.ref.workspaceKey
                  ? truncate(resource.ref.workspaceKey)
                  : null,
              }
            : {}),
          ...(resource.ref.sourceId ? { sourceId: truncate(resource.ref.sourceId) } : {}),
          ...(resource.ref.collection ? { collection: truncate(resource.ref.collection) } : {}),
          ...(resource.ref.savedQueryId
            ? { savedQueryId: truncate(resource.ref.savedQueryId) }
            : {}),
          ...(resource.ref.queryId ? { queryId: truncate(resource.ref.queryId) } : {}),
          ...(resource.ref.recordId ? { recordId: truncate(resource.ref.recordId) } : {}),
          ...(resource.ref.sourceUrl ? { sourceUrl: truncate(resource.ref.sourceUrl) } : {}),
          ...(resource.ref.publishedAt ? { publishedAt: truncate(resource.ref.publishedAt) } : {}),
          ...(resource.ref.collectedAt ? { collectedAt: truncate(resource.ref.collectedAt) } : {}),
          ...(resource.ref.executedAt ? { executedAt: truncate(resource.ref.executedAt) } : {}),
          ...(typeof resource.ref.total === 'number' ? { total: resource.ref.total } : {}),
          ...(typeof resource.ref.returned === 'number' ? { returned: resource.ref.returned } : {}),
          ...(typeof resource.ref.truncated === 'boolean'
            ? { truncated: resource.ref.truncated }
            : {}),
          ...(resource.ref.format ? { format: resource.ref.format } : {}),
          ...(typeof resource.ref.startLine === 'number'
            ? { startLine: resource.ref.startLine }
            : {}),
          ...(typeof resource.ref.endLine === 'number' ? { endLine: resource.ref.endLine } : {}),
          ...(typeof resource.ref.startColumn === 'number'
            ? { startColumn: resource.ref.startColumn }
            : {}),
          ...(typeof resource.ref.endColumn === 'number'
            ? { endColumn: resource.ref.endColumn }
            : {}),
          ...(resource.ref.selectedText
            ? { selectedText: resource.ref.selectedText.slice(0, MAX_FILE_RANGE_BYTES) }
            : {}),
          ...(snapshot ? { sourceSnapshot: snapshot } : {}),
          ...(resource.ref.snapshotHash
            ? { snapshotHash: truncate(resource.ref.snapshotHash) }
            : {}),
          ...(typeof resource.ref.dirty === 'boolean' ? { dirty: resource.ref.dirty } : {}),
          ...(resource.ref.mediaType ? { mediaType: resource.ref.mediaType } : {}),
          ...(typeof resource.ref.size === 'number' ? { size: resource.ref.size } : {}),
        },
      },
    ]
  })
}

function normalizeSkills(skills?: AgentResolvedSkillContext[]): AgentResolvedSkillContext[] {
  return (skills ?? []).slice(0, MAX_CONTEXT_SKILLS).map((skill) => ({
    skillId: truncate(skill.skillId),
    version: skill.version,
    label: truncate(skill.label),
    description: truncate(skill.description),
    source: skill.source,
    contentHash: skill.contentHash,
    markdown: skill.markdown,
  }))
}

function truncate(value: string): string {
  return value.length <= MAX_FIELD_LENGTH ? value : `${value.slice(0, MAX_FIELD_LENGTH - 3)}...`
}
