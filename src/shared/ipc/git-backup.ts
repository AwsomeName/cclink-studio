export type GitBackupErrorCode =
  | 'GIT_NOT_FOUND'
  | 'GIT_COMMAND_FAILED'
  | 'INVALID_INPUT'
  | 'INVALID_WORKSPACE'
  | 'ACCOUNT_NOT_CONFIGURED'
  | 'AUTHENTICATION_FAILED'
  | 'ENCRYPTION_UNAVAILABLE'
  | 'REMOTE_CONFLICT'
  | 'SENSITIVE_FILES'
  | 'NETWORK_ERROR'
  | 'BACKUP_IN_PROGRESS'
  | 'UNKNOWN'

export interface GitBackupAccountStatus {
  gitAvailable: boolean
  gitVersion: string | null
  username: string
  tokenConfigured: boolean
  connected: boolean
  connectedLogin?: string
  error?: string
  errorCode?: GitBackupErrorCode
}

export interface GitBackupSaveAccountInput {
  username: string
  token?: string
}

export interface GitBackupTestAccountInput {
  username?: string
  token?: string
}

export interface GitBackupProjectStatus {
  workspacePath: string
  projectId: string | null
  bound: boolean
  remoteUrl: string | null
  repositoryLabel: string | null
  lastBackupAt: string | null
  busy: boolean
  error?: string
}

export interface GitBackupRunInput {
  workspacePath: string
  /** First backup only: a full Git URL or a GitHub repository name. */
  repositoryInput?: string
}

export interface GitBackupRunResult {
  success: boolean
  status: 'backed-up' | 'no-changes' | 'failed'
  message: string
  remoteUrl?: string
  lastBackupAt?: string
  errorCode?: GitBackupErrorCode
  sensitiveFiles?: string[]
}

export interface GitBackupOperationResult {
  success: boolean
  message?: string
  error?: string
  errorCode?: GitBackupErrorCode
  account?: GitBackupAccountStatus
}

export interface GitBackupApiContract {
  getAccountStatus(): Promise<GitBackupAccountStatus>
  saveAccount(input: GitBackupSaveAccountInput): Promise<GitBackupOperationResult>
  clearAccount(): Promise<GitBackupOperationResult>
  testAccount(input?: GitBackupTestAccountInput): Promise<GitBackupOperationResult>
  getProjectStatus(workspacePath: string): Promise<GitBackupProjectStatus>
  backup(input: GitBackupRunInput): Promise<GitBackupRunResult>
}

export const gitBackupIpc = {
  getAccountStatus: defineIpcCall<[], GitBackupAccountStatus>('gitBackup:getAccountStatus'),
  saveAccount: defineIpcCall<[input: GitBackupSaveAccountInput], GitBackupOperationResult>(
    'gitBackup:saveAccount',
  ),
  clearAccount: defineIpcCall<[], GitBackupOperationResult>('gitBackup:clearAccount'),
  testAccount: defineIpcCall<
    [input: GitBackupTestAccountInput | undefined],
    GitBackupOperationResult
  >('gitBackup:testAccount'),
  getProjectStatus: defineIpcCall<[workspacePath: string], GitBackupProjectStatus>(
    'gitBackup:getProjectStatus',
  ),
  backup: defineIpcCall<[input: GitBackupRunInput], GitBackupRunResult>('gitBackup:backup'),
} as const
import { defineIpcCall } from './contract'
