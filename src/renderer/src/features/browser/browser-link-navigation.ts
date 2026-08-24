import type { WorkspaceRef } from '@shared/workspace-ref'
import { useTabStore } from '../../stores/tab-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useToastStore } from '../../components/common/Toast'
import { openDefaultBrowserTab } from '../web-resources/open-default-browser-tab'
import { getBrowserTabMode } from './browser-tab-mode'

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

export async function openHttpUrlInNewBrowserTab(input: {
  url: string
  title?: string
  sourceTabId?: string
}): Promise<boolean> {
  const url = normalizeHttpUrl(input.url)
  if (!url) return false

  const tabState = useTabStore.getState()
  const sourceTab = tabState.tabs.find((tab) => tab.id === input.sourceTabId)
  const sourceWorkspaceRef: WorkspaceRef =
    sourceTab?.workspaceRef ?? useWorkspaceStore.getState().activeWorkspaceRef

  if (sourceTab?.type === 'browser') {
    const mode = getBrowserTabMode(sourceTab)
    if (mode === 'invalid') {
      useToastStore.getState().show('未打开新页面：来源浏览器登录环境不完整', 'error')
      return false
    }
    tabState.openTab({
      type: 'browser',
      title: input.title?.trim().slice(0, 40) || '链接',
      icon: '🌐',
      initialUrl: url,
      browserProfile: sourceTab.browserProfile ?? null,
      webResourceRef: sourceTab.webResourceRef,
      webResourceDraftRef: sourceTab.webResourceDraftRef,
      workspaceRef: sourceWorkspaceRef,
      forceNew: true,
    })
    return true
  }

  await openDefaultBrowserTab(sourceWorkspaceRef, {
    initialUrl: url,
    title: input.title?.trim().slice(0, 40) || '链接',
  })
  return true
}
