export const STATUS_BAR_CONVERSATION_TITLE_LIMIT = 10

export function formatStatusBarConversationTitle(title: string): string {
  const normalized = title.trim() || '新会话'
  const characters = Array.from(normalized)
  if (characters.length <= STATUS_BAR_CONVERSATION_TITLE_LIMIT) return normalized
  return `${characters.slice(0, STATUS_BAR_CONVERSATION_TITLE_LIMIT).join('')}…`
}
