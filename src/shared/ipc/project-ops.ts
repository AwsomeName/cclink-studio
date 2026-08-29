export interface ProjectOpsPlatform {
  id: string
  name: string
  url: string
  account?: string
  notes?: string
  browserProfile?: string
}

export interface ProjectOpsAccountsConfig {
  version: 1
  platforms: ProjectOpsPlatform[]
}

export interface ProjectOpsValidationIssue {
  path: string
  message: string
}

export interface ProjectOpsAccountsResult {
  exists: boolean
  filePath: string
  config?: ProjectOpsAccountsConfig
  issues: ProjectOpsValidationIssue[]
  error?: string
}

export interface ProjectOpsCreateDraftInput {
  platformId?: string
  title?: string
  fileName?: string
}

export interface ProjectOpsCreateDraftResult {
  filePath: string
  created: boolean
}

export interface ProjectOpsPublicationRecordInput {
  platformId: string
  platformName?: string
  account?: string
  contentFile?: string
  url?: string
  status: 'published' | 'pending-review' | 'failed' | 'cancelled' | 'draft'
  notes?: string
}

export interface ProjectOpsPublicationRecordResult {
  filePath: string
}

export interface ProjectOpsApiContract {
  getAccounts: (workspacePath: string) => Promise<ProjectOpsAccountsResult>
  createAccountsTemplate: (workspacePath: string) => Promise<ProjectOpsAccountsResult>
  createCopyDraft: (
    workspacePath: string,
    input?: ProjectOpsCreateDraftInput,
  ) => Promise<ProjectOpsCreateDraftResult>
  appendPublicationRecord: (
    workspacePath: string,
    input: ProjectOpsPublicationRecordInput,
  ) => Promise<ProjectOpsPublicationRecordResult>
}

export const projectOpsIpc = {
  getAccounts: defineIpcCall<[workspacePath: string], ProjectOpsAccountsResult>(
    'projectOps:getAccounts',
  ),
  createAccountsTemplate: defineIpcCall<[workspacePath: string], ProjectOpsAccountsResult>(
    'projectOps:createAccountsTemplate',
  ),
  createCopyDraft: defineIpcCall<
    [workspacePath: string, input: ProjectOpsCreateDraftInput | undefined],
    ProjectOpsCreateDraftResult
  >('projectOps:createCopyDraft'),
  appendPublicationRecord: defineIpcCall<
    [workspacePath: string, input: ProjectOpsPublicationRecordInput],
    ProjectOpsPublicationRecordResult
  >('projectOps:appendPublicationRecord'),
} as const
import { defineIpcCall } from './contract'
