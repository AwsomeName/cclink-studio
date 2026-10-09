export const AGENT_CONVERSATION_SNAPSHOT_SCHEMA_VERSION = 2 as const

/**
 * Agent rawText is the ordered concatenation of visible text and thinking deltas.
 * Tool payloads do not contribute to rawText.
 */
export function deriveAgentMessageRawText(content: unknown): string | null {
  if (!Array.isArray(content)) return null
  let rawText = ''
  for (const rawBlock of content) {
    if (!rawBlock || typeof rawBlock !== 'object') return null
    const block = rawBlock as { type?: unknown; text?: unknown; thinking?: unknown }
    if (block.type === 'text') {
      if (typeof block.text !== 'string') return null
      rawText += block.text
    } else if (block.type === 'thinking') {
      if (typeof block.thinking !== 'string') return null
      rawText += block.thinking
    }
  }
  return rawText
}
