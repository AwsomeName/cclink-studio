import type {
  TerminalSubmitCommandInput,
  TerminalSubmitCommandResult,
} from '@shared/ipc/terminal'
import type { TerminalCommandActor, TerminalTabRef } from '@shared/terminal'
import { workspaceRefKey } from '../../../shared/workspace-ref'
import { recordTerminalLifecycleEvent } from './terminal-lifecycle'

export interface TerminalCommandSubmitResult {
  result: TerminalSubmitCommandResult
  retriedAfterRegister: boolean
}

export async function submitTerminalCommand(
  terminal: TerminalTabRef | undefined,
  command: string,
  actor: TerminalCommandActor = 'user',
): Promise<TerminalCommandSubmitResult> {
  const normalizedCommand = command.trim()
  if (!terminal?.sessionId) {
    return rejected('Terminal session 尚未创建')
  }
  if (!normalizedCommand) {
    return rejected('Terminal 命令不能为空')
  }

  const input: TerminalSubmitCommandInput = {
    terminalSessionId: terminal.sessionId,
    command: normalizedCommand,
    actor,
    permissionPolicy: terminal.permissionPolicy,
    workspaceKey: workspaceRefKey(terminal.runtime.workspaceRef),
  }

  const first = await window.deepink.terminal.submitCommand(input)
  if (!isSessionMissing(first)) {
    return { result: first, retriedAfterRegister: false }
  }

  await recordTerminalLifecycleEvent(terminal, 'created', 'Terminal Tab 已重新登记')
  return {
    result: await window.deepink.terminal.submitCommand(input),
    retriedAfterRegister: true,
  }
}

function rejected(error: string): TerminalCommandSubmitResult {
  return {
    result: {
      success: false,
      status: 'rejected',
      error,
    },
    retriedAfterRegister: false,
  }
}

function isSessionMissing(result: TerminalSubmitCommandResult): boolean {
  return (
    !result.success &&
    result.status === 'rejected' &&
    result.error.includes('Terminal session 不存在')
  )
}
