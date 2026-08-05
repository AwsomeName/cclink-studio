import type { WorkspaceRef } from '../workspace-ref'

export type WebPrincipalKind = 'personal' | 'sole-proprietor' | 'company' | 'organization'

export interface WebsiteResource {
  id: string
  name: string
  origin: string
  entryUrl: string
  notes?: string
  createdAt: string
  updatedAt: string
}

export interface WebPrincipal {
  id: string
  kind: WebPrincipalKind
  name: string
  createdAt: string
  updatedAt: string
}

export interface WebAccount {
  id: string
  /** Stable project identity. `null` is reserved for migrated v1 records awaiting user assignment. */
  projectId: string | null
  websiteId: string
  principalId: string
  label: string
  role?: string
  browserProfileId: string
  loginHint?: string
  loginConfirmedAt?: string
  createdAt: string
  updatedAt: string
}

export interface WebResourceSnapshot {
  schemaVersion: 2
  revision: number
  websites: WebsiteResource[]
  principals: WebPrincipal[]
  accounts: WebAccount[]
}

export interface WebResourceProjectSnapshot extends WebResourceSnapshot {
  projectId: string
  unassignedAccountCount: number
}

export interface WebResourceProjectScopeInput {
  workspaceRef: WorkspaceRef
}

export type BeginWebResourceDraftInput = WebResourceProjectScopeInput

export interface BeginWebResourceDraftResult {
  draftId: string
  browserProfileId: string
}

export interface SaveWebResourceDraftInput extends WebResourceProjectScopeInput {
  draftId: string
  tabId: string
  displayName: string
  duplicateResolution?: 'save-another'
}

export interface CancelWebResourceDraftInput extends WebResourceProjectScopeInput {
  draftId: string
  tabId: string
}

export interface CancelWebResourceDraftResult {
  draftId: string
  cleaned: true
}

export interface ResolveWebResourceLaunchInput extends WebResourceProjectScopeInput {
  accountId: string
}

/** Main-process-authoritative descriptor used to open a saved website account. */
export interface WebResourceLaunchDescriptor {
  webResourceRef: {
    projectId: string
    accountId: string
  }
  title: string
  entryUrl: string
  browserProfileId: string
}

export interface CreateWebConnectionInput {
  workspaceRef: WorkspaceRef
  websiteName: string
  entryUrl: string
  websiteNotes?: string
  principalKind: WebPrincipalKind
  principalName: string
  accountLabel: string
  accountRole?: string
  loginHint?: string
}

export interface ConfirmWebConnectionLoginInput extends WebResourceProjectScopeInput {
  accountId: string
}

export type ClaimLegacyWebConnectionsInput = WebResourceProjectScopeInput

export interface WebResourceConnection {
  website: WebsiteResource
  principal: WebPrincipal
  account: WebAccount
}

export interface ImportProjectOpsConfigInput {
  workspacePath: string
  principalKind: WebPrincipalKind
  principalName: string
}

export interface ImportProjectOpsConfigSummary {
  sourceFilePath: string
  totalCount: number
  importedCount: number
  skippedCount: number
}

export interface ClaimLegacyWebConnectionsSummary {
  claimedCount: number
}

export type WebResourceErrorCode =
  | 'INVALID_INPUT'
  | 'DUPLICATE_ACCOUNT'
  | 'RESOURCE_LIMIT_REACHED'
  | 'STORAGE_UNAVAILABLE'
  | 'SERVICE_UNAVAILABLE'
  | 'PROJECT_OPS_CONFIG_NOT_FOUND'
  | 'PROJECT_OPS_CONFIG_INVALID'
  | 'PROJECT_REQUIRED'
  | 'RESOURCE_NOT_FOUND'
  | 'DRAFT_NOT_FOUND'
  | 'DRAFT_MISMATCH'
  | 'INVALID_BROWSER_STATE'
  | 'CLEANUP_FAILED'
  | 'UNKNOWN'

export interface WebResourceOperationError {
  code: WebResourceErrorCode
  message: string
  context?: {
    existingAccountId?: string
  }
}

export type WebResourceOperationResult<T> =
  | { success: true; data: T }
  | { success: false; error: WebResourceOperationError }

export const EMPTY_WEB_RESOURCE_SNAPSHOT: WebResourceSnapshot = {
  schemaVersion: 2,
  revision: 0,
  websites: [],
  principals: [],
  accounts: [],
}
