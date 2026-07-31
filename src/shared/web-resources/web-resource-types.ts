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
  websiteId: string
  principalId: string
  label: string
  role?: string
  browserProfileId: string
  loginHint?: string
  createdAt: string
  updatedAt: string
}

export interface WebResourceSnapshot {
  schemaVersion: 1
  revision: number
  websites: WebsiteResource[]
  principals: WebPrincipal[]
  accounts: WebAccount[]
}

export interface CreateWebConnectionInput {
  websiteName: string
  entryUrl: string
  websiteNotes?: string
  principalKind: WebPrincipalKind
  principalName: string
  accountLabel: string
  accountRole?: string
  browserProfileId: string
  loginHint?: string
}

export interface WebResourceConnection {
  website: WebsiteResource
  principal: WebPrincipal
  account: WebAccount
}

export type WebResourceErrorCode =
  | 'INVALID_INPUT'
  | 'DUPLICATE_ACCOUNT'
  | 'RESOURCE_LIMIT_REACHED'
  | 'STORAGE_UNAVAILABLE'
  | 'SERVICE_UNAVAILABLE'
  | 'UNKNOWN'

export interface WebResourceOperationError {
  code: WebResourceErrorCode
  message: string
}

export type WebResourceOperationResult<T> =
  | { success: true; data: T }
  | { success: false; error: WebResourceOperationError }

export const EMPTY_WEB_RESOURCE_SNAPSHOT: WebResourceSnapshot = {
  schemaVersion: 1,
  revision: 0,
  websites: [],
  principals: [],
  accounts: [],
}
