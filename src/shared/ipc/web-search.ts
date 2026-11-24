import { defineIpcCall } from './contract'
import type {
  WebSearchMonthUsage,
  WebSearchResult,
  WebSearchSettingsInput,
  WebSearchStatus,
  WebSearchVerifyResult,
} from '../web-search/web-search-types'

export const webSearchIpc = {
  getStatus: defineIpcCall<[], WebSearchResult<WebSearchStatus>>('web-search:get-status'),
  saveSettings: defineIpcCall<[WebSearchSettingsInput], WebSearchResult<WebSearchStatus>>(
    'web-search:save-settings',
  ),
  verify: defineIpcCall<[WebSearchSettingsInput], WebSearchResult<WebSearchVerifyResult>>(
    'web-search:verify',
  ),
  getUsage: defineIpcCall<[string], WebSearchResult<WebSearchMonthUsage>>('web-search:get-usage'),
} as const

export interface WebSearchApiContract {
  getStatus(): Promise<WebSearchResult<WebSearchStatus>>
  saveSettings(input: WebSearchSettingsInput): Promise<WebSearchResult<WebSearchStatus>>
  verify(input: WebSearchSettingsInput): Promise<WebSearchResult<WebSearchVerifyResult>>
  getUsage(month: string): Promise<WebSearchResult<WebSearchMonthUsage>>
}
