import type { RemoteWorkspaceTransport, WorkspaceRef } from './workspace-ref'

export interface TerminalExecutionErrorInfo {
  layer: 'execution-backend' | 'permission' | 'workspace' | 'unknown'
  code: string
  message: string
  retryable: boolean
  context?: Record<string, unknown>
}

export type TerminalRuntimeLocation = 'local' | 'remote'

export type TerminalTransport = 'local' | RemoteWorkspaceTransport

export type TerminalBackend = 'local-shell' | 'remote-shell' | 'codex' | 'custom'

export type TerminalStatus = 'idle' | 'starting' | 'running' | 'blocked' | 'exited' | 'error'

export type TerminalPermissionRisk =
  | 'read'
  | 'write'
  | 'network'
  | 'destructive'
  | 'privileged'
  | 'unknown'

export type TerminalPermissionMode =
  | 'read-only'
  | 'ask-every-command'
  | 'ask-risky-command'
  | 'trusted-session'

export type TerminalClosePolicy = 'close-view' | 'terminate-process' | 'keep-running'

export type TerminalCommandActor = 'user' | 'agent' | 'system'

export type TerminalPermissionDecisionAction = 'allow' | 'confirm' | 'deny'

export interface TerminalRuntimeRef {
  location: TerminalRuntimeLocation
  transport: TerminalTransport
  backend: TerminalBackend
  workspaceRef: WorkspaceRef
  cwd?: string
  shell?: string
  endpointId?: string
}

export interface TerminalPermissionPolicy {
  mode: TerminalPermissionMode
  requireConfirmationFor: TerminalPermissionRisk[]
  allowlist?: string[]
  denylist?: string[]
}

export interface TerminalPermissionDecision {
  action: TerminalPermissionDecisionAction
  risk: TerminalPermissionRisk
  reason: string
  matchedRule?: string
}

export interface TerminalCommandConfirmationRequest {
  id: string
  createdAt: number
  expiresAt: number
  terminalSessionId: string
  workspaceKey?: string | null
  command: string
  actor: TerminalCommandActor
  risk: TerminalPermissionRisk
  reason: string
  cwd?: string
  runtime: TerminalRuntimeRef
}

export type TerminalExecutionEvent =
  | {
      kind: 'started'
      sessionId: string
      processId?: string | number
      timestamp: number
    }
  | {
      kind: 'output'
      sessionId: string
      data: string
      stream: 'stdout' | 'stderr'
      timestamp: number
    }
  | {
      kind: 'blocked'
      sessionId: string
      command: string
      reason: string
      actor: TerminalCommandActor
      timestamp: number
    }
  | {
      kind: 'exit'
      sessionId: string
      exitCode?: number
      signal?: string
      timestamp: number
    }
  | {
      kind: 'error'
      sessionId: string
      message: string
      executionError?: TerminalExecutionErrorInfo
      timestamp: number
    }

export interface TerminalTabRef {
  runtime: TerminalRuntimeRef
  permissionPolicy: TerminalPermissionPolicy
  status: TerminalStatus
  closePolicy: TerminalClosePolicy
  sessionId?: string
  processId?: string | number
  auditLogId?: string
}

export type TerminalAuditEventKind =
  | 'created'
  | 'closed'
  | 'terminated'
  | 'command-confirmation-requested'
  | 'command-confirmation-timeout'
  | 'command-submitted'
  | 'command-approved'
  | 'command-denied'
  | 'output'
  | 'exit'
  | 'error'

export interface TerminalAuditEvent {
  id: string
  terminalSessionId: string
  workspaceKey?: string | null
  timestamp: number
  kind: TerminalAuditEventKind
  actor?: TerminalCommandActor
  command?: string
  risk?: TerminalPermissionRisk
  approved?: boolean
  exitCode?: number
  message?: string
  executionError?: TerminalExecutionErrorInfo
}
