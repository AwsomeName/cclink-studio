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
  /** 状态所有者：本地身份或未来云账号。为空表示旧全局状态。 */
  ownerKey: string | null
  /** 统一状态键：本地为路径，远程为 `${transport}://...`，未归档为 null。 */
  workspaceKey: string | null
  /** 兼容旧字段：短期仍等同 workspaceKey，本地场景仍是路径。 */
  workspacePath: string | null
  updatedAt: number
  sections: Record<string, unknown>
}

export interface WorkspaceStateSetSectionResult {
  success: boolean
  snapshot?: WorkspaceStateSnapshot
  error?: string
}

export interface WorkspaceStateApiContract {
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
}
