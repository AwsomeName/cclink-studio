import { defineIpcCall } from './contract'
import type {
  ModelUsageRecord,
  UsageQuery,
  UsageResult,
  UsageSnapshot,
  UsageCategory,
} from '../model-usage'
export interface UsageClassifyInput {
  kind: 'run' | 'task' | 'session'
  id: string
  category: UsageCategory
}
export interface UsageExportInput {
  query: UsageQuery
  format: 'csv' | 'json'
  excludeDevelopment: boolean
}
export interface UsageImportResult {
  inserted: number
  replayed: number
  invalidLines?: number
  pendingLines?: number
  unidentifiable?: number
  earliest?: string | null
  latest?: string | null
}
export interface ModelUsageApiContract {
  snapshot(query: UsageQuery): Promise<UsageResult<UsageSnapshot>>
  calls(
    query: UsageQuery,
    offset: number,
    excludeDevelopment: boolean,
  ): Promise<UsageResult<{ total: number; records: ModelUsageRecord[] }>>
  setEnabled(enabled: boolean): Promise<UsageResult<null>>
  classify(input: UsageClassifyInput): Promise<UsageResult<null>>
  backfill(selectDirectory: boolean): Promise<UsageResult<UsageImportResult | null>>
  importFile(): Promise<UsageResult<UsageImportResult | null>>
  exportFile(input: UsageExportInput): Promise<UsageResult<{ path: string; calls: number } | null>>
}
export const modelUsageIpc = {
  snapshot: defineIpcCall<[UsageQuery], UsageResult<UsageSnapshot>>('model-usage:snapshot'),
  calls: defineIpcCall<
    [UsageQuery, number, boolean],
    UsageResult<{ total: number; records: ModelUsageRecord[] }>
  >('model-usage:calls'),
  setEnabled: defineIpcCall<[boolean], UsageResult<null>>('model-usage:set-enabled'),
  classify: defineIpcCall<[UsageClassifyInput], UsageResult<null>>('model-usage:classify'),
  backfill: defineIpcCall<[boolean], UsageResult<UsageImportResult | null>>('model-usage:backfill'),
  importFile: defineIpcCall<[], UsageResult<UsageImportResult | null>>('model-usage:import'),
  exportFile: defineIpcCall<
    [UsageExportInput],
    UsageResult<{ path: string; calls: number } | null>
  >('model-usage:export'),
} as const
