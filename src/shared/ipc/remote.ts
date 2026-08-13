import type {
  RemoteFileReadRequest,
  RemoteFileReadResult,
  RemoteFileTreeRequest,
  RemoteFileTreeResult,
  RemoteStatus,
} from '../remote-protocol'
import type { RemoteWorkspaceRef } from '../workspace-ref'
import { defineIpcCall } from './contract'

export interface RemoteApiContract {
  getStatus(ref: RemoteWorkspaceRef): Promise<RemoteStatus>
  listFileTree(request: RemoteFileTreeRequest): Promise<RemoteFileTreeResult>
  readFile(request: RemoteFileReadRequest): Promise<RemoteFileReadResult>
}

export const remoteIpc = {
  getStatus: defineIpcCall<[ref: RemoteWorkspaceRef], RemoteStatus>('remote:getStatus'),
  listFileTree: defineIpcCall<[request: RemoteFileTreeRequest], RemoteFileTreeResult>(
    'remote:listFileTree',
  ),
  readFile: defineIpcCall<[request: RemoteFileReadRequest], RemoteFileReadResult>(
    'remote:readFile',
  ),
} as const
