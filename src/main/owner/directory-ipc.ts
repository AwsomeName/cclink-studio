import { shell } from 'electron'
import { ownerDirectoryIpc } from '../../shared/ipc/owner-directory'
import { ownerSourceIpc } from '../../shared/ipc/owner-source'
import type { OwnerSourceDirectories } from './source-directories'
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
  registerTrustedIpcContract(ownerDirectoryIpc.confirm, guard, (_e, id, revision) =>
    service.confirm(id, revision),
  )
  registerTrustedIpcContract(ownerDirectoryIpc.upgrade, guard, (_e, id, revision) =>
    service.upgrade(id, revision),
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
export function registerOwnerSources(guard: TrustedRendererGuard, sources: OwnerSourceDirectories) {
  registerTrustedIpcContract(ownerSourceIpc.list, guard, (_e, id) => sources.list(id))
  registerTrustedIpcContract(ownerSourceIpc.add, guard, (_e, id) => sources.add(id))
  registerTrustedIpcContract(ownerSourceIpc.revoke, guard, (_e, id, grant) =>
    sources.revoke(id, grant),
  )
  registerTrustedIpcContract(ownerSourceIpc.entries, guard, (_e, id, grant, rel) =>
    sources.entries(id, grant, rel),
  )
  registerTrustedIpcContract(ownerSourceIpc.read, guard, (_e, id, grant, rel) =>
    sources.read(id, grant, rel),
  )
}
