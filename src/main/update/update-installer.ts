import type { UpdateInstallImpact } from '../../shared/update'
import type { MacDmgVerificationInput } from './mac-dmg-verifier'

/** UpdateService owns state; the installer only executes one bounded local transaction. */
export interface StagedUpdateInstallation {
  observeFailure?: (listener: () => void) => void
  arm(): Promise<void>
  commit(): Promise<void>
  cancel(): Promise<void>
}

export interface UpdateInstaller {
  stage(input: MacDmgVerificationInput): Promise<StagedUpdateInstallation>
  acknowledgeStartup?: (argv: string[]) => Promise<void>
  previousFailure?: () => Promise<string | null>
}

export interface UpdateInstallLifecycle {
  inspect(): Promise<UpdateInstallImpact[]>
  acquire?: () => () => void
  flush(): Promise<void>
  quit(): void
}
