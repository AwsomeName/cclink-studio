import { z } from 'zod'
import { bindIpcParser, ipcArgs, type IpcInvokeDefinition } from '../ipc/contract'
import { companyWorkspaceIpc } from './company-workspace'
import {
  companyWorkspaceScopeSchema,
  companyConfigureSchema,
  companyCreateBusinessSchema,
  companyUpdateBusinessSchema,
  companyLinkSchema,
  companyUnlinkSchema,
} from './company-workspace-schema'
import type { CompanyWorkspaceResult, CompanyWorkspaceSnapshot } from './company-workspace-types'
function bind<T>(
  definition: IpcInvokeDefinition<[T], CompanyWorkspaceResult<CompanyWorkspaceSnapshot>>,
  schema: z.ZodType<T>,
) {
  return bindIpcParser(
    definition,
    (args) => {
      if (args.length !== 1) throw new Error('公司请求只接受一个参数')
      return ipcArgs(schema.parse(args[0]))
    },
    (): CompanyWorkspaceResult<CompanyWorkspaceSnapshot> => ({
      success: false,
      error: { code: 'INVALID_INPUT', message: '公司请求参数无效' },
    }),
  )
}
export const companyWorkspaceIpcContracts = {
  getSnapshot: bind(companyWorkspaceIpc.getSnapshot, companyWorkspaceScopeSchema),
  configure: bind(companyWorkspaceIpc.configure, companyConfigureSchema),
  createBusiness: bind(companyWorkspaceIpc.createBusiness, companyCreateBusinessSchema),
  updateBusiness: bind(companyWorkspaceIpc.updateBusiness, companyUpdateBusinessSchema),
  linkResource: bind(companyWorkspaceIpc.linkResource, companyLinkSchema),
  unlinkResource: bind(companyWorkspaceIpc.unlinkResource, companyUnlinkSchema),
} as const
export type { CompanyWorkspaceApiContract } from './company-workspace'
