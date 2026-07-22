import { useEffect, useRef, useCallback, useState, useMemo, type CSSProperties } from 'react'
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
import { useContextMenuStore } from '../../features/context-actions/context-menu-store'
import {
  buildKeyboardContextMenuInput,
  isContextMenuKeyboardEvent,
} from '../../features/context-actions/context-menu-trigger'
import { useCommandStore } from '../../stores/command-store'
import { THREAD_RESTORED_EVENT } from '../../features/context-actions/domains/thread-context-actions'
import { MountedResourceBar } from '../../features/agent-conversations/mounted-resource-bar'
import { MountedSkillStrip } from '../../features/agent-conversations/mounted-skill-strip'
import {
  ResourceCandidateMenu,
  SkillCandidateMenu,
} from '../../features/agent-conversations/context-candidate-menu'
import {
  stripTrailingMentionToken,
  toMountedResource,
  toMountedSkill,
} from '../../features/agent-conversations/payload'
import { createConversationRunController } from '../../features/agent-conversations/conversation-run-controller'
import {
  buildArchivedQuickThreadList,
  buildResourceCandidates,
  buildSkillCandidates,
  buildQuickThreadList,
  createConversationRuntimeForWorkspace,
  type AgentResourceCandidate,
  type AgentSkillCandidate,
  type QuickThreadSummary,
} from '../../features/agent-conversations/view-model'
import type { PermissionMode } from '../../types'
import type { BrowserActionLog, BrowserDownloadRecord, BrowserTaskRun } from '@shared/ipc/browser'
import type { AgentCapabilityStatus } from '@shared/agent-protocol'
import { ConversationMessageRenderer } from '../common/ConversationMessageRenderer'
import { AgentComposerToolbar } from '../../features/agent-composer/AgentComposerToolbar'
import { useComposerHistory } from '../../features/agent-composer/use-composer-history'
import { TerminalConfirmationCards } from './TerminalConfirmationCards'
import { isAgentConfirmationVisible } from '../../utils/workspace-resource-visibility'
import {
  buildAgentDiagnosticMarkdown,
  selectDiagnosticBrowserTask,
} from '../../features/diagnostics/agent-diagnostic-report'
import { useToastStore } from '../common/Toast'
import {
  IconSparkle,
  IconCircle,
  IconSend,
  IconStop,
  IconDollar,
  IconTool,
  IconCheck,
  IconError,
  IconGlobe,
  IconFile,
  IconClipboard,
  IconPlus,
  IconHistory,
} from '../common/Icons'
import {
  AGENT_FOCUS_COMPOSER_EVENT,
  openFileRangeResource,
} from '../../features/markdown/markdown-navigation'
import { useConversationScroll } from '../../features/agent-conversations/use-conversation-scroll'

interface AgentPanelProps {
  variant?: 'center' | 'side'
}

const MIN_COMPOSER_HEIGHT = 118
const MAX_COMPOSER_HEIGHT = 520
const MIN_MESSAGES_HEIGHT = 180
const DEFAULT_THREAD_LIST_WIDTH = 292
const MIN_THREAD_LIST_WIDTH = 180
const MAX_THREAD_LIST_WIDTH = 440
const MIN_CENTER_CONVERSATION_WIDTH = 320
const THREAD_LIST_RESIZE_HANDLE_WIDTH = 7

function composerHeightStorageKey(variant: NonNullable<AgentPanelProps['variant']>): string {
  return `cclink-studio-agent-composer-height-${variant}`
}

function loadComposerHeight(variant: NonNullable<AgentPanelProps['variant']>): number | null {
  try {
    const value = Number(localStorage.getItem(composerHeightStorageKey(variant)))
    if (!Number.isFinite(value) || value < MIN_COMPOSER_HEIGHT) return null
    return Math.min(value, MAX_COMPOSER_HEIGHT)
  } catch {
    return null
  }
}

function loadThreadListWidth(): number {
  try {
    const value = Number(localStorage.getItem('cclink-studio-agent-thread-list-width'))
    if (!Number.isFinite(value)) return DEFAULT_THREAD_LIST_WIDTH
    return Math.min(Math.max(value, MIN_THREAD_LIST_WIDTH), MAX_THREAD_LIST_WIDTH)
  } catch {
    return DEFAULT_THREAD_LIST_WIDTH
  }
}

export function AgentPanel({ variant = 'side' }: AgentPanelProps): React.ReactElement {
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
  const addMountedSkill = useAgentStore((s) => s.addMountedSkill)
  const removeMountedSkill = useAgentStore((s) => s.removeMountedSkill)
  const scope = useAgentStore((s) => s.scope)
  const createConversation = useAgentStore((s) => s.createConversation)
  const switchConversation = useAgentStore((s) => s.switchConversation)
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
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const centerPanelRef = useRef<HTMLDivElement>(null)
  const conversationMainRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLDivElement>(null)
  const startComposerRef = useRef<HTMLDivElement>(null)
  const [resourceQuery, setResourceQuery] = useState<string | null>(null)
  const [skillQuery, setSkillQuery] = useState<string | null>(null)
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0)
  const [quickThreadsExpanded, setQuickThreadsExpanded] = useState(false)
  const [archivedThreadsExpanded, setArchivedThreadsExpanded] = useState(false)
  const [composerHeight, setComposerHeight] = useState<number | null>(() =>
    loadComposerHeight(variant),
  )
  const [threadListWidth, setThreadListWidth] = useState(loadThreadListWidth)
  const pendingConfirmations = useMemo(
    () =>
      allPendingConfirmations.filter((confirmation) =>
        isAgentConfirmationVisible(confirmation, activeConversationId),
      ),
    [activeConversationId, allPendingConfirmations],
  )
  const scrollRevision = useMemo(
    () => ({ messages, pendingConfirmationCount: pendingConfirmations.length }),
    [messages, pendingConfirmations.length],
  )
  const conversationScroll = useConversationScroll(
    `${workspaceRefKey(activeWorkspaceRef) ?? '__global__'}::${activeConversationId}`,
    scrollRevision,
  )
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

  const clampComposerHeight = useCallback((height: number): number => {
    const mainHeight = conversationMainRef.current?.getBoundingClientRect().height ?? 0
    const availableHeight =
      mainHeight > 0 ? Math.max(MIN_COMPOSER_HEIGHT, mainHeight - MIN_MESSAGES_HEIGHT) : height
    return Math.min(Math.max(height, MIN_COMPOSER_HEIGHT), MAX_COMPOSER_HEIGHT, availableHeight)
  }, [])

  const handleComposerResizeStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()

      const startY = event.clientY
      const startHeight = composerRef.current?.getBoundingClientRect().height ?? MIN_COMPOSER_HEIGHT
      const previousCursor = document.body.style.cursor
      const previousUserSelect = document.body.style.userSelect

      document.body.classList.add('is-resizing-composer')
      document.body.style.cursor = 'row-resize'
      document.body.style.userSelect = 'none'

      const handlePointerMove = (moveEvent: PointerEvent): void => {
        setComposerHeight(clampComposerHeight(startHeight + startY - moveEvent.clientY))
      }
      const finishResize = (): void => {
        document.body.classList.remove('is-resizing-composer')
        document.body.style.cursor = previousCursor
        document.body.style.userSelect = previousUserSelect
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', finishResize)
        window.removeEventListener('pointercancel', finishResize)
      }

      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', finishResize)
      window.addEventListener('pointercancel', finishResize)
    },
    [clampComposerHeight],
  )

  const handleComposerResizeKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
      event.preventDefault()
      const currentHeight =
        composerHeight ?? composerRef.current?.getBoundingClientRect().height ?? MIN_COMPOSER_HEIGHT
      const delta = event.key === 'ArrowUp' ? 12 : -12
      setComposerHeight(clampComposerHeight(currentHeight + delta))
    },
    [clampComposerHeight, composerHeight],
  )

  const clampThreadListWidth = useCallback((width: number): number => {
    const panelWidth = centerPanelRef.current?.getBoundingClientRect().width ?? 0
    const availableMaximum =
      panelWidth > 0
        ? Math.max(
            MIN_THREAD_LIST_WIDTH,
            panelWidth - MIN_CENTER_CONVERSATION_WIDTH - THREAD_LIST_RESIZE_HANDLE_WIDTH,
          )
        : MAX_THREAD_LIST_WIDTH
    return Math.min(Math.max(width, MIN_THREAD_LIST_WIDTH), MAX_THREAD_LIST_WIDTH, availableMaximum)
  }, [])

  const handleThreadListResizeStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()

      const startX = event.clientX
      const startWidth =
        centerPanelRef.current
          ?.querySelector<HTMLElement>('.agent-quick-switcher')
          ?.getBoundingClientRect().width ?? threadListWidth
      const previousCursor = document.body.style.cursor
      const previousUserSelect = document.body.style.userSelect

      document.body.classList.add('is-resizing-thread-list')
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      const handlePointerMove = (moveEvent: PointerEvent): void => {
        setThreadListWidth(clampThreadListWidth(startWidth + startX - moveEvent.clientX))
      }
      const finishResize = (): void => {
        document.body.classList.remove('is-resizing-thread-list')
        document.body.style.cursor = previousCursor
        document.body.style.userSelect = previousUserSelect
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', finishResize)
        window.removeEventListener('pointercancel', finishResize)
      }

      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', finishResize)
      window.addEventListener('pointercancel', finishResize)
    },
    [clampThreadListWidth, threadListWidth],
  )

  const handleThreadListResizeKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      const currentWidth =
        centerPanelRef.current
          ?.querySelector<HTMLElement>('.agent-quick-switcher')
          ?.getBoundingClientRect().width ?? threadListWidth
      const delta = event.key === 'ArrowLeft' ? 16 : -16
      setThreadListWidth(clampThreadListWidth(currentWidth + delta))
    },
    [clampThreadListWidth, threadListWidth],
  )

  useEffect(() => {
    try {
      const key = composerHeightStorageKey(variant)
      if (composerHeight === null) localStorage.removeItem(key)
      else localStorage.setItem(key, String(composerHeight))
    } catch {
      // localStorage 不可用时仍保留当前运行期的拖拽结果。
    }
  }, [composerHeight, variant])

  useEffect(() => {
    try {
      localStorage.setItem('cclink-studio-agent-thread-list-width', String(threadListWidth))
    } catch {
      // localStorage 不可用时仍保留当前运行期的拖拽结果。
    }
  }, [threadListWidth])

  useEffect(() => {
    const main = conversationMainRef.current
    if (!main || composerHeight === null) return
    const observer = new ResizeObserver(() => {
      setComposerHeight((height) => (height === null ? null : clampComposerHeight(height)))
    })
    observer.observe(main)
    return () => observer.disconnect()
  }, [clampComposerHeight, composerHeight])

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
    conversationScroll.followLatest()
    setResourceQuery(null)
    setSkillQuery(null)
    await runController.send(input)
  }, [conversationScroll, input, runController])

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
      addMountedSkill(toMountedSkill(skill), activeConversationId)
      setInput(stripTrailingMentionToken(input), activeConversationId)
      setResourceQuery(null)
      setSkillQuery(null)
      setMentionSelectedIndex(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    },
    [activeConversationId, addMountedSkill, input, setInput],
  )

  const handleRemoveMountedSkill = useCallback(
    (skillId: string) => {
      removeMountedSkill(skillId, activeConversationId)
    },
    [activeConversationId, removeMountedSkill],
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

  const handleOpenAgentSettings = useCallback(() => {
    openTab({ type: 'settings', title: 'Agent 设置', icon: '⚙️', settingsSection: 'agent' })
  }, [openTab])

  const handleNewConversation = useCallback(() => {
    const conversationId = createConversation({
      runtime: createConversationRuntimeForWorkspace(activeWorkspaceRef),
      activate: true,
    })
    setResourceQuery(null)
    setSkillQuery(null)
    void window.cclinkStudio.agent.resetSession(conversationId)
  }, [activeWorkspaceRef, createConversation])

  const handleSwitchConversation = useCallback(
    (conversationId: string) => {
      switchConversation(conversationId)
      setResourceQuery(null)
      setSkillQuery(null)
    },
    [switchConversation],
  )

  useEffect(() => {
    const handleThreadRestored = (): void => {
      setArchivedThreadsExpanded(false)
      setResourceQuery(null)
      setSkillQuery(null)
    }
    window.addEventListener(THREAD_RESTORED_EVENT, handleThreadRestored)
    return () => window.removeEventListener(THREAD_RESTORED_EVENT, handleThreadRestored)
  }, [])

  const handleCopyDiagnostics = useCallback(async () => {
    const conversation = useAgentStore.getState().conversations[activeConversationId] ?? null
    const diagnosticWorkspaceKey = workspaceRefKey(
      conversation?.runtime.workspaceRef ?? activeWorkspaceRef,
    )
    const currentMessages = conversation?.messages ?? messages
    const browserTab =
      scope.kind === 'browser'
        ? tabs.find((tab) => tab.id === scope.instanceId && tab.type === 'browser')
        : tabs.find((tab) => tab.id === activeTabId && tab.type === 'browser')
    let browserTabId = browserTab?.id ?? (scope.kind === 'browser' ? scope.instanceId : null)
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
    const markdown = buildAgentDiagnosticMarkdown({
      appVersion: '0.1.1',
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
      await copyTextToClipboard(markdown)
      showToast('诊断日志已复制', 'success')
    } catch (err) {
      showToast(`复制诊断日志失败: ${String(err)}`, 'error')
    }
  }, [
    activeConversationId,
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
  const quickThreads = quickThreadsExpanded ? allQuickThreads : allQuickThreads.slice(0, 5)
  const archivedQuickThreads = useMemo(
    () =>
      buildArchivedQuickThreadList({
        conversations,
        conversationOrder,
        activeConversationId,
        activeWorkspaceRef,
      }),
    [activeConversationId, activeWorkspaceRef, conversationOrder, conversations],
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
  const statusColor: Record<string, string> = {
    disconnected: '#666666',
    connecting: '#eab308',
    connected: '#22c55e',
    streaming: '#3b82f6',
    error: '#ef4444',
  }

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

  const riskColor: Record<string, string> = {
    read: '#22c55e',
    write: '#eab308',
    destructive: '#ef4444',
  }

  const isStreaming = backendState === 'streaming'
  const activeBrowserTask = useMemo(() => {
    if (scope.kind !== 'browser') return null
    const tasks = Object.values(browserTasks)
      .filter((task) => task.tabId === scope.instanceId)
      .sort((a, b) => b.startedAt - a.startedAt)
    return tasks.find((task) => !isFinalBrowserTaskStatus(task.status)) ?? tasks[0] ?? null
  }, [browserTasks, scope])
  const activeBrowserTaskLogs = activeBrowserTask
    ? (browserActionLogs[activeBrowserTask.id] ?? []).slice(-5)
    : []
  const activeBrowserTaskDownloads = activeBrowserTask
    ? activeBrowserTask.downloadIds
        .map((downloadId) => browserDownloads[downloadId])
        .filter(Boolean)
        .slice(-3)
    : []
  const workspaceName = useMemo(() => workspaceRefLabel(activeWorkspaceRef), [activeWorkspaceRef])
  const activeConversation = conversations[activeConversationId]
  const mountedResources = activeConversation?.mountedResources ?? []
  const mountedSkills = activeConversation?.mountedSkills ?? []
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
  const skillCandidates = useMemo(() => buildSkillCandidates(skillQuery ?? ''), [skillQuery])
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

  // 键盘事件：候选菜单优先；流式输出期间仍允许编辑草稿，但不提交。
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.nativeEvent.isComposing) return

      if (activeMentionKind && activeMentionCount > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setMentionSelectedIndex((index) => (index + 1) % activeMentionCount)
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setMentionSelectedIndex((index) => (index - 1 + activeMentionCount) % activeMentionCount)
          return
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault()
          handlePickSelectedMention()
          return
        }
      }

      if (activeMentionKind && e.key === 'Escape') {
        e.preventDefault()
        setResourceQuery(null)
        setSkillQuery(null)
        setMentionSelectedIndex(0)
        return
      }

      if (handleComposerHistoryKeyDown(e)) return
      if (loading) return
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [
      activeMentionCount,
      activeMentionKind,
      handleComposerHistoryKeyDown,
      handlePickSelectedMention,
      handleSend,
      loading,
    ],
  )
  const isStartConversation =
    messages.every((msg) => msg.id === 'welcome') &&
    pendingConfirmations.length === 0 &&
    !loading &&
    lastCost === null
  const quickThreadSwitcher = (
    <QuickThreadSwitcher
      threads={quickThreads}
      totalCount={allQuickThreads.length}
      expanded={quickThreadsExpanded}
      onToggleExpanded={() => setQuickThreadsExpanded((value) => !value)}
      onNew={handleNewConversation}
      onSwitch={handleSwitchConversation}
      archivedThreads={archivedQuickThreads}
      archivedExpanded={archivedThreadsExpanded}
      onToggleArchived={() => setArchivedThreadsExpanded((value) => !value)}
    />
  )
  const centerThreadList = (
    <>
      <div
        className="agent-thread-list-resize-handle"
        role="separator"
        aria-label="调整消息区和会话列表宽度"
        aria-orientation="vertical"
        aria-valuemin={MIN_THREAD_LIST_WIDTH}
        aria-valuemax={MAX_THREAD_LIST_WIDTH}
        aria-valuenow={Math.round(threadListWidth)}
        tabIndex={0}
        title="左右拖动调整会话列表宽度，双击恢复默认"
        onPointerDown={handleThreadListResizeStart}
        onKeyDown={handleThreadListResizeKeyDown}
        onDoubleClick={() => setThreadListWidth(DEFAULT_THREAD_LIST_WIDTH)}
      />
      {quickThreadSwitcher}
    </>
  )
  const centerPanelStyle = {
    '--agent-thread-list-width': `${threadListWidth}px`,
  } as CSSProperties

  if (variant === 'center' && isStartConversation) {
    return (
      <div ref={centerPanelRef} className="agent-panel agent-panel-center" style={centerPanelStyle}>
        <div className="agent-conversation-main">
          <div className="agent-start-page">
            <div className="agent-start-content">
              <div className="agent-start-status">
                <IconSparkle size={14} />
                <span>Agent</span>
                <IconCircle
                  size={8}
                  filled
                  color={statusColor[backendState]}
                  className={isStreaming ? 'animate-pulse' : ''}
                />
                <span>{statusText[backendState]}</span>
              </div>

              <h1 className="agent-start-title">我们应该在 {workspaceName} 中构建什么？</h1>

              <div ref={startComposerRef} className="agent-start-composer">
                {resourceQuery !== null && (
                  <ResourceCandidateMenu
                    candidates={resourceCandidates}
                    selectedIndex={mentionSelectedIndex}
                    onActiveIndexChange={setMentionSelectedIndex}
                    onPick={handleMountResource}
                    anchorRef={startComposerRef}
                    onRequestClose={() => setResourceQuery(null)}
                  />
                )}
                {skillQuery !== null && (
                  <SkillCandidateMenu
                    candidates={skillCandidates}
                    selectedIndex={mentionSelectedIndex}
                    onActiveIndexChange={setMentionSelectedIndex}
                    onPick={handleMountSkill}
                    anchorRef={startComposerRef}
                    onRequestClose={() => setSkillQuery(null)}
                  />
                )}
                <MountedSkillStrip skills={mountedSkills} onRemove={handleRemoveMountedSkill} />
                <textarea
                  ref={inputRef}
                  className="agent-start-input"
                  value={input}
                  onChange={(e) => handleInputChange(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="随心输入"
                  rows={3}
                />
                <AgentComposerToolbar
                  permissionMode={permissionMode}
                  settings={settings}
                  loading={loading || contextCompacting}
                  canSend={Boolean(input.trim()) && !contextCompacting}
                  contextUsage={contextUsage}
                  contextCompaction={contextCompaction}
                  canCompact={Boolean(sessionId) && !loading}
                  onCompactContext={handleCompactContext}
                  onPermissionModeChange={handlePermissionModeChange}
                  onOpenResourceMenu={() => setResourceQuery('')}
                  onOpenSkillMenu={() => setSkillQuery('')}
                  onOpenSettings={handleOpenAgentSettings}
                  sendButton={
                    <button
                      className="agent-start-send"
                      onClick={handleSend}
                      disabled={!input.trim() || contextCompacting}
                      title="发送"
                    >
                      <IconSend size={16} />
                    </button>
                  }
                />
              </div>

              <div className="agent-start-hints">
                <span>打开网页并整理资料</span>
                <span>新建 Markdown 草稿</span>
                <span>继续当前工作空间任务</span>
              </div>
            </div>
          </div>
        </div>
        {centerThreadList}
      </div>
    )
  }

  return (
    <div
      ref={variant === 'center' ? centerPanelRef : undefined}
      className={`agent-panel agent-panel-${variant}`}
      style={variant === 'center' ? centerPanelStyle : undefined}
    >
      {variant === 'side' && quickThreadSwitcher}
      <div className="agent-conversation-main" ref={conversationMainRef}>
        {activeBrowserTask && (
          <BrowserTaskCard
            task={activeBrowserTask}
            logs={activeBrowserTaskLogs}
            downloads={activeBrowserTaskDownloads}
            onPause={() => {
              void window.cclinkStudio.browser.pauseTask(activeBrowserTask.id)
            }}
            onResume={() => {
              void window.cclinkStudio.browser.resumeTask(activeBrowserTask.id)
            }}
            onCancel={() => {
              void window.cclinkStudio.browser.cancelTask(activeBrowserTask.id)
            }}
          />
        )}

        {/* 消息列表 */}
        <div
          className="agent-messages conversation-copy-surface"
          ref={conversationScroll.listRef}
          onScroll={conversationScroll.onScroll}
          onWheel={conversationScroll.onWheel}
          onPointerDown={conversationScroll.onPointerDown}
          onTouchStart={conversationScroll.onTouchStart}
        >
          {messages.map((msg) => (
            <ConversationMessageRenderer
              key={msg.id}
              message={msg}
              conversationId={activeConversationId}
              workspaceKey={
                activeConversation?.runtime.workspaceRef
                  ? workspaceRefKey(activeConversation.runtime.workspaceRef)
                  : null
              }
            />
          ))}

          {/* 工具确认卡片（支持并发多个） */}
          {pendingConfirmations.map((req) => (
            <div key={req.id} className="tool-confirmation-card">
              <div className="confirmation-header">
                <IconTool size={14} />
                请求执行操作
              </div>
              <div className="confirmation-body">
                <div className="confirmation-row">
                  <span className="confirmation-label">操作:</span>
                  <span className="confirmation-value">{req.toolName}</span>
                </div>
                <div className="confirmation-row">
                  <span className="confirmation-label">参数:</span>
                  <span className="confirmation-value confirmation-params">
                    {Object.entries(req.params)
                      .map(([k, v]) => `${k}="${String(v)}"`)
                      .join(', ')}
                  </span>
                </div>
                <div className="confirmation-row">
                  <span className="confirmation-label">风险:</span>
                  <span className="confirmation-value" style={{ color: riskColor[req.riskLevel] }}>
                    {riskLabel[req.riskLevel]}
                  </span>
                </div>
                {req.reason ? (
                  <div className="confirmation-row">
                    <span className="confirmation-label">原因:</span>
                    <span className="confirmation-value">{req.reason}</span>
                  </div>
                ) : null}
              </div>
              <div className="confirmation-actions">
                <button
                  className="confirm-approve-btn"
                  onClick={() => handleConfirmApprove(req.id, false)}
                >
                  <IconCheck size={12} />
                  允许
                </button>
                {req.allowAlways !== false ? (
                  <button
                    className="confirm-always-btn"
                    onClick={() => handleConfirmApprove(req.id, true)}
                  >
                    始终允许
                  </button>
                ) : null}
                <button className="confirm-reject-btn" onClick={() => handleConfirmReject(req.id)}>
                  <IconError size={12} />
                  拒绝
                </button>
              </div>
            </div>
          ))}

          <TerminalConfirmationCards />
        </div>

        {/* 费用显示 */}
        {lastCost !== null && (
          <div className="agent-cost">
            <IconDollar size={10} />${lastCost.toFixed(4)}
          </div>
        )}

        <div
          className="agent-composer-resize-handle"
          role="separator"
          aria-label="调整消息区和输入区高度"
          aria-orientation="horizontal"
          aria-valuemin={MIN_COMPOSER_HEIGHT}
          aria-valuemax={MAX_COMPOSER_HEIGHT}
          aria-valuenow={composerHeight ?? undefined}
          tabIndex={0}
          title="上下拖动调整输入区高度，双击恢复默认"
          onPointerDown={handleComposerResizeStart}
          onKeyDown={handleComposerResizeKeyDown}
          onDoubleClick={() => setComposerHeight(null)}
        />

        {/* 输入区域 */}
        <div
          ref={composerRef}
          className={`agent-composer-wrap ${composerHeight === null ? '' : 'resized'}`}
          style={composerHeight === null ? undefined : { height: composerHeight }}
        >
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
          <MountedResourceBar
            resources={mountedResources}
            onRemove={handleRemoveMountedResource}
            onOpen={openFileRangeResource}
          />
          <MountedSkillStrip skills={mountedSkills} onRemove={handleRemoveMountedSkill} />
          <div className="agent-input-card">
            <button
              type="button"
              className="agent-copy-diagnostics-btn"
              onClick={() => void handleCopyDiagnostics()}
              title="复制当前会话诊断日志"
            >
              <IconClipboard size={13} />
            </button>
            <textarea
              ref={inputRef}
              className="agent-input"
              value={input}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入消息，@ 挂资源，/ 挂技能..."
              rows={2}
            />
            <AgentComposerToolbar
              permissionMode={permissionMode}
              settings={settings}
              loading={loading || contextCompacting}
              canSend={Boolean(input.trim()) && !contextCompacting}
              contextUsage={contextUsage}
              contextCompaction={contextCompaction}
              canCompact={Boolean(sessionId) && !loading}
              onCompactContext={handleCompactContext}
              onPermissionModeChange={handlePermissionModeChange}
              onOpenResourceMenu={() => setResourceQuery('')}
              onOpenSkillMenu={() => setSkillQuery('')}
              onOpenSettings={handleOpenAgentSettings}
              sendButton={
                loading ? (
                  <button className="agent-abort-btn" onClick={handleAbort} title="中止">
                    <IconStop size={15} />
                  </button>
                ) : (
                  <button
                    className="agent-send-btn"
                    onClick={handleSend}
                    disabled={!input.trim() || contextCompacting}
                    title="发送"
                  >
                    <IconSend size={17} />
                  </button>
                )
              }
            />
          </div>
        </div>
      </div>
      {variant === 'center' && centerThreadList}
    </div>
  )
}

function QuickThreadSwitcher({
  threads,
  totalCount,
  expanded,
  onToggleExpanded,
  onNew,
  onSwitch,
  archivedThreads,
  archivedExpanded,
  onToggleArchived,
}: {
  threads: QuickThreadSummary[]
  totalCount: number
  expanded: boolean
  onToggleExpanded: () => void
  onNew: () => void
  onSwitch: (conversationId: string) => void
  archivedThreads: QuickThreadSummary[]
  archivedExpanded: boolean
  onToggleArchived: () => void
}): React.ReactElement {
  const showContextMenu = useContextMenuStore((state) => state.show)
  const executeCommand = useCommandStore((state) => state.executeCommand)
  const hasOverflow = totalCount > 5

  const restoreThread = (thread: QuickThreadSummary): void => {
    void executeCommand('agent.restoreConversation', {
      source: 'toolbar',
      target: {
        kind: 'thread',
        workspaceKey: thread.workspaceKey,
        conversationId: thread.id,
      },
    })
  }

  const renderThreadRow = (thread: QuickThreadSummary, archived: boolean): React.ReactElement => (
    <div
      key={thread.id}
      className={`agent-quick-thread-row ${thread.isActive ? 'active' : ''} ${
        archived ? 'archived' : ''
      }`}
      role="button"
      tabIndex={0}
      onClick={() => {
        if (archived) restoreThread(thread)
        else onSwitch(thread.id)
      }}
      onKeyDown={(event) => {
        if (isContextMenuKeyboardEvent(event.nativeEvent)) {
          event.preventDefault()
          showContextMenu(
            buildKeyboardContextMenuInput(
              {
                kind: 'thread',
                workspaceKey: thread.workspaceKey,
                conversationId: thread.id,
                activeRunId: useAgentStore.getState().conversations[thread.id]?.activeRunId ?? null,
              },
              event.currentTarget,
            ),
          )
          return
        }
        if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) {
          return
        }
        event.preventDefault()
        if (archived) restoreThread(thread)
        else onSwitch(thread.id)
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
        showContextMenu({
          target: {
            kind: 'thread',
            workspaceKey: thread.workspaceKey,
            conversationId: thread.id,
            activeRunId: useAgentStore.getState().conversations[thread.id]?.activeRunId ?? null,
          },
          x: event.clientX,
          y: event.clientY,
          focusReturn: event.currentTarget,
        })
      }}
      title={`${thread.title} · ${thread.statusLabel} · 右键管理`}
    >
      <span className={`agent-quick-thread-dot status-${thread.statusKind}`} />
      <span className="agent-quick-thread-copy">
        <span className="agent-quick-thread-title">{thread.title}</span>
        <span className="agent-quick-thread-meta">
          {thread.workspaceLabel} · {thread.messageCount} 条消息
        </span>
      </span>
      <span className="agent-quick-thread-detail">{thread.detail}</span>
    </div>
  )

  return (
    <div className="agent-quick-switcher">
      <div className="agent-quick-switcher-head">
        <div className="agent-quick-switcher-heading">
          <IconHistory size={12} />
          <span>会话列表</span>
          <em>{totalCount}</em>
        </div>
        <button type="button" className="agent-quick-new-btn" onClick={onNew} title="新建会话">
          <IconPlus size={14} />
        </button>
      </div>

      <div className="agent-quick-thread-list" aria-label="会话列表">
        {threads.map((thread) => renderThreadRow(thread, false))}
      </div>

      {hasOverflow && (
        <button
          type="button"
          className="agent-quick-expand-btn"
          onClick={onToggleExpanded}
          title={expanded ? '收起会话列表' : '展开更多会话'}
        >
          {expanded ? '收起' : `展开其余 ${totalCount - threads.length}`}
        </button>
      )}

      {archivedThreads.length > 0 && (
        <div className="agent-quick-history">
          <button
            type="button"
            className={`agent-quick-history-toggle ${archivedExpanded ? 'active' : ''}`}
            onClick={onToggleArchived}
            aria-expanded={archivedExpanded}
          >
            <IconHistory size={11} />
            <span>历史会话</span>
            <em>{archivedThreads.length}</em>
          </button>
          {archivedExpanded && (
            <div className="agent-quick-thread-list agent-quick-history-list">
              {archivedThreads.map((thread) => renderThreadRow(thread, true))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function BrowserTaskCard({
  task,
  logs,
  downloads,
  onPause,
  onResume,
  onCancel,
}: {
  task: BrowserTaskRun
  logs: BrowserActionLog[]
  downloads: BrowserDownloadRecord[]
  onPause: () => void
  onResume: () => void
  onCancel: () => void
}): React.ReactElement {
  const status = browserTaskStatusMeta(task.status)
  const canPause = task.status === 'running'
  const canResume = task.status === 'paused'
  const canCancel = task.status === 'running' || task.status === 'paused'

  return (
    <div className={`browser-task-card browser-task-card-${task.status}`}>
      <div className="browser-task-head">
        <div className="browser-task-title">
          <IconGlobe size={13} />
          <span title={task.goal}>{task.goal}</span>
        </div>
        <span className="browser-task-status" style={{ color: status.color }}>
          <IconCircle size={7} filled color={status.color} />
          {status.label}
        </span>
      </div>

      {logs.length > 0 && (
        <div className="browser-task-log-list">
          {logs.map((log) => {
            const logMeta = browserActionStatusMeta(log.status)
            return (
              <div key={log.id} className="browser-task-log-row">
                <span className="browser-task-log-status" style={{ color: logMeta.color }}>
                  {logMeta.label}
                </span>
                <span className="browser-task-log-action">{log.action}</span>
                <span className="browser-task-log-time">
                  {formatBrowserTaskDuration(log.startedAt, log.endedAt)}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {task.errorMessage && (
        <div className="browser-task-error" title={task.errorMessage}>
          {task.failureReason ?? 'unknown'} · {task.errorMessage}
        </div>
      )}

      {downloads.length > 0 && (
        <div className="browser-task-downloads">
          {downloads.map((download) => (
            <div key={download.id} className="browser-task-download-row">
              <div className="browser-task-download-main">
                <IconFile size={12} />
                <span title={download.savedPath ?? download.tempPath ?? download.suggestedFilename}>
                  {download.suggestedFilename}
                </span>
                <em>{downloadStatusLabel(download)}</em>
              </div>
              {download.retention !== 'discarded' && (
                <div className="browser-task-download-actions">
                  <button
                    disabled={download.fileMissing}
                    onClick={() => {
                      void window.cclinkStudio.browser.openDownload(download.id)
                    }}
                  >
                    打开
                  </button>
                  <button
                    disabled={download.fileMissing}
                    onClick={() => {
                      void window.cclinkStudio.browser.revealDownload(download.id)
                    }}
                  >
                    定位
                  </button>
                  {download.retention === 'temporary' && (
                    <button
                      disabled={download.fileMissing}
                      onClick={() => {
                        void window.cclinkStudio.browser.keepDownloadToWorkspace(download.id)
                      }}
                    >
                      保留
                    </button>
                  )}
                  <button
                    disabled={download.fileMissing}
                    onClick={() => {
                      void window.cclinkStudio.browser.saveDownloadAs(download.id)
                    }}
                  >
                    另存为
                  </button>
                  {download.retention === 'temporary' && (
                    <button
                      className="danger"
                      onClick={() => {
                        void window.cclinkStudio.browser.discardDownload(download.id)
                      }}
                    >
                      丢弃
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {canCancel && (
        <div className="browser-task-actions">
          {canPause && (
            <button className="browser-task-btn" onClick={onPause}>
              暂停
            </button>
          )}
          {canResume && (
            <button className="browser-task-btn" onClick={onResume}>
              继续
            </button>
          )}
          <button className="browser-task-btn danger" onClick={onCancel}>
            <IconStop size={11} />
            终止
          </button>
        </div>
      )}
    </div>
  )
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

function browserActionStatusMeta(status: BrowserActionLog['status']): {
  label: string
  color: string
} {
  switch (status) {
    case 'started':
      return { label: '执行中', color: '#3b82f6' }
    case 'succeeded':
      return { label: '成功', color: '#22c55e' }
    case 'failed':
      return { label: '失败', color: '#ef4444' }
    case 'skipped':
      return { label: '跳过', color: '#9ca3af' }
  }
}

function formatBrowserTaskDuration(startedAt: number, endedAt?: number): string {
  const durationMs = Math.max(0, (endedAt ?? Date.now()) - startedAt)
  if (durationMs < 1000) return `${durationMs}ms`
  return `${(durationMs / 1000).toFixed(1)}s`
}
