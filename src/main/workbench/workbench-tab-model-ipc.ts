import {
  workbenchBrowserStateIpc,
  workbenchTabModelIpc,
} from '../../shared/ipc/workbench-tab-model'
import {
  registerTrustedIpcContract,
  type TrustedRendererGuard,
} from '../ipc/trusted-renderer-guard'
import { WorkbenchTabModel, WorkbenchTabModelError } from './workbench-tab-model'
import { BrowserBookmarkModel } from './browser-bookmark-model'

export function registerWorkbenchTabModelIpc(
  model: WorkbenchTabModel,
  bookmarks: BrowserBookmarkModel,
  trustedRendererGuard: TrustedRendererGuard,
): void {
  registerTrustedIpcContract(
    workbenchTabModelIpc.getProjection,
    trustedRendererGuard,
    (_event, input) => model.getProjection(input.workspaceKey, input.ownerKey),
  )
  registerTrustedIpcContract(
    workbenchTabModelIpc.applyDelta,
    trustedRendererGuard,
    async (_event, input) => {
      try {
        return { success: true as const, projection: await model.applyDelta(input) }
      } catch (error) {
        if (error instanceof WorkbenchTabModelError) {
          return {
            success: false as const,
            error: { code: error.code, message: error.message },
          }
        }
        return {
          success: false as const,
          error: { code: 'persist-failed' as const, message: 'TabModel 更新失败' },
        }
      }
    },
  )
  registerTrustedIpcContract(
    workbenchBrowserStateIpc.getBrowserProjection,
    trustedRendererGuard,
    (_event, input) => model.getBrowserProjection(input.workspaceKey, input.ownerKey),
  )
  registerTrustedIpcContract(
    workbenchBrowserStateIpc.applyBrowserDelta,
    trustedRendererGuard,
    async (_event, input) => {
      try {
        return { success: true as const, projection: await model.applyBrowserDelta(input) }
      } catch (error) {
        return mapModelError(error)
      }
    },
  )
  registerTrustedIpcContract(
    workbenchBrowserStateIpc.getBookmarks,
    trustedRendererGuard,
    (_event, input) => bookmarks.getProjection(input.workspaceKey, input.ownerKey),
  )
  registerTrustedIpcContract(
    workbenchBrowserStateIpc.replaceBookmarks,
    trustedRendererGuard,
    async (_event, input) => {
      try {
        return { success: true as const, projection: await bookmarks.replace(input) }
      } catch (error) {
        return mapModelError(error)
      }
    },
  )
}

function mapModelError(error: unknown) {
  if (error instanceof WorkbenchTabModelError) {
    return { success: false as const, error: { code: error.code, message: error.message } }
  }
  return {
    success: false as const,
    error: { code: 'persist-failed' as const, message: 'Workbench 状态更新失败' },
  }
}
