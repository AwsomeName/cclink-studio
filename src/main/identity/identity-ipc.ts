import { ipcMain } from 'electron'
import type { LocalIdentityService } from './local-identity-service'

export function registerIdentityIpc(localIdentityService: LocalIdentityService): void {
  ipcMain.handle('identity:getLocalIdentity', () => localIdentityService.ensureIdentity())
}
