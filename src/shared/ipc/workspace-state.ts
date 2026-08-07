import type { WorkspaceConversationSnapshotSummary } from '../workspace-conversation-diagnostics'

/** 工作台状态分区名称。先允许扩展字符串，便于逐步迁移各 renderer store。 */
export type WorkspaceStateSection =
  | 'layout'
  | 'tabs'
  | 'browserTabs'
  | 'editorDrafts'
  | 'fileTree'
  | 'search'
  | 'commandPalette'
  | 'settingsPage'
  | 'agentConversations'
  | string

export interface WorkspaceStateSnapshot {
  version: 1
  workspaceId: string
  /** 状态所有者：本地身份或官方账号。为空表示全局状态。 */
  ownerKey: string | null
  /** 统一状态键：本地为路径，未归档为 null。 */
  workspaceKey: string | null
  /** 本地工作空间路径；当前等同 workspaceKey。 */
  workspacePath: string | null
  updatedAt: number
  sections: Record<string, unknown>
}

export interface WorkspaceStateSetSectionResult {
  success: boolean
  snapshot?: WorkspaceStateSnapshot
  error?: string
}

export interface WorkspaceStateDiagnostics {
  userDataPath: string
  stateFilePath: string
  backupFilePath: string
  workspaceCount: number
  fileVersion: number
  userData: {
    fixedUserDataPath: string
  } | null
  /** 旧版 main process 不提供；新版诊断会跨重启保留会话恢复轨迹。 */
  recoveryTrace?: WorkspaceRecoveryTraceSnapshot
}

export type WorkspaceRecoveryTraceEvent =
  | 'state-index-loaded'
  | 'state-index-recovered'
  | 'state-index-reset'
  | 'snapshot-selected'
  | 'snapshot-missing'
  | 'conversation-write'
  | 'conversation-write-regression'
  | 'conversation-write-failed'
  | 'shutdown-flush'

export interface WorkspaceRecoveryTraceEntry {
  timestamp: string
  appVersion: string
  event: WorkspaceRecoveryTraceEvent
  outcome: string
  workspaceRef: string | null
  ownerRef: string | null
  source: 'central' | 'project-primary' | 'project-backup' | 'fallback' | 'empty' | null
  summary: WorkspaceConversationSnapshotSummary | null
  previousSummary: WorkspaceConversationSnapshotSummary | null
  primaryStatus: 'ok' | 'missing' | 'invalid' | 'unavailable' | null
  backupStatus: 'ok' | 'missing' | 'invalid' | 'unavailable' | null
}

export interface WorkspaceRecoveryTraceSnapshot {
  filePath: string
  /** 用户可直接打开的固定 Markdown 镜像；旧版运行时可能不提供。 */
  documentFilePath?: string
  documentStatus?: 'pending' | 'ok' | 'unavailable'
  retainedEntries: number
  droppedCount: number
  entries: WorkspaceRecoveryTraceEntry[]
}

export interface WorkspaceStateLocalWorkspaceSummary {
  workspaceKey: string
  workspacePath: string
  ownerKey: string | null
  updatedAt: number
  storage?: 'project' | 'fallback'
  projectId?: string | null
}

export interface WorkspaceStateResolveResult {
  valid: boolean
  workspacePath: string | null
  error?: string
}

export interface WorkspaceStateApiContract {
  resolveLocalWorkspace: (workspacePath: string) => Promise<WorkspaceStateResolveResult>
  get: (workspaceKey?: string | null, ownerKey?: string | null) => Promise<WorkspaceStateSnapshot>
  setSection: (
    workspaceKey: string | null | undefined,
    section: WorkspaceStateSection,
    value: unknown,
    ownerKey?: string | null,
  ) => Promise<WorkspaceStateSetSectionResult>
  clear: (
    workspaceKey?: string | null,
    ownerKey?: string | null,
  ) => Promise<{ success: boolean; error?: string }>
  listLocalWorkspaces: (ownerKey?: string | null) => Promise<WorkspaceStateLocalWorkspaceSummary[]>
  diagnostics: () => Promise<WorkspaceStateDiagnostics>
}
