import type { WorkspaceRef } from '../../../../shared/workspace-ref'
import {
  workspaceRefKey,
  workspaceRefLabel,
  workspaceRefSourceLabel,
} from '../../../../shared/workspace-ref'
import type { AgentConversationState } from '../../stores/agent-store'
import type {
  AgentMountedResource,
  AgentMountedResourceKind,
  AgentMountedSkill,
  AgentScope,
  Tab,
} from '../../types'

export type SessionGroupKey = 'active' | 'today' | 'yesterday' | 'week' | 'earlier'
export type SessionFilter = 'all' | 'workspace' | 'unbound' | 'running'

export interface AgentSessionSummary {
  id: string
  title: string
  subtitle: string
  preview: string
  updatedAt: number
  messageCount: number
  loading: boolean
  sessionId: string | null
  isActive: boolean
  workspaceLabel: string
  workspaceSource: string
  workspaceKey: string | null
  isWorkspaceBound: boolean
  group: SessionGroupKey
  createdAt: number
  surface: AgentConversationState['surface']
  runtimeLabel: string
  statusLabel: string
}

export interface AgentSessionGroup {
  key: SessionGroupKey
  label: string
  sessions: AgentSessionSummary[]
}

export interface AgentContextChip {
  id: string
  label: string
  detail?: string
  kind: 'workspace' | 'scope' | 'tab' | 'file' | 'browser' | 'android' | 'more'
  muted?: boolean
}

export interface AgentSessionStats {
  total: number
  workspaceBound: number
  unbound: number
  running: number
}

export interface AgentSessionDetail {
  title: string
  preview: string
  rows: Array<{
    label: string
    value: string
    title?: string
  }>
}

export interface ProjectAssistantSessions {
  active: AgentSessionSummary[]
  closed: AgentSessionSummary[]
}

export type AgentResourceCandidate = AgentMountedResource & {
  source: 'selected-file' | 'open-tab' | 'draft'
  searchText: string
}

export type AgentSkillCandidate = AgentMountedSkill & {
  searchText: string
}

const DEFAULT_AGENT_SKILLS: AgentMountedSkill[] = [
  {
    id: 'grill-me',
    name: 'grill-me',
    label: 'grill-me',
    description: '用 /grilling 风格拷问方案、假设、边界、失败路径和下一步。',
    source: 'user',
  },
]

const GROUP_LABELS: Record<SessionGroupKey, string> = {
  active: '当前',
  today: '今天',
  yesterday: '昨天',
  week: '本周',
  earlier: '更早',
}

export function buildAssistantPanelSessionGroups({
  conversations,
  conversationOrder,
  activeConversationId,
  searchQuery = '',
  filter = 'all',
  activeWorkspaceRef,
  now = Date.now(),
}: {
  conversations: Record<string, AgentConversationState>
  conversationOrder: string[]
  activeConversationId: string
  searchQuery?: string
  filter?: SessionFilter
  activeWorkspaceRef?: WorkspaceRef
  now?: number
}): AgentSessionGroup[] {
  const summaries = conversationOrder
    .flatMap((id) => {
      const conversation = conversations[id]
      if (!conversation || conversation.surface !== 'assistant-panel' || conversation.archivedAt) {
        return []
      }
      return [
        buildSessionSummary({
          conversation,
          activeConversationId,
          now,
        }),
      ]
    })
    .filter((summary) =>
      matchesSessionFilters({
        summary,
        searchQuery,
        filter,
        activeWorkspaceRef,
      }),
    )
    .sort((a, b) => {
      if (a.id === activeConversationId) return -1
      if (b.id === activeConversationId) return 1
      return b.updatedAt - a.updatedAt
    })

  const grouped = new Map<SessionGroupKey, AgentSessionSummary[]>()
  for (const summary of summaries) {
    const key = summary.isActive ? 'active' : summary.group
    grouped.set(key, [...(grouped.get(key) ?? []), summary])
  }

  return (['active', 'today', 'yesterday', 'week', 'earlier'] as const)
    .map((key) => ({
      key,
      label: GROUP_LABELS[key],
      sessions: grouped.get(key) ?? [],
    }))
    .filter((group) => group.sessions.length > 0)
}

export function buildArchivedAssistantPanelSessions({
  conversations,
  conversationOrder,
  activeConversationId,
  searchQuery = '',
  filter = 'all',
  activeWorkspaceRef,
  now = Date.now(),
}: {
  conversations: Record<string, AgentConversationState>
  conversationOrder: string[]
  activeConversationId: string
  searchQuery?: string
  filter?: SessionFilter
  activeWorkspaceRef?: WorkspaceRef
  now?: number
}): AgentSessionSummary[] {
  return conversationOrder
    .flatMap((id) => {
      const conversation = conversations[id]
      if (!conversation || conversation.surface !== 'assistant-panel' || !conversation.archivedAt) {
        return []
      }
      return [
        buildSessionSummary({
          conversation,
          activeConversationId,
          now,
        }),
      ]
    })
    .filter((summary) =>
      matchesSessionFilters({
        summary,
        searchQuery,
        filter,
        activeWorkspaceRef,
      }),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export function buildAssistantPanelSessionStats({
  conversations,
  conversationOrder,
}: {
  conversations: Record<string, AgentConversationState>
  conversationOrder: string[]
}): AgentSessionStats {
  const sessions = conversationOrder
    .map((id) => conversations[id])
    .filter(
      (conversation): conversation is AgentConversationState =>
        Boolean(conversation) &&
        conversation.surface === 'assistant-panel' &&
        !conversation.archivedAt,
    )

  return {
    total: sessions.length,
    workspaceBound: sessions.filter((session) => Boolean(session.runtime.workspaceRef)).length,
    unbound: sessions.filter((session) => !session.runtime.workspaceRef).length,
    running: sessions.filter((session) => session.loading).length,
  }
}

export function buildProjectAssistantSessions({
  conversations,
  conversationOrder,
  activeConversationId,
  activeWorkspaceRef,
  now = Date.now(),
}: {
  conversations: Record<string, AgentConversationState>
  conversationOrder: string[]
  activeConversationId: string
  activeWorkspaceRef: WorkspaceRef
  now?: number
}): ProjectAssistantSessions {
  const workspaceKey = workspaceRefKey(activeWorkspaceRef)
  const summaries = conversationOrder
    .flatMap((id) => {
      const conversation = conversations[id]
      if (!conversation || conversation.surface !== 'assistant-panel') return []
      const conversationKey = conversation.runtime.workspaceRef
        ? workspaceRefKey(conversation.runtime.workspaceRef)
        : null
      if (conversationKey !== workspaceKey) return []
      return [
        buildSessionSummary({
          conversation,
          activeConversationId,
          now,
        }),
      ]
    })
    .sort((a, b) => {
      if (a.id === activeConversationId) return -1
      if (b.id === activeConversationId) return 1
      return b.updatedAt - a.updatedAt
    })

  return {
    active: summaries.filter((summary) => !conversations[summary.id]?.archivedAt),
    closed: summaries
      .filter((summary) => conversations[summary.id]?.archivedAt)
      .sort((a, b) => b.updatedAt - a.updatedAt),
  }
}

export function buildSessionSummary({
  conversation,
  activeConversationId,
  now = Date.now(),
}: {
  conversation: AgentConversationState
  activeConversationId: string
  now?: number
}): AgentSessionSummary {
  const workspace = conversation.runtime.workspaceRef
  const isWorkspaceBound = Boolean(workspace)
  const workspaceLabel = workspace ? workspaceRefLabel(workspace) : '未绑定工作区'
  const workspaceSource = workspace ? workspaceRefSourceLabel(workspace) : '即时助手'
  const userMessages = conversation.messages.filter((message) => message.role === 'user')
  const assistantMessages = conversation.messages.filter((message) => message.role === 'assistant')
  const lastMeaningful =
    [...conversation.messages]
      .reverse()
      .find((message) => message.id !== 'welcome' && message.rawText.trim()) ?? null

  return {
    id: conversation.id,
    title: conversation.title,
    subtitle: `${workspaceSource} · ${workspaceLabel}`,
    preview:
      getPreviewText(lastMeaningful?.rawText) ||
      getPreviewText(userMessages.at(-1)?.rawText) ||
      '还没有任务内容',
    updatedAt: conversation.updatedAt,
    messageCount: userMessages.length + assistantMessages.length,
    loading: conversation.loading,
    sessionId: conversation.sessionId,
    isActive: conversation.id === activeConversationId,
    workspaceLabel,
    workspaceSource,
    workspaceKey: workspace ? workspaceRefKey(workspace) : null,
    isWorkspaceBound,
    group: getSessionGroup(conversation.updatedAt, now),
    createdAt: conversation.createdAt,
    surface: conversation.surface,
    runtimeLabel: runtimeLabel(conversation),
    statusLabel: conversation.loading ? '运行中' : statusLabel(conversation.backendState),
  }
}

export function buildActiveContextChips({
  activeWorkspaceRef,
  scope,
  activeTab,
  tabs = [],
  editorFiles = {},
}: {
  activeWorkspaceRef: WorkspaceRef
  scope: AgentScope
  activeTab?: Tab
  tabs?: Tab[]
  editorFiles?: Record<string, { dirty: boolean; loading?: boolean }>
}): AgentContextChip[] {
  const chips: AgentContextChip[] = [
    {
      id: 'workspace',
      kind: 'workspace',
      label: workspaceRefLabel(activeWorkspaceRef),
      detail: workspaceRefSourceLabel(activeWorkspaceRef),
    },
    {
      id: 'scope',
      kind: 'scope',
      label: scopeLabel(scope, activeTab),
      detail: '操作目标',
      muted: scope.kind === 'all',
    },
  ]

  if (activeTab) {
    chips.push({
      id: `tab:${activeTab.id}`,
      kind: 'tab',
      label: activeTab.title,
      detail: tabTypeLabel(activeTab),
      muted: activeTab.type === 'settings',
    })
  }

  const openEditorTabs = tabs.filter((tab) => tab.type === 'editor' && tab.id !== activeTab?.id)
  for (const tab of openEditorTabs.slice(0, 2)) {
    chips.push({
      id: `editor:${tab.id}`,
      kind: 'file',
      label: tab.title,
      detail: tab.filePath ? '打开文档' : '草稿',
      muted: !tab.dirty,
    })
  }

  const browserTabs = tabs.filter((tab) => tab.type === 'browser')
  if (browserTabs.length > 0 && activeTab?.type !== 'browser') {
    chips.push({
      id: 'browser-tabs',
      kind: 'browser',
      label: `${browserTabs.length} 个浏览器`,
      detail: '已打开',
    })
  }

  const hasAndroidTab = tabs.some((tab) => tab.type === 'android')
  if (hasAndroidTab && activeTab?.type !== 'android') {
    chips.push({
      id: 'android-tabs',
      kind: 'android',
      label: 'Android',
      detail: '已打开',
    })
  }

  const dirtyDraftCount = Object.entries(editorFiles).filter(
    ([key, file]) => key.startsWith('virtual:') || file.dirty,
  ).length
  if (dirtyDraftCount > 0) {
    chips.push({
      id: 'dirty-drafts',
      kind: 'file',
      label: `${dirtyDraftCount} 个草稿/改动`,
      detail: '未保存',
    })
  }

  const extra = chips.length - 7
  if (extra > 0) {
    return [
      ...chips.slice(0, 6),
      {
        id: 'more',
        kind: 'more',
        label: `还有 ${extra + 1} 项`,
        muted: true,
      },
    ]
  }

  return chips
}

export function buildSessionDetail(summary: AgentSessionSummary | null): AgentSessionDetail | null {
  if (!summary) return null
  return {
    title: summary.title === '新会话' ? '即时助手' : summary.title,
    preview: summary.preview,
    rows: [
      {
        label: '状态',
        value: summary.statusLabel,
      },
      {
        label: '工作区',
        value: `${summary.workspaceSource} · ${summary.workspaceLabel}`,
        title: summary.workspaceKey ?? undefined,
      },
      {
        label: '运行环境',
        value: summary.runtimeLabel,
      },
      {
        label: '消息',
        value: `${summary.messageCount} 条`,
      },
      {
        label: '创建',
        value: formatDateTime(summary.createdAt),
      },
      {
        label: '更新',
        value: formatDateTime(summary.updatedAt),
      },
      ...(summary.sessionId
        ? [
            {
              label: 'Session',
              value: summary.sessionId.slice(0, 12),
              title: summary.sessionId,
            },
          ]
        : []),
    ],
  }
}

export function buildResourceCandidates({
  tabs,
  editorFiles,
  selectedPath,
  query = '',
}: {
  tabs: Tab[]
  editorFiles?: Record<string, { dirty: boolean; loading?: boolean }>
  selectedPath?: string | null
  query?: string
}): AgentResourceCandidate[] {
  const candidates: AgentResourceCandidate[] = []

  if (selectedPath) {
    candidates.push(
      createResourceCandidate({
        id: `file:${selectedPath}`,
        kind: 'file',
        label: basename(selectedPath),
        detail: selectedPath,
        source: 'selected-file',
        ref: { type: 'file', path: selectedPath },
      }),
    )
  }

  for (const tab of tabs) {
    const candidate = tabResourceCandidate(tab)
    if (candidate) candidates.push(candidate)
  }

  for (const [key, file] of Object.entries(editorFiles ?? {})) {
    if (!key.startsWith('virtual:') && !file.dirty) continue
    if (tabs.some((tab) => tab.filePath === key || `virtual:${tab.id}` === key)) continue
    candidates.push(
      createResourceCandidate({
        id: `draft:${key}`,
        kind: 'file',
        label: key.startsWith('virtual:') ? '未命名草稿' : basename(key),
        detail: key.startsWith('virtual:') ? '草稿' : key,
        source: 'draft',
        ref: { type: 'file', path: key },
      }),
    )
  }

  const deduped = dedupeCandidates(candidates)
  const q = query.trim().toLowerCase()
  if (!q) return deduped.slice(0, 8)
  return deduped.filter((candidate) => candidate.searchText.includes(q)).slice(0, 8)
}

export function buildSkillCandidates(query = ''): AgentSkillCandidate[] {
  const q = query.trim().toLowerCase()
  return DEFAULT_AGENT_SKILLS.map((skill) => ({
    ...skill,
    searchText: [skill.name, skill.label, skill.description]
      .filter(Boolean)
      .join(' ')
      .toLowerCase(),
  }))
    .filter((skill) => !q || skill.searchText.includes(q))
    .slice(0, 8)
}

export function createConversationRuntimeForWorkspace(activeWorkspaceRef: WorkspaceRef) {
  return {
    location: activeWorkspaceRef.kind === 'remote' ? 'remote' : 'local',
    transport: activeWorkspaceRef.kind === 'remote' ? activeWorkspaceRef.transport : 'local',
    backend: 'deepink-agent',
    workspaceRef: activeWorkspaceRef,
  } as const
}

function getPreviewText(text?: string): string {
  const normalized = (text ?? '').replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  return normalized.length > 72 ? `${normalized.slice(0, 72)}...` : normalized
}

function matchesSessionFilters({
  summary,
  searchQuery,
  filter,
  activeWorkspaceRef,
}: {
  summary: AgentSessionSummary
  searchQuery: string
  filter: SessionFilter
  activeWorkspaceRef?: WorkspaceRef
}): boolean {
  const query = searchQuery.trim().toLowerCase()
  if (query) {
    const searchable = [
      summary.title,
      summary.preview,
      summary.workspaceLabel,
      summary.workspaceSource,
      summary.sessionId ?? '',
    ]
      .join(' ')
      .toLowerCase()
    if (!searchable.includes(query)) return false
  }

  switch (filter) {
    case 'all':
      return true
    case 'workspace': {
      if (!summary.isWorkspaceBound) return false
      if (!activeWorkspaceRef) return true
      return summary.workspaceKey === workspaceRefKey(activeWorkspaceRef)
    }
    case 'unbound':
      return !summary.isWorkspaceBound
    case 'running':
      return summary.loading
  }
}

function getSessionGroup(updatedAt: number, now: number): SessionGroupKey {
  const oneDay = 24 * 60 * 60 * 1000
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const start = startOfToday.getTime()

  if (updatedAt >= start) return 'today'
  if (updatedAt >= start - oneDay) return 'yesterday'
  if (updatedAt >= now - 7 * oneDay) return 'week'
  return 'earlier'
}

function scopeLabel(scope: AgentScope, activeTab?: Tab): string {
  switch (scope.kind) {
    case 'all':
      return '全部'
    case 'android':
      return 'Android'
    case 'editor':
      return '编辑器'
    case 'browser':
      return activeTab?.type === 'browser' ? activeTab.title : '浏览器'
  }
}

function runtimeLabel(conversation: AgentConversationState): string {
  const location = conversation.runtime.location === 'remote' ? '远程' : '本地'
  const transport =
    conversation.runtime.transport === 'local'
      ? 'Local'
      : conversation.runtime.transport === 'direct'
        ? '直连'
        : 'CCLink'
  const backend = conversation.runtime.backend ?? 'deepink-agent'
  return `${location} · ${transport} · ${backend}`
}

function statusLabel(status: AgentConversationState['backendState']): string {
  switch (status) {
    case 'disconnected':
      return '未连接'
    case 'connecting':
      return '连接中'
    case 'connected':
      return '已就绪'
    case 'streaming':
      return '思考中'
    case 'error':
      return '连接错误'
  }
}

function formatDateTime(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return '未知'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

function tabResourceCandidate(tab: Tab): AgentResourceCandidate | null {
  switch (tab.type) {
    case 'editor':
      return createResourceCandidate({
        id: tab.filePath ? `file:${tab.filePath}` : `tab:${tab.id}`,
        kind: tab.filePath ? 'file' : 'tab',
        label: tab.title,
        detail: tab.filePath ?? '文档 Tab',
        source: 'open-tab',
        ref: tab.filePath
          ? { type: 'file', path: tab.filePath, tabId: tab.id }
          : { type: 'tab', tabId: tab.id },
      })
    case 'browser':
      return createResourceCandidate({
        id: `browser:${tab.id}`,
        kind: 'browser',
        label: tab.title || '浏览器',
        detail: '浏览器 Tab',
        source: 'open-tab',
        ref: { type: 'browser', tabId: tab.id },
      })
    case 'android':
      return createResourceCandidate({
        id: `android:${tab.id}`,
        kind: 'android',
        label: tab.title || 'Android',
        detail: '设备 Tab',
        source: 'open-tab',
        ref: { type: 'android', tabId: tab.id },
      })
    case 'terminal':
      return createResourceCandidate({
        id: `terminal:${tab.id}`,
        kind: 'terminal',
        label: tab.title || 'Terminal',
        detail: '命令会话',
        source: 'open-tab',
        ref: { type: 'terminal', tabId: tab.id },
      })
    case 'remote-file':
      return createResourceCandidate({
        id: `file:${tab.remoteFile?.path ?? tab.id}`,
        kind: 'file',
        label: tab.title,
        detail: tab.remoteFile?.path ?? '远程文件',
        source: 'open-tab',
        ref: { type: 'file', path: tab.remoteFile?.path, tabId: tab.id },
      })
    default:
      return null
  }
}

function createResourceCandidate(input: {
  id: string
  kind: AgentMountedResourceKind
  label: string
  detail?: string
  source: AgentResourceCandidate['source']
  ref: AgentMountedResource['ref']
}): AgentResourceCandidate {
  return {
    id: input.id,
    kind: input.kind,
    label: input.label,
    detail: input.detail,
    source: input.source,
    ref: input.ref,
    searchText: [input.label, input.detail, input.kind].filter(Boolean).join(' ').toLowerCase(),
  }
}

function dedupeCandidates(candidates: AgentResourceCandidate[]): AgentResourceCandidate[] {
  const seen = new Set<string>()
  const result: AgentResourceCandidate[] = []
  for (const candidate of candidates) {
    if (seen.has(candidate.id)) continue
    seen.add(candidate.id)
    result.push(candidate)
  }
  return result
}

function basename(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path
}

function tabTypeLabel(tab: Tab): string {
  switch (tab.type) {
    case 'browser':
      return '浏览器 Tab'
    case 'editor':
      return tab.filePath ? '文档文件' : 'Markdown 草稿'
    case 'android':
      return 'Android'
    case 'conversation':
      return '工作会话'
    case 'model':
      return '模型文件'
    case 'remote-file':
      return '远程文件'
    case 'terminal':
      return '命令会话'
    case 'settings':
      return '设置'
    case 'preview':
      return '预览'
    case 'cclink':
      return '远程会话'
  }
}
