import { defineIpcCall } from './contract'
import type {
  CompanyAccountsBackupResult,
  CompanyAccountsAiProposal,
  CompanyAccountsConfirmRecordInput,
  CompanyAccountsDestinationInput,
  CompanyAccountsExportResult,
  CompanyAccountsImportBatch,
  CompanyAccountsImportInput,
  CompanyAccountsMonthDestinationInput,
  CompanyAccountsProject,
  CompanyAccountsRestoreInput,
  CompanyAccountsResult,
  CompanyAccountsSnapshot,
  CompanyAccountsUpdateRecordInput,
  CompanyAccountsUpdateSettingsInput,
} from '../company-accounts/company-accounts-types'

export interface CompanyAccountsApiContract {
  getSnapshot(month: string): Promise<CompanyAccountsResult<CompanyAccountsSnapshot>>
  initialize(month: string): Promise<CompanyAccountsResult<CompanyAccountsSnapshot>>
  importFiles(
    input: CompanyAccountsImportInput,
  ): Promise<CompanyAccountsResult<CompanyAccountsImportBatch>>
  updateRecord(
    input: CompanyAccountsUpdateRecordInput,
  ): Promise<CompanyAccountsResult<CompanyAccountsSnapshot>>
  confirmRecord(
    input: CompanyAccountsConfirmRecordInput,
  ): Promise<CompanyAccountsResult<CompanyAccountsSnapshot>>
  proposeRecord(recordId: string): Promise<CompanyAccountsResult<CompanyAccountsAiProposal>>
  createProject(name: string): Promise<CompanyAccountsResult<CompanyAccountsProject>>
  updateSettings(
    input: CompanyAccountsUpdateSettingsInput,
  ): Promise<CompanyAccountsResult<CompanyAccountsSnapshot>>
  exportMonth(
    input: CompanyAccountsMonthDestinationInput,
  ): Promise<CompanyAccountsResult<CompanyAccountsExportResult>>
  createBackup(
    input: CompanyAccountsDestinationInput,
  ): Promise<CompanyAccountsResult<CompanyAccountsBackupResult>>
  restoreBackup(
    input: CompanyAccountsRestoreInput,
  ): Promise<CompanyAccountsResult<CompanyAccountsSnapshot>>
}

export const companyAccountsIpc = {
  getSnapshot: defineIpcCall<[month: string], CompanyAccountsResult<CompanyAccountsSnapshot>>(
    'company-accounts:get-snapshot',
  ),
  initialize: defineIpcCall<[month: string], CompanyAccountsResult<CompanyAccountsSnapshot>>(
    'company-accounts:initialize',
  ),
  importFiles: defineIpcCall<
    [input: CompanyAccountsImportInput],
    CompanyAccountsResult<CompanyAccountsImportBatch>
  >('company-accounts:import-files'),
  updateRecord: defineIpcCall<
    [input: CompanyAccountsUpdateRecordInput],
    CompanyAccountsResult<CompanyAccountsSnapshot>
  >('company-accounts:update-record'),
  confirmRecord: defineIpcCall<
    [input: CompanyAccountsConfirmRecordInput],
    CompanyAccountsResult<CompanyAccountsSnapshot>
  >('company-accounts:confirm-record'),
  proposeRecord: defineIpcCall<
    [recordId: string],
    CompanyAccountsResult<CompanyAccountsAiProposal>
  >('company-accounts:propose-record'),
  createProject: defineIpcCall<[name: string], CompanyAccountsResult<CompanyAccountsProject>>(
    'company-accounts:create-project',
  ),
  updateSettings: defineIpcCall<
    [input: CompanyAccountsUpdateSettingsInput],
    CompanyAccountsResult<CompanyAccountsSnapshot>
  >('company-accounts:update-settings'),
  exportMonth: defineIpcCall<
    [input: CompanyAccountsMonthDestinationInput],
    CompanyAccountsResult<CompanyAccountsExportResult>
  >('company-accounts:export-month'),
  createBackup: defineIpcCall<
    [input: CompanyAccountsDestinationInput],
    CompanyAccountsResult<CompanyAccountsBackupResult>
  >('company-accounts:create-backup'),
  restoreBackup: defineIpcCall<
    [input: CompanyAccountsRestoreInput],
    CompanyAccountsResult<CompanyAccountsSnapshot>
  >('company-accounts:restore-backup'),
} as const
