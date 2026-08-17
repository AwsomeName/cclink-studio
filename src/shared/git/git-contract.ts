import { bindIpcParser, defineIpcCall } from '../ipc/contract'
import type {
  GitCommitInput,
  GitDiffRequest,
  GitDiffResult,
  GitOperationResult,
  GitPushInput,
  GitRepositorySnapshot,
} from './git-types'

export const gitIpc = {
  getSnapshot: defineIpcCall<[workspacePath: string], GitRepositorySnapshot>(
    'git:getRepositorySnapshot',
  ),
  getDiff: defineIpcCall<[input: GitDiffRequest], GitDiffResult>('git:getDiff'),
  commit: defineIpcCall<[input: GitCommitInput], GitOperationResult>('git:commit'),
  push: defineIpcCall<[input: GitPushInput], GitOperationResult>('git:push'),
} as const

export const gitIpcContracts = {
  getSnapshot: bindIpcParser(gitIpc.getSnapshot, (args): [workspacePath: string] => {
    if (args.length !== 1 || typeof args[0] !== 'string') {
      throw new Error('Git 状态请求需要一个工作空间路径')
    }
    const workspacePath = args[0].trim()
    if (!isValidWorkspacePath(workspacePath)) {
      throw new Error('Git 状态工作空间路径无效')
    }
    return [workspacePath]
  }),
  getDiff: bindIpcParser(gitIpc.getDiff, (args): [input: GitDiffRequest] => {
    if (args.length !== 1 || !args[0] || typeof args[0] !== 'object') {
      throw new Error('Git Diff 请求无效')
    }
    const input = args[0] as Partial<GitDiffRequest>
    if (
      typeof input.workspacePath !== 'string' ||
      !isValidWorkspacePath(input.workspacePath) ||
      typeof input.path !== 'string' ||
      !input.path ||
      input.path.length > 4_096 ||
      input.path.includes('\u0000') ||
      !['staged', 'unstaged', 'untracked', 'conflicted'].includes(input.area ?? '')
    ) {
      throw new Error('Git Diff 请求无效')
    }
    return [input as GitDiffRequest]
  }),
  commit: bindIpcParser(gitIpc.commit, (args): [input: GitCommitInput] => {
    if (args.length !== 1 || !args[0] || typeof args[0] !== 'object') {
      throw new Error('Git 提交请求无效')
    }
    const input = args[0] as Partial<GitCommitInput>
    const message = typeof input.message === 'string' ? input.message.trim() : ''
    if (
      typeof input.workspacePath !== 'string' ||
      !isValidWorkspacePath(input.workspacePath) ||
      typeof input.expectedRevision !== 'string' ||
      !/^[a-f0-9]{64}$/.test(input.expectedRevision) ||
      !message ||
      message.length > 1_000 ||
      /\u0000/.test(message) ||
      !Array.isArray(input.pathsToStage) ||
      input.pathsToStage.length > 2_000 ||
      input.pathsToStage.some(
        (path) =>
          typeof path !== 'string' || !path || path.length > 4_096 || path.includes('\u0000'),
      )
    ) {
      throw new Error('Git 提交请求无效')
    }
    return [{ ...input, message, pathsToStage: [...new Set(input.pathsToStage)] } as GitCommitInput]
  }),
  push: bindIpcParser(gitIpc.push, (args): [input: GitPushInput] => {
    if (args.length !== 1 || !args[0] || typeof args[0] !== 'object') {
      throw new Error('Git Push 请求无效')
    }
    const input = args[0] as Partial<GitPushInput>
    if (
      typeof input.workspacePath !== 'string' ||
      !isValidWorkspacePath(input.workspacePath) ||
      typeof input.expectedHeadOid !== 'string' ||
      !/^[a-f0-9]{7,64}$/i.test(input.expectedHeadOid)
    ) {
      throw new Error('Git Push 请求无效')
    }
    return [input as GitPushInput]
  }),
} as const

function isValidWorkspacePath(workspacePath: string): boolean {
  const value = workspacePath.trim()
  return (
    Boolean(value) && value.length <= 32_768 && !/[\u0000\r\n]/.test(value) && isAbsolutePath(value)
  )
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\')
}
