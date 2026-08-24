import type { WorkspaceRef } from '@shared/workspace-ref'
import { workspaceRefKey } from '@shared/workspace-ref'
import type { Tab } from '../../types'
import type { BrowserTabState } from '../../stores/browser-store'
import { getBrowserTabMode } from '../../features/browser/browser-tab-mode'

export function getBrowserTabsForWorkspace(tabs: Tab[], workspaceRef: WorkspaceRef): Tab[] {
  const workspaceKey = workspaceRefKey(workspaceRef)
  return tabs.filter(
    (tab) =>
      tab.type === 'browser' &&
      Boolean(tab.workspaceRef) &&
      workspaceRefKey(tab.workspaceRef!) === workspaceKey,
  )
}

export function getBrowserUrlLabel(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.host || url
  } catch {
    return url
  }
}

export function getBrowserDisplayTitle(tabTitle: string, pageTitle?: string | null): string {
  const normalizedPageTitle = pageTitle?.trim()
  return tabTitle === '浏览器' && normalizedPageTitle ? normalizedPageTitle : tabTitle
}

export function findOrdinaryBrowserTabByUrl(
  tabs: Tab[],
  browserTabs: Partial<Record<string, Pick<BrowserTabState, 'url'>>>,
  url: string,
): Tab | undefined {
  return tabs.find(
    (tab) => getBrowserTabMode(tab) === 'ordinary' && browserTabs[tab.id]?.url === url,
  )
}
