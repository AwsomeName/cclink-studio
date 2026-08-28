import type { CclinkServer, CclinkWorkspace } from '../cclink'
import type { CclinkRemoteMessage, CclinkRemoteSession } from '../cclink-runtime'
import type { RemoteWorkspaceRef } from '../workspace-ref'
import type { RemoteFileTreeResult } from '../remote-protocol'
import type { TransientImageAttachment } from '../image-attachment'
import { defineIpcCall } from './contract'

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
