export const CLEAN_BROWSER_CHILD_ARGUMENT = '--cclink-clean-browser='

export interface CleanBrowserChildOptions {
  url: string
  userDataPath: string
}

export interface CleanBrowserNavigateMessage {
  type: 'clean-browser-navigate'
  url: string
}

export function encodeCleanBrowserChildOptions(options: CleanBrowserChildOptions): string {
  return Buffer.from(JSON.stringify(options), 'utf8').toString('base64url')
}

export function parseCleanBrowserChildOptions(argv: string[]): CleanBrowserChildOptions | null {
  const argument = argv.find((value) => value.startsWith(CLEAN_BROWSER_CHILD_ARGUMENT))
  if (!argument) return null

  try {
    const encoded = argument.slice(CLEAN_BROWSER_CHILD_ARGUMENT.length)
    const value = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8'),
    ) as Partial<CleanBrowserChildOptions>
    if (typeof value.url !== 'string' || typeof value.userDataPath !== 'string') return null
    if (!isSupportedCleanBrowserUrl(value.url)) return null
    return value as CleanBrowserChildOptions
  } catch {
    return null
  }
}

export function isSupportedCleanBrowserUrl(value: string): boolean {
  if (value.length > 16_384) return false
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
  } catch {
    return false
  }
}
