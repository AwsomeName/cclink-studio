import { workspaceRefKey } from '@shared/workspace-ref'
import type { Command } from '../../../stores/command-store'
import { useAgentStore } from '../../../stores/agent-store'
import { useTabStore } from '../../../stores/tab-store'
import { useUIStore } from '../../../stores/ui-store'
import { useToastStore } from '../../../components/common/Toast'
import { focusAgentComposer } from '../../markdown/markdown-navigation'
import { recordTerminalLifecycleEvent } from '../../../utils/terminal-lifecycle'
import { createTerminalId } from '../../../utils/terminal-tab'
import type { CommandContext } from '../context-target'
import { getTerminalContextSurface } from '../terminal-context-surface'
import type { MenuContribution } from '../menu-contribution-registry'

function terminalTarget(context?: CommandContext) {
  return context?.target?.kind === 'terminal' ? context.target : null
}

function resolveTerminal(context?: CommandContext) {
  const target = terminalTarget(context)
  if (!target) throw new Error('Terminal 目标已失效')
  const tabState = useTabStore.getState()
  const tab = tabState.tabs.find((item) => item.id === target.tabId)
  if (
    tabState.activeTabId !== target.tabId ||
    tab?.type !== 'terminal' ||
    tab.terminal?.sessionId !== target.sessionId ||
    workspaceRefKey(tab.terminal.runtime.workspaceRef) !== target.workspaceKey
  ) {
    throw new Error('Terminal session 已切换')
  }
  const surface = getTerminalContextSurface(target.sessionId)
  return { target, tab, surface }
}

async function confirmTerminalAction(title: string, message: string): Promise<boolean> {
  const { response } = await window.cclinkStudio.dialog.showMessageBox({
    type: 'warning',
    title,
    message,
    detail: '该操作会结束当前 Terminal 进程，已产生的输出仍保留在审计记录中。',
    buttons: ['取消', '继续'],
    defaultId: 0,
    cancelId: 0,
  })
  return response === 1
}

async function terminateTerminal(context?: CommandContext): Promise<void> {
  const initial = resolveTerminal(context)
  if (!(await confirmTerminalAction('终止 Terminal', '确认终止当前 Terminal 进程？'))) return
  const { tab } = resolveTerminal(context)
  const result = await window.cclinkStudio.terminal.terminatePty(initial.target.sessionId)
  if (!result.success) throw new Error(result.error ?? 'Terminal 终止失败')
  await recordTerminalLifecycleEvent(tab.terminal, 'terminated', '由上下文菜单终止')
  useTabStore.getState().updateTabTerminal(tab.id, {
    ...tab.terminal!,
    status: 'exited',
    processId: undefined,
  })
}

async function restartTerminal(context?: CommandContext): Promise<void> {
  const initial = resolveTerminal(context)
  if (!(await confirmTerminalAction('重启 Terminal', '确认结束当前进程并启动新 Terminal？'))) return
  const { tab } = resolveTerminal(context)
  const result = await window.cclinkStudio.terminal.terminatePty(initial.target.sessionId)
  if (!result.success) throw new Error(result.error ?? 'Terminal 重启前终止失败')
  await recordTerminalLifecycleEvent(tab.terminal, 'terminated', '由上下文菜单重启')
  const nextTerminal = {
    ...tab.terminal!,
    sessionId: createTerminalId('terminal-session'),
    auditLogId: createTerminalId('terminal-audit'),
    status: 'idle' as const,
    processId: undefined,
  }
  useTabStore.getState().updateTabTerminal(tab.id, nextTerminal)
  await recordTerminalLifecycleEvent(nextTerminal, 'created', '由上下文菜单重启')
}

function mountTerminalSelection(context?: CommandContext): void {
  const { target, surface } = resolveTerminal(context)
  const selectionText = surface?.getSelectionText() ?? ''
  if (!selectionText || selectionText !== target.selectionText) {
    throw new Error('Terminal 选区已变化')
  }
  const agentStore = useAgentStore.getState()
  const conversation = agentStore.conversations[agentStore.activeConversationId]
  const conversationWorkspaceKey = conversation?.runtime.workspaceRef
    ? workspaceRefKey(conversation.runtime.workspaceRef)
    : null
  if (!conversation || conversationWorkspaceKey !== target.workspaceKey) {
    throw new Error('当前 Agent 会话属于其他项目')
  }
  agentStore.addMountedResource(
    {
      id: `terminal-selection:${target.sessionId}:${Date.now()}`,
      kind: 'terminal',
      label: 'Terminal 选区',
      detail: `Terminal ${target.sessionId.slice(0, 24)} 的选中文本`,
      ref: {
        type: 'terminal',
        tabId: target.tabId,
        workspaceKey: target.workspaceKey,
        selectedText: selectionText.slice(0, 8_000),
      },
    },
    agentStore.activeConversationId,
  )
  useUIStore.getState().setAgentPanelMode('right', 'user')
  useToastStore.getState().show('已将 Terminal 选区挂到 Agent，未执行任何命令', 'success')
  requestAnimationFrame(focusAgentComposer)
}

export function createTerminalContextCommands(): Command[] {
  return [
    {
      id: 'terminal.copySelection',
      label: '复制',
      contextOnly: true,
      category: 'Terminal',
      enabled: (context) => Boolean(terminalTarget(context)?.selectionText),
      action: (context) => {
        const { target, surface } = resolveTerminal(context)
        if (!surface || surface.getSelectionText() !== target.selectionText) {
          throw new Error('Terminal 选区已变化')
        }
        return surface.copy()
      },
    },
    {
      id: 'terminal.paste',
      label: '粘贴',
      contextOnly: true,
      category: 'Terminal',
      risk: 'local-write',
      enabled: (context) => {
        const target = terminalTarget(context)
        return Boolean(target && getTerminalContextSurface(target.sessionId))
      },
      action: (context) => {
        const surface = resolveTerminal(context).surface
        if (!surface) throw new Error('Terminal 操作面已销毁')
        return surface.paste()
      },
    },
    {
      id: 'terminal.find',
      label: '查找',
      contextOnly: true,
      category: 'Terminal',
      action: (context) => {
        const surface = resolveTerminal(context).surface
        if (!surface) throw new Error('Terminal 操作面已销毁')
        surface.openFind()
      },
    },
    {
      id: 'terminal.clear',
      label: '清屏',
      contextOnly: true,
      category: 'Terminal',
      risk: 'local-write',
      action: (context) => {
        const surface = resolveTerminal(context).surface
        if (!surface) throw new Error('Terminal 操作面已销毁')
        surface.clear()
      },
    },
    {
      id: 'terminal.sendSelectionToAgent',
      label: '将选区挂到 Agent',
      contextOnly: true,
      category: 'Terminal',
      enabled: (context) => Boolean(terminalTarget(context)?.selectionText),
      action: mountTerminalSelection,
    },
    {
      id: 'terminal.restart',
      label: '重启 Terminal…',
      contextOnly: true,
      category: 'Terminal',
      risk: 'destructive',
      action: restartTerminal,
    },
    {
      id: 'terminal.terminate',
      label: '终止 Terminal…',
      contextOnly: true,
      category: 'Terminal',
      risk: 'destructive',
      enabled: (context) => {
        const status = terminalTarget(context)?.status
        return {
          enabled: Boolean(status && ['starting', 'running', 'blocked'].includes(status)),
          reason: 'Terminal 当前没有运行中的进程',
        }
      },
      action: terminateTerminal,
    },
  ]
}

export const terminalMenuContributions: MenuContribution[] = [
  {
    id: 'terminal.copy',
    targetKinds: ['terminal'],
    group: '20-edit',
    order: 10,
    commandId: 'terminal.copySelection',
  },
  {
    id: 'terminal.paste',
    targetKinds: ['terminal'],
    group: '20-edit',
    order: 20,
    commandId: 'terminal.paste',
  },
  {
    id: 'terminal.find',
    targetKinds: ['terminal'],
    group: '30-view',
    order: 10,
    commandId: 'terminal.find',
  },
  {
    id: 'terminal.clear',
    targetKinds: ['terminal'],
    group: '30-view',
    order: 20,
    commandId: 'terminal.clear',
  },
  {
    id: 'terminal.send-selection',
    targetKinds: ['terminal'],
    group: '40-send',
    order: 10,
    commandId: 'terminal.sendSelectionToAgent',
  },
  {
    id: 'terminal.restart',
    targetKinds: ['terminal'],
    group: '80-manage',
    order: 10,
    commandId: 'terminal.restart',
  },
  {
    id: 'terminal.terminate',
    targetKinds: ['terminal'],
    group: '99-danger',
    order: 10,
    commandId: 'terminal.terminate',
  },
]
