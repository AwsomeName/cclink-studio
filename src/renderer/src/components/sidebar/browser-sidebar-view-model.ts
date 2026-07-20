import type { WorkspaceRef } from '@shared/workspace-ref'
import { workspaceRefKey } from '@shared/workspace-ref'
import type { Tab } from '../../types'

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
