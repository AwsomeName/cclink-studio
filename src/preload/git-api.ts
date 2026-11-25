import { gitIpc, type GitApiContract } from '../shared/git'
import { invokeIpcContract } from './ipc-contract-client'

export const gitApi: GitApiContract = {
  shareWorkspaceSettings: (path) => invokeIpcContract(gitIpc.shareWorkspaceSettings, path),
  transfer: (input) => invokeIpcContract(gitIpc.transfer, input),
  getSnapshot: (workspacePath) => invokeIpcContract(gitIpc.getSnapshot, workspacePath),
  getDiff: (input) => invokeIpcContract(gitIpc.getDiff, input),
  commit: (input) => invokeIpcContract(gitIpc.commit, input),
  push: (input) => invokeIpcContract(gitIpc.push, input),
  previewProjectSync: (path) => invokeIpcContract(gitIpc.previewProjectSync, path),
}
