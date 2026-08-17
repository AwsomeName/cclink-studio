const REMOTE_SESSION_TITLE_LIMIT = 30

export function isGenericRemoteSessionTitle(title: string): boolean {
  const normalized = title.trim()
  return (
    !normalized ||
    normalized === '新远程会话' ||
    /^远程会话(?:\s+[a-z0-9-]{4,})?$/iu.test(normalized) ||
    /^会话\s*·\s*.+$/u.test(normalized)
  )
}

export function deriveRemoteSessionTitle(content: string): string | null {
  const normalized = content.replace(/\s+/gu, ' ').trim()
  if (!normalized) return null
  const characters = Array.from(normalized)
  if (characters.length <= REMOTE_SESSION_TITLE_LIMIT) return normalized
  return `${characters.slice(0, REMOTE_SESSION_TITLE_LIMIT).join('')}…`
}

export function resolveRemoteSessionTitle(input: {
  currentTitle?: string
  incomingTitle?: string
  sessionId: string
}): string {
  const current = input.currentTitle?.trim() ?? ''
  const incoming = input.incomingTitle?.trim() ?? ''
  if (current && !isGenericRemoteSessionTitle(current) && isGenericRemoteSessionTitle(incoming)) {
    return current
  }
  return incoming || current || `远程会话 ${input.sessionId.slice(-6)}`
}
