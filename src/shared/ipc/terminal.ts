import type {
  TerminalAuditEvent,
  TerminalAuditEventKind,
  TerminalCommandActor,
  TerminalCommandConfirmationRequest,
  TerminalExecutionEvent,
  TerminalClosePolicy,
  TerminalPermissionPolicy,
  TerminalPermissionRisk,
  TerminalRuntimeRef,
  TerminalStatus,
} from '../terminal'
import { defineIpcCall } from './contract'

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
  permissionPolicy?: TerminalPermissionPolicy
  closePolicy?: TerminalClosePolicy
}

export interface TerminalSessionSnapshot {
  sessionId: string
  runtime: TerminalRuntimeRef
  status: TerminalStatus
  createdAt: number
  updatedAt: number
  processId?: string | number
  exitCode?: number
  signal?: string
  exitedAt?: number
  errorMessage?: string
  lastCommand?: string
  workspaceKey?: string | null
  permissionPolicy?: TerminalPermissionPolicy
  closePolicy?: TerminalClosePolicy
  attachable?: boolean
  outputBuffer?: TerminalSessionOutputLine[]
  commandHistory?: TerminalSessionCommandRecord[]
}

export type TerminalSessionOutputKind = 'stdout' | 'stderr' | 'system' | 'error' | 'input'

export interface TerminalSessionOutputLine {
  id: string
  kind: TerminalSessionOutputKind
  text: string
  timestamp: number
}

export interface TerminalSessionCommandRecord {
  id: string
  command: string
  actor: TerminalCommandActor
  timestamp: number
}

export interface TerminalSubmitCommandInput {
  terminalSessionId: string
  command: string
  actor: TerminalCommandActor
  permissionPolicy: TerminalPermissionPolicy
  workspaceKey?: string | null
}

function isBoundedString(value: unknown, maxLength: number, allowEmpty = false): value is string {
  return (
    typeof value === 'string' &&
    value.length <= maxLength &&
    (allowEmpty || value.length > 0) &&
    !value.includes('\0')
  )
}

function isTerminalRuntimePayload(value: unknown): value is TerminalRuntimeRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const runtime = value as Partial<TerminalRuntimeRef>
  if (runtime.location !== 'local' && runtime.location !== 'remote') return false
  if (runtime.transport !== 'local' && runtime.transport !== 'cclink') return false
  if (!['local-shell', 'remote-shell', 'codex', 'custom'].includes(runtime.backend ?? '')) {
    return false
  }
  if (!runtime.workspaceRef || typeof runtime.workspaceRef !== 'object') return false
  if (runtime.cwd !== undefined && !isBoundedString(runtime.cwd, 32_768)) return false
  if (runtime.shell !== undefined && !isBoundedString(runtime.shell, 4_096)) return false
  if (runtime.endpointId !== undefined && !isBoundedString(runtime.endpointId, 256)) return false
  return true
}

export function parseTerminalConfirmationRequest(
  value: unknown,
): TerminalCommandConfirmationRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const request = value as Partial<TerminalCommandConfirmationRequest>
  if (!isBoundedString(request.id, 256) || !isBoundedString(request.terminalSessionId, 256)) {
    return null
  }
  if (!Number.isFinite(request.createdAt) || !Number.isFinite(request.expiresAt)) return null
  if (!isBoundedString(request.command, 100_000)) return null
  if (!['user', 'agent', 'system'].includes(request.actor ?? '')) return null
  if (
    !['read', 'write', 'network', 'destructive', 'privileged', 'unknown'].includes(
      request.risk ?? '',
    )
  ) {
    return null
  }
  if (!isBoundedString(request.reason, 10_000, true)) return null
  if (request.cwd !== undefined && !isBoundedString(request.cwd, 32_768)) return null
  if (
    request.workspaceKey !== undefined &&
    request.workspaceKey !== null &&
    !isBoundedString(request.workspaceKey, 32_768, true)
  ) {
    return null
  }
  if (!isTerminalRuntimePayload(request.runtime)) return null
  return value as TerminalCommandConfirmationRequest
}

export function parseTerminalExecutionEvent(value: unknown): TerminalExecutionEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const event = value as Partial<TerminalExecutionEvent>
  if (!isBoundedString(event.sessionId, 256) || !Number.isFinite(event.timestamp)) return null

  switch (event.kind) {
    case 'started':
      return event.processId === undefined || ['string', 'number'].includes(typeof event.processId)
        ? (value as TerminalExecutionEvent)
        : null
    case 'output':
      return isBoundedString(event.data, 1_000_000, true) &&
        (event.stream === 'stdout' || event.stream === 'stderr')
        ? (value as TerminalExecutionEvent)
        : null
    case 'blocked':
      return isBoundedString(event.command, 100_000) &&
        isBoundedString(event.reason, 10_000, true) &&
        ['user', 'agent', 'system'].includes(event.actor ?? '')
        ? (value as TerminalExecutionEvent)
        : null
    case 'exit':
      return (event.exitCode === undefined || Number.isInteger(event.exitCode)) &&
        (event.signal === undefined || isBoundedString(event.signal, 256))
        ? (value as TerminalExecutionEvent)
        : null
    case 'error':
      return isBoundedString(event.message, 10_000, true) ? (value as TerminalExecutionEvent) : null
    default:
      return null
  }
}

export interface TerminalPtySize {
  columns: number
  rows: number
}

export interface TerminalPtyStartInput {
  terminalSessionId: string
  runtime: TerminalRuntimeRef
  size?: TerminalPtySize
}

export interface TerminalPtyWriteInput {
  terminalSessionId: string
  data: string
}

export interface TerminalPtyResizeInput {
  terminalSessionId: string
  size: TerminalPtySize
}

export interface TerminalPtyStartResult extends TerminalOperationResult {
  processId?: string | number
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
  startPty(input: TerminalPtyStartInput): Promise<TerminalPtyStartResult>
  writePty(input: TerminalPtyWriteInput): Promise<TerminalOperationResult>
  resizePty(input: TerminalPtyResizeInput): Promise<TerminalOperationResult>
  terminatePty(terminalSessionId: string): Promise<TerminalOperationResult>
  listSessions(): Promise<TerminalSessionSnapshot[]>
  listAuditEvents(filter?: TerminalAuditListFilter): Promise<TerminalAuditEvent[]>
  clearAuditSession(terminalSessionId: string): Promise<TerminalOperationResult>
  clearAuditEvents(): Promise<TerminalOperationResult>
}

export const terminalIpc = {
  resolveCommandConfirmation: defineIpcCall<
    [id: string, approved: boolean],
    TerminalOperationResult
  >('terminal:resolveCommandConfirmation'),
  recordLifecycleEvent: defineIpcCall<
    [input: TerminalLifecycleAuditInput],
    TerminalOperationResult
  >('terminal:recordLifecycleEvent'),
  submitCommand: defineIpcCall<[input: TerminalSubmitCommandInput], TerminalSubmitCommandResult>(
    'terminal:submitCommand',
  ),
  startPty: defineIpcCall<[input: TerminalPtyStartInput], TerminalPtyStartResult>(
    'terminal:startPty',
  ),
  writePty: defineIpcCall<[input: TerminalPtyWriteInput], TerminalOperationResult>(
    'terminal:writePty',
  ),
  resizePty: defineIpcCall<[input: TerminalPtyResizeInput], TerminalOperationResult>(
    'terminal:resizePty',
  ),
  terminatePty: defineIpcCall<[terminalSessionId: string], TerminalOperationResult>(
    'terminal:terminatePty',
  ),
  listSessions: defineIpcCall<[], TerminalSessionSnapshot[]>('terminal:listSessions'),
  listAuditEvents: defineIpcCall<[filter?: TerminalAuditListFilter], TerminalAuditEvent[]>(
    'terminal:listAuditEvents',
  ),
  clearAuditSession: defineIpcCall<[terminalSessionId: string], TerminalOperationResult>(
    'terminal:clearAuditSession',
  ),
  clearAuditEvents: defineIpcCall<[], TerminalOperationResult>('terminal:clearAuditEvents'),
} as const

export const terminalIpcEvents = {
  requestCommandConfirmation: 'terminal:requestCommandConfirmation',
  executionEvent: 'terminal:executionEvent',
} as const

export interface TerminalIpcEventPayloads {
  [terminalIpcEvents.requestCommandConfirmation]: TerminalCommandConfirmationRequest
  [terminalIpcEvents.executionEvent]: TerminalExecutionEvent
}
