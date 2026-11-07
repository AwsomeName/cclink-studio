import { useRef, useState } from 'react'
import { terminalCodeBlockSourceKey, type TerminalCodeBlockSource } from '@shared/terminal'
import { useCommandStore } from '../../stores/command-store'
import { useTerminalStore } from '../../stores/terminal-store'
import { useToastStore } from '../../components/common/Toast'
import { findCodeBlockSession } from './conversation-terminal-command'

export interface ConversationCodeCommandContext {
  conversationId: string
  messageId: string
  contentIndex: number
  workspaceKey: string
  isStreaming: boolean
}

export function ConversationCodeRunButton({
  context,
  line,
}: {
  context: ConversationCodeCommandContext
  line: number
}): React.ReactElement {
  const [pending, setPending] = useState(false)
  const pendingRef = useRef(false)
  const source: TerminalCodeBlockSource = {
    conversationId: context.conversationId,
    messageId: context.messageId,
    contentIndex: context.contentIndex,
    line,
  }
  const key = terminalCodeBlockSourceKey(source)
  const session = useTerminalStore((state) => findCodeBlockSession(source, state.sessions))
  const waiting = useTerminalStore((state) =>
    state.pendingConfirmations.some((request) => request.terminalSessionId === session?.sessionId),
  )
  const label = waiting
    ? '等待确认'
    : pending
      ? '启动中…'
      : session && session.status !== 'idle'
        ? '查看终端'
        : '运行'
  const run = async (): Promise<void> => {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    try {
      const result = await useCommandStore
        .getState()
        .executeCommand('terminal.runConversationCodeBlock', {
          source: 'toolbar',
          target: {
            kind: 'message',
            workspaceKey: context.workspaceKey,
            conversationId: source.conversationId,
            messageId: source.messageId,
            codeBlock: { contentIndex: source.contentIndex, line },
          },
        })
      if (!result.ok) useToastStore.getState().show(result.message ?? '命令未启动', 'error')
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }
  return (
    <button
      type="button"
      className="conversation-markdown-code-run"
      data-code-command={key}
      disabled={context.isStreaming || pending || waiting}
      title={
        context.isStreaming ? '消息生成完成后可运行' : `${label} · 本机 · ${context.workspaceKey}`
      }
      aria-label={`${label}代码块`}
      onClick={() => void run()}
    >
      <span aria-hidden="true">▷</span>
      <span>{label}</span>
    </button>
  )
}
