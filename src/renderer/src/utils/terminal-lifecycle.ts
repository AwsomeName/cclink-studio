import type { TerminalLifecycleAuditKind } from '@shared/ipc/terminal'
import type { TerminalTabRef } from '@shared/terminal'
import { workspaceRefKey } from '../../../shared/workspace-ref'

export async function recordTerminalLifecycleEvent(
  terminal: TerminalTabRef | undefined,
  kind: TerminalLifecycleAuditKind,
  message?: string,
): Promise<void> {
  if (!terminal?.sessionId) return

  try {
    const result = await window.cclinkStudio.terminal.recordLifecycleEvent({
      terminalSessionId: terminal.sessionId,
      workspaceKey: workspaceRefKey(terminal.runtime.workspaceRef),
      kind,
      message,
      runtime: terminal.runtime,
      permissionPolicy: terminal.permissionPolicy,
      closePolicy: terminal.closePolicy,
      codeBlockSource: terminal.codeBlockSource,
    })
    if (!result.success) {
      console.warn('[TerminalLifecycle] 审计记录失败:', result.error)
    }
  } catch (error) {
    console.warn('[TerminalLifecycle] 审计记录异常:', error)
  }
}
