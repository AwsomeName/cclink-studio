import { bindIpcParser, ipcArgs } from '../ipc/contract'
import {
  archiveWebAccountGroupInputSchema,
  archiveWebAccountInputSchema,
  createWebAccountGroupInputSchema,
  mergeWebAccountsInputSchema,
  parseCancelWebResourceDraftInput,
  parseConfirmWebConnectionLoginInput,
  parseCreateWebConnectionInput,
  parseImportProjectOpsConfigInput,
  parseResolveWebResourceLaunchInput,
  parseSaveWebResourceDraftInput,
  parseWebResourceProjectScopeInput,
  updateWebAccountGroupInputSchema,
} from './web-resource-schema'
import { webResourcesIpc } from './web-resource'
import type {
  ClaimLegacyWebConnectionsSummary,
  ImportProjectOpsConfigSummary,
  WebResourceOperationResult,
} from './web-resource-types'

const invalidInputResult = async <T>(): Promise<WebResourceOperationResult<T>> => ({
  success: false,
  error: {
    code: 'INVALID_INPUT',
    message: '网站或账号参数无效',
  },
})

export const webResourcesIpcContracts = {
  getSnapshot: bindIpcParser(
    webResourcesIpc.getSnapshot,
    (args) => {
      if (args.length !== 1) {
        throw new Error(`IPC ${webResourcesIpc.getSnapshot.channel} 需要 1 个参数`)
      }
      return ipcArgs(parseWebResourceProjectScopeInput(args[0]))
    },
    invalidInputResult,
  ),
  createConnection: bindIpcParser(
    webResourcesIpc.createConnection,
    (args) => {
      if (args.length !== 1) {
        throw new Error(`IPC ${webResourcesIpc.createConnection.channel} 需要 1 个参数`)
      }
      return ipcArgs(parseCreateWebConnectionInput(args[0]))
    },
    invalidInputResult,
  ),
  beginDraft: bindIpcParser(
    webResourcesIpc.beginDraft,
    (args) => {
      if (args.length !== 1) {
        throw new Error(`IPC ${webResourcesIpc.beginDraft.channel} 需要 1 个参数`)
      }
      return ipcArgs(parseWebResourceProjectScopeInput(args[0]))
    },
    invalidInputResult,
  ),
  saveDraft: bindIpcParser(
    webResourcesIpc.saveDraft,
    (args) => {
      if (args.length !== 1) {
        throw new Error(`IPC ${webResourcesIpc.saveDraft.channel} 需要 1 个参数`)
      }
      return ipcArgs(parseSaveWebResourceDraftInput(args[0]))
    },
    invalidInputResult,
  ),
  cancelDraft: bindIpcParser(
    webResourcesIpc.cancelDraft,
    (args) => {
      if (args.length !== 1) {
        throw new Error(`IPC ${webResourcesIpc.cancelDraft.channel} 需要 1 个参数`)
      }
      return ipcArgs(parseCancelWebResourceDraftInput(args[0]))
    },
    invalidInputResult,
  ),
  resolveLaunch: bindIpcParser(
    webResourcesIpc.resolveLaunch,
    (args) => {
      if (args.length !== 1) {
        throw new Error(`IPC ${webResourcesIpc.resolveLaunch.channel} 需要 1 个参数`)
      }
      return ipcArgs(parseResolveWebResourceLaunchInput(args[0]))
    },
    invalidInputResult,
  ),
  confirmLogin: bindIpcParser(
    webResourcesIpc.confirmLogin,
    (args) => {
      if (args.length !== 1) {
        throw new Error(`IPC ${webResourcesIpc.confirmLogin.channel} 需要 1 个参数`)
      }
      return ipcArgs(parseConfirmWebConnectionLoginInput(args[0]))
    },
    invalidInputResult,
  ),
  claimLegacyConnections: bindIpcParser(
    webResourcesIpc.claimLegacyConnections,
    (args) => {
      if (args.length !== 1) {
        throw new Error(`IPC ${webResourcesIpc.claimLegacyConnections.channel} 需要 1 个参数`)
      }
      return ipcArgs(parseWebResourceProjectScopeInput(args[0]))
    },
    async (): Promise<WebResourceOperationResult<ClaimLegacyWebConnectionsSummary>> =>
      invalidInputResult(),
  ),
  importProjectOpsConfig: bindIpcParser(
    webResourcesIpc.importProjectOpsConfig,
    (args) => {
      if (args.length !== 1) {
        throw new Error(`IPC ${webResourcesIpc.importProjectOpsConfig.channel} 需要 1 个参数`)
      }
      return ipcArgs(parseImportProjectOpsConfigInput(args[0]))
    },
    async (): Promise<WebResourceOperationResult<ImportProjectOpsConfigSummary>> => ({
      success: false,
      error: { code: 'INVALID_INPUT', message: '导入参数无效' },
    }),
  ),
  createAccountGroup: bindIpcParser(
    webResourcesIpc.createAccountGroup,
    (args) => {
      if (args.length !== 1) {
        throw new Error(`IPC ${webResourcesIpc.createAccountGroup.channel} 需要 1 个参数`)
      }
      return ipcArgs(createWebAccountGroupInputSchema.parse(args[0]))
    },
    invalidInputResult,
  ),
  updateAccountGroup: bindIpcParser(
    webResourcesIpc.updateAccountGroup,
    (args) => {
      if (args.length !== 1) {
        throw new Error(`IPC ${webResourcesIpc.updateAccountGroup.channel} 需要 1 个参数`)
      }
      return ipcArgs(updateWebAccountGroupInputSchema.parse(args[0]))
    },
    invalidInputResult,
  ),
  archiveAccountGroup: bindIpcParser(
    webResourcesIpc.archiveAccountGroup,
    (args) => {
      if (args.length !== 1) {
        throw new Error(`IPC ${webResourcesIpc.archiveAccountGroup.channel} 需要 1 个参数`)
      }
      return ipcArgs(archiveWebAccountGroupInputSchema.parse(args[0]))
    },
    invalidInputResult,
  ),
  archiveAccount: bindIpcParser(
    webResourcesIpc.archiveAccount,
    (args) => {
      if (args.length !== 1) {
        throw new Error(`IPC ${webResourcesIpc.archiveAccount.channel} 需要 1 个参数`)
      }
      return ipcArgs(archiveWebAccountInputSchema.parse(args[0]))
    },
    invalidInputResult,
  ),
  mergeAccounts: bindIpcParser(
    webResourcesIpc.mergeAccounts,
    (args) => {
      if (args.length !== 1) {
        throw new Error(`IPC ${webResourcesIpc.mergeAccounts.channel} 需要 1 个参数`)
      }
      return ipcArgs(mergeWebAccountsInputSchema.parse(args[0]))
    },
    invalidInputResult,
  ),
} as const
