import type { WorkspaceRef } from '@shared/workspace-ref'
import { useTabStore } from '../../stores/tab-store'
import { useWorkspaceStore } from '../../stores/workspace-store'

export interface BrowserLinkTarget {
  url: string
  title: string
}

export function normalizeHttpUrl(value: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

export function resolveBrowserLinkClick(event: MouseEvent): BrowserLinkTarget | null {
  if (event.button !== 0 || !(event.target instanceof Element)) return null
  const anchor = event.target.closest('a[href]')
  const url = normalizeHttpUrl(anchor?.getAttribute('href') ?? null)
  if (!url) return null
  return {
    url,
    title: anchor?.textContent?.trim().slice(0, 40) || '链接',
  }
}

export function openHttpUrlInNewBrowserTab(input: {
  url: string
  title?: string
  sourceTabId?: string
}): boolean {
  const url = normalizeHttpUrl(input.url)
  if (!url) return false

  const tabState = useTabStore.getState()
  const sourceWorkspaceRef: WorkspaceRef =
    tabState.tabs.find((tab) => tab.id === input.sourceTabId)?.workspaceRef ??
    useWorkspaceStore.getState().activeWorkspaceRef

  tabState.openTab({
    type: 'browser',
    title: input.title?.trim().slice(0, 40) || '链接',
    icon: '🌐',
    initialUrl: url,
    workspaceRef: sourceWorkspaceRef,
    forceNew: true,
  })
  return true
}
