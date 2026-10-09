export type CompanyAccountRecordStatus = 'pending' | 'confirmed'

export type CompanyAccountRecordType = 'income' | 'expense' | 'internal_transfer' | 'refund'

export type CompanyAccountDirection = 'income' | 'expense'

export interface CompanyAccountsSettings {
  companyName: string
  defaultCurrency: string
}

export interface CompanyAccountsProject {
  id: string
  name: string
  createdAt: string
}

export interface CompanyAccountsDocument {
  id: string
  originalName: string
  mimeType: string
  size: number
  storedPath: string
  createdAt: string
  linkedRecordIds: string[]
}

export interface CompanyAccountsRecord {
  id: string
  date: string
  month: string
  recordType: CompanyAccountRecordType
  direction: CompanyAccountDirection
  amountMinor: number
  currency: string
  account: string
  counterparty: string
  purpose: string
  category: string
  projectId: string | null
  status: CompanyAccountRecordStatus
  version: number
  suggestion: {
    category: string
    recordType: CompanyAccountRecordType
    reason: string
    source: 'rules-v1'
  } | null
  documentIds: string[]
  sourceDocumentIds: string[]
  supportingDocumentIds: string[]
  history: Array<{
    id: string
    eventType: 'imported' | 'ai_suggested' | 'updated' | 'confirmed'
    actor: 'studio' | 'agent' | 'user'
    createdAt: string
  }>
  createdAt: string
  updatedAt: string
}

export interface CompanyAccountsAiProposal {
  recordId: string
  category: string
  recordType: CompanyAccountRecordType
  projectId: string | null
  reason: string
}

export interface CompanyAccountsImportBatch {
  id: string
  month: string
  sourceLabel: string
  importedRecords: number
  importedDocuments: number
  duplicateRecords: number
  duplicateDocuments: number
  failures: Array<{ fileName: string; reason: string }>
  createdAt: string
}

export interface CompanyAccountsProjectSummary {
  projectId: string
  projectName: string
  spentMinor: number
  categories: Array<{ category: string; spentMinor: number }>
}

export interface CompanyAccountsMonthlySummary {
  month: string
  incomeMinor: number
  expenseMinor: number
  refundMinor: number
  netMinor: number
  confirmedCount: number
  pendingCount: number
  projectSpending: CompanyAccountsProjectSummary[]
}

export interface CompanyAccountsSnapshot {
  workspaceAvailable: boolean
  initialized: boolean
  databaseVersion: number | null
  month: string
  months: string[]
  settings: CompanyAccountsSettings
  records: CompanyAccountsRecord[]
  projects: CompanyAccountsProject[]
  documents: CompanyAccountsDocument[]
  summary: CompanyAccountsMonthlySummary
  lastImport: CompanyAccountsImportBatch | null
  error?: string
}

export type CompanyAccountsErrorCode =
  | 'NO_LOCAL_WORKSPACE'
  | 'NOT_INITIALIZED'
  | 'INVALID_INPUT'
  | 'CONFLICT'
  | 'IO_ERROR'
  | 'INTERNAL_ERROR'

export type CompanyAccountsResult<T> =
  | { success: true; data: T }
  | { success: false; error: { code: CompanyAccountsErrorCode; message: string } }

export interface CompanyAccountsImportInput {
  month: string
  filePaths: string[]
}

export interface CompanyAccountsUpdateRecordInput {
  recordId: string
  expectedVersion: number
  date: string
  recordType: CompanyAccountRecordType
  direction: CompanyAccountDirection
  amountMinor: number
  currency: string
  account: string
  counterparty: string
  purpose: string
  category: string
  projectId: string | null
  documentIds: string[]
}

export interface CompanyAccountsConfirmRecordInput {
  recordId: string
  expectedVersion: number
}

export interface CompanyAccountsUpdateSettingsInput {
  month: string
  companyName: string
  defaultCurrency: string
}

export interface CompanyAccountsMonthDestinationInput {
  month: string
  destinationDirectory: string
}

export interface CompanyAccountsDestinationInput {
  destinationDirectory: string
}

export interface CompanyAccountsRestoreInput {
  backupDirectory: string
  month: string
}

export interface CompanyAccountsExportResult {
  directoryPath: string
  recordCount: number
  documentCount: number
}

export interface CompanyAccountsBackupResult {
  directoryPath: string
}
