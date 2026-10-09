import { cadIpcContracts } from '../../shared/ipc/workbench-contract'
import { realpath } from 'node:fs/promises'
import type { CadConversionService } from './cad-conversion-service'
import type { FileService } from '../fs/file-service'
import {
  registerTrustedIpcContract,
  type TrustedRendererGuard,
} from '../ipc/trusted-renderer-guard'

export function registerCadIpc(
  cadConversionService: CadConversionService | (() => CadConversionService | null),
  fileService: FileService,
  trustedRendererGuard: TrustedRendererGuard,
): void {
  const getService = (): CadConversionService => {
    const service =
      typeof cadConversionService === 'function' ? cadConversionService() : cadConversionService
    if (!service) throw new Error('CAD 转换能力当前不可用，请查看 Agent 能力状态')
    return service
  }

  const observedRenderers = new Set<number>()
  const observeRenderer = (event: Electron.IpcMainInvokeEvent): void => {
    const rendererId = event.sender.id
    if (observedRenderers.has(rendererId)) return
    observedRenderers.add(rendererId)
    event.sender.once('destroyed', () => {
      observedRenderers.delete(rendererId)
      const service =
        typeof cadConversionService === 'function' ? cadConversionService() : cadConversionService
      service?.releasePreviewGrantsForRenderer(rendererId)
    })
  }

  const withAuthorizedSource = async <T>(
    event: Electron.IpcMainInvokeEvent,
    requestedSourcePath: string,
    operation: (input: {
      requestedSourcePath: string
      canonicalSourcePath: string
      workspaceRoot: string
    }) => Promise<T>,
  ): Promise<T> => {
    observeRenderer(event)
    return fileService.withAccess({ rendererId: event.sender.id }, async () => {
      const workspaceRoot = fileService.getCurrentAccessRoot()
      if (!workspaceRoot) {
        throw new Error('OUTSIDE_WORKSPACE: CAD 文件必须属于当前本地工作空间')
      }
      const safeSourcePath = await fileService.assertReadableFile(requestedSourcePath)
      const [canonicalSourcePath, canonicalWorkspaceRoot] = await Promise.all([
        realpath(safeSourcePath),
        realpath(workspaceRoot),
      ])
      return operation({
        requestedSourcePath: safeSourcePath,
        canonicalSourcePath,
        workspaceRoot: canonicalWorkspaceRoot,
      })
    })
  }

  registerTrustedIpcContract(cadIpcContracts.getBackendStatus, trustedRendererGuard, () =>
    getService().getBackendStatus(),
  )
  registerTrustedIpcContract(
    cadIpcContracts.getModelSupport,
    trustedRendererGuard,
    (event, inputPath) =>
      withAuthorizedSource(event, inputPath, ({ canonicalSourcePath }) =>
        getService().getModelSupport(canonicalSourcePath),
      ),
  )
  registerTrustedIpcContract(
    cadIpcContracts.inspectModel,
    trustedRendererGuard,
    (event, inputPath) =>
      withAuthorizedSource(event, inputPath, ({ canonicalSourcePath }) =>
        getService().inspectModel(canonicalSourcePath),
      ),
  )
  registerTrustedIpcContract(cadIpcContracts.getCacheStatus, trustedRendererGuard, () =>
    getService().getCacheStatus(),
  )
  registerTrustedIpcContract(cadIpcContracts.clearCache, trustedRendererGuard, () =>
    getService().clearCache(),
  )
  registerTrustedIpcContract(cadIpcContracts.convertModel, trustedRendererGuard, (event, request) =>
    withAuthorizedSource(event, request.inputPath, async (source) => {
      const result = await getService().convertModel({
        ...request,
        inputPath: source.canonicalSourcePath,
      })
      return getService().createPreviewGrant(result, {
        rendererId: event.sender.id,
        ...source,
      })
    }),
  )
  registerTrustedIpcContract(
    cadIpcContracts.readPreview,
    trustedRendererGuard,
    (event, previewRef) => {
      observeRenderer(event)
      return fileService.withAccess({ rendererId: event.sender.id }, async () => {
        const workspaceRoot = fileService.getCurrentAccessRoot()
        if (!workspaceRoot) {
          throw new Error('OUTSIDE_WORKSPACE: CAD 预览必须属于当前本地工作空间')
        }
        return getService().readPreview(previewRef, {
          rendererId: event.sender.id,
          workspaceRoot: await realpath(workspaceRoot),
          authorizeSource: async (requestedSourcePath) =>
            realpath(await fileService.assertReadableFile(requestedSourcePath)),
        })
      })
    },
  )
}
