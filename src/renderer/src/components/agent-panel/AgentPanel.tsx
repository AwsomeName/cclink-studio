import { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import {
  useAgentStore,
  useBrowserDownloadStore,
  useBrowserTaskStore,
  useDataSourceStore,
  useEditorStore,
  useFsStore,
  useSettingsStore,
  useTabStore,
  useWorkspaceStore,
} from '../../stores'
import { workspaceRefKey, workspaceRefLabel } from '../../../../shared/workspace-ref'
import {
  importAgentImageFiles,
  MAX_AGENT_IMAGES,
} from '../../features/agent-conversations/image-attachments'
import {
  stripTrailingMentionToken,
  toMountedResource,
  toMountedSkill,
} from '../../features/agent-conversations/payload'
import { createConversationRunController } from '../../features/agent-conversations/conversation-run-controller'
import {
  buildResourceCandidates,
  buildSkillCandidates,
  buildQuickThreadList,
  buildActiveContextChips,
  createConversationRuntimeForWorkspace,
  type AgentResourceCandidate,
  type AgentSkillCandidate,
} from '../../features/agent-conversations/view-model'
import type { PermissionMode } from '../../types'
import type { BrowserActionLog, BrowserDownloadRecord, BrowserTaskRun } from '@shared/ipc/browser'
import type { AgentCapabilityStatus } from '@shared/agent-protocol'
import type { AgentRoleSummary, AgentSkillRef } from '@shared/agent-role'
import { DEFAULT_AGENT_RUNTIME_BINDING } from '@shared/agent-runtime'
import { useComposerHistory } from '../../features/agent-composer/use-composer-history'
import { isAgentConfirmationVisible } from '../../utils/workspace-resource-visibility'
import {
  buildAgentDiagnosticMarkdown,
  selectDiagnosticBrowserTask,
} from '../../features/diagnostics/agent-diagnostic-report'
import { collectUnifiedDiagnosticReport } from '../../features/diagnostics/unified-diagnostic-report'
import { APP_VERSION } from '../../app-metadata'
import { useToastStore } from '../common/Toast'
import {
  AGENT_FOCUS_COMPOSER_EVENT,
  openFileRangeResource,
} from '../../features/markdown/markdown-navigation'
import { useAgentRoles } from '../../features/agent-profiles/use-agent-profiles'
import { useAgentSkills } from '../../features/agent-skills/use-agent-skills'
import {
  applyAgentRoleToConversation,
  getApplyAgentRoleError,
} from '../../features/agent-roles/agent-role-actions'
import { buildAgentConversationTimeline } from '../../features/agent-roles/AgentConversationTimeline'
import {
  AgentPanelView,
  isAgentComposerCandidateSelectionKey,
  type AgentPanelActivityModel,
  type AgentPanelPermissionModel,
  type AgentPanelTimelineItem,
} from './agent-panel-view'
import { RemoteAgentController } from '../../features/cclink-remote/remote-agent-controller'
import { useTerminalConfirmationViewModels } from './terminal-confirmation-view-model'
import {
  selectBrowserTabConversationTask,
  selectConversationBrowserTask,
} from '../../features/agent-conversations/browser-task-binding'

interface AgentPanelProps {
  variant?: 'center' | 'side'
}

export function AgentPanel({ variant = 'side' }: AgentPanelProps): React.ReactElement {
  const activeWorkspaceRef = useWorkspaceStore((state) => state.activeWorkspaceRef)
  const workspaceGeneration = useWorkspaceStore((state) => state.generation)

  if (activeWorkspaceRef.kind === 'remote') {
    return (
      <RemoteAgentController
        key={`${workspaceRefKey(activeWorkspaceRef)}::${workspaceGeneration}`}
        workspaceRef={activeWorkspaceRef}
        workspaceGeneration={workspaceGeneration}
        variant={variant}
      />
    )
  }

  return <LocalAgentPanelController variant={variant} />
}

function LocalAgentPanelController({ variant = 'side' }: AgentPanelProps): React.ReactElement {
  const conversations = useAgentStore((s) => s.conversations)
  const conversationOrder = useAgentStore((s) => s.conversationOrder)
  const activeConversationId = useAgentStore((s) => s.activeConversationId)
  const messages = useAgentStore((s) => s.messages)
  const input = useAgentStore((s) => s.input)
  const loading = useAgentStore((s) => s.loading)
  const backendState = useAgentStore((s) => s.backendState)
  const sessionId = useAgentStore((s) => s.sessionId)
  const lastCost = useAgentStore((s) => s.lastCost)
  const contextUsage = useAgentStore((s) => s.contextUsage)
  const contextCompaction = useAgentStore((s) => s.contextCompaction)
  const allPendingConfirmations = useAgentStore((s) => s.pendingConfirmations)
  const permissionMode = useAgentStore((s) => s.permissionMode)
  const setInput = useAgentStore((s) => s.setInput)
  const setContextUsage = useAgentStore((s) => s.setContextUsage)
  const removePendingConfirmation = useAgentStore((s) => s.removePendingConfirmation)
  const setPermissionMode = useAgentStore((s) => s.setPermissionMode)
  const addMountedResource = useAgentStore((s) => s.addMountedResource)
  const removeMountedResource = useAgentStore((s) => s.removeMountedResource)
  const addPendingImages = useAgentStore((s) => s.addPendingImages)
  const removePendingImage = useAgentStore((s) => s.removePendingImage)
  const addMountedSkill = useAgentStore((s) => s.addMountedSkill)
  const removeMountedSkill = useAgentStore((s) => s.removeMountedSkill)
  const scope = useAgentStore((s) => s.scope)
  const createConversation = useAgentStore((s) => s.createConversation)
  const switchConversation = useAgentStore((s) => s.switchConversation)
  const restoreArchivedConversation = useAgentStore((s) => s.restoreArchivedConversation)
  const setRuntimeBinding = useAgentStore((s) => s.setRuntimeBinding)
  const tabs = useTabStore((s) => s.tabs)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const openTab = useTabStore((s) => s.openTab)
  const settings = useSettingsStore((s) => s.settings)
  const loadSettings = useSettingsStore((s) => s.loadSettings)
  const editorFiles = useEditorStore((s) => s.files)
  const selectedPath = useFsStore((s) => s.selectedPath)
  const activeWorkspaceRef = useWorkspaceStore((s) => s.activeWorkspaceRef)
  const browserTasks = useBrowserTaskStore((s) => s.tasks)
  const browserActionLogs = useBrowserTaskStore((s) => s.actionLogs)
  const upsertBrowserTask = useBrowserTaskStore((s) => s.upsertTask)
  const upsertBrowserActionLog = useBrowserTaskStore((s) => s.upsertActionLog)
  const refreshBrowserTasks = useBrowserTaskStore((s) => s.refresh)
  const browserDownloads = useBrowserDownloadStore((s) => s.downloads)
  const upsertBrowserDownload = useBrowserDownloadStore((s) => s.upsertDownload)
  const refreshBrowserDownloads = useBrowserDownloadStore((s) => s.refresh)
  const dataSources = useDataSourceStore((s) => s.sources)
  const savedQueriesBySourceId = useDataSourceStore((s) => s.savedQueriesBySourceId)
  const loadDataSources = useDataSourceStore((s) => s.loadSources)
  const loadSavedQueries = useDataSourceStore((s) => s.loadSavedQueries)
  const showToast = useToastStore((s) => s.show)
  const { roles, error: rolesError } = useAgentRoles()
  const { skills: availableSkills, error: skillsError } = useAgentSkills()
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const focusedTabConversationRef = useRef<string | null>(null)
  const [resourceQuery, setResourceQuery] = useState<string | null>(null)
  const [skillQuery, setSkillQuery] = useState<string | null>(null)
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0)
  const pendingConfirmations = useMemo(
    () =>
      allPendingConfirmations.filter((confirmation) =>
        isAgentConfirmationVisible(confirmation, activeConversationId),
      ),
    [activeConversationId, allPendingConfirmations],
  )
  const terminalConfirmationModels = useTerminalConfirmationViewModels()
  const runController = useMemo(
    () => createConversationRunController({ conversationId: activeConversationId }),
    [activeConversationId],
  )
  const contextCompacting = contextCompaction.status === 'compacting'

  useEffect(() => {
    let cancelled = false
    void window.cclinkStudio.agent.getContextUsage(activeConversationId).then((usage) => {
      if (!cancelled && usage) setContextUsage(usage, activeConversationId)
    })
    return () => {
      cancelled = true
    }
  }, [activeConversationId, setContextUsage])

  useEffect(() => {
    void refreshBrowserTasks()
    const offTask = window.cclinkStudio.browser.onTaskChanged(({ task }) => {
      upsertBrowserTask(task)
    })
    const offLog = window.cclinkStudio.browser.onActionLogChanged(({ log }) => {
      upsertBrowserActionLog(log)
    })
    const offDownload = window.cclinkStudio.browser.onDownloadChanged(({ download }) => {
      upsertBrowserDownload(download)
    })
    return () => {
      offTask()
      offLog()
      offDownload()
    }
  }, [refreshBrowserTasks, upsertBrowserTask, upsertBrowserActionLog, upsertBrowserDownload])

  useEffect(() => {
    void refreshBrowserDownloads()
  }, [refreshBrowserDownloads])

  const activeBrowserTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId && tab.type === 'browser') ?? null,
    [activeTabId, tabs],
  )
  const activePublishingAffairId = useMemo(() => {
    const tab = tabs.find((candidate) => candidate.id === activeTabId)
    return tab?.type === 'article-publishing' ? (tab.articlePublishing?.affairId ?? null) : null
  }, [activeTabId, tabs])
  const activeConversationBrowserTask = useMemo(
    () =>
      selectConversationBrowserTask({
        tasks: Object.values(browserTasks),
        conversationId: activeConversationId,
        workspaceKey: workspaceRefKey(activeWorkspaceRef),
      }),
    [activeConversationId, activeWorkspaceRef, browserTasks],
  )
  const activeTabConversationTask = useMemo(
    () =>
      activeBrowserTab
        ? selectBrowserTabConversationTask({
            tasks: Object.values(browserTasks),
            tabId: activeBrowserTab.id,
            workspaceKey: workspaceRefKey(activeWorkspaceRef),
          })
        : null,
    [activeBrowserTab, activeWorkspaceRef, browserTasks],
  )

  useEffect(() => {
    let cancelled = false
    const taskConversationId = activeTabConversationTask?.correlation?.conversationId
    const publishingConversationId = activePublishingAffairId
      ? `article-publishing-${activePublishingAffairId}`
      : null
    const conversationId = taskConversationId ?? publishingConversationId
    if (!conversationId) {
      focusedTabConversationRef.current = null
      return
    }
    const bindingKey = activeTabConversationTask
      ? `browser:${activeTabConversationTask.tabId}:${activeTabConversationTask.id}:${conversationId}`
      : `article-publishing:${activePublishingAffairId}:${conversationId}`
    if (focusedTabConversationRef.current === bindingKey) return
    const conversation = conversations[conversationId]
    if (!conversation && !activeTabConversationTask) return
    if (!conversation) {
      createConversation({
        id: conversationId,
        runtime: createConversationRuntimeForWorkspace(activeWorkspaceRef),
      })
    } else if (conversation.archivedAt) {
      void restoreArchivedConversation(conversationId)
        .then(() => {
          if (cancelled) return
          focusedTabConversationRef.current = bindingKey
          switchConversation(conversationId)
        })
        .catch(() => {
          if (!cancelled) focusedTabConversationRef.current = null
        })
      return () => {
        cancelled = true
      }
    }
    focusedTabConversationRef.current = bindingKey
    switchConversation(conversationId)
    return () => {
      cancelled = true
    }
  }, [
    activePublishingAffairId,
    activeTabConversationTask,
    activeWorkspaceRef,
    conversations,
    createConversation,
    restoreArchivedConversation,
    switchConversation,
  ])

  useEffect(() => {
    void loadDataSources()
    void loadSavedQueries()
  }, [loadDataSources, loadSavedQueries])

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  useEffect(() => {
    const focusComposer = (): void => inputRef.current?.focus()
    window.addEventListener(AGENT_FOCUS_COMPOSER_EVENT, focusComposer)
    return () => window.removeEventListener(AGENT_FOCUS_COMPOSER_EVENT, focusComposer)
  }, [])

  const handleSend = useCallback(async () => {
    setResourceQuery(null)
    setSkillQuery(null)
    await runController.send(input)
  }, [input, runController])

  const handleCompactContext = useCallback(
    async (instructions: string) => {
      const result = await runController.compact(instructions)
      if (result.status === 'failed') showToast(result.error, 'error')
    },
    [runController, showToast],
  )

  const updateMentionQueryFromInput = useCallback((text: string) => {
    const match = /(?:^|\s)([@/])([^\s@/]*)$/.exec(text)
    setResourceQuery(match?.[1] === '@' ? match[2] : null)
    setSkillQuery(match?.[1] === '/' ? match[2] : null)
    setMentionSelectedIndex(0)
  }, [])

  const handleInputChange = useCallback(
    (text: string) => {
      setInput(text, activeConversationId)
      updateMentionQueryFromInput(text)
    },
    [activeConversationId, setInput, updateMentionQueryFromInput],
  )
  const handleComposerHistoryKeyDown = useComposerHistory({
    conversationId: activeConversationId,
    messages,
    value: input,
    onValueChange: handleInputChange,
    textareaRef: inputRef,
  })

  const handleMountResource = useCallback(
    (resource: AgentResourceCandidate) => {
      addMountedResource(toMountedResource(resource), activeConversationId)
      setInput(stripTrailingMentionToken(input), activeConversationId)
      setResourceQuery(null)
      setSkillQuery(null)
      setMentionSelectedIndex(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    },
    [activeConversationId, addMountedResource, input, setInput],
  )

  const handleRemoveMountedResource = useCallback(
    (resourceId: string) => {
      removeMountedResource(resourceId, activeConversationId)
    },
    [activeConversationId, removeMountedResource],
  )

  const handleMountSkill = useCallback(
    (skill: AgentSkillCandidate) => {
      void addMountedSkill(toMountedSkill(skill), activeConversationId).then((saved) => {
        if (!saved) showToast('Skill 挂载保存失败，原配置已保留', 'error')
      })
      setInput(stripTrailingMentionToken(input), activeConversationId)
      setResourceQuery(null)
      setSkillQuery(null)
      setMentionSelectedIndex(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    },
    [activeConversationId, addMountedSkill, input, setInput, showToast],
  )

  const handleRemoveMountedSkill = useCallback(
    (skill: AgentSkillRef) => {
      void removeMountedSkill(skill, activeConversationId).then((saved) => {
        if (!saved) showToast('Skill 移除保存失败，原配置已保留', 'error')
      })
    },
    [activeConversationId, removeMountedSkill, showToast],
  )

  const handleAbort = useCallback(async () => {
    const result = await runController.abort()
    if (result.status === 'failed') showToast(result.error, 'error')
  }, [runController, showToast])

  // 权限确认：允许
  const handleConfirmApprove = useCallback(
    async (id: string, alwaysAllow = false) => {
      await window.cclinkStudio.agent.resolveToolConfirmation(id, true, alwaysAllow)
      removePendingConfirmation(id)
    },
    [removePendingConfirmation],
  )

  // 权限确认：拒绝
  const handleConfirmReject = useCallback(
    async (id: string) => {
      await window.cclinkStudio.agent.resolveToolConfirmation(id, false)
      removePendingConfirmation(id)
    },
    [removePendingConfirmation],
  )

  // 切换权限模式
  const handlePermissionModeChange = useCallback(
    async (nextMode: PermissionMode) => {
      if (nextMode === permissionMode) return
      await window.cclinkStudio.agent.setPermissionMode(nextMode)
      setPermissionMode(nextMode)
    },
    [permissionMode, setPermissionMode],
  )

  const handleRoleChange = useCallback(
    async (role: AgentRoleSummary) => {
      const conversation = useAgentStore.getState().conversations[activeConversationId]
      if (!conversation) return
      const result = await applyAgentRoleToConversation(conversation.id, {
        roleId: role.roleId,
        version: role.version,
      })
      const failure = getApplyAgentRoleError(result)
      showToast(failure ?? `当前会话已切换为「${role.label}」`, failure ? 'error' : 'success')
    },
    [activeConversationId, showToast],
  )

  const handleOpenAgentSettings = useCallback(() => {
    openTab({ type: 'settings', title: 'Agent 设置', icon: '⚙️', settingsSection: 'agent' })
  }, [openTab])

  const handleCopyDiagnostics = useCallback(async () => {
    const conversation = useAgentStore.getState().conversations[activeConversationId] ?? null
    const diagnosticWorkspaceKey = workspaceRefKey(
      conversation?.runtime.workspaceRef ?? activeWorkspaceRef,
    )
    const currentMessages = conversation?.messages ?? messages
    const browserTab = activeConversationBrowserTask
      ? tabs.find(
          (tab) => tab.id === activeConversationBrowserTask.tabId && tab.type === 'browser',
        )
      : scope.kind === 'browser'
        ? tabs.find((tab) => tab.id === scope.instanceId && tab.type === 'browser')
        : tabs.find((tab) => tab.id === activeTabId && tab.type === 'browser')
    let browserTabId =
      activeConversationBrowserTask?.tabId ??
      browserTab?.id ??
      (scope.kind === 'browser' ? scope.instanceId : null)
    let currentUrl = browserTab?.initialUrl ?? null
    let viewState = null
    let pageDiagnostics = null
    let browserRuntime = null
    let agentRuntime = null
    let capabilities: AgentCapabilityStatus[] = []

    try {
      agentRuntime = await window.cclinkStudio.agent.getStatus(activeConversationId)
    } catch {
      agentRuntime = null
    }

    try {
      capabilities = await window.cclinkStudio.agent.getCapabilities()
    } catch {
      capabilities = []
    }

    if (!browserTabId) {
      try {
        browserTabId = await window.cclinkStudio.browser.getActiveViewId(diagnosticWorkspaceKey)
      } catch {
        browserTabId = null
      }
    }

    if (browserTabId) {
      try {
        currentUrl = await window.cclinkStudio.browser.getCurrentURL(browserTabId)
      } catch {
        currentUrl = browserTab?.initialUrl ?? null
      }
      try {
        viewState = await window.cclinkStudio.browser.getViewState()
      } catch {
        viewState = null
      }
      try {
        browserRuntime = await window.cclinkStudio.browser.getRuntimeDiagnostics(browserTabId)
        pageDiagnostics = browserRuntime.page
      } catch {
        try {
          pageDiagnostics = await window.cclinkStudio.browser.getDiagnostics(browserTabId)
        } catch {
          pageDiagnostics = null
        }
      }
    }

    const diagnosticTask = selectDiagnosticBrowserTask({
      tasks: Object.values(browserTasks),
      tabId: browserTabId,
      workspaceKey: diagnosticWorkspaceKey,
      conversationId: conversation?.id ?? null,
    })
    const diagnosticDownloads = diagnosticTask
      ? diagnosticTask.downloadIds.map((downloadId) => browserDownloads[downloadId]).filter(Boolean)
      : []
    const agentReport = buildAgentDiagnosticMarkdown({
      appVersion: APP_VERSION,
      platform: navigator.platform,
      workspaceRef: activeWorkspaceRef,
      conversation,
      agentRuntime,
      capabilities,
      messages: currentMessages,
      backendState,
      permissionMode,
      scope,
      browser: {
        tabId: browserTabId,
        url: browserRuntime?.visibleUrl ?? currentUrl,
        title: browserRuntime?.visibleTitle || browserTab?.title || null,
        profile: browserRuntime?.profileId ?? browserTab?.browserProfile ?? null,
        viewState: browserRuntime?.viewState ?? viewState,
      },
      browserRuntime,
      pageDiagnostics,
      browserTask: diagnosticTask,
      browserActionLogs: diagnosticTask ? (browserActionLogs[diagnosticTask.id] ?? []) : [],
      browserDownloads: diagnosticDownloads,
      pendingConfirmationCount: pendingConfirmations.length,
    })

    try {
      const activeFilePath = tabs.find((tab) => tab.id === activeTabId)?.filePath ?? null
      const diagnosticReport = await collectUnifiedDiagnosticReport({
        agentReport,
        activeFilePath,
      })
      await copyTextToClipboard(diagnosticReport)
      showToast('完整诊断日志已复制', 'success')
    } catch (err) {
      showToast(`复制诊断日志失败: ${String(err)}`, 'error')
    }
  }, [
    activeConversationId,
    activeConversationBrowserTask,
    activeTabId,
    activeWorkspaceRef,
    backendState,
    browserActionLogs,
    browserDownloads,
    browserTasks,
    messages,
    pendingConfirmations.length,
    permissionMode,
    scope,
    showToast,
    tabs,
  ])

  const allQuickThreads = useMemo(
    () =>
      buildQuickThreadList({
        conversations,
        conversationOrder,
        activeConversationId,
        activeWorkspaceRef,
        pendingConfirmationCount: pendingConfirmations.length,
        expanded: true,
      }),
    [
      activeConversationId,
      activeWorkspaceRef,
      conversationOrder,
      conversations,
      pendingConfirmations.length,
    ],
  )
  useEffect(() => {
    const active = conversations[activeConversationId]
    if (
      active &&
      !active.archivedAt &&
      allQuickThreads.some((thread) => thread.id === activeConversationId)
    ) {
      return
    }
    const fallback = allQuickThreads.find((thread) => !conversations[thread.id]?.archivedAt)
    if (fallback) {
      switchConversation(fallback.id)
      return
    }
    createConversation({
      runtime: createConversationRuntimeForWorkspace(activeWorkspaceRef),
    })
  }, [
    activeConversationId,
    activeWorkspaceRef,
    allQuickThreads,
    conversations,
    createConversation,
    switchConversation,
  ])

  // 连接状态颜色
  const statusText: Record<string, string> = {
    disconnected: '未连接',
    connecting: '连接中...',
    connected: '已就绪',
    streaming: '思考中...',
    error: '连接错误',
  }

  const riskLabel: Record<string, string> = {
    read: '只读',
    write: '写入',
    destructive: '破坏性',
  }

  const activeBrowserTask = useMemo(() => {
    if (activeConversationBrowserTask) return activeConversationBrowserTask
    if (scope.kind !== 'browser') return null
    const tasks = Object.values(browserTasks)
      .filter((task) => task.tabId === scope.instanceId)
      .sort((a, b) => b.startedAt - a.startedAt)
    return tasks.find((task) => !isFinalBrowserTaskStatus(task.status)) ?? tasks[0] ?? null
  }, [activeConversationBrowserTask, browserTasks, scope])
  const activeBrowserTaskLogs = activeBrowserTask
    ? (browserActionLogs[activeBrowserTask.id] ?? []).slice(-5)
    : []
  const activeBrowserTaskDownloads = activeBrowserTask
    ? activeBrowserTask.downloadIds
        .map((downloadId) => browserDownloads[downloadId])
        .filter(Boolean)
        .slice(-3)
    : []
  const browserActivities: AgentPanelActivityModel[] = activeBrowserTask
    ? [
        {
          id: `browser-task:${activeBrowserTask.id}`,
          title: activeBrowserTask.goal,
          status: browserTaskStatusMeta(activeBrowserTask.status).label,
          tone:
            activeBrowserTask.status === 'failed'
              ? 'error'
              : activeBrowserTask.status === 'paused'
                ? 'warning'
                : activeBrowserTask.status === 'completed'
                  ? 'success'
                  : 'info',
          detail: activeBrowserTask.errorMessage
            ? `${activeBrowserTask.failureReason ?? 'unknown'} · ${activeBrowserTask.errorMessage}`
            : undefined,
          rows: [
            ...activeBrowserTaskLogs.map((log) => ({
              id: `log:${log.id}`,
              label: log.action,
              detail: browserActionStatusLabel(log),
              meta: formatBrowserTaskDuration(log.startedAt, log.endedAt),
            })),
            ...activeBrowserTaskDownloads.map((download) => ({
              id: `download:${download.id}`,
              label: download.suggestedFilename,
              detail: downloadStatusLabel(download),
              actions:
                download.retention === 'discarded'
                  ? []
                  : [
                      {
                        id: 'open',
                        label: '打开',
                        disabled: download.fileMissing,
                        onInvoke: () => void window.cclinkStudio.browser.openDownload(download.id),
                      },
                      {
                        id: 'reveal',
                        label: '定位',
                        disabled: download.fileMissing,
                        onInvoke: () =>
                          void window.cclinkStudio.browser.revealDownload(download.id),
                      },
                      ...(download.retention === 'temporary'
                        ? [
                            {
                              id: 'keep',
                              label: '保留',
                              disabled: download.fileMissing,
                              onInvoke: () =>
                                void window.cclinkStudio.browser.keepDownloadToWorkspace(
                                  download.id,
                                ),
                            },
                          ]
                        : []),
                      {
                        id: 'save-as',
                        label: '另存为',
                        disabled: download.fileMissing,
                        onInvoke: () =>
                          void window.cclinkStudio.browser.saveDownloadAs(download.id),
                      },
                      ...(download.retention === 'temporary'
                        ? [
                            {
                              id: 'discard',
                              label: '丢弃',
                              tone: 'danger' as const,
                              onInvoke: () =>
                                void window.cclinkStudio.browser.discardDownload(download.id),
                            },
                          ]
                        : []),
                    ],
            })),
          ],
          actions: [
            ...(activeBrowserTask.status === 'running'
              ? [
                  {
                    id: 'pause',
                    label: '暂停',
                    onInvoke: () =>
                      void window.cclinkStudio.browser.pauseTask(activeBrowserTask.id),
                  },
                ]
              : []),
            ...(activeBrowserTask.status === 'paused' && !activeBrowserTask.correlation?.affairId
              ? [
                  {
                    id: 'resume',
                    label: '继续',
                    onInvoke: () =>
                      void window.cclinkStudio.browser.resumeTask(activeBrowserTask.id),
                  },
                ]
              : []),
            ...(activeBrowserTask.status === 'running' || activeBrowserTask.status === 'paused'
              ? [
                  {
                    id: 'cancel',
                    label: '终止',
                    tone: 'danger' as const,
                    onInvoke: () =>
                      void window.cclinkStudio.browser.cancelTask(activeBrowserTask.id),
                  },
                ]
              : []),
          ],
        },
      ]
    : []
  const workspaceName = useMemo(() => workspaceRefLabel(activeWorkspaceRef), [activeWorkspaceRef])
  const activeConversation = conversations[activeConversationId]
  const canChangeRuntime = Boolean(
    activeConversation &&
    !activeConversation.loading &&
    !activeConversation.sessionId &&
    !activeConversation.messages.some((message) => message.role === 'user'),
  )
  const mountedResources = activeConversation?.mountedResources ?? []
  const pendingImages = activeConversation?.pendingImages ?? []
  const mountedSkills = activeConversation?.mountedSkills ?? []
  const activeRoleRef = activeConversation?.configuration.roleRef
  const activeRole = roles.find(
    (role) => role.roleId === activeRoleRef?.roleId && role.version === activeRoleRef.version,
  )
  const handleAddImages = useCallback(
    async (files: File[]) => {
      const result = await importAgentImageFiles(files, MAX_AGENT_IMAGES - pendingImages.length)
      if (result.attachments.length > 0) {
        addPendingImages(result.attachments, activeConversationId)
      }
      if (result.errors.length > 0) showToast(result.errors.join('\n'), 'error')
      requestAnimationFrame(() => inputRef.current?.focus())
    },
    [activeConversationId, addPendingImages, pendingImages.length, showToast],
  )
  const handleRemovePendingImage = useCallback(
    (imageId: string) => removePendingImage(imageId, activeConversationId),
    [activeConversationId, removePendingImage],
  )
  const savedQueries = useMemo(
    () => Object.values(savedQueriesBySourceId).flat(),
    [savedQueriesBySourceId],
  )
  const resourceCandidates = useMemo(
    () =>
      buildResourceCandidates({
        activeWorkspaceRef,
        tabs,
        editorFiles,
        selectedPath,
        dataSources,
        savedQueries,
        query: resourceQuery ?? '',
      }),
    [activeWorkspaceRef, dataSources, editorFiles, resourceQuery, savedQueries, selectedPath, tabs],
  )
  const skillCandidates = useMemo(
    () => buildSkillCandidates(availableSkills, skillQuery ?? ''),
    [availableSkills, skillQuery],
  )
  const activeMentionKind =
    resourceQuery !== null ? 'resource' : skillQuery !== null ? 'skill' : null
  const activeMentionCount =
    activeMentionKind === 'resource'
      ? resourceCandidates.length
      : activeMentionKind === 'skill'
        ? skillCandidates.length
        : 0
  const handlePickSelectedMention = useCallback((): boolean => {
    if (activeMentionKind === 'resource') {
      const candidate = resourceCandidates[mentionSelectedIndex]
      if (!candidate) return false
      handleMountResource(candidate)
      return true
    }
    if (activeMentionKind === 'skill') {
      const candidate = skillCandidates[mentionSelectedIndex]
      if (!candidate) return false
      handleMountSkill(candidate)
      return true
    }
    return false
  }, [
    activeMentionKind,
    handleMountResource,
    handleMountSkill,
    mentionSelectedIndex,
    resourceCandidates,
    skillCandidates,
  ])

  useEffect(() => {
    if (activeMentionCount === 0) {
      setMentionSelectedIndex(0)
      return
    }
    setMentionSelectedIndex((index) => Math.min(index, activeMentionCount - 1))
  }, [activeMentionCount])

  // 候选菜单和历史导航先于通用 Composer 的 Enter 提交策略。
  const handleKeyDownBeforeSubmit = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (activeMentionKind && activeMentionCount > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setMentionSelectedIndex((index) => (index + 1) % activeMentionCount)
          return true
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setMentionSelectedIndex((index) => (index - 1 + activeMentionCount) % activeMentionCount)
          return true
        }
        if (isAgentComposerCandidateSelectionKey(e)) {
          e.preventDefault()
          handlePickSelectedMention()
          return true
        }
      }

      if (activeMentionKind && e.key === 'Escape') {
        e.preventDefault()
        setResourceQuery(null)
        setSkillQuery(null)
        setMentionSelectedIndex(0)
        return true
      }

      return handleComposerHistoryKeyDown(e)
    },
    [
      activeMentionCount,
      activeMentionKind,
      handleComposerHistoryKeyDown,
      handlePickSelectedMention,
    ],
  )
  const isStartConversation =
    messages.every((msg) => msg.id === 'welcome') &&
    pendingConfirmations.length === 0 &&
    !loading &&
    lastCost === null

  useEffect(() => {
    if (rolesError) showToast(`角色列表加载失败: ${rolesError}`, 'error')
  }, [rolesError, showToast])

  useEffect(() => {
    if (skillsError) showToast(`Skill 列表加载失败: ${skillsError}`, 'error')
  }, [showToast, skillsError])

  const labelRole = (roleId: string, version: number): string =>
    roles.find((role) => role.roleId === roleId && role.version === version)?.label ??
    `${roleId}@${version}`
  const timeline: AgentPanelTimelineItem[] = isStartConversation
    ? []
    : buildAgentConversationTimeline(messages, activeConversation?.configurationEvents ?? []).map(
        (item) =>
          item.kind === 'message'
            ? {
                kind: 'message' as const,
                id: item.value.id,
                message: item.value,
                conversationId: activeConversationId,
                workspaceKey: activeConversation?.runtime.workspaceRef
                  ? workspaceRefKey(activeConversation.runtime.workspaceRef)
                  : null,
              }
            : {
                kind: 'status' as const,
                id: item.value.id,
                label: `角色已从「${labelRole(
                  item.value.fromRoleRef.roleId,
                  item.value.fromRoleRef.version,
                )}」切换为「${labelRole(
                  item.value.toRoleRef.roleId,
                  item.value.toRoleRef.version,
                )}」`,
                detail: `配置 #${item.value.configurationRevision}`,
              },
      )

  const permissionModels: AgentPanelPermissionModel[] = pendingConfirmations.map((request) => ({
    id: request.id,
    title: 'Agent 请求执行操作',
    rows: [
      { label: '操作', value: request.toolName },
      ...request.summary,
      { label: '风险', value: riskLabel[request.riskLevel] },
    ],
    actions: [
      {
        id: 'approve',
        label: '允许',
        tone: 'approve' as const,
        onInvoke: () => void handleConfirmApprove(request.id, false),
      },
      ...(request.allowAlways !== false
        ? [
            {
              id: 'always',
              label: '始终允许',
              tone: 'always' as const,
              onInvoke: () => void handleConfirmApprove(request.id, true),
            },
          ]
        : []),
      {
        id: 'reject',
        label: '拒绝',
        tone: 'reject' as const,
        onInvoke: () => void handleConfirmReject(request.id),
      },
    ],
  }))

  const activeTab = tabs.find((tab) => tab.id === activeTabId)
  const contextChips = buildActiveContextChips({
    activeWorkspaceRef,
    scope,
    activeTab,
    tabs,
    editorFiles,
  })
  const canSubmit =
    !loading &&
    (Boolean(input.trim()) || pendingImages.length > 0) &&
    !contextCompacting &&
    Boolean(activeRole)

  return (
    <AgentPanelView
      model={{
        runtime: 'local',
        variant,
        timelineKey: `local:${workspaceRefKey(activeWorkspaceRef)}:${activeConversationId}`,
        header: {
          title: 'Agent',
          runtimeLabel: `本地 · ${activeRole?.label ?? activeRoleRef?.roleId ?? '角色加载中'}`,
          status: {
            tone:
              backendState === 'streaming'
                ? 'working'
                : backendState === 'connected'
                  ? 'ready'
                  : backendState === 'connecting'
                    ? 'connecting'
                    : 'unavailable',
            label: statusText[backendState],
            detail: `本地 Agent ${statusText[backendState]}`,
          },
          diagnostics: {
            state: 'enabled',
            label: '复制完整诊断日志',
            onInvoke: () => void handleCopyDiagnostics(),
          },
        },
        contextChips,
        notices: [
          ...(!activeRole
            ? [
                {
                  id: 'role-unavailable',
                  tone: 'error' as const,
                  title: '当前角色不可用',
                  detail: '请选择可用角色后再发送消息。',
                },
              ]
            : []),
          ...(backendState === 'error'
            ? [
                {
                  id: 'backend-error',
                  tone: 'error' as const,
                  title: '本地 Agent 连接错误',
                  detail: '可复制诊断日志检查本地 Runtime。',
                },
              ]
            : []),
        ],
        activities: browserActivities,
        permissions: [...permissionModels, ...terminalConfirmationModels],
        timeline,
        empty: {
          title: isStartConversation ? `我们应该在 ${workspaceName} 中构建什么？` : '开始工作',
          description: 'Agent 会以当前工作空间和上下文栏中的目标作为操作边界。',
          suggestions: ['打开网页并整理资料', '新建 Markdown 草稿', '继续当前工作空间任务'],
        },
        costLabel: lastCost === null ? null : `费用 $${lastCost.toFixed(4)}`,
        composer: {
          textareaRef: inputRef,
          value: input,
          onChange: handleInputChange,
          onSubmit: handleSend,
          onStop: handleAbort,
          canSubmit,
          submitting: loading || contextCompacting,
          stopCapability: loading
            ? { state: 'enabled' }
            : contextCompacting
              ? { state: 'hidden', reason: '上下文压缩期间不能停止 Agent' }
              : { state: 'hidden' },
          placeholder: '输入消息，@ 挂资源，/ 挂技能；Shift+Enter 换行',
          onKeyDownBeforeSubmit: handleKeyDownBeforeSubmit,
          onPaste: (event) => {
            const files = Array.from(event.clipboardData.files).filter((file) =>
              file.type.startsWith('image/'),
            )
            if (files.length === 0) return
            event.preventDefault()
            void handleAddImages(files)
          },
          onDragOver: (event) => {
            if (Array.from(event.dataTransfer.items).some((item) => item.kind === 'file')) {
              event.preventDefault()
            }
          },
          onDrop: (event) => {
            const files = Array.from(event.dataTransfer.files).filter((file) =>
              file.type.startsWith('image/'),
            )
            if (files.length === 0) return
            event.preventDefault()
            void handleAddImages(files)
          },
          enhancements: {
            resourceCandidates: {
              open: resourceQuery !== null,
              items: resourceCandidates,
              selectedIndex: mentionSelectedIndex,
              onActiveIndexChange: setMentionSelectedIndex,
              onPick: handleMountResource,
              onRequestClose: () => setResourceQuery(null),
            },
            skillCandidates: {
              open: skillQuery !== null,
              items: skillCandidates,
              selectedIndex: mentionSelectedIndex,
              onActiveIndexChange: setMentionSelectedIndex,
              onPick: handleMountSkill,
              onRequestClose: () => setSkillQuery(null),
            },
            mountedResources: {
              items: mountedResources,
              onRemove: handleRemoveMountedResource,
              onOpen: openFileRangeResource,
            },
            mountedSkills: {
              items: mountedSkills,
              availableSkills,
              onRemove: handleRemoveMountedSkill,
            },
            images: {
              items: pendingImages,
              onRemove: handleRemovePendingImage,
            },
          },
          actionBar: {
            kind: 'local',
            toolbar: {
              roleRef: activeRoleRef,
              roles,
              onRoleChange: (role) => void handleRoleChange(role),
              permissionMode,
              settings,
              runtimeBinding: activeConversation.runtimeBinding ?? DEFAULT_AGENT_RUNTIME_BINDING,
              canChangeRuntime,
              onRuntimeChange: (binding) => setRuntimeBinding(binding, activeConversationId),
              loading: loading || contextCompacting,
              contextUsage,
              contextCompaction,
              canCompact: Boolean(sessionId) && !loading,
              onCompactContext: handleCompactContext,
              onPermissionModeChange: handlePermissionModeChange,
              onOpenResourceMenu: () => setResourceQuery(''),
              onOpenSkillMenu: () => setSkillQuery(''),
              onAddImages: (files) => void handleAddImages(files),
              onOpenSettings: handleOpenAgentSettings,
            },
          },
        },
      }}
    />
  )
}
async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()
  const ok = document.execCommand('copy')
  document.body.removeChild(textarea)
  if (!ok) throw new Error('clipboard unavailable')
}

function isFinalBrowserTaskStatus(status: BrowserTaskRun['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

function browserTaskStatusMeta(status: BrowserTaskRun['status']): { label: string; color: string } {
  switch (status) {
    case 'running':
      return { label: '运行中', color: '#3b82f6' }
    case 'paused':
      return { label: '已暂停', color: '#eab308' }
    case 'completed':
      return { label: '已完成', color: '#22c55e' }
    case 'failed':
      return { label: '失败', color: '#ef4444' }
    case 'cancelled':
      return { label: '已终止', color: '#9ca3af' }
  }
}

function browserActionStatusLabel(log: BrowserActionLog): string {
  switch (log.status) {
    case 'started':
      return '进行中'
    case 'succeeded':
      return '完成'
    case 'failed':
      return '失败'
    case 'skipped':
      return '跳过'
  }
}

function formatBrowserTaskDuration(startedAt: number, endedAt?: number): string {
  const duration = Math.max(0, (endedAt ?? Date.now()) - startedAt)
  if (duration < 1_000) return `${duration}ms`
  return `${(duration / 1_000).toFixed(duration < 10_000 ? 1 : 0)}s`
}

function downloadStatusLabel(download: BrowserDownloadRecord): string {
  if (download.fileMissing) return '已丢失'
  if (download.retention === 'discarded') return '已丢弃'
  if (download.retention === 'kept') return '已保留'
  switch (download.status) {
    case 'pending':
      return '等待中'
    case 'downloading':
      return '下载中'
    case 'completed':
      return '临时'
    case 'failed':
      return '失败'
    case 'cancelled':
      return '已取消'
  }
}
