import type { Tab } from '../../types'

export type BrowserTabMode = 'ordinary' | 'account' | 'account-draft' | 'invalid'

type BrowserBinding = Pick<Tab, 'browserProfile' | 'webResourceRef' | 'webResourceDraftRef'>

export function getBrowserTabMode(tab: BrowserBinding): BrowserTabMode {
  const profileIsAbsent = tab.browserProfile === null || tab.browserProfile === undefined
  const accountIsAbsent = tab.webResourceRef === null || tab.webResourceRef === undefined
  const draftIsAbsent = tab.webResourceDraftRef === null || tab.webResourceDraftRef === undefined
  const hasValidProfile =
    typeof tab.browserProfile === 'string' && Boolean(tab.browserProfile.trim())
  const hasValidAccount =
    typeof tab.webResourceRef?.accountId === 'string' &&
    Boolean(tab.webResourceRef.accountId.trim())
  const hasValidDraft =
    typeof tab.webResourceDraftRef?.draftId === 'string' &&
    Boolean(tab.webResourceDraftRef.draftId.trim())

  if (profileIsAbsent && accountIsAbsent && draftIsAbsent) return 'ordinary'
  if (hasValidProfile && hasValidAccount && draftIsAbsent) return 'account'
  if (hasValidProfile && accountIsAbsent && hasValidDraft) return 'account-draft'
  return 'invalid'
}

export function isValidBrowserTabMode(tab: BrowserBinding): boolean {
  return getBrowserTabMode(tab) !== 'invalid'
}
