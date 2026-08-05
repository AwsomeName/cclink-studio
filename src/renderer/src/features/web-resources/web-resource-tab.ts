import type { WebResourceLaunchDescriptor } from '@shared/web-resources/web-resource-types'
import type { WorkspaceRef } from '@shared/workspace-ref'
import { useTabStore } from '../../stores'

export function openResolvedWebResourceTab(
  descriptor: WebResourceLaunchDescriptor,
  workspaceRef: WorkspaceRef,
): string {
  const store = useTabStore.getState()
  store.openTab({
    type: 'browser',
    title: descriptor.title,
    icon: '🌐',
    initialUrl: descriptor.entryUrl,
    browserProfile: descriptor.browserProfileId,
    webResourceRef: descriptor.webResourceRef,
    workspaceRef,
  })
  const tabId = useTabStore.getState().activeTabId
  if (!tabId) throw new Error('网页 Tab 创建失败')
  return tabId
}

/** Resolve the project-owned account in main, then open or activate its single Browser Tab. */
export async function resolveAndOpenWebResourceTab(
  accountId: string,
  workspaceRef: WorkspaceRef,
): Promise<string> {
  const result = await window.cclinkStudio.webResources.resolveLaunch({
    workspaceRef,
    accountId,
  })
  if (!result.success) throw new Error(result.error.message)
  return openResolvedWebResourceTab(result.data, workspaceRef)
}
