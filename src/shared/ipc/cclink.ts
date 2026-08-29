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
  if (value.message !== undefined && !isEventRecord(value.message)) return null
  if (value.sessions !== undefined && !Array.isArray(value.sessions)) return null
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
