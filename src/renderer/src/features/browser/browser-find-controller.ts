import { workspaceRefKey } from '@shared/workspace-ref'
import { useTabStore } from '../../stores/tab-store'
import { useBrowserFindStore } from './browser-find-store'

let nextFindRequest = 1

function getCurrentBrowserTarget(tabId: string): { workspaceKey: string | null } | null {
  const state = useTabStore.getState()
  const tab = state.tabs.find((candidate) => candidate.id === tabId)
  if (state.activeTabId !== tabId || tab?.type !== 'browser' || !tab.workspaceRef) return null
  return { workspaceKey: workspaceRefKey(tab.workspaceRef) }
}

export async function runBrowserFind(
  tabId: string,
  options: { forward: boolean; findNext: boolean },
  requestedQuery?: string,
): Promise<void> {
  const session = useBrowserFindStore.getState().sessions[tabId]
  const query = (requestedQuery ?? session?.query ?? '').trim()
  const target = getCurrentBrowserTarget(tabId)
  if (!query || !target) {
    console.warn(
      `[BrowserFind] 未发起查找 tab=${tabId} reason=${!query ? 'empty-query' : 'stale-renderer-target'}`,
    )
    if (!target) {
      useBrowserFindStore.getState().setError(tabId, '当前浏览器目标已切换，请重新打开查找')
    }
    return
  }
  try {
    const identity = await window.cclinkStudio.browser.getRuntimeIdentity(tabId)
    if (!identity || identity.workspaceKey !== target.workspaceKey) {
      throw new Error('浏览器页面已切换，请重试')
    }
    const requestToken = `find-${Date.now()}-${nextFindRequest++}`
    useBrowserFindStore.getState().beginRequest(tabId, requestToken, identity.runtimeGeneration)
    console.log(
      `[BrowserFind] 发起查找 tab=${tabId} generation=${identity.runtimeGeneration} next=${options.findNext}`,
    )
    await window.cclinkStudio.browser.findInPage({
      ...identity,
      requestToken,
      query,
      forward: options.forward,
      findNext: options.findNext,
    })
  } catch (error) {
    console.warn(
      `[BrowserFind] 查找失败 tab=${tabId}: ${error instanceof Error ? error.message : String(error)}`,
    )
    useBrowserFindStore
      .getState()
      .setError(tabId, error instanceof Error ? error.message : '网页查找失败')
  }
}

export async function closeBrowserFind(tabId: string): Promise<void> {
  useBrowserFindStore.getState().close(tabId)
  await stopBrowserFindSelection(tabId)
}

export async function stopBrowserFindSelection(tabId: string): Promise<void> {
  const target = getCurrentBrowserTarget(tabId)
  if (!target) return
  try {
    const identity = await window.cclinkStudio.browser.getRuntimeIdentity(tabId)
    if (!identity || identity.workspaceKey !== target.workspaceKey) return
    await window.cclinkStudio.browser.stopFindInPage({
      ...identity,
      action: 'clearSelection',
    })
  } catch {
    // View may be navigating or closing; local find UI is already closed.
  }
}
