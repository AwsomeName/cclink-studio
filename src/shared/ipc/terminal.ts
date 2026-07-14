import type {
  TerminalAuditEvent,
  TerminalAuditEventKind,
  TerminalCommandActor,
  TerminalCommandConfirmationRequest,
  TerminalExecutionEvent,
  TerminalPermissionPolicy,
  TerminalPermissionRisk,
  TerminalRuntimeRef,
  TerminalStatus,
} from '../terminal'

export interface TerminalAuditListFilter {
  terminalSessionId?: string
  workspaceKey?: string | null
  limit?: number
}

export interface TerminalOperationResult {
  success: boolean
  error?: string
}

export type TerminalLifecycleAuditKind = Extract<
  TerminalAuditEventKind,
  'created' | 'closed' | 'terminated'
>

export interface TerminalLifecycleAuditInput {
  terminalSessionId: string
  workspaceKey?: string | null
  kind: TerminalLifecycleAuditKind
  message?: string
  runtime?: TerminalRuntimeRef
}

export interface TerminalSessionSnapshot {
  sessionId: string
  runtime: TerminalRuntimeRef
  status: TerminalStatus
  createdAt: number
  updatedAt: number
  processId?: string | number
  exitCode?: number
  errorMessage?: string
  lastCommand?: string
}

export interface TerminalSubmitCommandInput {
  terminalSessionId: string
  command: string
  actor: TerminalCommandActor
  permissionPolicy: TerminalPermissionPolicy
  workspaceKey?: string | null
}

export interface TerminalSubmitCommandAcceptedResult {
  success: true
  status: 'accepted'
  risk: TerminalPermissionRisk
  execution: 'started' | 'not-started'
  message: string
}

export interface TerminalSubmitCommandRejectedResult {
  success: false
  status: 'denied' | 'rejected'
  risk?: TerminalPermissionRisk
  error: string
}

export type TerminalSubmitCommandResult =
  | TerminalSubmitCommandAcceptedResult
  | TerminalSubmitCommandRejectedResult

export interface TerminalApiContract {
  onRequestCommandConfirmation(
    callback: (request: TerminalCommandConfirmationRequest) => void,
  ): () => void
  onExecutionEvent(callback: (event: TerminalExecutionEvent) => void): () => void
  resolveCommandConfirmation(id: string, approved: boolean): Promise<{ success: boolean }>
  recordLifecycleEvent(input: TerminalLifecycleAuditInput): Promise<TerminalOperationResult>
  submitCommand(input: TerminalSubmitCommandInput): Promise<TerminalSubmitCommandResult>
  listSessions(): Promise<TerminalSessionSnapshot[]>
  listAuditEvents(filter?: TerminalAuditListFilter): Promise<TerminalAuditEvent[]>
  clearAuditSession(terminalSessionId: string): Promise<TerminalOperationResult>
  clearAuditEvents(): Promise<TerminalOperationResult>
}
