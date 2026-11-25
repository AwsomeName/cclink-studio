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
} as const

export interface TechDailyApiContract {
  getSettings(input: WorkspaceInput): Promise<TechDailyResult<TechDailySettingsSnapshot>>
  saveSettings(input: SaveTechDailySettings): Promise<TechDailyResult<TechDailySettingsSnapshot>>
  getStatus(input: WorkspaceInput): Promise<TechDailyResult<TechDailyStatus>>
  getSearxng(): Promise<TechDailyResult<SearxngConfigSnapshot>>
  saveSearxng(input: SearxngConfigInput): Promise<TechDailyResult<SearxngConfigSnapshot>>
  testSearxng(input: SearxngConfigInput): Promise<TechDailyResult<SearxngTestResult>>
  collect(input: WorkspaceInput): Promise<TechDailyResult<TechDailyCollectResult>>
}
