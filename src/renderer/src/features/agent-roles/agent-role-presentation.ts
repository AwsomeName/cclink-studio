import type { AgentRoleIcon } from '@shared/agent-role'

const ROLE_GLYPHS: Record<AgentRoleIcon, string> = {
  assistant: '✦',
  challenger: '◇',
  'fact-checker': '✓',
  product: '▣',
  architect: '⌘',
  governance: '⚖',
  rights: '◉',
}

export function getAgentRoleGlyph(icon: AgentRoleIcon): string {
  return ROLE_GLYPHS[icon]
}
