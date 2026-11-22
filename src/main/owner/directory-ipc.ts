import { shell } from 'electron'
import { ownerDirectoryIpc } from '../../shared/ipc/owner-directory'
import { ownerSourceIpc } from '../../shared/ipc/owner-source'
import type { AskFileRead, OwnerSourceFiles } from './source-files'
import {
  findSourceFiles,
  readSourceExcerpt,
  type OwnerSourceDirectories,
} from './source-directories'
import { ownerPreferencesIpc } from '../../shared/ipc/owner-preferences'
import type { OwnerPreferences } from './owner-preferences'
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
export function registerOwnerSources(
  guard: TrustedRendererGuard,
  sources: OwnerSourceDirectories,
  files: OwnerSourceFiles,
  ask: AskFileRead,
) {
  registerTrustedIpcContract(ownerSourceIpc.list, guard, (_e, id) => sources.list(id))
  registerTrustedIpcContract(ownerSourceIpc.prepare, guard, (_e, id, rootId) =>
    sources.prepare(id, rootId ?? undefined),
  )
  registerTrustedIpcContract(ownerSourceIpc.confirm, guard, (_e, id, token) =>
    sources.confirm(id, token),
  )
  registerTrustedIpcContract(ownerSourceIpc.revoke, guard, (_e, id, grant) =>
    sources.revoke(id, grant),
  )
  registerTrustedIpcContract(ownerSourceIpc.entries, guard, (_e, id, grant, rel) =>
    sources.entries(id, grant, rel),
  )
  registerTrustedIpcContract(ownerSourceIpc.read, guard, (_e, id, grant, rel) =>
    sources.read(id, grant, rel),
  )
  registerTrustedIpcContract(ownerSourceIpc.find, guard, (_e, id, grant, terms) =>
    findSourceFiles(sources, id, grant, terms),
  )
  registerTrustedIpcContract(ownerSourceIpc.excerpt, guard, (_e, id, grant, rel, anchor) =>
    readSourceExcerpt(sources, id, grant, rel, anchor),
  )
  registerTrustedIpcContract(ownerSourceIpc.requestFile, guard, (_e, id, conversation, path) =>
    files.request(id, conversation, path, ask),
  )
  registerTrustedIpcContract(ownerSourceIpc.grantFile, guard, (_e, id, path) =>
    files.grantSkipped(id, path),
  )
  registerTrustedIpcContract(ownerSourceIpc.fileExcerpt, guard, (_e, id, grant, anchor) =>
    files.excerpt(id, grant, anchor),
  )
}
export function registerOwnerPreferences(guard: TrustedRendererGuard, prefs: OwnerPreferences) {
  registerTrustedIpcContract(ownerPreferencesIpc.get, guard, () => prefs.get())
  registerTrustedIpcContract(ownerPreferencesIpc.register, guard, (_e, purpose) =>
    prefs.register(purpose),
  )
  registerTrustedIpcContract(ownerPreferencesIpc.remove, guard, (_e, id) => prefs.remove(id))
  registerTrustedIpcContract(ownerPreferencesIpc.setDefaultParent, guard, (_e, id) =>
    prefs.setDefaultParent(id),
  )
  registerTrustedIpcContract(ownerPreferencesIpc.update, guard, (_e, change) =>
    prefs.update(change),
  )
}
