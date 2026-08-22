import type { WorkspaceRef } from '@shared/workspace-ref'
import { useTabStore } from '../../stores/tab-store'

export const EMPTY_BROWSER_TAB_URL = 'about:blank'

export interface OpenDefaultBrowserTabResult {
  tabId: string
  saveable: boolean
  error?: string
}

export interface OpenDefaultBrowserTabOptions {
  initialUrl?: string
  title?: string
}

function getOpenedTabId(): string {
  const tabId = useTabStore.getState().activeTabId
  if (!tabId) throw new Error('浏览器 Tab 创建失败')
  return tabId
}

/**
 * 打开默认浏览器 Tab，并在本地项目中复用网站账号草稿的独立登录环境。
 * 服务不可用或没有本地项目时仍保留基础网页浏览，避免账号能力阻断浏览器。
 */
export async function openDefaultBrowserTab(
  workspaceRef: WorkspaceRef,
  options: OpenDefaultBrowserTabOptions = {},
): Promise<OpenDefaultBrowserTabResult> {
  const initialUrl = options.initialUrl ?? EMPTY_BROWSER_TAB_URL
  const title = options.title?.trim() || '浏览器'
  if (workspaceRef.kind === 'local') {
    try {
      const result = await window.cclinkStudio.webResources.beginDraft({ workspaceRef })
      if (result.success) {
        useTabStore.getState().openTab({
          type: 'browser',
          title,
          icon: '🌐',
          browserProfile: result.data.browserProfileId,
          webResourceDraftRef: { draftId: result.data.draftId },
          workspaceRef,
          initialUrl,
          forceNew: true,
        })
        return { tabId: getOpenedTabId(), saveable: true }
      }

      useTabStore.getState().openTab({
        type: 'browser',
        title,
        icon: '🌐',
        workspaceRef,
        initialUrl,
        forceNew: true,
        allowDegradedBrowser: true,
      })
      return { tabId: getOpenedTabId(), saveable: false, error: result.error.message }
    } catch (error) {
      useTabStore.getState().openTab({
        type: 'browser',
        title,
        icon: '🌐',
        workspaceRef,
        initialUrl,
        forceNew: true,
        allowDegradedBrowser: true,
      })
      return {
        tabId: getOpenedTabId(),
        saveable: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  useTabStore.getState().openTab({
    type: 'browser',
    title,
    icon: '🌐',
    workspaceRef,
    initialUrl,
    forceNew: true,
  })
  return { tabId: getOpenedTabId(), saveable: false, error: '请先打开一个本地项目' }
}
