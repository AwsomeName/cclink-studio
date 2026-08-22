import { useEffect } from 'react'
import type {
  BrowserContextAgentRequest,
  BrowserOpenTabRequest,
  BrowserPopupCreatedPayload,
  BrowserRuntimeTabClosedPayload,
} from '@shared/ipc/browser'
import { localWorkspaceRef, workspaceRefKey, type WorkspaceRef } from '@shared/workspace-ref'
import { useTabStore } from '../stores/tab-store'
import { useWorkspaceStore } from '../stores/workspace-store'
import { useOpenProjectsStore } from '../stores/open-projects-store'
import { useAgentStore } from '../stores/agent-store'
import { useUIStore } from '../stores/ui-store'
import { useContextMenuStore } from '../features/context-actions/context-menu-store'
import { focusAgentComposer } from '../features/markdown/markdown-navigation'
import { useToastStore } from '../components/common/Toast'
import { openDefaultBrowserTab } from '../features/web-resources/open-default-browser-tab'
import { openWorkspaceRef } from '../features/workspace-open/workspace-open-controller'

function requestedWorkspaceRef(workspaceKey: string | null): WorkspaceRef | null {
  if (!workspaceKey) return null
  const remoteRef = useOpenProjectsStore
    .getState()
    .openRemoteWorkspaceRefs.find((ref) => workspaceRefKey(ref) === workspaceKey)
  if (remoteRef) return remoteRef
  if (workspaceKey.startsWith('cclink://')) return null
  return localWorkspaceRef(workspaceKey)
}

async function activateBrowserRequestWorkspace(
  workspaceKey: string | null,
): Promise<WorkspaceRef | null> {
  const activeWorkspaceRef = useWorkspaceStore.getState().activeWorkspaceRef
  if (workspaceRefKey(activeWorkspaceRef) === workspaceKey) return activeWorkspaceRef

  const targetWorkspaceRef = requestedWorkspaceRef(workspaceKey)
  if (!targetWorkspaceRef) {
    useToastStore.getState().show('未打开新页面：找不到来源项目，当前项目保持不变', 'error')
    return null
  }

  try {
    await openWorkspaceRef(targetWorkspaceRef, {
      confirmedRemote: targetWorkspaceRef.kind === 'remote',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    useToastStore
      .getState()
      .show(`未打开新页面：无法切换到来源项目（${message}），当前项目保持不变`, 'error')
    return null
  }

  const activatedWorkspaceRef = useWorkspaceStore.getState().activeWorkspaceRef
  if (workspaceRefKey(activatedWorkspaceRef) !== workspaceKey) {
    useToastStore.getState().show('未打开新页面：来源项目切换未完成，当前项目保持不变', 'error')
    return null
  }
  return activatedWorkspaceRef
}

export async function openRequestedBrowserTab(request: BrowserOpenTabRequest): Promise<void> {
  const activeWorkspaceRef = await activateBrowserRequestWorkspace(request.workspaceKey)
  if (!activeWorkspaceRef) return
  const tabState = useTabStore.getState()
  const activeWorkspaceKey = workspaceRefKey(activeWorkspaceRef)

  const activeTab = tabState.tabs.find((tab) => tab.id === tabState.activeTabId)
  if (
    !request.forceNew &&
    activeTab?.type === 'browser' &&
    activeTab.workspaceRef &&
    workspaceRefKey(activeTab.workspaceRef) === activeWorkspaceKey
  ) {
    return
  }

  const existingBrowserTab = !request.forceNew
    ? tabState.tabs.find(
        (tab) =>
          tab.type === 'browser' &&
          tab.workspaceRef &&
          workspaceRefKey(tab.workspaceRef) === activeWorkspaceKey,
      )
    : undefined
  if (existingBrowserTab) {
    tabState.activateTab(existingBrowserTab.id)
    return
  }

  if (request.profileId) {
    const sourceTab = request.sourceTabId
      ? tabState.tabs.find((tab) => tab.id === request.sourceTabId)
      : undefined
    const sourceBindingIsValid =
      sourceTab?.type === 'browser' &&
      sourceTab.workspaceRef !== undefined &&
      workspaceRefKey(sourceTab.workspaceRef) === activeWorkspaceKey &&
      sourceTab.browserProfile === request.profileId &&
      Number(Boolean(sourceTab.webResourceRef)) + Number(Boolean(sourceTab.webResourceDraftRef)) ===
        1
    if (!sourceBindingIsValid) {
      useToastStore
        .getState()
        .show('未打开新页面：来源账号归属不完整，已阻止创建仅有登录 Profile 的 Tab', 'error')
      return
    }
    tabState.openTab({
      type: 'browser',
      title: '浏览器',
      icon: '🌐',
      initialUrl: request.initialUrl,
      browserProfile: request.profileId,
      webResourceRef: sourceTab.webResourceRef,
      webResourceDraftRef: sourceTab.webResourceDraftRef,
      workspaceRef: activeWorkspaceRef,
      forceNew: true,
    })
    return
  }

  const result = await openDefaultBrowserTab(activeWorkspaceRef, {
    initialUrl: request.initialUrl,
  })
  if (!result.saveable) {
    useToastStore.getState().show(`网页已打开，但账号保存环境创建失败：${result.error}`, 'error')
  }
}

export async function adoptRequestedBrowserPopup(
  payload: BrowserPopupCreatedPayload,
): Promise<boolean> {
  try {
    // 10 秒只限制 renderer 是否开始处理，不能限制后续真实的跨项目切换。
    await window.cclinkStudio.browser.beginPopupAdoption(payload.tabId)
  } catch {
    useToastStore.getState().show('新页面已超时或失效，未切换项目', 'error')
    return false
  }

  const activeWorkspaceRef = await activateBrowserRequestWorkspace(payload.workspaceKey)
  if (!activeWorkspaceRef) {
    await window.cclinkStudio.browser.rejectPopup(payload.tabId).catch(() => undefined)
    return false
  }

  const tabState = useTabStore.getState()
  const sourceTab = tabState.tabs.find((tab) => tab.id === payload.sourceTabId)
  const inheritsWebResource =
    sourceTab?.type === 'browser' &&
    sourceTab.workspaceRef !== undefined &&
    workspaceRefKey(sourceTab.workspaceRef) === payload.workspaceKey &&
    (sourceTab.browserProfile ?? null) === payload.profileId

  const accepted = tabState.adoptBrowserRuntimeTab({
    id: payload.tabId,
    title: '浏览器',
    initialUrl: payload.url,
    browserProfile: payload.profileId,
    ...(inheritsWebResource
      ? {
          webResourceRef: sourceTab.webResourceRef,
          webResourceDraftRef: sourceTab.webResourceDraftRef,
        }
      : {}),
    workspaceRef: activeWorkspaceRef,
    activate: payload.activate,
  })
  if (!accepted) {
    await window.cclinkStudio.browser.rejectPopup(payload.tabId).catch(() => undefined)
    useToastStore.getState().show('新页面与现有 Tab 冲突，已安全关闭', 'error')
    return false
  }

  try {
    await window.cclinkStudio.browser.acceptPopup(payload.tabId)
  } catch {
    const tab = useTabStore.getState().tabs.find((item) => item.id === payload.tabId)
    if (tab?.type === 'browser') useTabStore.getState().closeTab(payload.tabId)
    await window.cclinkStudio.browser.rejectPopup(payload.tabId).catch(() => undefined)
    useToastStore.getState().show('新页面接纳失败，已关闭', 'error')
    return false
  }
  return true
}

export function closeRuntimeBrowserTab(payload: BrowserRuntimeTabClosedPayload): void {
  const tab = useTabStore.getState().tabs.find((item) => item.id === payload.tabId)
  if (
    tab?.type !== 'browser' ||
    !tab.workspaceRef ||
    workspaceRefKey(tab.workspaceRef) !== payload.workspaceKey
  ) {
    return
  }
  useTabStore.getState().closeTab(payload.tabId)
}

export function mountBrowserContextToAgent(request: BrowserContextAgentRequest): void {
  const activeWorkspaceRef = useWorkspaceStore.getState().activeWorkspaceRef
  const activeWorkspaceKey = workspaceRefKey(activeWorkspaceRef)
  const tab = useTabStore.getState().tabs.find((item) => item.id === request.tabId)
  if (
    request.workspaceKey !== activeWorkspaceKey ||
    tab?.type !== 'browser' ||
    !tab.workspaceRef ||
    workspaceRefKey(tab.workspaceRef) !== request.workspaceKey ||
    (tab.browserProfile ?? null) !== request.profileId
  ) {
    useToastStore.getState().show('网页目标已切换，未挂到 Agent', 'error')
    return
  }

  const agentStore = useAgentStore.getState()
  const conversation = agentStore.conversations[agentStore.activeConversationId]
  const conversationWorkspaceKey = conversation?.runtime.workspaceRef
    ? workspaceRefKey(conversation.runtime.workspaceRef)
    : null
  if (!conversation || conversationWorkspaceKey !== request.workspaceKey) {
    useToastStore.getState().show('当前 Agent 会话属于其他项目', 'error')
    return
  }

  const sourceUrl = request.url ?? request.pageUrl
  const labelBySource = {
    selection: '网页选区',
    link: '网页链接',
    image: '网页图片',
    page: '网页页面',
  } as const
  agentStore.addMountedResource(
    {
      id: `browser-context:${request.tabId}:${request.source}:${Date.now()}`,
      kind: 'browser',
      label: labelBySource[request.source],
      detail: request.source === 'selection' ? '已挂载网页选中文本' : sourceUrl,
      ref: {
        type: 'browser',
        tabId: request.tabId,
        workspaceKey: request.workspaceKey,
        sourceUrl,
        selectedText: request.text,
      },
    },
    agentStore.activeConversationId,
  )
  useUIStore.getState().setAgentPanelMode('right', 'user')
  useToastStore.getState().show('已挂到当前 Agent，会在你确认发送后使用', 'success')
  requestAnimationFrame(focusAgentComposer)
}

export function useBrowserOpenRequests(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return
    const offOpen = window.cclinkStudio.browser.onRequestOpenTab((request) => {
      void openRequestedBrowserTab(request)
    })
    const offPopup = window.cclinkStudio.browser.onPopupCreated((payload) => {
      void adoptRequestedBrowserPopup(payload)
    })
    const offRuntimeClosed = window.cclinkStudio.browser.onRuntimeTabClosed(closeRuntimeBrowserTab)
    const offNativeMenu = window.cclinkStudio.browser.onNativeContextMenuOpened(() => {
      useContextMenuStore.getState().hide('native-browser-menu')
    })
    const offAgent = window.cclinkStudio.browser.onContextAgentRequest(mountBrowserContextToAgent)
    return () => {
      offOpen()
      offPopup()
      offRuntimeClosed()
      offNativeMenu()
      offAgent()
    }
  }, [enabled])
}
