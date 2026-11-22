import type { WebAccount, WebsiteResource } from '@shared/web-resources/web-resource-types'
import {
  observeWebResourceLogin,
  type WebResourceLoginObservation,
} from './web-resource-view-model'

/**
 * Reads each account's own isolated browser profile; at most eight checks run at once.
 * A failed check is reported as an error for that account only.
 */
export async function checkWebAccountLogins(
  rows: Array<{ account: WebAccount; website: WebsiteResource }>,
): Promise<Record<string, WebResourceLoginObservation>> {
  const entries: Array<readonly [string, WebResourceLoginObservation]> = []
  for (let index = 0; index < rows.length; index += 8) {
    const batch = rows.slice(index, index + 8)
    entries.push(
      ...(await Promise.all(
        batch.map(async ({ account, website }) => {
          try {
            const summary = await window.cclinkStudio.browser.getSessionDiagnostics({
              url: website.entryUrl,
              profileId: account.browserProfileId,
            })
            return [account.id, observeWebResourceLogin(summary)] as const
          } catch {
            return [account.id, { status: 'error' as const, checkedAt: Date.now() }] as const
          }
        }),
      )),
    )
  }
  return Object.fromEntries(entries)
}
