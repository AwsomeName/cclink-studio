import type { Session } from 'electron'

const observed = new WeakSet<Session>()

/** Opt-in developer diagnostics: never log headers, bodies, query strings or credentials. */
export function installBrowserLoadDiagnostics(session: Session): void {
  if (process.env.CCLINK_BROWSER_LOAD_DIAGNOSTICS !== '1' || observed.has(session)) return
  observed.add(session)
  const record = (
    details: Electron.OnErrorOccurredListenerDetails | Electron.OnCompletedListenerDetails,
  ) => {
    console.info('[BrowserLoad]', JSON.stringify(loadDiagnostic(details)))
  }
  session.webRequest.onErrorOccurred(record)
  session.webRequest.onCompleted((details) => {
    if (details.resourceType === 'mainFrame' || details.statusCode >= 400) record(details)
  })
}

export function loadDiagnostic(details: {
  id: number
  url: string
  resourceType: string
  fromCache: boolean
  webContentsId?: number
  error?: string
  statusCode?: number
}) {
  let origin: string | undefined
  try {
    const parsed = new URL(details.url)
    if (['http:', 'https:'].includes(parsed.protocol)) origin = parsed.origin
  } catch {
    /* Invalid and non-web URLs are deliberately omitted. */
  }
  return {
    requestId: details.id,
    origin,
    resourceType: details.resourceType,
    webContentsId: details.webContentsId,
    fromCache: details.fromCache,
    statusCode: details.statusCode,
    error: details.error?.match(/(?:net::)?ERR_[A-Z_]+/u)?.[0],
  }
}
