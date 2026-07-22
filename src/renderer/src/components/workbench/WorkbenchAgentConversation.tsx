import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import {
  useAgentStore,
  useDataSourceStore,
  useEditorStore,
  useFsStore,
  useSettingsStore,
  useTabStore,
  useWorkspaceStore,
} from '../../stores'
import type { ConversationRuntimeRef, PermissionMode } from '../../types'
import type { ToolConfirmationRequest } from '../../types'
import {
  workspaceRefKey,
  workspaceRefLabel,
  workspaceRefSourceLabel,
} from '../../../../shared/workspace-ref'
import { ConversationMessageRenderer } from '../common/ConversationMessageRenderer'
import { IconCheck, IconError, IconSend, IconStop, IconTool } from '../common/Icons'
import { ConversationShell, type ConversationShellBadgeKind } from './ConversationShell'
import { AgentComposerToolbar } from '../../features/agent-composer/AgentComposerToolbar'
import { useComposerHistory } from '../../features/agent-composer/use-composer-history'
import { MountedResourceBar } from '../../features/agent-conversations/mounted-resource-bar'
import { MountedSkillStrip } from '../../features/agent-conversations/mounted-skill-strip'
import { getConversationActivity } from '../../features/agent-conversations/activity'
import {
  ResourceCandidateMenu,
  SkillCandidateMenu,
} from '../../features/agent-conversations/context-candidate-menu'
import {
  buildResourceCandidates,
  buildSkillCandidates,
  type AgentResourceCandidate,
  type AgentSkillCandidate,
} from '../../features/agent-conversations/view-model'
import {
  stripTrailingMentionToken,
  toMountedResource,
  toMountedSkill,
} from '../../features/agent-conversations/payload'
import {
  getLocalAgentConversationMeta,
  type ConversationRuntimeAdapterStatus,
} from '../../utils/conversation-runtime-adapter'
import { createConversationRunController } from '../../features/agent-conversations/conversation-run-controller'
import {
  AGENT_FOCUS_COMPOSER_EVENT,
  openFileRangeResource,
} from '../../features/markdown/markdown-navigation'
import { useConversationScroll } from '../../features/agent-conversations/use-conversation-scroll'

export function WorkbenchAgentConversation({
  tabId,
  conversationId,
}: {
  tabId: string
  conversationId: string
}): React.ReactElement {
  const composerRef = useRef<HTMLDivElement>(null)
  const conversation = useAgentStore((state) => state.conversations[conversationId])
  const setInput = useAgentStore((state) => state.setInput)
  const setContextUsage = useAgentStore((state) => state.setContextUsage)
  const restoreArchivedConversation = useAgentStore((state) => state.restoreArchivedConversation)
  const pendingConfirmations = useAgentStore((state) => state.pendingConfirmations)
  const permissionMode = useAgentStore((state) => state.permissionMode)
  const removePendingConfirmation = useAgentStore((state) => state.removePendingConfirmation)
  const setPermissionMode = useAgentStore((state) => state.setPermissionMode)
  const addMountedResource = useAgentStore((state) => state.addMountedResource)
  const removeMountedResource = useAgentStore((state) => state.removeMountedResource)
  const addMountedSkill = useAgentStore((state) => state.addMountedSkill)
  const removeMountedSkill = useAgentStore((state) => state.removeMountedSkill)
  const tabs = useTabStore((state) => state.tabs)
  const openTab = useTabStore((state) => state.openTab)
  const updateTabTitle = useTabStore((state) => state.updateTabTitle)
  const settings = useSettingsStore((state) => state.settings)
  const loadSettings = useSettingsStore((state) => state.loadSettings)
  const editorFiles = useEditorStore((state) => state.files)
  const selectedPath = useFsStore((state) => state.selectedPath)
  const activeWorkspaceRef = useWorkspaceStore((state) => state.activeWorkspaceRef)
  const dataSources = useDataSourceStore((state) => state.sources)
  const savedQueriesBySourceId = useDataSourceStore((state) => state.savedQueriesBySourceId)
  const loadDataSources = useDataSourceStore((state) => state.loadSources)
  const loadSavedQueries = useDataSourceStore((state) => state.loadSavedQueries)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const [resourceQuery, setResourceQuery] = useState<string | null>(null)
  const [skillQuery, setSkillQuery] = useState<string | null>(null)
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0)

  const scrollWorkspaceRef = conversation?.runtime.workspaceRef ?? activeWorkspaceRef
  const conversationScroll = useConversationScroll(
    `${workspaceRefKey(scrollWorkspaceRef) ?? '__global__'}::${conversationId}`,
    conversation?.messages,
  )
  const runController = useMemo(
    () => createConversationRunController({ conversationId }),
    [conversationId],
  )

  useEffect(() => {
    const focusComposer = (): void => inputRef.current?.focus()
    window.addEventListener(AGENT_FOCUS_COMPOSER_EVENT, focusComposer)
    return () => window.removeEventListener(AGENT_FOCUS_COMPOSER_EVENT, focusComposer)
  }, [])

  useEffect(() => {
    if (!conversation) return
    updateTabTitle(tabId, conversation.title === '新会话' ? '新工作会话' : conversation.title)
  }, [conversation, tabId, updateTabTitle])

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  useEffect(() => {
    void loadDataSources()
    void loadSavedQueries()
  }, [loadDataSources, loadSavedQueries])

  useEffect(() => {
    let cancelled = false
    void window.cclinkStudio.agent.getContextUsage(conversationId).then((usage) => {
      if (!cancelled && usage) setContextUsage(usage, conversationId)
    })
    return () => {
      cancelled = true
    }
  }, [conversationId, setContextUsage])

  const conversationInput = conversation?.input ?? ''
  const mountedResources = conversation?.mountedResources ?? []
  const mountedSkills = conversation?.mountedSkills ?? []
  const contextCompacting = conversation?.contextCompaction.status === 'compacting'
  const composerWorkspaceRef = conversation?.runtime.workspaceRef ?? activeWorkspaceRef
  const savedQueries = useMemo(
    () => Object.values(savedQueriesBySourceId).flat(),
    [savedQueriesBySourceId],
  )
  const conversationConfirmations = useMemo(
    () => pendingConfirmations.filter((request) => request.conversationId === conversationId),
    [conversationId, pendingConfirmations],
  )
  const resourceCandidates = useMemo(
    () =>
      buildResourceCandidates({
        activeWorkspaceRef: composerWorkspaceRef,
        tabs,
        editorFiles,
        selectedPath,
        dataSources,
        savedQueries,
        query: resourceQuery ?? '',
      }),
    [
      composerWorkspaceRef,
      dataSources,
      editorFiles,
      resourceQuery,
      savedQueries,
      selectedPath,
      tabs,
    ],
  )
  const skillCandidates = useMemo(() => buildSkillCandidates(skillQuery ?? ''), [skillQuery])
  const activeMentionKind =
    resourceQuery !== null ? 'resource' : skillQuery !== null ? 'skill' : null
  const activeMentionCount =
    activeMentionKind === 'resource'
      ? resourceCandidates.length
      : activeMentionKind === 'skill'
        ? skillCandidates.length
        : 0

  useEffect(() => {
    if (activeMentionCount === 0) {
      setMentionSelectedIndex(0)
      return
    }
    setMentionSelectedIndex((index) => Math.min(index, activeMentionCount - 1))
  }, [activeMentionCount])

  const updateMentionQueryFromInput = useCallback((text: string) => {
    const match = /(?:^|\s)([@/])([^\s@/]*)$/.exec(text)
    setResourceQuery(match?.[1] === '@' ? match[2] : null)
    setSkillQuery(match?.[1] === '/' ? match[2] : null)
    setMentionSelectedIndex(0)
  }, [])
  const handleInputChange = useCallback(
    (text: string) => {
      setInput(text, conversationId)
      updateMentionQueryFromInput(text)
    },
    [conversationId, setInput, updateMentionQueryFromInput],
  )
  const handleComposerHistoryKeyDown = useComposerHistory({
    conversationId,
    messages: conversation?.messages ?? [],
    value: conversationInput,
    onValueChange: handleInputChange,
    textareaRef: inputRef,
  })
  const handleMountResource = useCallback(
    (resource: AgentResourceCandidate) => {
      addMountedResource(toMountedResource(resource), conversationId)
      setInput(stripTrailingMentionToken(conversationInput), conversationId)
      setResourceQuery(null)
      setSkillQuery(null)
      setMentionSelectedIndex(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    },
    [addMountedResource, conversationId, conversationInput, setInput],
  )
  const handleRemoveMountedResource = useCallback(
    (resourceId: string) => {
      removeMountedResource(resourceId, conversationId)
    },
    [conversationId, removeMountedResource],
  )
  const handleMountSkill = useCallback(
    (skill: AgentSkillCandidate) => {
      addMountedSkill(toMountedSkill(skill), conversationId)
      setInput(stripTrailingMentionToken(conversationInput), conversationId)
      setResourceQuery(null)
      setSkillQuery(null)
      setMentionSelectedIndex(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    },
    [addMountedSkill, conversationId, conversationInput, setInput],
  )
  const handleRemoveMountedSkill = useCallback(
    (skillId: string) => {
      removeMountedSkill(skillId, conversationId)
    },
    [conversationId, removeMountedSkill],
  )
  const handlePermissionModeChange = useCallback(
    async (nextMode: PermissionMode) => {
      if (nextMode === permissionMode) return
      await window.cclinkStudio.agent.setPermissionMode(nextMode)
      setPermissionMode(nextMode)
    },
    [permissionMode, setPermissionMode],
  )

  const handleCompactContext = useCallback(
    async (instructions: string) => {
      await runController.compact(instructions)
    },
    [runController],
  )
  const handleOpenAgentSettings = useCallback(() => {
    openTab({ type: 'settings', title: 'Agent 设置', icon: '⚙️', settingsSection: 'agent' })
  }, [openTab])
  const handleConfirmApprove = useCallback(
    async (id: string, alwaysAllow = false) => {
      await window.cclinkStudio.agent.resolveToolConfirmation(id, true, alwaysAllow)
      removePendingConfirmation(id)
    },
    [removePendingConfirmation],
  )
  const handleConfirmReject = useCallback(
    async (id: string) => {
      await window.cclinkStudio.agent.resolveToolConfirmation(id, false)
      removePendingConfirmation(id)
    },
    [removePendingConfirmation],
  )

  if (!conversation) {
    return (
      <div className="workbench-agent-conversation">
        <div className="workbench-agent-empty">这个工作会话不存在，可能已经被关闭或迁移。</div>
      </div>
    )
  }

  const runtimeMeta = getRuntimeMeta(conversation.runtime)
  const adapterMeta = getLocalAgentConversationMeta(
    conversation,
    runtimeMeta.subtitle,
    runtimeMeta.chips,
  )
  const isArchived = Boolean(conversation.archivedAt)
  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.nativeEvent.isComposing) return

    if (activeMentionKind && activeMentionCount > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setMentionSelectedIndex((index) => (index + 1) % activeMentionCount)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setMentionSelectedIndex((index) => (index - 1 + activeMentionCount) % activeMentionCount)
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        if (activeMentionKind === 'resource') {
          const candidate = resourceCandidates[mentionSelectedIndex]
          if (candidate) handleMountResource(candidate)
        } else {
          const candidate = skillCandidates[mentionSelectedIndex]
          if (candidate) handleMountSkill(candidate)
        }
        return
      }
    }

    if (activeMentionKind && event.key === 'Escape') {
      event.preventDefault()
      setResourceQuery(null)
      setSkillQuery(null)
      setMentionSelectedIndex(0)
      return
    }

    if (handleComposerHistoryKeyDown(event)) return
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !contextCompacting) {
      event.preventDefault()
      setResourceQuery(null)
      setSkillQuery(null)
      conversationScroll.followLatest()
      void runController.send(conversation.input)
    }
  }

  return (
    <ConversationShell
      title={adapterMeta.title}
      subtitle={adapterMeta.subtitle}
      chips={adapterMeta.chips}
      badge={adapterMeta.badge}
      badgeKind={toShellBadgeKind(adapterMeta.status)}
      variant="local"
      listRef={conversationScroll.listRef}
      listProps={{
        onScroll: conversationScroll.onScroll,
        onWheel: conversationScroll.onWheel,
        onPointerDown: conversationScroll.onPointerDown,
        onTouchStart: conversationScroll.onTouchStart,
      }}
      composerRef={composerRef}
      context={
        <>
          <MountedResourceBar
            resources={mountedResources}
            onRemove={handleRemoveMountedResource}
            onOpen={openFileRangeResource}
          />
          <ConversationActivityPanel
            conversation={conversation}
            pendingConfirmations={conversationConfirmations}
            onApprove={handleConfirmApprove}
            onReject={handleConfirmReject}
          />
        </>
      }
      composer={
        isArchived ? (
          <ConversationComposer>
            <div className="conversation-archive-composer">
              <span>这个工作会话已归档。恢复后才能继续发送消息。</span>
              <button
                onClick={() => void restoreArchivedConversation(conversationId).catch(() => {})}
                title="恢复会话"
              >
                恢复会话
              </button>
            </div>
          </ConversationComposer>
        ) : (
          <ConversationComposer>
            {resourceQuery !== null && (
              <ResourceCandidateMenu
                candidates={resourceCandidates}
                selectedIndex={mentionSelectedIndex}
                onActiveIndexChange={setMentionSelectedIndex}
                onPick={handleMountResource}
                anchorRef={composerRef}
                onRequestClose={() => setResourceQuery(null)}
              />
            )}
            {skillQuery !== null && (
              <SkillCandidateMenu
                candidates={skillCandidates}
                selectedIndex={mentionSelectedIndex}
                onActiveIndexChange={setMentionSelectedIndex}
                onPick={handleMountSkill}
                anchorRef={composerRef}
                onRequestClose={() => setSkillQuery(null)}
              />
            )}
            <MountedSkillStrip skills={mountedSkills} onRemove={handleRemoveMountedSkill} />
            <div className="conversation-input-card">
              <textarea
                ref={inputRef}
                value={conversation.input}
                onChange={(event) => handleInputChange(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                placeholder="发送到这个工作会话，@ 挂资源，/ 挂技能。Cmd/Ctrl + Enter 发送。"
              />
              <AgentComposerToolbar
                permissionMode={permissionMode}
                settings={settings}
                loading={conversation.loading || contextCompacting}
                canSend={Boolean(conversation.input.trim()) && !contextCompacting}
                contextUsage={conversation.contextUsage}
                contextCompaction={conversation.contextCompaction}
                canCompact={Boolean(conversation.sessionId) && !conversation.loading}
                onCompactContext={handleCompactContext}
                onPermissionModeChange={handlePermissionModeChange}
                onOpenResourceMenu={() => setResourceQuery('')}
                onOpenSkillMenu={() => setSkillQuery('')}
                onOpenSettings={handleOpenAgentSettings}
                sendButton={
                  conversation.loading ? (
                    <button onClick={() => void runController.abort()} title="中止当前任务">
                      <IconStop size={16} />
                    </button>
                  ) : (
                    <button
                      disabled={!conversation.input.trim() || contextCompacting}
                      onClick={() => {
                        setResourceQuery(null)
                        setSkillQuery(null)
                        conversationScroll.followLatest()
                        void runController.send(conversation.input)
                      }}
                      title="发送"
                    >
                      <IconSend size={16} />
                    </button>
                  )
                }
              />
            </div>
          </ConversationComposer>
        )
      }
    >
      {conversation.messages.map((message) => (
        <ConversationMessageRenderer
          key={message.id}
          message={message}
          conversationId={conversationId}
          workspaceKey={
            conversation.runtime.workspaceRef
              ? workspaceRefKey(conversation.runtime.workspaceRef)
              : null
          }
        />
      ))}
    </ConversationShell>
  )
}

function ConversationComposer({ children }: { children: ReactNode }): React.ReactElement {
  return <>{children}</>
}

function ConversationActivityPanel({
  conversation,
  pendingConfirmations,
  onApprove,
  onReject,
}: {
  conversation: NonNullable<ReturnType<typeof useAgentStore.getState>['conversations'][string]>
  pendingConfirmations: ToolConfirmationRequest[]
  onApprove: (id: string, alwaysAllow?: boolean) => Promise<void>
  onReject: (id: string) => Promise<void>
}): React.ReactElement | null {
  const activity = getConversationActivity(conversation)
  const visibleConfirmations = pendingConfirmations.slice(0, 2)
  const showActivity = activity.kind !== 'idle' || visibleConfirmations.length > 0

  if (!showActivity) return null

  return (
    <div className={`conversation-activity-panel ${activity.kind}`}>
      <div className="conversation-activity-summary">
        <span className={`conversation-activity-dot ${activity.kind}`} />
        <span className="conversation-activity-label">{activity.label}</span>
        <span className="conversation-activity-detail" title={activity.detail}>
          {activity.detail}
        </span>
        {activity.toolCount > 0 && (
          <span className="conversation-activity-chip">
            <IconTool size={11} />
            {activity.toolCount} 次工具
          </span>
        )}
        {activity.errorCount > 0 && (
          <span className="conversation-activity-chip error">
            <IconError size={11} />
            {activity.errorCount} 个错误
          </span>
        )}
      </div>

      {visibleConfirmations.length > 0 && (
        <div className="conversation-confirmation-list">
          {visibleConfirmations.map((request) => (
            <div key={request.id} className="conversation-confirmation-item">
              <div className="conversation-confirmation-main">
                <IconTool size={12} />
                <span title={request.reason || request.toolName}>
                  {request.reason || request.toolName}
                </span>
                <em>{riskLabel(request.riskLevel)}</em>
              </div>
              <div className="conversation-confirmation-actions">
                <button onClick={() => void onApprove(request.id, false)} title="允许这次操作">
                  <IconCheck size={11} />
                  允许
                </button>
                <button onClick={() => void onReject(request.id)} title="拒绝这次操作">
                  <IconError size={11} />
                  拒绝
                </button>
              </div>
            </div>
          ))}
          {pendingConfirmations.length > visibleConfirmations.length && (
            <div className="conversation-confirmation-more">
              还有 {pendingConfirmations.length - visibleConfirmations.length} 个操作待确认
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function riskLabel(risk: ToolConfirmationRequest['riskLevel']): string {
  switch (risk) {
    case 'read':
      return '只读'
    case 'write':
      return '写入'
    case 'destructive':
      return '高风险'
  }
}

function getRuntimeMeta(runtime: ConversationRuntimeRef): {
  subtitle: string
  chips: string[]
} {
  const workspace = runtime.workspaceRef
  const workspaceLabel = workspace ? workspaceRefLabel(workspace) : '未绑定工作空间'
  const sourceLabel = workspace ? workspaceRefSourceLabel(workspace) : '系统'
  const locationLabel = '本地'
  const transportLabel = 'Local'

  return {
    subtitle: `${sourceLabel} · ${workspaceLabel}`,
    chips: [`${locationLabel}`, transportLabel],
  }
}

function toShellBadgeKind(status: ConversationRuntimeAdapterStatus): ConversationShellBadgeKind {
  switch (status) {
    case 'busy':
      return 'busy'
    case 'error':
      return 'error'
    case 'offline':
      return 'offline'
    case 'cached':
      return 'remote'
    case 'archived':
      return 'archived'
    case 'ready':
    default:
      return 'idle'
  }
}
