import type { AgentSendMessagePayload, AgentSendResource, AgentSendSkill } from '@shared/ipc/agent'
import type { AgentConversationState } from '../../stores/agent-store'
import type { AgentMountedResource, AgentMountedSkill } from '../../types'
import type { AgentResourceCandidate, AgentSkillCandidate } from './view-model'

export const MAX_FILE_RANGE_BYTES = 32 * 1024
export const MAX_FILE_RANGE_LINES = 200
export const MAX_MESSAGE_FILE_RANGE_BYTES = 64 * 1024

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
    id: skill.id,
    name: skill.name,
    label: skill.label,
    description: skill.description,
    source: skill.source,
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
): AgentMountedResource[] {
  return resources.filter((resource) => resource.kind === 'file-range')
}

export function toSendSkills(skills: AgentMountedSkill[]): AgentSendSkill[] {
  return skills.map((skill) => ({
    id: skill.id,
    name: skill.name,
    label: skill.label,
    description: skill.description,
    source: skill.source,
  }))
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
    sessionId: conversation?.sessionId ?? null,
    ...(conversation?.runtime.workspaceRef
      ? { workspaceRef: conversation.runtime.workspaceRef }
      : {}),
  }
}

export function stripTrailingMentionToken(text: string): string {
  return text.replace(/(^|\s)([@/])([^\s@/]*)$/, '$1').trimEnd()
}
