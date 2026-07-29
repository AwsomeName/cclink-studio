import type { BrowserWindow } from 'electron'
import {
  updateIpc,
  updateSnapshotChangedChannel,
  updateSnapshotChangedEventSchema,
} from '../../shared/update'
import type { UpdateService } from '../update/update-service'
import { registerTrustedIpcContract, type TrustedRendererGuard } from './trusted-renderer-guard'

export function registerUpdaterIpc(
  service: UpdateService,
  mainWindow: BrowserWindow,
  trustedRendererGuard: TrustedRendererGuard,
): () => void {
  registerTrustedIpcContract(updateIpc.getSnapshot, trustedRendererGuard, () =>
    service.getSnapshot(),
  )
  registerTrustedIpcContract(updateIpc.check, trustedRendererGuard, () => service.check(true))
  registerTrustedIpcContract(updateIpc.startDownload, trustedRendererGuard, () =>
    service.startDownload(),
  )
  registerTrustedIpcContract(updateIpc.cancelDownload, trustedRendererGuard, () =>
    service.cancelDownload(),
  )
  registerTrustedIpcContract(updateIpc.defer, trustedRendererGuard, () => service.defer())
  registerTrustedIpcContract(updateIpc.ignoreVersion, trustedRendererGuard, () =>
    service.ignoreVersion(),
  )
  registerTrustedIpcContract(updateIpc.prepareInstall, trustedRendererGuard, () =>
    service.prepareInstall(),
  )
  registerTrustedIpcContract(updateIpc.installAndRestart, trustedRendererGuard, (_event, input) =>
    service.installAndRestart(input),
  )

  return service.subscribe((snapshot) => {
    if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
    const event = updateSnapshotChangedEventSchema.parse({ snapshot })
    mainWindow.webContents.send(updateSnapshotChangedChannel, event)
  })
}
