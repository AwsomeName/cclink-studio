import type { WorkspaceRef } from '@shared/workspace-ref'
import { useTabStore } from '../../stores/tab-store'

export const EMPTY_BROWSER_TAB_URL = 'about:blank'

export interface OpenBrowserTabResult {
  tabId: string
}

export interface OpenWebAccountDraftTabResult extends OpenBrowserTabResult {
  success: boolean
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

function openBrowserTab(
  workspaceRef: WorkspaceRef,
  options: OpenDefaultBrowserTabOptions,
  binding?: { browserProfile: string; draftId: string },
): OpenBrowserTabResult {
  useTabStore.getState().openTab({
    type: 'browser',
    title: options.title?.trim() || '浏览器',
    icon: '🌐',
    ...(binding
      ? {
          browserProfile: binding.browserProfile,
          webResourceDraftRef: { draftId: binding.draftId },
        }
      : { browserProfile: null }),
    workspaceRef,
    initialUrl: options.initialUrl ?? EMPTY_BROWSER_TAB_URL,
    forceNew: true,
  })
  return { tabId: getOpenedTabId() }
}

/** 打开共享默认 Session 的普通 Browser Tab；不依赖网站账号服务。 */
export async function openDefaultBrowserTab(
  workspaceRef: WorkspaceRef,
  options: OpenDefaultBrowserTabOptions = {},
): Promise<OpenBrowserTabResult> {
  return openBrowserTab(workspaceRef, options)
}

/** 只有明确“添加网站与账号”时才创建隔离的账号草稿 Profile。 */
export async function openWebAccountDraftTab(
  workspaceRef: WorkspaceRef,
  options: OpenDefaultBrowserTabOptions = {},
): Promise<OpenWebAccountDraftTabResult> {
  if (workspaceRef.kind !== 'local') {
    return { tabId: '', success: false, error: '请先打开一个本地项目' }
  }

  try {
    const result = await window.cclinkStudio.webResources.beginDraft({ workspaceRef })
    if (!result.success) return { tabId: '', success: false, error: result.error.message }
    return {
      ...openBrowserTab(workspaceRef, options, {
        browserProfile: result.data.browserProfileId,
        draftId: result.data.draftId,
      }),
      success: true,
    }
  } catch (error) {
    return {
      tabId: '',
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
