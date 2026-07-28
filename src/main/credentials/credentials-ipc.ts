import { credentialsIpcContracts as credentialsIpc } from '../../shared/ipc/credentials-contract'
import type {
  CredentialFieldResult,
  CredentialMetadataResult,
  CredentialOperationResult,
} from '../../shared/ipc/credentials'
import {
  registerTrustedIpcContract,
  type TrustedRendererGuard,
} from '../ipc/trusted-renderer-guard'
import type { CredentialService } from './credential-service'

export function registerCredentialsIpc(
  credentialService: CredentialService,
  trustedRendererGuard: TrustedRendererGuard,
): void {
  registerTrustedIpcContract(credentialsIpc.getStatus, trustedRendererGuard, () =>
    credentialService.getStatus(),
  )

  registerTrustedIpcContract(
    credentialsIpc.listMetadata,
    trustedRendererGuard,
    async (): Promise<CredentialMetadataResult> => ({
      success: true,
      metadata: credentialService.listMetadata(),
      status: credentialService.getStatus(),
    }),
  )

  registerTrustedIpcContract(
    credentialsIpc.set,
    trustedRendererGuard,
    async (_event, input): Promise<CredentialOperationResult> =>
      operation(() => credentialService.setCredential(input)),
  )

  registerTrustedIpcContract(
    credentialsIpc.revealField,
    trustedRendererGuard,
    async (_event, id, field): Promise<CredentialFieldResult> => {
      try {
        return {
          success: true,
          value: credentialService.revealField(id, field),
          status: credentialService.getStatus(),
        }
      } catch (error) {
        return failure(error, credentialService)
      }
    },
  )

  registerTrustedIpcContract(
    credentialsIpc.copyField,
    trustedRendererGuard,
    async (_event, id, field): Promise<CredentialOperationResult> =>
      operation(async () => {
        credentialService.copyField(id, field)
        return credentialService.getStatus()
      }),
  )

  registerTrustedIpcContract(
    credentialsIpc.remove,
    trustedRendererGuard,
    async (_event, id): Promise<CredentialOperationResult> =>
      operation(() => credentialService.removeCredential(id)),
  )

  registerTrustedIpcContract(
    credentialsIpc.clearAll,
    trustedRendererGuard,
    async (): Promise<CredentialOperationResult> => operation(() => credentialService.clearAll()),
  )

  registerTrustedIpcContract(
    credentialsIpc.removeLegacyFiles,
    trustedRendererGuard,
    async (): Promise<CredentialOperationResult> =>
      operation(() => credentialService.removeLegacyFiles()),
  )

  registerTrustedIpcContract(
    credentialsIpc.openDirectory,
    trustedRendererGuard,
    async (): Promise<CredentialOperationResult> =>
      operation(async () => {
        await credentialService.openDirectory()
        return credentialService.getStatus()
      }),
  )

  registerTrustedIpcContract(
    credentialsIpc.reload,
    trustedRendererGuard,
    async (): Promise<CredentialOperationResult> => {
      const status = await credentialService.reload()
      if (status.status !== 'ready' && status.status !== 'conflict') {
        return {
          success: false,
          error: status.message ?? '本地凭证文件重新加载失败',
          status,
        }
      }
      return { success: true, status }
    },
  )
}

async function operation(
  run: () => Promise<ReturnType<CredentialService['getStatus']>>,
): Promise<CredentialOperationResult> {
  try {
    return { success: true, status: await run() }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function failure(error: unknown, credentialService: CredentialService): CredentialFieldResult {
  return {
    success: false,
    error: error instanceof Error ? error.message : String(error),
    status: credentialService.getStatus(),
  }
}
