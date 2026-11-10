import {
  isTerminalFinalStatus,
  terminalCodeBlockSourceKey,
  type TerminalCodeBlockSource,
} from '@shared/terminal'
import { workspaceRefKey } from '@shared/workspace-ref'
import type { TerminalSessionSnapshot } from '@shared/ipc/terminal'
import type { Command } from '../../stores/command-store'
import { useAgentStore } from '../../stores/agent-store'
import { useTerminalStore } from '../../stores/terminal-store'
import { useTabStore } from '../../stores/tab-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useToastStore } from '../../components/common/Toast'
import {
  buildTerminalTabDraft,
  buildTerminalTabDraftFromSession,
  buildTerminalRecordTabDraft,
} from '../../utils/terminal-tab'
import type { CommandContext } from '../context-actions/context-target'
import {
  commandNeedsTerminal,
  findCommandCodeBlock,
  terminalInteractionPrompt,
} from './conversation-command'

let refreshGeneration = 0
export async function refreshTerminalSessions(): Promise<void> {
  const generation = ++refreshGeneration
  const sessions = await window.cclinkStudio.terminal.listSessions()
  if (generation === refreshGeneration) useTerminalStore.getState().mergeSessions(sessions)
}

export function findCodeBlockSession(
  source: TerminalCodeBlockSource,
  sessions = useTerminalStore.getState().sessions,
): TerminalSessionSnapshot | undefined {
  const key = terminalCodeBlockSourceKey(source)
  return sessions.find(
    (session) =>
      session.codeBlockSource && terminalCodeBlockSourceKey(session.codeBlockSource) === key,
  )
}

export function revealConversationTerminal(session: TerminalSessionSnapshot): void {
  if (
    workspaceRefKey(useWorkspaceStore.getState().activeWorkspaceRef) !==
    workspaceRefKey(session.runtime.workspaceRef)
  ) {
    useToastStore
      .getState()
      .show('其他工作空间的 Terminal 需要查看，请切回消息所属工作空间', 'info')
    return
  }
  const tabs = useTabStore.getState()
  const existing = tabs.tabs.find(
    (tab) =>
      tab.terminal?.sessionId === session.sessionId ||
      tab.terminalRecord?.sessionId === session.sessionId,
  )
  if (existing) {
    tabs.activateTab(existing.id)
    return
  }
  const draft =
    isTerminalFinalStatus(session.status) || !session.attachable
      ? buildTerminalRecordTabDraft(session)
      : buildTerminalTabDraftFromSession(session)
  tabs.openTab({ ...draft, workspaceRef: session.runtime.workspaceRef })
}

function resolveCodeBlock(context?: CommandContext) {
  const target = context?.target?.kind === 'message' ? context.target : null
  if (!target?.codeBlock) return null
  const conversation = useAgentStore.getState().conversations[target.conversationId]
  const ref = conversation?.runtime.workspaceRef
  if (
    !conversation ||
    conversation.runtime.location !== 'local' ||
    ref?.kind !== 'local' ||
    conversation.runtimeBinding?.kind === 'acp' ||
    workspaceRefKey(ref) !== target.workspaceKey
  )
    return null
  const message = conversation.messages.find((item) => item.id === target.messageId)
  if (!message || message.role !== 'assistant' || message.isStreaming) return null
  const block = message.content[target.codeBlock.contentIndex]
  if (block?.type !== 'text') return null
  const command = findCommandCodeBlock(block.text, target.codeBlock.line)
  if (!command) return null
  const source: TerminalCodeBlockSource = {
    conversationId: conversation.id,
    messageId: message.id,
    ...target.codeBlock,
  }
  return { source, command, workspaceRef: ref }
}

// 仅用于合并同一用户动作的并发点击；执行事实与跨挂载恢复来自主进程 session。
const pending = new Map<string, Promise<void>>()

async function runCodeBlock(context?: CommandContext): Promise<void> {
  const resolved = resolveCodeBlock(context)
  if (!resolved) throw new Error('代码块未完成或本地 Agent 会话已变化')
  const key = terminalCodeBlockSourceKey(resolved.source)
  const existingPromise = pending.get(key)
  if (existingPromise) return existingPromise
  const task = (async () => {
    await refreshTerminalSessions()
    let session = findCodeBlockSession(resolved.source)
    if (session && session.status !== 'idle') {
      revealConversationTerminal(session)
      return
    }
    if (!session) {
      const draft = buildTerminalTabDraft(resolved.workspaceRef)
      const created = await window.cclinkStudio.terminal.recordLifecycleEvent({
        terminalSessionId: draft.terminal.sessionId!,
        kind: 'created',
        runtime: draft.terminal.runtime,
        permissionPolicy: draft.terminal.permissionPolicy,
        closePolicy: 'keep-running',
        workspaceKey: workspaceRefKey(resolved.workspaceRef),
        codeBlockSource: resolved.source,
        message: '用户从 Agent 消息启动命令',
      })
      await refreshTerminalSessions()
      if (!created.success) throw new Error(created.error ?? 'Terminal 创建失败')
      session = findCodeBlockSession(resolved.source)
    }
    if (!session) throw new Error('Terminal session 未登记，未执行命令')
    const sessionId = session.sessionId
    const result = await window.cclinkStudio.terminal
      .submitCommand({
        terminalSessionId: session.sessionId,
        command: resolved.command,
        actor: 'user',
        workspaceKey: workspaceRefKey(resolved.workspaceRef),
        permissionPolicy: {
          mode: 'ask-risky-command',
          requireConfirmationFor: ['write', 'network', 'destructive', 'privileged', 'unknown'],
        },
      })
      .finally(() => {
        // 超时、窗口重建或服务拒绝同样结束此确认，不能留下永远禁用的按钮。
        const store = useTerminalStore.getState()
        store.pendingConfirmations
          .filter((request) => request.terminalSessionId === sessionId)
          .forEach((request) => store.removePendingConfirmation(request.id))
      })
    await refreshTerminalSessions()
    const latest = findCodeBlockSession(resolved.source) ?? session
    if (!result.success) throw new Error(result.error)
    if (result.execution !== 'started') {
      revealConversationTerminal(latest)
      throw new Error(latest.errorMessage ?? 'Terminal 启动失败，命令未执行')
    }
    if (commandNeedsTerminal(resolved.command)) revealConversationTerminal(latest)
    else useToastStore.getState().show('命令已提交到后台 Terminal，可点击“查看终端”接管', 'success')
  })()
  pending.set(key, task)
  try {
    await task
  } finally {
    pending.delete(key)
  }
}

export function createConversationTerminalCommands(): Command[] {
  return [
    {
      id: 'terminal.runConversationCodeBlock',
      label: '在 Terminal 运行代码块',
      category: 'Terminal',
      contextOnly: true,
      risk: 'external-side-effect',
      enabled: (context) => Boolean(resolveCodeBlock(context)),
      action: runCodeBlock,
    },
  ]
}

export function createConversationTerminalAttentionObserver(): (
  sessionId: string,
  data: string,
) => void {
  const tails = new Map<string, { text: string; prompt: string | null }>()
  return (sessionId, data) => {
    const session = useTerminalStore
      .getState()
      .sessions.find((item) => item.sessionId === sessionId)
    if (!session?.codeBlockSource) return
    const previous = tails.get(sessionId)
    const text = ((previous?.text ?? '') + data).slice(-2048)
    const prompt = terminalInteractionPrompt(text)
    tails.set(sessionId, { text, prompt })
    if (tails.size > 300) tails.delete(tails.keys().next().value!)
    if (prompt && prompt !== previous?.prompt) {
      revealConversationTerminal(session)
      useToastStore.getState().show('Terminal 出现交互提示，请在终端中接管', 'info')
    }
  }
}
