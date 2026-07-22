import type { Command } from '../../../stores/command-store'
import { useToastStore } from '../../../components/common/Toast'
import { copyTextToClipboard } from '../../../utils/clipboard'
import type { MenuContribution } from '../menu-contribution-registry'

export function createSelectionContextCommands(): Command[] {
  return [
    {
      id: 'conversation.copySelection',
      label: '复制',
      contextOnly: true,
      category: '会话',
      enabled: (context) =>
        Boolean(context.target?.kind === 'conversation-selection' && context.target.text.trim()),
      action: async (context) => {
        if (context?.target?.kind !== 'conversation-selection') throw new Error('选区已失效')
        await copyTextToClipboard(context.target.text)
        useToastStore.getState().show('已复制选中文本', 'success')
      },
    },
  ]
}

export const selectionMenuContributions: MenuContribution[] = [
  {
    id: 'conversation-selection.copy',
    targetKinds: ['conversation-selection'],
    group: '40-copy',
    order: 10,
    commandId: 'conversation.copySelection',
    icon: '▣',
  },
]
