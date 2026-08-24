import type { Tab } from '../../types'

export type BrowserTabMode = 'ordinary' | 'account' | 'account-draft' | 'invalid'

type BrowserBinding = Pick<Tab, 'browserProfile' | 'webResourceRef' | 'webResourceDraftRef'>

export function getBrowserTabMode(tab: BrowserBinding): BrowserTabMode {
  const hasProfile = typeof tab.browserProfile === 'string' && Boolean(tab.browserProfile.trim())
  const hasAccount =
    typeof tab.webResourceRef?.accountId === 'string' &&
    Boolean(tab.webResourceRef.accountId.trim())
  const hasDraft =
    typeof tab.webResourceDraftRef?.draftId === 'string' &&
    Boolean(tab.webResourceDraftRef.draftId.trim())

  if (!hasProfile && !hasAccount && !hasDraft) return 'ordinary'
  if (hasProfile && hasAccount && !hasDraft) return 'account'
  if (hasProfile && !hasAccount && hasDraft) return 'account-draft'
  return 'invalid'
}

export function isValidBrowserTabMode(tab: BrowserBinding): boolean {
  return getBrowserTabMode(tab) !== 'invalid'
}
