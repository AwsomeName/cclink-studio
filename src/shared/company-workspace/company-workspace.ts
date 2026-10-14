import { defineIpcCall } from '../ipc/contract'
import type {
  CompanyWorkspaceResult,
  CompanyWorkspaceSnapshot,
  CompanyWorkspaceScope,
  CompanyConfigureInput,
  CompanyCreateBusinessInput,
  CompanyUpdateBusinessInput,
  CompanyLinkInput,
  CompanyUnlinkInput,
} from './company-workspace-types'
type Result = CompanyWorkspaceResult<CompanyWorkspaceSnapshot>
export const companyWorkspaceIpc = {
  getSnapshot: defineIpcCall<[CompanyWorkspaceScope], Result>('company-workspace:get-snapshot'),
  configure: defineIpcCall<[CompanyConfigureInput], Result>('company-workspace:configure'),
  createBusiness: defineIpcCall<[CompanyCreateBusinessInput], Result>(
    'company-workspace:create-business',
  ),
  updateBusiness: defineIpcCall<[CompanyUpdateBusinessInput], Result>(
    'company-workspace:update-business',
  ),
  linkResource: defineIpcCall<[CompanyLinkInput], Result>('company-workspace:link-resource'),
  unlinkResource: defineIpcCall<[CompanyUnlinkInput], Result>('company-workspace:unlink-resource'),
} as const
export const companyWorkspaceIpcEvents = { changed: 'company-workspace:changed' } as const
export interface CompanyWorkspaceApiContract {
  getSnapshot(input: CompanyWorkspaceScope): Promise<Result>
  configure(input: CompanyConfigureInput): Promise<Result>
  createBusiness(input: CompanyCreateBusinessInput): Promise<Result>
  updateBusiness(input: CompanyUpdateBusinessInput): Promise<Result>
  linkResource(input: CompanyLinkInput): Promise<Result>
  unlinkResource(input: CompanyUnlinkInput): Promise<Result>
  onChanged(callback: (input: { workspaceId: string; revision: number }) => void): () => void
}
