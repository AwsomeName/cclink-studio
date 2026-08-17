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
  diagnose(ref: RemoteWorkspaceRef, sessionId?: string): Promise<RemoteDiagnosticReport>
  listFileTree(request: RemoteFileTreeRequest): Promise<RemoteFileTreeResult>
  readFile(request: RemoteFileReadRequest): Promise<RemoteFileReadResult>
  writeFile(request: RemoteFileWriteRequest): Promise<RemoteFileMutationResult>
  createFile(request: RemoteFileCreateRequest): Promise<RemoteFileMutationResult>
  renameFile(request: RemoteFileRenameRequest): Promise<RemoteFileMutationResult>
  deleteFile(request: RemoteFileDeleteRequest): Promise<RemoteFileMutationResult>
  getDraft(input: { ref: RemoteWorkspaceRef; path: string }): Promise<RemoteFileDraft | null>
  saveDraft(draft: RemoteFileDraft): Promise<void>
  deleteDraft(input: { ref: RemoteWorkspaceRef; path: string }): Promise<void>
  deleteDraftPrefix(input: { ref: RemoteWorkspaceRef; pathPrefix: string }): Promise<void>
  rebaseDraftPrefix(input: {
    ref: RemoteWorkspaceRef
    oldPrefix: string
    newPrefix: string
  }): Promise<void>
}

export interface RemoteFileDraft {
  ref: RemoteWorkspaceRef
  path: string
  content: string
  savedContent: string
  sha256: string
  updatedAt: number
}

export const remoteIpc = {
  getStatus: defineIpcCall<[ref: RemoteWorkspaceRef], RemoteStatus>('remote:getStatus'),
  diagnose: defineIpcCall<
    [ref: RemoteWorkspaceRef, sessionId: string | undefined],
    RemoteDiagnosticReport
  >('remote:diagnose'),
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
  getDraft: defineIpcCall<
    [input: { ref: RemoteWorkspaceRef; path: string }],
    RemoteFileDraft | null
  >('remote:getDraft'),
  saveDraft: defineIpcCall<[draft: RemoteFileDraft], void>('remote:saveDraft'),
  deleteDraft: defineIpcCall<[input: { ref: RemoteWorkspaceRef; path: string }], void>(
    'remote:deleteDraft',
  ),
  deleteDraftPrefix: defineIpcCall<[input: { ref: RemoteWorkspaceRef; pathPrefix: string }], void>(
    'remote:deleteDraftPrefix',
  ),
  rebaseDraftPrefix: defineIpcCall<
    [input: { ref: RemoteWorkspaceRef; oldPrefix: string; newPrefix: string }],
    void
  >('remote:rebaseDraftPrefix'),
} as const
