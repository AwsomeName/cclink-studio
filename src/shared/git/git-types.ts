export type GitRepositoryAvailability =
  | 'available'
  | 'not-repository'
  | 'repository-outside-workspace'
  | 'git-unavailable'
  | 'invalid-workspace'
  | 'unavailable'

export type GitSnapshotErrorCode =
  | 'GIT_NOT_FOUND'
  | 'NOT_A_REPOSITORY'
  | 'REPOSITORY_OUTSIDE_WORKSPACE'
  | 'INVALID_WORKSPACE'
  | 'GIT_COMMAND_FAILED'

export type GitChangeArea = 'staged' | 'unstaged' | 'untracked' | 'conflicted'

export interface GitChangeEntry {
  path: string
  originalPath: string | null
  stagedStatus: string | null
  unstagedStatus: string | null
  untracked: boolean
  conflicted: boolean
}

export interface GitDiffRequest {
  workspacePath: string
  path: string
  area: GitChangeArea
}

export interface GitDiffResult {
  workspacePath: string
  path: string
  area: GitChangeArea
  content: string
  truncated: boolean
  binary: boolean
  error?: string
}

export interface GitCommitInput {
  workspacePath: string
  expectedRevision: string
  message: string
  pathsToStage: string[]
}

export interface GitPushInput {
  workspacePath: string
  expectedHeadOid: string
}

export interface GitOperationResult {
  success: boolean
  message: string
  snapshot: GitRepositorySnapshot
  errorCode?: string
}

export interface GitRepositorySnapshot {
  workspacePath: string
  availability: GitRepositoryAvailability
  repositoryRoot: string | null
  repositoryName: string | null
  branch: string | null
  headOid: string | null
  detached: boolean
  unborn: boolean
  upstream: string | null
  ahead: number | null
  behind: number | null
  changeCount: number
  stagedCount: number
  unstagedCount: number
  untrackedCount: number
  conflictedCount: number
  changes: GitChangeEntry[]
  additions: number
  deletions: number
  lineStatsIncomplete: boolean
  refreshedAt: string
  revision: string
  ignoredSharedTaskDefinitions?: Array<{ path: string; rule: string }>
  errorCode?: GitSnapshotErrorCode
  error?: string
}

export interface GitApiContract {
  getSnapshot(workspacePath: string): Promise<GitRepositorySnapshot>
  getDiff(input: GitDiffRequest): Promise<GitDiffResult>
  commit(input: GitCommitInput): Promise<GitOperationResult>
  push(input: GitPushInput): Promise<GitOperationResult>
}
