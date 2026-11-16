import { workspaceRefKey } from '@shared/workspace-ref'
import type { TtsStartInput } from '@shared/local-tts'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useTabStore } from '../../stores/tab-store'
import { useEditorStore } from '../../stores/editor-store'
import { useAgentStore } from '../../stores/agent-store'
import { useCommandStore, type Command } from '../../stores/command-store'
import { useToastStore } from '../../components/common/Toast'
import type { CommandContext } from '../context-actions/context-target'
import type { MenuContribution } from '../context-actions/menu-contribution-registry'
import { getEditorContextSurface } from '../context-actions/editor-context-surface'
import { startTts, useTtsStore } from './tts-controller'

function resolveInput(context: CommandContext | undefined, selection: boolean): TtsStartInput {
  const workspaceKey = workspaceRefKey(useWorkspaceStore.getState().activeWorkspaceRef)
  const target = context?.target
  if (target?.kind === 'message') {
    if (target.workspaceKey !== workspaceKey) throw new Error('消息所在工作空间已切换')
    // The shared message component already owns the displayed, completed text.
    // Remote and unbound messages must not depend on the local conversation store.
    if (context?.source === 'toolbar' && context.inputValue !== undefined) {
      return {
        source: {
          kind: 'message',
          workspaceKey,
          conversationId: target.conversationId,
          messageId: target.messageId,
          title: `对话 · ${context.inputValue.replace(/\s+/gu, ' ').trim().slice(0, 48)}`,
          selection: false,
        },
        text: context.inputValue,
      }
    }
    const conversation = useAgentStore.getState().conversations[target.conversationId]
    if (
      !conversation ||
      (conversation.runtime.workspaceRef
        ? workspaceRefKey(conversation.runtime.workspaceRef)
        : null) !== workspaceKey
    )
      throw new Error('消息所在工作空间已切换')
    const message = conversation.messages.find((m) => m.id === target.messageId)
    if (!message || message.isStreaming) throw new Error('请等待回复完成后朗读')
    const text = message.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('\n\n')
    return {
      source: {
        kind: 'message',
        workspaceKey,
        conversationId: conversation.id,
        messageId: message.id,
        title:
          `${message.role === 'assistant' ? '助手' : '用户'} · ${conversation.title || '对话'}`.slice(
            0,
            256,
          ),
        selection: false,
      },
      text,
    }
  }
  if (target?.kind === 'conversation-selection') {
    return {
      source: { kind: 'message', workspaceKey, title: '对话选区', selection: true },
      text: target.text,
    }
  }
  const tabs = useTabStore.getState()
  const tabId = target && 'tabId' in target ? target.tabId : tabs.activeTabId
  const tab = tabs.tabs.find((item) => item.id === tabId)
  if (!tab || tab.id !== tabs.activeTabId) throw new Error('内容标签已切换')
  if (tab.type === 'browser')
    return {
      source: {
        kind: 'browser',
        workspaceKey,
        tabId: tab.id,
        title: tab.title.slice(0, 256) || '网页',
        selection,
      },
    }
  if (tab.type !== 'editor') throw new Error('请打开 Markdown 文档或网页后朗读')
  const surface = getEditorContextSurface(tab.id)
  const text = selection
    ? surface?.getSelectionText()
    : useEditorStore.getState().files[tab.filePath ?? `virtual:${tab.id}`]?.currentContent
  if (!text?.trim()) throw new Error(selection ? '请先选中文字' : '文档尚未加载或没有可朗读正文')
  if (
    selection &&
    target &&
    (target.kind === 'editor' || target.kind === 'markdown-selection') &&
    target.range?.selectedText &&
    target.range.selectedText !== text
  )
    throw new Error('选区已变化，请重新选择')
  return {
    source: {
      kind: 'markdown',
      workspaceKey,
      tabId: tab.id,
      title: tab.title.slice(0, 256) || '未命名文档',
      selection,
    },
    text,
  }
}

export function createTtsCommands(): Command[] {
  return [
    {
      id: 'tts.read',
      label: '朗读当前内容',
      category: '本地朗读',
      action: (context) => startTts(resolveInput(context, false)),
    },
    {
      id: 'tts.readSelection',
      label: '朗读选中内容',
      category: '本地朗读',
      action: (context) => startTts(resolveInput(context, true)),
    },
    {
      id: 'tts.settings',
      label: '语音与朗读设置',
      category: '本地朗读',
      action: () => useTtsStore.setState({ open: true }),
    },
  ]
}
export const ttsMenuContributions: MenuContribution[] = [
  {
    id: 'tts.editor-selection',
    targetKinds: ['editor', 'markdown-selection'],
    group: '40-send',
    order: 20,
    commandId: 'tts.readSelection',
    when: (c) => !!(c.target && 'range' in c.target && c.target.range?.selectedText),
  },
  {
    id: 'tts.message',
    targetKinds: ['message'],
    group: '40-copy',
    order: 30,
    commandId: 'tts.read',
    when: (context) => {
      if (context.target?.kind !== 'message') return false
      const target = context.target
      return !!useAgentStore
        .getState()
        .conversations[
          target.conversationId
        ]?.messages.some((message) => message.id === target.messageId && !message.isStreaming)
    },
  },
  {
    id: 'tts.message-selection',
    targetKinds: ['conversation-selection'],
    group: '40-copy',
    order: 30,
    commandId: 'tts.readSelection',
  },
]

export async function executeTtsCommand(
  id: string,
  context: CommandContext = { source: 'toolbar' },
): Promise<void> {
  const result = await useCommandStore.getState().executeCommand(id, context)
  if (!result.ok) useToastStore.getState().show(result.message || '朗读操作失败', 'error')
}
