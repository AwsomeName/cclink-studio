import type {
  BrowserTaskFailureReason,
  BrowserActionLog,
  BrowserActionLogChangedPayload,
  BrowserTaskRun,
  BrowserTaskStatus,
  BrowserTaskChangedPayload,
} from '../../shared/ipc/browser'

export type {
  BrowserTaskFailureReason,
  BrowserActionLog,
  BrowserActionLogChangedPayload,
  BrowserTaskRun,
  BrowserTaskStatus,
  BrowserTaskChangedPayload,
}

export interface StartBrowserTaskOptions {
  tabId: string
  goal: string
  correlation?: BrowserTaskRun['correlation']
}

export type UpdateBrowserTaskCorrelationOptions = Partial<
  NonNullable<BrowserTaskRun['correlation']>
>

export interface FailBrowserTaskOptions {
  reason: BrowserTaskFailureReason
  errorMessage?: string
}

export interface StartBrowserActionLogOptions {
  taskRunId: string
  tabId: string
  action: string
  paramsSummary: string
}

export interface FailBrowserActionLogOptions {
  reason: BrowserTaskFailureReason
  errorMessage?: string
}
