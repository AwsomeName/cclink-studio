import { defineIpcCall } from './contract'

export type CredentialStatus = 'ready' | 'degraded' | 'conflict' | 'unavailable' | 'failed'

export type CredentialKind = 'api-key' | 'token' | 'basic' | 'bearer' | 'generic'

export interface CredentialMetadata {
  id: string
  kind: CredentialKind
  configured: boolean
  fieldNames: string[]
  updatedAt: string | null
  consumers: string[]
}

export interface CredentialServiceStatus {
  status: CredentialStatus
  filePath: string
  configuredCount: number
  message?: string
  legacyEncryptedFiles: string[]
}

export interface SetCredentialInput {
  id: string
  kind: CredentialKind
  fields: Record<string, string>
}

export interface CredentialOperationResult {
  success: boolean
  error?: string
  status?: CredentialServiceStatus
}

export interface CredentialMetadataResult extends CredentialOperationResult {
  metadata?: CredentialMetadata[]
}

export interface CredentialFieldResult extends CredentialOperationResult {
  value?: string
}

export interface CredentialsApiContract {
  listMetadata(): Promise<CredentialMetadataResult>
  getStatus(): Promise<CredentialServiceStatus>
  set(input: SetCredentialInput): Promise<CredentialOperationResult>
  revealField(id: string, field: string): Promise<CredentialFieldResult>
  copyField(id: string, field: string): Promise<CredentialOperationResult>
  remove(id: string): Promise<CredentialOperationResult>
  clearAll(): Promise<CredentialOperationResult>
  removeLegacyFiles(): Promise<CredentialOperationResult>
  openDirectory(): Promise<CredentialOperationResult>
  reload(): Promise<CredentialOperationResult>
}

export const credentialsIpc = {
  listMetadata: defineIpcCall<[], CredentialMetadataResult>('credentials:listMetadata'),
  getStatus: defineIpcCall<[], CredentialServiceStatus>('credentials:getStatus'),
  set: defineIpcCall<[SetCredentialInput], CredentialOperationResult>('credentials:set'),
  revealField: defineIpcCall<[string, string], CredentialFieldResult>('credentials:revealField'),
  copyField: defineIpcCall<[string, string], CredentialOperationResult>('credentials:copyField'),
  remove: defineIpcCall<[string], CredentialOperationResult>('credentials:remove'),
  clearAll: defineIpcCall<[], CredentialOperationResult>('credentials:clearAll'),
  removeLegacyFiles: defineIpcCall<[], CredentialOperationResult>('credentials:removeLegacyFiles'),
  openDirectory: defineIpcCall<[], CredentialOperationResult>('credentials:openDirectory'),
  reload: defineIpcCall<[], CredentialOperationResult>('credentials:reload'),
} as const
