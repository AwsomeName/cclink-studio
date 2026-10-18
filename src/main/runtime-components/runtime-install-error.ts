import type { ManagedClaudeInstallErrorCode } from '../../shared/ipc/runtime-components'

export class RuntimeComponentInstallError extends Error {
  readonly code: ManagedClaudeInstallErrorCode

  constructor(code: ManagedClaudeInstallErrorCode, message: string) {
    super(message)
    this.name = 'RuntimeComponentInstallError'
    this.code = code
  }
}
