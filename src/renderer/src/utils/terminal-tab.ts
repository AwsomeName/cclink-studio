import type { TerminalTabRef } from '@shared/terminal'
import type { TerminalSessionSnapshot } from '@shared/ipc/terminal'
import type { WorkspaceRef } from '../../../shared/workspace-ref'
import { workspaceRefLabel } from '../../../shared/workspace-ref'

export interface TerminalTabDraft {
  type: 'terminal'
  title: string
  icon: string
  terminal: TerminalTabRef
  terminalRecord?: TerminalSessionSnapshot
  forceNew: true
}

export interface TerminalRecordTabDraft {
  type: 'terminal-record'
  title: string
  icon: string
  terminalRecord: TerminalSessionSnapshot
  forceNew: true
}

export function createTerminalId(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${random}`
}

function getTerminalCwd(workspaceRef: WorkspaceRef): string | undefined {
  switch (workspaceRef.kind) {
    case 'local':
      return workspaceRef.path
    case 'global':
      return undefined
  }
}

function getTerminalRuntime(workspaceRef: WorkspaceRef): TerminalTabRef['runtime'] {
  return {
    location: 'local',
    transport: 'local',
    backend: 'local-shell',
    workspaceRef,
    cwd: getTerminalCwd(workspaceRef),
  }
}

export function getTerminalPermissionPolicy(
  workspaceRef: WorkspaceRef,
): TerminalTabRef['permissionPolicy'] {
  if (workspaceRef.kind === 'global') {
    return {
      mode: 'ask-every-command',
      requireConfirmationFor: ['read', 'write', 'network', 'destructive', 'privileged', 'unknown'],
    }
  }

  return {
    mode: 'ask-risky-command',
    requireConfirmationFor: ['write', 'network', 'destructive', 'privileged', 'unknown'],
  }
}

export function buildTerminalTabDraft(workspaceRef: WorkspaceRef): TerminalTabDraft {
  return {
    type: 'terminal',
    title: `Terminal · ${workspaceRefLabel(workspaceRef)}`,
    icon: '⌨️',
    forceNew: true,
    terminal: {
      runtime: getTerminalRuntime(workspaceRef),
      permissionPolicy: getTerminalPermissionPolicy(workspaceRef),
      status: 'idle',
      closePolicy: 'terminate-process',
      sessionId: createTerminalId('terminal-session'),
      auditLogId: createTerminalId('terminal-audit'),
    },
  }
}

export function buildTerminalTabDraftFromSession(
  session: TerminalSessionSnapshot,
): TerminalTabDraft {
  const workspaceRef = session.runtime.workspaceRef
  return {
    type: 'terminal',
    title: `Terminal · ${workspaceRefLabel(workspaceRef)}`,
    icon: '⌨️',
    forceNew: true,
    terminal: {
      runtime: session.runtime,
      permissionPolicy: session.permissionPolicy ?? getTerminalPermissionPolicy(workspaceRef),
      status: session.status,
      closePolicy: session.closePolicy ?? 'terminate-process',
      sessionId: session.sessionId,
      processId: session.processId,
      auditLogId: `terminal-audit-${session.sessionId}`,
    },
    terminalRecord: session,
  }
}

export function buildTerminalRecordTabDraft(
  session: TerminalSessionSnapshot,
): TerminalRecordTabDraft {
  return {
    type: 'terminal-record',
    title: `Terminal 记录 · ${workspaceRefLabel(session.runtime.workspaceRef)}`,
    icon: '⌨️',
    forceNew: true,
    terminalRecord: session,
  }
}
