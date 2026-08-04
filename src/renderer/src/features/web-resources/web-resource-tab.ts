import type {
  WebAccount,
  WebPrincipal,
  WebsiteResource,
} from '@shared/web-resources/web-resource-types'
import type { WorkspaceRef } from '@shared/workspace-ref'
import { useTabStore } from '../../stores'

export interface WebResourceTabDescriptor {
  account: WebAccount
  principal: WebPrincipal
  website: WebsiteResource
}

/** Open or activate the single primary Browser Tab for a project website account resource. */
export function ensureWebResourceTab(
  descriptor: WebResourceTabDescriptor,
  workspaceRef: WorkspaceRef,
): string {
  const { account, principal, website } = descriptor
  if (!account.projectId) throw new Error('网站账号尚未归属当前项目')

  const store = useTabStore.getState()
  store.openTab({
    type: 'browser',
    title: `${website.name} · ${principal.name}`,
    icon: '🌐',
    initialUrl: website.entryUrl,
    browserProfile: account.browserProfileId,
    webResourceRef: { projectId: account.projectId, accountId: account.id },
    workspaceRef,
  })

  const tabId = useTabStore.getState().activeTabId
  if (!tabId) throw new Error('网页 Tab 创建失败')
  return tabId
}
