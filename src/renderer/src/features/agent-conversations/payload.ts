import type {
  AgentConversationContinuity,
  AgentImageAttachment,
  AgentSendMessagePayload,
  AgentSendResource,
  AgentSendSkill,
} from '@shared/ipc/agent'
import type { AgentConversationState } from '../../stores/agent-store'
import type { AgentMessage, AgentMountedResource, AgentMountedSkill } from '../../types'
import type { AgentResourceCandidate, AgentSkillCandidate } from './view-model'

export const MAX_FILE_RANGE_BYTES = 32 * 1024
export const MAX_FILE_RANGE_LINES = 200
export const MAX_MESSAGE_FILE_RANGE_BYTES = 64 * 1024
const MAX_CONTINUITY_MESSAGES = 10
const MAX_CONTINUITY_RECENT_MESSAGES = 6
const MAX_CONTINUITY_USER_MESSAGES = 4
const MAX_CONTINUITY_MESSAGE_LENGTH = 1200
const MAX_CONTINUITY_TASKS = 12

export function toMountedResource(resource: AgentResourceCandidate): AgentMountedResource {
  return {
    id: resource.id,
    kind: resource.kind,
    label: resource.label,
    detail: resource.detail,
    ref: resource.ref,
  }
}

export function toMountedSkill(skill: AgentSkillCandidate): AgentMountedSkill {
  return {
    skillId: skill.skillId,
    version: skill.version,
  }
}

export function toSendResources(resources: AgentMountedResource[]): AgentSendResource[] {
  let rangeBytes = 0
  return resources.flatMap((resource) => {
    if (resource.kind === 'file-range') {
      const snapshot = resource.ref.sourceSnapshot ?? ''
      const lines =
        typeof resource.ref.startLine === 'number' && typeof resource.ref.endLine === 'number'
          ? resource.ref.endLine - resource.ref.startLine + 1
          : snapshot.split('\n').length
      const bytes = new TextEncoder().encode(snapshot).byteLength
      if (
        !snapshot ||
        lines > MAX_FILE_RANGE_LINES ||
        bytes > MAX_FILE_RANGE_BYTES ||
        rangeBytes + bytes > MAX_MESSAGE_FILE_RANGE_BYTES
      ) {
        return []
      }
      rangeBytes += bytes
    }
    return [
      {
        id: resource.id,
        kind: resource.kind,
        label: resource.label,
        detail: resource.detail,
        ref: resource.ref,
      },
    ]
  })
}

export function transientMessageResources(
  resources: AgentMountedResource[],
  images: AgentImageAttachment[] = [],
): AgentMountedResource[] {
  return [
    ...resources.filter((resource) => resource.kind === 'file-range'),
    ...images.map((image) => ({
      id: image.id,
      kind: 'image' as const,
      label: image.name,
      detail: `${image.mediaType} · ${formatBytes(image.size)}`,
      ref: {
        type: 'image' as const,
        mediaType: image.mediaType,
        size: image.size,
      },
    })),
  ]
}

export function toSendSkills(skills: AgentMountedSkill[]): AgentSendSkill[] {
  return skills.map((skill) => ({ ...skill }))
}

export function buildAgentSendPayload(
  message: string,
  conversation: AgentConversationState | undefined,
  runId?: string,
): AgentSendMessagePayload {
  return {
    message,
    ...(runId ? { runId } : {}),
    resources: toSendResources(conversation?.mountedResources ?? []),
    skills: toSendSkills(conversation?.mountedSkills ?? []),
    images: conversation?.pendingImages ?? [],
    sessionId: conversation?.sessionId ?? null,
    sessionCompatibilityFingerprint: conversation?.sessionCompatibilityFingerprint ?? null,
    configuration: conversation?.configuration,
    continuity: buildConversationContinuity(conversation, message),
    ...(conversation?.runtime.workspaceRef
      ? { workspaceRef: conversation.runtime.workspaceRef }
      : {}),
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function buildConversationContinuity(
  conversation: AgentConversationState | undefined,
  currentMessage: string,
): AgentConversationContinuity | undefined {
  if (!conversation) return undefined
  const messages = [...conversation.messages]
  const lastMessage = messages.at(-1)
  if (lastMessage?.role === 'user' && lastMessage.rawText.trim() === currentMessage.trim()) {
    messages.pop()
  }

  const continuityCandidates = messages.flatMap((message, index) => {
    const text = getContinuityMessageText(message)
    return text ? [{ index, role: message.role, text: truncateContinuityText(text) }] : []
  })
  const selectedMessageIndexes = new Set([
    ...continuityCandidates.slice(-MAX_CONTINUITY_RECENT_MESSAGES).map(({ index }) => index),
    ...continuityCandidates
      .filter(({ role }) => role === 'user')
      .slice(-MAX_CONTINUITY_USER_MESSAGES)
      .map(({ index }) => index),
  ])
  const recentMessages = continuityCandidates
    .filter(({ index }) => selectedMessageIndexes.has(index))
    .slice(-MAX_CONTINUITY_MESSAGES)
    .map(({ role, text }) => ({ role, text }))
  const tasks = findLatestTasks(messages)

  return recentMessages.length > 0 || tasks.length > 0 ? { recentMessages, tasks } : undefined
}

function getContinuityMessageText(message: AgentMessage): string {
  if (message.role === 'assistant') {
    const visibleText = message.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('\n')
      .trim()
    return visibleText
  }
  return message.rawText.trim()
}

function truncateContinuityText(text: string): string {
  if (text.length <= MAX_CONTINUITY_MESSAGE_LENGTH) return text
  const tailLength = 320
  return `${text.slice(0, MAX_CONTINUITY_MESSAGE_LENGTH - tailLength - 5)}\n...\n${text.slice(-tailLength)}`
}

function findLatestTasks(messages: AgentMessage[]): AgentConversationContinuity['tasks'] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message) continue
    for (let blockIndex = message.content.length - 1; blockIndex >= 0; blockIndex -= 1) {
      const block = message.content[blockIndex]
      if (block?.type !== 'tool_use' || block.name !== 'TodoWrite') continue
      const todos = Array.isArray(block.input.todos) ? block.input.todos : []
      return todos.slice(0, MAX_CONTINUITY_TASKS).flatMap((todo) => {
        if (!todo || typeof todo !== 'object') return []
        const candidate = todo as { content?: unknown; status?: unknown }
        if (
          typeof candidate.content !== 'string' ||
          !candidate.content.trim() ||
          (candidate.status !== 'pending' &&
            candidate.status !== 'in_progress' &&
            candidate.status !== 'completed')
        ) {
          return []
        }
        return [
          {
            content: candidate.content.trim().slice(0, 300),
            status: candidate.status,
          },
        ]
      })
    }
  }
  return []
}

export function stripTrailingMentionToken(text: string): string {
  return text.replace(/(^|\s)([@/])([^\s@/]*)$/, '$1').trimEnd()
}
