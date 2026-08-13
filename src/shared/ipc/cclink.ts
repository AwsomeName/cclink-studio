import type { CclinkServer, CclinkWorkspace } from '../cclink'
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
  onRealtimeStatus(callback: (status: CclinkRealtimeStatus) => void): () => void
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
} as const

export const cclinkIpcEvents = { realtimeStatus: 'cclink:realtimeStatus' } as const
