import type { WorkspaceStateSnapshot } from '@shared/ipc/workspace-state'
import type { BrowserViewBinding } from '@shared/ipc/browser'
import type { WorkspaceRef } from '../../../shared/workspace-ref'
import { workspaceRefKey } from '../../../shared/workspace-ref'
import { useAgentStore } from '../stores/agent-store'
import { useBrowserTaskStore } from '../stores/browser-task-store'
import { useTabStore } from '../stores/tab-store'
import { useWorkspaceStore } from '../stores/workspace-store'
import {
  flushPendingWorkspaceSectionWrites,
  getWorkspaceStateKey,
  getWorkspaceStateOwnerKey,
} from './workspace-state'
import {
  applyTerminalRuntimeStatuses,
  hydrateRuntimeSections,
  persistRuntimeSections,
  readTerminalRuntimeStatuses,
  reconcileAgentRuntimeStatuses,
} from './workspace-runtime'
import { flushMountedMarkdownViewStates } from '../features/markdown/markdown-view-state-lifecycle'
import { captureWorkspaceLayout, persistCapturedWorkspaceLayout } from '../stores/ui-store'
import { cancelActivePanelResize } from './panel-layout-drag-lifecycle'
import { persistEditorDrafts } from '../stores/editor-store'
import { flushMarkdownAutosaves } from '../features/markdown/markdown-autosave'
import { useToastStore } from '../components/common/Toast'

async function protectEditorDraftsBeforeSwitch(): Promise<void> {
  await flushMarkdownAutosaves()
  try {
    await persistEditorDrafts()
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    const message = `草稿未能保存，已保留当前工作空间。请重试保留草稿或先保存文件：${reason}`
    useToastStore.getState().show(message, 'error')
    throw new Error(message)
  }
}

export interface WorkspaceRuntimeTransition {
  ref: WorkspaceRef
  key: string | null
  snapshot: WorkspaceStateSnapshot | null
  generation: number
  outgoingOwnership: WorkspaceRuntimeResourceOwnership
}

export interface WorkspaceRuntimeResourceOwnership {
  workspaceKey: string | null
  browserTabIds: string[]
  browserTaskIds: string[]
  activeBrowserTabId: string | null
  agentConversationIds: string[]
  activeAgentConversationId: string | null
  terminalSessionIds: string[]
}

let workspaceTransitionGeneration = 0
const OPTIONAL_RUNTIME_RECONCILIATION_TIMEOUT_MS = 1_500

async function waitForOptionalRuntime<T>(
  label: 'Browser' | 'Browser rollback' | 'Terminal',
  operation: Promise<T>,
): Promise<T | null> {
  let timeout: ReturnType<typeof setTimeout> | null = null
  let timedOut = false
  try {
    const result = await Promise.race([
      operation,
      new Promise<null>((resolve) => {
        timeout = setTimeout(() => {
          timedOut = true
          resolve(null)
        }, OPTIONAL_RUNTIME_RECONCILIATION_TIMEOUT_MS)
      }),
    ])
    if (timedOut) {
      console.warn(`[WorkspaceTransition] ${label} runtime reconciliation timed out`)
    }
    return result
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

export function beginWorkspaceRuntimeTransition(): number {
  cancelActivePanelResize()
  workspaceTransitionGeneration += 1
  return workspaceTransitionGeneration
}

export function isWorkspaceRuntimeTransitionCurrent(generation: number): boolean {
  return generation === workspaceTransitionGeneration
}

export function cancelWorkspaceRuntimeTransition(generation: number): boolean {
  if (!isWorkspaceRuntimeTransitionCurrent(generation)) return false
  workspaceTransitionGeneration += 1
  return true
}

export function collectWorkspaceRuntimeResourceOwnership(
  workspaceKey: string | null,
): WorkspaceRuntimeResourceOwnership {
  const tabState = useTabStore.getState()
  const workspaceTabs = tabState.tabs.filter(
    (tab) => tab.workspaceRef && workspaceRefKey(tab.workspaceRef) === workspaceKey,
  )
  const browserTabIds = workspaceTabs.flatMap((tab) => (tab.type === 'browser' ? [tab.id] : []))
  const terminalSessionIds = workspaceTabs.flatMap((tab) =>
    tab.type === 'terminal' && tab.terminal?.sessionId ? [tab.terminal.sessionId] : [],
  )
  const browserTaskIds = Object.values(useBrowserTaskStore.getState().tasks)
    .filter((task) => browserTabIds.includes(task.tabId))
    .map((task) => task.id)
  const agentState = useAgentStore.getState()
  const agentConversationIds = agentState.conversationOrder.filter((conversationId) => {
    const workspaceRef = agentState.conversations[conversationId]?.runtime.workspaceRef
    return workspaceRef ? workspaceRefKey(workspaceRef) === workspaceKey : false
  })

  return {
    workspaceKey,
    browserTabIds,
    browserTaskIds,
    activeBrowserTabId:
      tabState.activeTabId && browserTabIds.includes(tabState.activeTabId)
        ? tabState.activeTabId
        : null,
    agentConversationIds,
    activeAgentConversationId: agentConversationIds.includes(agentState.activeConversationId)
      ? agentState.activeConversationId
      : null,
    terminalSessionIds,
  }
}

function getIncomingBrowserViews(snapshot: WorkspaceStateSnapshot | null): BrowserViewBinding[] {
  const tabsSection = snapshot?.sections.tabs
  if (!tabsSection || typeof tabsSection !== 'object') return []
  const tabs = (tabsSection as { tabs?: unknown }).tabs
  if (!Array.isArray(tabs)) return []

  return tabs.flatMap((tab) => {
    if (!tab || typeof tab !== 'object') return []
    const candidate = tab as { id?: unknown; type?: unknown; browserProfile?: unknown }
    if (candidate.type !== 'browser' || typeof candidate.id !== 'string') return []
    if (
      candidate.browserProfile !== undefined &&
      candidate.browserProfile !== null &&
      typeof candidate.browserProfile !== 'string'
    ) {
      throw new Error(`浏览器 Tab ${candidate.id} 的 Profile 绑定无效`)
    }
    return [
      {
        tabId: candidate.id,
        profileId: candidate.browserProfile ?? null,
      },
    ]
  })
}

async function bindBrowserRuntimeToWorkspace(
  workspaceKey: string | null,
  snapshot: WorkspaceStateSnapshot | null,
): Promise<void> {
  const reconcileViews = window.cclinkStudio?.browser?.reconcileViews
  if (!reconcileViews) return

  try {
    await reconcileViews({
      workspaceKey,
      views: getIncomingBrowserViews(snapshot),
      activeTabId: null,
    })
  } catch (error) {
    console.warn('[WorkspaceTransition] Browser runtime ownership update failed:', error)
  }
}

export async function prepareWorkspaceRuntimeTransition(
  ref: WorkspaceRef,
  options: { persistCurrent?: boolean; generation?: number } = {},
): Promise<WorkspaceRuntimeTransition> {
  const generation = options.generation ?? beginWorkspaceRuntimeTransition()
  const key = workspaceRefKey(ref)
  const currentKey = getWorkspaceStateKey()
  const currentRef = useWorkspaceStore.getState().activeWorkspaceRef
  const outgoingOwnership = collectWorkspaceRuntimeResourceOwnership(currentKey)
  if (isWorkspaceRuntimeTransitionCurrent(generation)) cancelActivePanelResize()

  if (options.persistCurrent !== false && key !== currentKey) {
    // Markdown 滚动位置在组件内防抖；项目切换前必须先采样 DOM，
    // 再由统一 WorkspaceState 所有者持久化出站快照。
    flushMountedMarkdownViewStates()
    await protectEditorDraftsBeforeSwitch()
    // Optional view snapshots may degrade; editor content is guarded separately above.
    const layout = isWorkspaceRuntimeTransitionCurrent(generation) ? captureWorkspaceLayout() : null
    await Promise.all([
      persistRuntimeSections(currentKey, currentRef),
      ...(layout ? [persistCapturedWorkspaceLayout(layout).catch(() => {})] : []),
    ])
  }

  // A 离开前最后一次调整可能仍在写入；快速切回时必须先等待目标 layout，再读取磁盘快照。
  const ownerKey = getWorkspaceStateOwnerKey()
  // 同工作空间重开不 hydrate layout，继续保留内存值，无需等待其未使用的磁盘布局。
  if (key !== currentKey) await flushPendingWorkspaceSectionWrites('layout', key, ownerKey)
  const snapshot = await window.cclinkStudio.workspaceState.get(key, ownerKey)

  return { ref, key, snapshot, generation, outgoingOwnership }
}

export async function applyWorkspaceRuntimeTransition(
  transition: WorkspaceRuntimeTransition,
  options: { hydrate?: boolean; flush?: boolean; commitProjection?: () => void } = {},
): Promise<boolean> {
  if (!isWorkspaceRuntimeTransitionCurrent(transition.generation)) return false
  const [, terminalSessions] = await Promise.all([
    waitForOptionalRuntime(
      'Browser',
      bindBrowserRuntimeToWorkspace(transition.key, transition.snapshot),
    ),
    waitForOptionalRuntime('Terminal', readTerminalRuntimeStatuses()),
  ])
  if (!isWorkspaceRuntimeTransitionCurrent(transition.generation)) return false
  const activeLocalPath = transition.ref.kind === 'local' ? transition.ref.path : null
  const activeResult =
    transition.ref.kind === 'remote'
      ? await window.cclinkStudio.workspaceState.setActiveLocalWorkspace(null, 'remote')
      : await window.cclinkStudio.workspaceState.setActiveLocalWorkspace(activeLocalPath)
  if (!activeResult.success || !isWorkspaceRuntimeTransitionCurrent(transition.generation)) {
    console.warn('[WorkspaceTransition] 主进程工作空间提交失败:', activeResult.error)
    return false
  }
  // Include edits made while the target workspace and its optional runtimes were loading.
  if (transition.key !== getWorkspaceStateKey()) {
    try {
      await protectEditorDraftsBeforeSwitch()
    } catch (error) {
      const previous = useWorkspaceStore.getState().activeWorkspaceRef
      if (isWorkspaceRuntimeTransitionCurrent(transition.generation)) {
        const rollback = await window.cclinkStudio.workspaceState.setActiveLocalWorkspace(
          previous.kind === 'local' ? previous.path : null,
          previous.kind === 'remote' ? 'remote' : 'selection',
        )
        if (!rollback.success)
          console.warn('[WorkspaceTransition] 恢复原工作空间选择失败:', rollback.error)
        // The incoming reconciliation may already have hidden the outgoing browser views.
        // Restore their ownership/activation along with the workspace selection on abort.
        if (isWorkspaceRuntimeTransitionCurrent(transition.generation)) {
          const tabs = useTabStore.getState()
          const browserTabs = tabs.tabs.filter(
            (tab) =>
              tab.type === 'browser' &&
              tab.workspaceRef &&
              workspaceRefKey(tab.workspaceRef) === workspaceRefKey(previous),
          )
          const reconcile = window.cclinkStudio.browser?.reconcileViews
          if (reconcile)
            await waitForOptionalRuntime(
              'Browser rollback',
              reconcile({
                workspaceKey: workspaceRefKey(previous),
                views: browserTabs.map((tab) => ({
                  tabId: tab.id,
                  profileId: tab.browserProfile ?? null,
                })),
                activeTabId: browserTabs.some((tab) => tab.id === tabs.activeTabId)
                  ? tabs.activeTabId
                  : null,
              }).catch((reason: unknown) => {
                console.warn('[WorkspaceTransition] 恢复原浏览器绑定失败:', reason)
              }),
            )
        }
      }
      throw error
    }
    if (!isWorkspaceRuntimeTransitionCurrent(transition.generation)) return false
  }
  // 等待期间用户可能又开始拖拽；最终提交前同步释放，不能让 Browser 继续处于 resize 隐藏态。
  cancelActivePanelResize()
  // 同工作空间重开时，内存布局可能比读取的磁盘快照更新；保持用户最新布局，避免迟到写回旧宽度。
  const restoreLayout = transition.key !== getWorkspaceStateKey()
  options.commitProjection?.()
  useWorkspaceStore.getState().commitActiveWorkspace(transition.ref)

  if (options.hydrate !== false) {
    hydrateRuntimeSections(transition.snapshot, transition.ref, { restoreLayout })
    if (terminalSessions) applyTerminalRuntimeStatuses(terminalSessions, transition.key)
    void reconcileAgentRuntimeStatuses(transition.key)
  }

  if (options.flush !== false) {
    void persistRuntimeSections(transition.key, transition.ref)
  }
  return true
}
