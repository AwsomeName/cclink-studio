import { shell } from 'electron'
import { ownerDirectoryIpc } from '../../shared/ipc/owner-directory'
import {
  registerTrustedIpcContract,
  type TrustedRendererGuard,
} from '../ipc/trusted-renderer-guard'
import type { AffairDirectoryService } from './affair-directory'
export function registerOwnerDirectories(
  guard: TrustedRendererGuard,
  service: AffairDirectoryService,
) {
  registerTrustedIpcContract(ownerDirectoryIpc.list, guard, () => service.list())
  registerTrustedIpcContract(ownerDirectoryIpc.save, guard, (_e, a, revision) =>
    service.save(a, revision),
  )
  registerTrustedIpcContract(ownerDirectoryIpc.retry, guard, (_e, id) => service.retry(id))
  registerTrustedIpcContract(ownerDirectoryIpc.preview, guard, (_e, id, name) =>
    service.preview(id, name),
  )
  registerTrustedIpcContract(ownerDirectoryIpc.reveal, guard, async (_e, id) => {
    const error = await shell.openPath(await service.location(id))
    if (error) throw Error(error)
  })
}
