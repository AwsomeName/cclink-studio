import type { CompanyAccountsResult } from '../../shared/company-accounts/company-accounts-types'
import { companyAccountsIpcContracts } from '../../shared/ipc/company-accounts-contract'
import {
  registerTrustedIpcContract,
  type TrustedRendererGuard,
} from '../ipc/trusted-renderer-guard'
import { CompanyAccountsError, CompanyAccountsService } from './company-accounts-service'

function fail<T>(error: unknown): CompanyAccountsResult<T> {
  if (error instanceof CompanyAccountsError) {
    return { success: false, error: { code: error.code, message: error.message } }
  }
  return {
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: error instanceof Error ? error.message : '未知账目错误',
    },
  }
}

async function run<T>(operation: () => T | Promise<T>): Promise<CompanyAccountsResult<T>> {
  try {
    return { success: true, data: await operation() }
  } catch (error) {
    return fail(error)
  }
}

export function registerCompanyAccountsIpc(
  getService: () => CompanyAccountsService | null,
  trustedRendererGuard: TrustedRendererGuard,
): void {
  const service = (): CompanyAccountsService => {
    const current = getService()
    if (!current) throw new CompanyAccountsError('INTERNAL_ERROR', '公司账目能力当前不可用')
    return current
  }

  registerTrustedIpcContract(
    companyAccountsIpcContracts.getSnapshot,
    trustedRendererGuard,
    (_event, month) => run(() => service().getSnapshot(month)),
  )
  registerTrustedIpcContract(
    companyAccountsIpcContracts.initialize,
    trustedRendererGuard,
    (_event, month) => run(() => service().initialize(month)),
  )
  registerTrustedIpcContract(
    companyAccountsIpcContracts.importFiles,
    trustedRendererGuard,
    (_event, input) => run(() => service().importFiles(input)),
  )
  registerTrustedIpcContract(
    companyAccountsIpcContracts.updateRecord,
    trustedRendererGuard,
    (_event, input) => run(() => service().updateRecord(input)),
  )
  registerTrustedIpcContract(
    companyAccountsIpcContracts.confirmRecord,
    trustedRendererGuard,
    (_event, input) => run(() => service().confirmRecord(input.recordId, input.expectedVersion)),
  )
  registerTrustedIpcContract(
    companyAccountsIpcContracts.proposeRecord,
    trustedRendererGuard,
    (_event, recordId) => run(() => service().proposeRecord(recordId)),
  )
  registerTrustedIpcContract(
    companyAccountsIpcContracts.createProject,
    trustedRendererGuard,
    (_event, name) => run(() => service().createProject(name)),
  )
  registerTrustedIpcContract(
    companyAccountsIpcContracts.updateSettings,
    trustedRendererGuard,
    (_event, input) => run(() => service().updateSettings(input)),
  )
  registerTrustedIpcContract(
    companyAccountsIpcContracts.exportMonth,
    trustedRendererGuard,
    (_event, input) => run(() => service().exportMonth(input.month, input.destinationDirectory)),
  )
  registerTrustedIpcContract(
    companyAccountsIpcContracts.createBackup,
    trustedRendererGuard,
    (_event, input) => run(() => service().createBackup(input.destinationDirectory)),
  )
  registerTrustedIpcContract(
    companyAccountsIpcContracts.restoreBackup,
    trustedRendererGuard,
    (_event, input) => run(() => service().restoreBackup(input)),
  )
}
