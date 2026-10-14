import type { z } from 'zod'
import type {
  CompanyAccountsMonthlySummary,
  CompanyAccountsProject,
} from '../company-accounts/company-accounts-types'
import type {
  companyWorkspaceScopeSchema,
  companyConfigureSchema,
  companyCreateBusinessSchema,
  companyUpdateBusinessSchema,
  companyLinkSchema,
  companyUnlinkSchema,
} from './company-workspace-schema'

export type CompanyWorkspaceScope = z.infer<typeof companyWorkspaceScopeSchema>
export type CompanyConfigureInput = z.infer<typeof companyConfigureSchema>
export type CompanyCreateBusinessInput = z.infer<typeof companyCreateBusinessSchema>
export type CompanyUpdateBusinessInput = z.infer<typeof companyUpdateBusinessSchema>
export type CompanyLinkInput = z.infer<typeof companyLinkSchema>
export type CompanyUnlinkInput = z.infer<typeof companyUnlinkSchema>
export type CompanyWorkspaceErrorCode =
  | 'INVALID_INPUT'
  | 'WORKSPACE_DENIED'
  | 'NOT_ENABLED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'IO_ERROR'
  | 'SERVICE_UNAVAILABLE'
export type CompanyWorkspaceResult<T> =
  | { success: true; data: T }
  | { success: false; error: { code: CompanyWorkspaceErrorCode; message: string } }
export interface CompanyBusiness {
  id: string
  version: number
  name: string
  goal: string
  deliverable: string
  dueDate: string | null
  ledgerProjectId: string | null
  archived: boolean
  createdAt: string
  updatedAt: string
}
export interface CompanyResourceLink {
  id: string
  businessId: string
  kind: CompanyLinkInput['kind']
  target: string
  createdAt: string
  label: string
  availability: 'available' | 'missing' | 'changed'
  issue?: string
}
export interface CompanyConversationSource {
  id: string
  title: string
}
export interface CompanyPublishingSource {
  id: string
  title: string
  status: string
  url?: string
  observedAt?: string
}
export interface CompanyWorkspaceSnapshot {
  workspaceId: string
  enabled: boolean
  name: string
  revision: number
  projects: CompanyBusiness[]
  links: CompanyResourceLink[]
  conversations: CompanyConversationSource[]
  publications: CompanyPublishingSource[]
  sourceIssues: { conversations?: string; publications?: string }
  finance: {
    state: 'ready' | 'not-initialized' | 'unavailable'
    month: string
    currency: string
    projects: CompanyAccountsProject[]
    summary: CompanyAccountsMonthlySummary | null
    issue?: string
  }
}
