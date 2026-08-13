import type { CclinkServer, CclinkWorkspace } from '../cclink'
import type { CclinkRemoteMessage, CclinkRemoteSession } from '../cclink-runtime'
import type { RemoteWorkspaceRef } from '../workspace-ref'
import type { RemoteFileTreeResult } from '../remote-protocol'
import { defineIpcCall } from './contract'

export interface CclinkRealtimeStatus {
  state: 'idle' | 'connecting' | 'online' | 'offline' | 'error'
  error?: string
}

export interface CclinkApiContract {
  listServers(): Promise<CclinkServer[]>
  connectRealtime(): Promise<CclinkRealtimeStatus>
  getRealtimeStatus(): Promise<CclinkRealtimeStatus>
  browseDirectory(input: { serverId: string; path: string }): Promise<RemoteFileTreeResult>
  openWorkspace(input: { serverId: string; path: string }): Promise<CclinkWorkspace>
  listSessions(ref: RemoteWorkspaceRef): Promise<CclinkRemoteSession[]>
  createSession(input: { ref: RemoteWorkspaceRef; name?: string }): Promise<CclinkRemoteSession>
  setSessionArchived(input: { sessionId: string; archived: boolean }): Promise<CclinkRemoteSession>
  listMessages(sessionId: string): Promise<CclinkRemoteMessage[]>
  sendAgentMessage(input: {
    ref: RemoteWorkspaceRef
    sessionId: string
    content: string
  }): Promise<{ success: boolean; error?: string }>
  onRealtimeStatus(callback: (status: CclinkRealtimeStatus) => void): () => void
  onRealtimeEvent(callback: (event: CclinkRealtimeEvent) => void): () => void
}

export interface CclinkRealtimeEvent {
  type: 'conversation' | 'sessions' | 'server'
  serverId: string
  sessionId?: string
  phase?: 'message' | 'started' | 'streaming' | 'completed' | 'error'
  message?: CclinkRemoteMessage
}

export const cclinkIpc = {
  listServers: defineIpcCall<[], CclinkServer[]>('cclink:listServers'),
  connectRealtime: defineIpcCall<[], CclinkRealtimeStatus>('cclink:connectRealtime'),
  getRealtimeStatus: defineIpcCall<[], CclinkRealtimeStatus>('cclink:getRealtimeStatus'),
  browseDirectory: defineIpcCall<[input: { serverId: string; path: string }], RemoteFileTreeResult>(
    'cclink:browseDirectory',
  ),
  openWorkspace: defineIpcCall<[input: { serverId: string; path: string }], CclinkWorkspace>(
    'cclink:openWorkspace',
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
    [input: { ref: RemoteWorkspaceRef; sessionId: string; content: string }],
    { success: boolean; error?: string }
  >('cclink:sendAgentMessage'),
} as const

export const cclinkIpcEvents = {
  realtimeStatus: 'cclink:realtimeStatus',
  realtimeEvent: 'cclink:realtimeEvent',
} as const
