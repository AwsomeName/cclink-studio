import type {
  RemoteFileReadRequest,
  RemoteFileReadResult,
  RemoteFileWriteRequest,
  RemoteFileCreateRequest,
  RemoteFileRenameRequest,
  RemoteFileDeleteRequest,
  RemoteFileMutationResult,
  RemoteFileTreeRequest,
  RemoteFileTreeResult,
  RemoteStatus,
  RemoteDiagnosticReport,
} from '../remote-protocol'
import type { RemoteWorkspaceRef } from '../workspace-ref'
import { defineIpcCall } from './contract'

export interface RemoteApiContract {
  getStatus(ref: RemoteWorkspaceRef): Promise<RemoteStatus>
  diagnose(ref: RemoteWorkspaceRef): Promise<RemoteDiagnosticReport>
  listFileTree(request: RemoteFileTreeRequest): Promise<RemoteFileTreeResult>
  readFile(request: RemoteFileReadRequest): Promise<RemoteFileReadResult>
  writeFile(request: RemoteFileWriteRequest): Promise<RemoteFileMutationResult>
  createFile(request: RemoteFileCreateRequest): Promise<RemoteFileMutationResult>
  renameFile(request: RemoteFileRenameRequest): Promise<RemoteFileMutationResult>
  deleteFile(request: RemoteFileDeleteRequest): Promise<RemoteFileMutationResult>
}

export const remoteIpc = {
  getStatus: defineIpcCall<[ref: RemoteWorkspaceRef], RemoteStatus>('remote:getStatus'),
  diagnose: defineIpcCall<[ref: RemoteWorkspaceRef], RemoteDiagnosticReport>('remote:diagnose'),
  listFileTree: defineIpcCall<[request: RemoteFileTreeRequest], RemoteFileTreeResult>(
    'remote:listFileTree',
  ),
  readFile: defineIpcCall<[request: RemoteFileReadRequest], RemoteFileReadResult>(
    'remote:readFile',
  ),
  writeFile: defineIpcCall<[request: RemoteFileWriteRequest], RemoteFileMutationResult>(
    'remote:writeFile',
  ),
  createFile: defineIpcCall<[request: RemoteFileCreateRequest], RemoteFileMutationResult>(
    'remote:createFile',
  ),
  renameFile: defineIpcCall<[request: RemoteFileRenameRequest], RemoteFileMutationResult>(
    'remote:renameFile',
  ),
  deleteFile: defineIpcCall<[request: RemoteFileDeleteRequest], RemoteFileMutationResult>(
    'remote:deleteFile',
  ),
} as const
