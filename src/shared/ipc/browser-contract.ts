import type { IpcInvokeDefinition } from './contract'
import { bindIpcParser, ipcArgs } from './contract'
import { browserDownloadIpc, browserIpc, browserTaskIpc } from './browser'
import {
  browserCreateViewOptionsSchema,
  browserHistoryLimitSchema,
  browserIdentifierSchema,
  browserOptionalIdentifierSchema,
  browserReconcileViewsSchema,
  browserSessionDiagnosticRequestSchema,
  browserTaskGoalSchema,
  browserUrlSchema,
  browserViewModeSchema,
  browserWorkspaceKeySchema,
  browserZoomFactorSchema,
} from './browser-schema'

function requireArgs(args: unknown[], count: number, channel: string): void {
  if (args.length !== count) throw new Error(`IPC ${channel} 需要 ${count} 个参数`)
}

function bindBrowserParser<Args extends unknown[], Result>(
  definition: IpcInvokeDefinition<Args, Result>,
  parseArgs: (args: unknown[]) => NoInfer<Args>,
) {
  return bindIpcParser(definition, parseArgs, (error) => Promise.reject(error))
}

function bindNoArgs<Result>(definition: IpcInvokeDefinition<[], Result>) {
  return bindBrowserParser(definition, (args) => {
    requireArgs(args, 0, definition.channel)
    return ipcArgs()
  })
}

function bindIdentifier<Result>(definition: IpcInvokeDefinition<[string], Result>) {
  return bindBrowserParser(definition, (args) => {
    requireArgs(args, 1, definition.channel)
    return ipcArgs(browserIdentifierSchema.parse(args[0]))
  })
}

function bindOptionalIdentifier<Result>(definition: IpcInvokeDefinition<[string | null], Result>) {
  return bindBrowserParser(definition, (args) => {
    requireArgs(args, 1, definition.channel)
    return ipcArgs(browserOptionalIdentifierSchema.parse(args[0]))
  })
}

export const browserIpcContracts = {
  createView: bindBrowserParser(browserIpc.createView, (args) => {
    if (args.length < 1 || args.length > 3) {
      throw new Error(`IPC ${browserIpc.createView.channel} 需要 1 至 3 个参数`)
    }
    return ipcArgs(
      browserIdentifierSchema.parse(args[0]),
      args[1] === undefined ? undefined : browserUrlSchema.parse(args[1]),
      args[2] === undefined ? undefined : browserCreateViewOptionsSchema.parse(args[2]),
    )
  }),
  destroyView: bindIdentifier(browserIpc.destroyView),
  setActive: bindOptionalIdentifier(browserIpc.setActive),
  reconcileViews: bindBrowserParser(browserIpc.reconcileViews, (args) => {
    requireArgs(args, 1, browserIpc.reconcileViews.channel)
    return ipcArgs(browserReconcileViewsSchema.parse(args[0]))
  }),
  navigate: bindBrowserParser(browserIpc.navigate, (args) => {
    requireArgs(args, 2, browserIpc.navigate.channel)
    return ipcArgs(browserIdentifierSchema.parse(args[0]), browserUrlSchema.parse(args[1]))
  }),
  goBack: bindIdentifier(browserIpc.goBack),
  goForward: bindIdentifier(browserIpc.goForward),
  reload: bindIdentifier(browserIpc.reload),
  capturePage: bindIdentifier(browserIpc.capturePage),
  getCurrentURL: bindIdentifier(browserIpc.getCurrentURL),
  getActiveViewId: bindBrowserParser(browserIpc.getActiveViewId, (args) => {
    if (args.length > 1)
      throw new Error(`IPC ${browserIpc.getActiveViewId.channel} 最多接受 1 个参数`)
    return ipcArgs(args[0] === undefined ? undefined : browserWorkspaceKeySchema.parse(args[0]))
  }),
  getDiagnostics: bindIdentifier(browserIpc.getDiagnostics),
  getRuntimeDiagnostics: bindIdentifier(browserIpc.getRuntimeDiagnostics),
  getSessionDiagnostics: bindBrowserParser(browserIpc.getSessionDiagnostics, (args) => {
    requireArgs(args, 1, browserIpc.getSessionDiagnostics.channel)
    return ipcArgs(browserSessionDiagnosticRequestSchema.parse(args[0]))
  }),
  zoomIn: bindIdentifier(browserIpc.zoomIn),
  zoomOut: bindIdentifier(browserIpc.zoomOut),
  resetZoom: bindIdentifier(browserIpc.resetZoom),
  setZoom: bindBrowserParser(browserIpc.setZoom, (args) => {
    requireArgs(args, 2, browserIpc.setZoom.channel)
    return ipcArgs(browserIdentifierSchema.parse(args[0]), browserZoomFactorSchema.parse(args[1]))
  }),
  fitWidth: bindIdentifier(browserIpc.fitWidth),
  setDeviceMode: bindBrowserParser(browserIpc.setDeviceMode, (args) => {
    requireArgs(args, 2, browserIpc.setDeviceMode.channel)
    return ipcArgs(browserIdentifierSchema.parse(args[0]), browserViewModeSchema.parse(args[1]))
  }),
  getViewState: bindNoArgs(browserIpc.getViewState),
  listSnapshots: bindNoArgs(browserIpc.listSnapshots),
  removeSnapshot: bindIdentifier(browserIpc.removeSnapshot),
  clearSnapshots: bindNoArgs(browserIpc.clearSnapshots),
  listHistory: bindBrowserParser(browserIpc.listHistory, (args) => {
    if (args.length > 1) throw new Error(`IPC ${browserIpc.listHistory.channel} 最多接受 1 个参数`)
    return ipcArgs(browserHistoryLimitSchema.parse(args[0]))
  }),
  clearHistory: bindNoArgs(browserIpc.clearHistory),
} as const

export const browserTaskIpcContracts = {
  start: bindBrowserParser(browserTaskIpc.start, (args) => {
    requireArgs(args, 2, browserTaskIpc.start.channel)
    return ipcArgs(browserIdentifierSchema.parse(args[0]), browserTaskGoalSchema.parse(args[1]))
  }),
  list: bindNoArgs(browserTaskIpc.list),
  get: bindIdentifier(browserTaskIpc.get),
  getActiveForTab: bindIdentifier(browserTaskIpc.getActiveForTab),
  pause: bindIdentifier(browserTaskIpc.pause),
  resume: bindIdentifier(browserTaskIpc.resume),
  cancel: bindIdentifier(browserTaskIpc.cancel),
  finish: bindIdentifier(browserTaskIpc.finish),
  listActionLogs: bindIdentifier(browserTaskIpc.listActionLogs),
} as const

export const browserDownloadIpcContracts = {
  list: bindNoArgs(browserDownloadIpc.list),
  get: bindIdentifier(browserDownloadIpc.get),
  keepToWorkspace: bindIdentifier(browserDownloadIpc.keepToWorkspace),
  saveAs: bindIdentifier(browserDownloadIpc.saveAs),
  discard: bindIdentifier(browserDownloadIpc.discard),
  open: bindIdentifier(browserDownloadIpc.open),
  reveal: bindIdentifier(browserDownloadIpc.reveal),
} as const
