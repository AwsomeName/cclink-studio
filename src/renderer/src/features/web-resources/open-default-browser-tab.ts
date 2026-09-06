import type { WorkspaceRef } from '@shared/workspace-ref'
import { useTabStore } from '../../stores/tab-store'

export const EMPTY_BROWSER_TAB_URL = 'about:blank'

export interface OpenBrowserTabResult {
  tabId: string
  saveable: boolean
  error?: string
}

export interface OpenWebAccountDraftTabResult {
  tabId: string
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
  return { tabId: getOpenedTabId(), saveable: Boolean(binding) }
}

/**
 * 打开普通 Browser Tab。对本地工作空间，预先分配一个持久 Profile 草稿：用户可以先正常
 * 浏览和登录，再把当前 Tab 原地保存成账号；保存过程不会切换 Profile 或要求再次登录。
 */
export async function openDefaultBrowserTab(
  workspaceRef: WorkspaceRef,
  options: OpenDefaultBrowserTabOptions = {},
): Promise<OpenBrowserTabResult> {
  if (workspaceRef.kind === 'local') {
    try {
      const result = await window.cclinkStudio.webResources.beginDraft({ workspaceRef })
      if (result.success) {
        return openBrowserTab(workspaceRef, options, {
          browserProfile: result.data.browserProfileId,
          draftId: result.data.draftId,
        })
      }
      return {
        ...openBrowserTab(workspaceRef, options),
        error: result.error.message,
      }
    } catch (error) {
      return {
        ...openBrowserTab(workspaceRef, options),
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  return {
    ...openBrowserTab(workspaceRef, options),
    error: '请先打开一个本地项目',
  }
}

/** 从账号管理入口添加账号；与普通 Browser 使用同一种“先浏览登录、后原地保存”模型。 */
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
