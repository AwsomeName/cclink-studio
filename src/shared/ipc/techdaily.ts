import { defineIpcCall } from './contract'
import type {
  SaveTechDailySettings,
  SearxngConfigInput,
  SearxngConfigSnapshot,
  SearxngTestResult,
  TechDailyCollectResult,
  TechDailyResult,
  TechDailySettingsSnapshot,
  TechDailyStatus,
  TechDailyMonth,
  TechDailyRun,
} from '../techdaily/techdaily-types'

type WorkspaceInput = { workspacePath: string }

export const techDailyIpc = {
  getSettings: defineIpcCall<[WorkspaceInput], TechDailyResult<TechDailySettingsSnapshot>>(
    'techdaily:get-settings',
  ),
  saveSettings: defineIpcCall<[SaveTechDailySettings], TechDailyResult<TechDailySettingsSnapshot>>(
    'techdaily:save-settings',
  ),
  getStatus: defineIpcCall<[WorkspaceInput], TechDailyResult<TechDailyStatus>>(
    'techdaily:get-status',
  ),
  getSearxng: defineIpcCall<[], TechDailyResult<SearxngConfigSnapshot>>('techdaily:get-searxng'),
  saveSearxng: defineIpcCall<[SearxngConfigInput], TechDailyResult<SearxngConfigSnapshot>>(
    'techdaily:save-searxng',
  ),
  testSearxng: defineIpcCall<[SearxngConfigInput], TechDailyResult<SearxngTestResult>>(
    'techdaily:test-searxng',
  ),
  collect: defineIpcCall<[WorkspaceInput], TechDailyResult<TechDailyCollectResult>>(
    'techdaily:collect',
  ),
  listMonth: defineIpcCall<
    [{ workspacePath: string; month: string }],
    TechDailyResult<TechDailyMonth>
  >('techdaily:list-month'),
  getRun: defineIpcCall<
    [{ workspacePath: string; day: string }],
    TechDailyResult<TechDailyRun | null>
  >('techdaily:get-run'),
  generate: defineIpcCall<
    [{ workspacePath: string; overwrite: boolean }],
    TechDailyResult<TechDailyRun>
  >('techdaily:generate'),
  stop: defineIpcCall<[WorkspaceInput], TechDailyResult<TechDailyRun | null>>('techdaily:stop'),
} as const

export interface TechDailyApiContract {
  getSettings(input: WorkspaceInput): Promise<TechDailyResult<TechDailySettingsSnapshot>>
  saveSettings(input: SaveTechDailySettings): Promise<TechDailyResult<TechDailySettingsSnapshot>>
  getStatus(input: WorkspaceInput): Promise<TechDailyResult<TechDailyStatus>>
  getSearxng(): Promise<TechDailyResult<SearxngConfigSnapshot>>
  saveSearxng(input: SearxngConfigInput): Promise<TechDailyResult<SearxngConfigSnapshot>>
  testSearxng(input: SearxngConfigInput): Promise<TechDailyResult<SearxngTestResult>>
  collect(input: WorkspaceInput): Promise<TechDailyResult<TechDailyCollectResult>>
  listMonth(input: { workspacePath: string; month: string }): Promise<TechDailyResult<TechDailyMonth>>
  getRun(input: { workspacePath: string; day: string }): Promise<TechDailyResult<TechDailyRun | null>>
  generate(input: { workspacePath: string; overwrite: boolean }): Promise<TechDailyResult<TechDailyRun>>
  stop(input: WorkspaceInput): Promise<TechDailyResult<TechDailyRun | null>>
}
