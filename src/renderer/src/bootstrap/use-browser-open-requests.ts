import { useEffect } from 'react'
import type { BrowserContextAgentRequest, BrowserOpenTabRequest } from '@shared/ipc/browser'
import { workspaceRefKey } from '@shared/workspace-ref'
import { useTabStore } from '../stores/tab-store'
import { useWorkspaceStore } from '../stores/workspace-store'
import { useAgentStore } from '../stores/agent-store'
import { useUIStore } from '../stores/ui-store'
import { useContextMenuStore } from '../features/context-actions/context-menu-store'
import { focusAgentComposer } from '../features/markdown/markdown-navigation'
import { useToastStore } from '../components/common/Toast'

export function openRequestedBrowserTab(request: BrowserOpenTabRequest): void {
  const tabState = useTabStore.getState()
  const activeWorkspaceRef = useWorkspaceStore.getState().activeWorkspaceRef
  const activeWorkspaceKey = workspaceRefKey(activeWorkspaceRef)
  if (request.workspaceKey !== activeWorkspaceKey) return

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

  tabState.openTab({
    type: 'browser',
    title: '浏览器',
    icon: '🌐',
    initialUrl: request.initialUrl,
    browserProfile: request.profileId ?? null,
    workspaceRef: activeWorkspaceRef,
    forceNew: true,
  })
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
    const offOpen = window.cclinkStudio.browser.onRequestOpenTab(openRequestedBrowserTab)
    const offNativeMenu = window.cclinkStudio.browser.onNativeContextMenuOpened(() => {
      useContextMenuStore.getState().hide('native-browser-menu')
    })
    const offAgent = window.cclinkStudio.browser.onContextAgentRequest(mountBrowserContextToAgent)
    return () => {
      offOpen()
      offNativeMenu()
      offAgent()
    }
  }, [enabled])
}
