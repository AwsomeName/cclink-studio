import type { Session } from 'electron'

const configuredSessions = new WeakSet<Session>()

const ACCEPT_LANGUAGE = 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7'

export function normalizeDesktopUserAgent(userAgent: string): string {
  return userAgent
    // Electron inserts the packaged product token immediately before Chrome/.
    // The production name may contain localized characters (for example
    // `CCLinkStudio开源版/0.1.37`), so matching only the npm package name leaves
    // a non-Chrome token visible to strict SSO/WAF implementations.
    .replace(/\s+[^()\s/]+\/[\d.]+(?=\s+Chrome\/[\d.]+)/gi, '')
    .replace(/\s+(Electron|cclink-studio|cclinkstudio)\/[\d.]+/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * Remove the Electron product token while preserving Chromium's real client hints.
 * Keeping the browser engine current is safer than inventing a mismatched Chrome identity.
 */
export function installBrowserCompatibilityHeaders(session: Session): void {
  if (configuredSessions.has(session)) return
  configuredSessions.add(session)

  session.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders }

    for (const key of Object.keys(headers)) {
      const lower = key.toLowerCase()
      if (lower === 'user-agent' && typeof headers[key] === 'string') {
        headers[key] = normalizeDesktopUserAgent(headers[key])
      }
    }

    if (!Object.keys(headers).some((key) => key.toLowerCase() === 'accept-language')) {
      headers['Accept-Language'] = ACCEPT_LANGUAGE
    }

    callback({ requestHeaders: headers })
  })
}
