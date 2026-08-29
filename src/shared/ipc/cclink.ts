import type { CclinkServer, CclinkWorkspace } from '../cclink'
import type { CclinkRemoteMessage, CclinkRemoteSession } from '../cclink-runtime'
import type { RemoteWorkspaceRef } from '../workspace-ref'
import type { RemoteFileTreeResult } from '../remote-protocol'
import type { TransientImageAttachment } from '../image-attachment'
import { defineIpcCall } from './contract'
import { isBoundedIpcEventPayload, isBoundedIpcEventString } from './event-payload'

export interface CclinkRealtimeStatus {
  state: 'idle' | 'connecting' | 'online' | 'offline' | 'error'
  error?: string
}

export interface CclinkImageUploadProgress {
  uploadId: string
  imageId?: string
  imageIndex: number
  imageCount: number
  loadedBytes: number
  totalBytes: number
  percent: number
  phase: 'preparing' | 'uploading' | 'sending' | 'completed' | 'cancelled' | 'failed'
  error?: string
}

export interface CclinkApiContract {
  listServers(): Promise<CclinkServer[]>
  connectRealtime(): Promise<CclinkRealtimeStatus>
  getRealtimeStatus(): Promise<CclinkRealtimeStatus>
  browseDirectory(input: { serverId: string; path: string }): Promise<RemoteFileTreeResult>
  openWorkspace(input: {
    serverId: string
    path: string
    requestId: string
  }): Promise<CclinkWorkspace>
  cancelOpenWorkspace(input: { requestId: string }): Promise<{ success: boolean }>
  listSessions(ref: RemoteWorkspaceRef): Promise<CclinkRemoteSession[]>
  createSession(input: { ref: RemoteWorkspaceRef; name?: string }): Promise<CclinkRemoteSession>
  setSessionArchived(input: { sessionId: string; archived: boolean }): Promise<CclinkRemoteSession>
  listMessages(sessionId: string): Promise<CclinkRemoteMessage[]>
  sendAgentMessage(input: {
    ref: RemoteWorkspaceRef
    sessionId: string
    content: string
    images?: TransientImageAttachment[]
    imageUploadId?: string
  }): Promise<{ success: boolean; error?: string }>
  cancelAgentImageUpload(input: { uploadId: string }): Promise<{ success: boolean }>
  stopTrackingAgentRun(input: {
    ref: RemoteWorkspaceRef
    sessionId: string
  }): Promise<{ success: boolean; error?: string }>
  resolveToolApproval(input: {
    ref: RemoteWorkspaceRef
    sessionId: string
    requestId: string
    toolUseId: string
    approved: boolean
  }): Promise<{ success: boolean; error?: string }>
  answerQuestion(input: {
    ref: RemoteWorkspaceRef
    sessionId: string
    requestId: string
    toolUseId: string
    answers: Record<string, string>
  }): Promise<{ success: boolean; error?: string }>
  respondPermission(input: {
    serverId: string
    requestId: string
    approved: boolean
    remember?: boolean
  }): Promise<{ success: boolean; error?: string }>
  onRealtimeStatus(callback: (status: CclinkRealtimeStatus) => void): () => void
  onRealtimeEvent(callback: (event: CclinkRealtimeEvent) => void): () => void
  onImageUploadProgress(callback: (progress: CclinkImageUploadProgress) => void): () => void
}

export interface CclinkRealtimeEvent {
  type: 'conversation' | 'sessions' | 'server' | 'permission'
  serverId: string
  sessionId?: string
  phase?: 'message' | 'started' | 'streaming' | 'completed' | 'error' | 'untracked'
  message?: CclinkRemoteMessage
  sessions?: CclinkRemoteSession[]
  permission?: { requestId: string; path: string; operation: string }
}

const REALTIME_STATES = new Set<CclinkRealtimeStatus['state']>([
  'idle',
  'connecting',
  'online',
  'offline',
  'error',
])
const REALTIME_EVENT_TYPES = new Set<CclinkRealtimeEvent['type']>([
  'conversation',
  'sessions',
  'server',
  'permission',
])
const REALTIME_EVENT_PHASES = new Set<NonNullable<CclinkRealtimeEvent['phase']>>([
  'message',
  'started',
  'streaming',
  'completed',
  'error',
  'untracked',
])
const IMAGE_UPLOAD_PHASES = new Set<CclinkImageUploadProgress['phase']>([
  'preparing',
  'uploading',
  'sending',
  'completed',
  'cancelled',
  'failed',
])
const REMOTE_ERROR_LAYERS = new Set([
  'account',
  'transport',
  'remote-agent',
  'workspace',
  'file-provider',
  'unknown',
])

export function parseCclinkRealtimeStatusEvent(value: unknown): CclinkRealtimeStatus | null {
  if (!isEventRecord(value) || !isBoundedIpcEventPayload(value)) return null
  if (typeof value.state !== 'string' || !REALTIME_STATES.has(value.state as never)) return null
  if (
    value.error !== undefined &&
    !isBoundedIpcEventString(value.error, 32_768, { allowEmpty: true })
  ) {
    return null
  }
  return value as unknown as CclinkRealtimeStatus
}

export function parseCclinkRealtimeEvent(value: unknown): CclinkRealtimeEvent | null {
  if (!isEventRecord(value) || !isBoundedIpcEventPayload(value)) return null
  if (typeof value.type !== 'string' || !REALTIME_EVENT_TYPES.has(value.type as never)) return null
  if (!isBoundedIpcEventString(value.serverId, 512)) return null
  if (value.sessionId !== undefined && !isBoundedIpcEventString(value.sessionId, 512)) return null
  if (
    value.phase !== undefined &&
    (typeof value.phase !== 'string' || !REALTIME_EVENT_PHASES.has(value.phase as never))
  ) {
    return null
  }
  if (value.message !== undefined && !isCclinkRemoteMessage(value.message)) return null
  if (
    value.sessions !== undefined &&
    (!Array.isArray(value.sessions) || !value.sessions.every(isCclinkRemoteSession))
  ) {
    return null
  }
  if (value.permission !== undefined) {
    if (
      !isEventRecord(value.permission) ||
      !isBoundedIpcEventString(value.permission.requestId, 512) ||
      !isBoundedIpcEventString(value.permission.path, 4096) ||
      !isBoundedIpcEventString(value.permission.operation, 256)
    ) {
      return null
    }
  }
  return value as unknown as CclinkRealtimeEvent
}

export function parseCclinkImageUploadProgressEvent(
  value: unknown,
): CclinkImageUploadProgress | null {
  if (!isEventRecord(value) || !isBoundedIpcEventPayload(value)) return null
  if (!isBoundedIpcEventString(value.uploadId, 512)) return null
  if (value.imageId !== undefined && !isBoundedIpcEventString(value.imageId, 512)) return null
  if (!isNonNegativeInteger(value.imageIndex) || !isNonNegativeInteger(value.imageCount))
    return null
  if (!isNonNegativeNumber(value.loadedBytes) || !isNonNegativeNumber(value.totalBytes)) return null
  if (typeof value.percent !== 'number' || !Number.isFinite(value.percent)) return null
  if (value.percent < 0 || value.percent > 100) return null
  if (typeof value.phase !== 'string' || !IMAGE_UPLOAD_PHASES.has(value.phase as never)) return null
  if (
    value.error !== undefined &&
    !isBoundedIpcEventString(value.error, 32_768, { allowEmpty: true })
  ) {
    return null
  }
  return value as unknown as CclinkImageUploadProgress
}

function isEventRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isCclinkRemoteSession(value: unknown): value is CclinkRemoteSession {
  if (!isEventRecord(value)) return false
  return (
    isBoundedIpcEventString(value.id, 512) &&
    isBoundedIpcEventString(value.name, 1024, { allowEmpty: true }) &&
    isBoundedIpcEventString(value.workspaceId, 512) &&
    isBoundedIpcEventString(value.workspacePath, 4096) &&
    isBoundedIpcEventString(value.serverId, 512) &&
    (value.status === 'active' || value.status === 'idle' || value.status === 'archived') &&
    isNonNegativeNumber(value.createdAt) &&
    isNonNegativeNumber(value.updatedAt) &&
    isNonNegativeInteger(value.messageCount) &&
    isNonNegativeNumber(value.contextUsage)
  )
}

function isCclinkRemoteMessage(value: unknown): value is CclinkRemoteMessage {
  if (
    !isEventRecord(value) ||
    !isBoundedIpcEventString(value.id, 512) ||
    !isNonNegativeNumber(value.timestamp)
  ) {
    return false
  }
  if (value.type === 'user' || value.type === 'agentText' || value.type === 'system') {
    if (!isBoundedIpcEventString(value.content, 1_000_000, { allowEmpty: true })) return false
    return (
      value.type !== 'system' ||
      value.remoteError === undefined ||
      isCclinkRemoteError(value.remoteError)
    )
  }
  if (value.type === 'agentTool') return isCclinkRemoteTool(value.tool)
  if (value.type === 'userQuestion') {
    return (
      isBoundedIpcEventString(value.requestId, 512) &&
      isBoundedIpcEventString(value.toolUseId, 512) &&
      Array.isArray(value.questions) &&
      value.questions.length <= 100 &&
      value.questions.every(isCclinkRemoteQuestion) &&
      (value.answered === undefined || typeof value.answered === 'boolean')
    )
  }
  return false
}

function isCclinkRemoteError(value: unknown): boolean {
  if (
    !isEventRecord(value) ||
    typeof value.layer !== 'string' ||
    !REMOTE_ERROR_LAYERS.has(value.layer) ||
    !isBoundedIpcEventString(value.code, 512) ||
    !isBoundedIpcEventString(value.message, 32_768, { allowEmpty: true }) ||
    typeof value.retryable !== 'boolean'
  ) {
    return false
  }
  if (value.context === undefined) return true
  return (
    isEventRecord(value.context) &&
    Object.values(value.context).every(
      (entry) =>
        entry === null ||
        typeof entry === 'string' ||
        typeof entry === 'boolean' ||
        (typeof entry === 'number' && Number.isFinite(entry)),
    )
  )
}

function isCclinkRemoteTool(value: unknown): boolean {
  if (!isEventRecord(value)) return false
  if (
    !isBoundedIpcEventString(value.id, 512) ||
    !isBoundedIpcEventString(value.name, 512) ||
    (value.state !== 'pending' &&
      value.state !== 'executing' &&
      value.state !== 'completed' &&
      value.state !== 'failed' &&
      value.state !== 'denied')
  ) {
    return false
  }
  if (value.input !== undefined && !isEventRecord(value.input)) return false
  if (!isOptionalEventString(value.output, 1_000_000)) return false
  if (!isOptionalEventString(value.error, 32_768)) return false
  if (!isOptionalEventString(value.approvalReason, 32_768)) return false
  if (value.requiresApproval !== undefined && typeof value.requiresApproval !== 'boolean')
    return false
  if (value.expiresAt !== undefined && !isNonNegativeNumber(value.expiresAt)) return false
  return isOptionalEventString(value.requestId, 512)
}

function isCclinkRemoteQuestion(value: unknown): boolean {
  if (!isEventRecord(value)) return false
  if (
    !isBoundedIpcEventString(value.id, 512) ||
    !isBoundedIpcEventString(value.question, 32_768) ||
    !isOptionalEventString(value.header, 1024) ||
    (value.multiSelect !== undefined && typeof value.multiSelect !== 'boolean')
  ) {
    return false
  }
  return (
    value.options === undefined ||
    (Array.isArray(value.options) &&
      value.options.length <= 100 &&
      value.options.every(
        (option) =>
          isEventRecord(option) &&
          isBoundedIpcEventString(option.label, 4096) &&
          isOptionalEventString(option.description, 32_768),
      ))
  )
}

function isOptionalEventString(value: unknown, maxLength: number): boolean {
  return value === undefined || isBoundedIpcEventString(value, maxLength, { allowEmpty: true })
}

export const cclinkIpc = {
  listServers: defineIpcCall<[], CclinkServer[]>('cclink:listServers'),
  connectRealtime: defineIpcCall<[], CclinkRealtimeStatus>('cclink:connectRealtime'),
  getRealtimeStatus: defineIpcCall<[], CclinkRealtimeStatus>('cclink:getRealtimeStatus'),
  browseDirectory: defineIpcCall<[input: { serverId: string; path: string }], RemoteFileTreeResult>(
    'cclink:browseDirectory',
  ),
  openWorkspace: defineIpcCall<
    [input: { serverId: string; path: string; requestId: string }],
    CclinkWorkspace
  >('cclink:openWorkspace'),
  cancelOpenWorkspace: defineIpcCall<[input: { requestId: string }], { success: boolean }>(
    'cclink:cancelOpenWorkspace',
  ),
  listSessions: defineIpcCall<[ref: RemoteWorkspaceRef], CclinkRemoteSession[]>(
    'cclink:listSessions',
  ),
  createSession: defineIpcCall<
    [input: { ref: RemoteWorkspaceRef; name?: string }],
    CclinkRemoteSession
  >('cclink:createSession'),
  setSessionArchived: defineIpcCall<
    [input: { sessionId: string; archived: boolean }],
    CclinkRemoteSession
  >('cclink:setSessionArchived'),
  listMessages: defineIpcCall<[sessionId: string], CclinkRemoteMessage[]>('cclink:listMessages'),
  sendAgentMessage: defineIpcCall<
    [
      input: {
        ref: RemoteWorkspaceRef
        sessionId: string
        content: string
        images?: TransientImageAttachment[]
        imageUploadId?: string
      },
    ],
    { success: boolean; error?: string }
  >('cclink:sendAgentMessage'),
  cancelAgentImageUpload: defineIpcCall<[input: { uploadId: string }], { success: boolean }>(
    'cclink:cancelAgentImageUpload',
  ),
  stopTrackingAgentRun: defineIpcCall<
    [input: { ref: RemoteWorkspaceRef; sessionId: string }],
    { success: boolean; error?: string }
  >('cclink:stopTrackingAgentRun'),
  resolveToolApproval: defineIpcCall<
    [
      input: {
        ref: RemoteWorkspaceRef
        sessionId: string
        requestId: string
        toolUseId: string
        approved: boolean
      },
    ],
    { success: boolean; error?: string }
  >('cclink:resolveToolApproval'),
  answerQuestion: defineIpcCall<
    [
      input: {
        ref: RemoteWorkspaceRef
        sessionId: string
        requestId: string
        toolUseId: string
        answers: Record<string, string>
      },
    ],
    { success: boolean; error?: string }
  >('cclink:answerQuestion'),
  respondPermission: defineIpcCall<
    [
      input: {
        serverId: string
        requestId: string
        approved: boolean
        remember?: boolean
      },
    ],
    { success: boolean; error?: string }
  >('cclink:respondPermission'),
} as const

export const cclinkIpcEvents = {
  realtimeStatus: 'cclink:realtimeStatus',
  realtimeEvent: 'cclink:realtimeEvent',
  imageUploadProgress: 'cclink:imageUploadProgress',
} as const
