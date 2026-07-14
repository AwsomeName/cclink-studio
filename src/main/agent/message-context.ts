import type { AgentSendResource, AgentSendSkill } from '../../shared/ipc/agent'

export interface AgentSendMessageContext {
  resources?: AgentSendResource[]
  skills?: AgentSendSkill[]
}

const MAX_CONTEXT_RESOURCES = 20
const MAX_CONTEXT_SKILLS = 8
const MAX_FIELD_LENGTH = 180

export function buildAgentMessageWithContext(
  message: string,
  context?: AgentSendMessageContext,
): string {
  const resources = normalizeResources(context?.resources)
  const skills = normalizeSkills(context?.skills)
  if (resources.length === 0 && skills.length === 0) return message

  return [
    'DeepInk 会话上下文:',
    '以下是用户显式挂载到当前会话的资源索引和 Skill。不要把资源索引当作资源正文；需要读取文件、查看网页或操作 Tab 时，必须使用可用工具并遵守权限确认。Skill 表示用户希望本轮遵循的流程风格，不代表可以执行未授权代码。',
    JSON.stringify({ mountedResources: resources, mountedSkills: skills }, null, 2),
    '',
    '用户消息:',
    message,
  ].join('\n')
}

function normalizeResources(resources?: AgentSendResource[]): AgentSendResource[] {
  return (resources ?? []).slice(0, MAX_CONTEXT_RESOURCES).map((resource) => ({
    id: truncate(resource.id),
    kind: resource.kind,
    label: truncate(resource.label),
    ...(resource.detail ? { detail: truncate(resource.detail) } : {}),
    ref: {
      type: resource.ref.type,
      ...(resource.ref.path ? { path: truncate(resource.ref.path) } : {}),
      ...(resource.ref.tabId ? { tabId: truncate(resource.ref.tabId) } : {}),
      ...(resource.ref.workspaceKey !== undefined
        ? { workspaceKey: resource.ref.workspaceKey ? truncate(resource.ref.workspaceKey) : null }
        : {}),
    },
  }))
}

function normalizeSkills(skills?: AgentSendSkill[]): AgentSendSkill[] {
  return (skills ?? []).slice(0, MAX_CONTEXT_SKILLS).map((skill) => ({
    id: truncate(skill.id),
    name: truncate(skill.name),
    label: truncate(skill.label),
    ...(skill.description ? { description: truncate(skill.description) } : {}),
    ...(skill.source ? { source: skill.source } : {}),
  }))
}

function truncate(value: string): string {
  return value.length <= MAX_FIELD_LENGTH ? value : `${value.slice(0, MAX_FIELD_LENGTH - 3)}...`
}
