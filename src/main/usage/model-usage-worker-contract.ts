import type { ModelUsageContext, UsageQuery, UsageCategory } from '../../shared/model-usage'
export type UsageWorkerCommand =
  | { type: 'start'; context: ModelUsageContext }
  | { type: 'observe'; runId: string; event: unknown }
  | { type: 'finish'; runId: string; status: 'succeeded' | 'failed' | 'interrupted' | 'unknown' }
  | { type: 'snapshot'; query: UsageQuery }
  | { type: 'calls'; query: UsageQuery; offset: number; excludeDevelopment: boolean }
  | { type: 'setEnabled'; enabled: boolean }
  | {
      type: 'classify'
      target: { kind: 'run' | 'session' | 'task'; id: string; category: UsageCategory }
    }
  | { type: 'backfill'; root?: string }
  | { type: 'import'; path: string }
  | {
      type: 'export'
      path: string
      format: 'csv' | 'json'
      query: UsageQuery
      excludeDevelopment: boolean
    }
  | { type: 'initialize' | 'close' }
