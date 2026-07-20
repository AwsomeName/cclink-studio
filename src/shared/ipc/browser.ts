export type BrowserViewModeType = 'desktop' | 'mobile'
export type BrowserZoomModeType = 'fit' | 'manual'

export interface BrowserViewState {
  viewMode: BrowserViewModeType
  zoomMode: BrowserZoomModeType
  zoomFactor: number
}

export interface BrowserCreateViewRestoreOptions {
  viewMode: BrowserViewModeType
  zoomMode: BrowserZoomModeType
  manualZoom: number
  history?: string[]
  historyIndex?: number
}

export interface BrowserCreateViewOptions {
  restore?: BrowserCreateViewRestoreOptions
  profileId?: string | null
  workspaceKey?: string | null
}

export interface BrowserReconcileViewsOptions {
  workspaceKey: string | null
  validTabIds: string[]
  activeTabId: string | null
}

/** 浏览器实例快照（关闭时落盘，重启「恢复上次会话」重建用）。 */
export interface BrowserInstanceSnapshot {
  id: string
  url: string
  title: string | null
  viewMode: BrowserViewModeType
  zoomMode: BrowserZoomModeType
  manualZoom: number
  history?: string[]
  historyIndex?: number
  closedAt: number
}

export interface BrowserHistoryEntry {
  id: string
  url: string
  title: string | null
  visitedAt: number
}

export type BrowserTaskStatus = 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'

export type BrowserTaskFailureReason =
  | 'timeout'
  | 'navigation_blocked'
  | 'selector_missing'
  | 'element_obscured'
  | 'auth_required'
  | 'captcha_or_bot_check'
  | 'download_failed'
  | 'user_interrupted'
  | 'tab_closed'
  | 'unknown'

export interface BrowserTaskRun {
  id: string
  tabId: string
  goal: string
  status: BrowserTaskStatus
  startedAt: number
  endedAt?: number
  failureReason?: BrowserTaskFailureReason
  errorMessage?: string
  downloadIds: string[]
}

export type BrowserActionLogStatus = 'started' | 'succeeded' | 'failed' | 'skipped'

export interface BrowserActionLog {
  id: string
  taskRunId: string
  tabId: string
  action: string
  paramsSummary: string
  status: BrowserActionLogStatus
  startedAt: number
  endedAt?: number
  errorMessage?: string
  failureReason?: BrowserTaskFailureReason
}

export interface BrowserTaskChangedPayload {
  task: BrowserTaskRun
}

export interface BrowserActionLogChangedPayload {
  log: BrowserActionLog
}

export interface BrowserDownloadRecord {
  id: string
  trigger: 'user' | 'agent'
  retention: 'temporary' | 'kept' | 'discarded'
  taskRunId?: string
  tabId: string
  workspaceKey: string | null
  sourceUrl: string
  suggestedFilename: string
  tempPath?: string
  savedPath?: string
  fileMissing?: boolean
  status: 'pending' | 'downloading' | 'completed' | 'failed' | 'cancelled'
  createdAt: number
  completedAt?: number
  errorMessage?: string
}

export interface BrowserDownloadChangedPayload {
  download: BrowserDownloadRecord
}

export interface BrowserConsoleDiagnosticEntry {
  type: 'log' | 'warn' | 'error' | 'info'
  text: string
  timestamp: number
}

export interface BrowserNetworkDiagnosticEntry {
  method: string
  url: string
  status?: number
  resourceType?: string
  timestamp: number
  failed?: boolean
  errorText?: string
}

export interface BrowserPageDiagnosticSummary {
  tabId: string
  url: string
  title: string
  consoleErrors: BrowserConsoleDiagnosticEntry[]
  networkIssues: BrowserNetworkDiagnosticEntry[]
  suspectedChallenges: string[]
  pageTextSample?: string
}

export type BrowserBindingStatus =
  | 'matched'
  | 'url_mismatch'
  | 'tab_mismatch'
  | 'unclaimed'
  | 'view_missing'

export interface BrowserCookieDiagnosticEntry {
  name: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
  session: boolean
  expiresAt?: number
  likelyAuth: boolean
}

export interface BrowserCookieChangeDiagnosticEntry extends BrowserCookieDiagnosticEntry {
  timestamp: number
  removed: boolean
  cause:
    | 'explicit'
    | 'overwrite'
    | 'expired'
    | 'evicted'
    | 'expired-overwrite'
    | 'inserted'
    | 'inserted-no-change-overwrite'
    | 'inserted-no-value-change-overwrite'
}

export interface BrowserSessionDiagnosticSummary {
  partition: string
  persistent: boolean
  cookieStoreFlushed: boolean
  cookieCount: number
  persistentCookieCount: number
  expiredCookieCount: number
  likelyAuthCookies: BrowserCookieDiagnosticEntry[]
  cookieNames: string[]
  recentCookieChanges: BrowserCookieChangeDiagnosticEntry[]
  errorMessage?: string
}

export interface BrowserSessionDiagnosticRequest {
  url: string
  profileId?: string | null
}

export interface BrowserRuntimeDiagnosticSummary {
  requestedTabId: string
  visibleTabId: string | null
  visibleUrl: string | null
  visibleTitle: string | null
  profileId: string | null
  viewState: BrowserViewState | null
  playwrightTabId: string | null
  playwrightUrl: string | null
  playwrightTitle: string | null
  bindingStatus: BrowserBindingStatus
  engineVersions?: {
    electron: string
    chromium: string
    node: string
  }
  recentUrls: string[]
  lastClaim: {
    status: 'succeeded' | 'failed'
    timestamp: number
    expectedUrl: string
    errorMessage?: string
  } | null
  session: BrowserSessionDiagnosticSummary | null
  page: BrowserPageDiagnosticSummary | null
}

export interface BrowserUrlChangedPayload {
  tabId: string
  url: string
  history?: string[]
  historyIndex?: number
}

export interface BrowserPageMetaChangedPayload {
  tabId: string
  title?: string
  faviconUrl?: string | null
}

export type BrowserViewStateChangedPayload = BrowserViewState & { tabId: string }

export interface BrowserOpenTabRequest {
  initialUrl?: string
  /** 发起浏览器任务的项目；renderer 只能在同一项目内响应。 */
  workspaceKey: string | null
}

export interface BrowserApiContract {
  createView: (tabId: string, initialUrl?: string, opts?: BrowserCreateViewOptions) => Promise<void>
  destroyView: (tabId: string) => Promise<void>
  setActive: (tabId: string | null) => Promise<void>
  reconcileViews: (options: BrowserReconcileViewsOptions) => Promise<void>

  navigate: (tabId: string, url: string) => Promise<void>
  goBack: (tabId: string) => Promise<void>
  goForward: (tabId: string) => Promise<void>
  reload: (tabId: string) => Promise<void>
  capturePage: (tabId: string) => Promise<string | null>
  getCurrentURL: (tabId: string) => Promise<string>
  getActiveViewId: (workspaceKey?: string | null) => Promise<string | null>
  getDiagnostics: (tabId: string) => Promise<BrowserPageDiagnosticSummary | null>
  getRuntimeDiagnostics: (tabId: string) => Promise<BrowserRuntimeDiagnosticSummary>
  getSessionDiagnostics: (
    request: BrowserSessionDiagnosticRequest,
  ) => Promise<BrowserSessionDiagnosticSummary>
  onUrlChanged: (callback: (payload: BrowserUrlChangedPayload) => void) => () => void
  onPageMetaChanged: (callback: (payload: BrowserPageMetaChangedPayload) => void) => () => void
  onRequestOpenTab: (callback: (payload: BrowserOpenTabRequest) => void) => () => void

  zoomIn: (tabId: string) => Promise<void>
  zoomOut: (tabId: string) => Promise<void>
  resetZoom: (tabId: string) => Promise<void>
  setZoom: (tabId: string, factor: number) => Promise<void>
  fitWidth: (tabId: string) => Promise<void>

  setDeviceMode: (tabId: string, mode: BrowserViewModeType) => Promise<void>
  getViewState: () => Promise<BrowserViewState | null>
  onViewStateChanged: (callback: (state: BrowserViewStateChangedPayload) => void) => () => void

  listSnapshots: () => Promise<BrowserInstanceSnapshot[]>
  removeSnapshot: (id: string) => Promise<void>
  clearSnapshots: () => Promise<void>
  listHistory: (limit?: number) => Promise<BrowserHistoryEntry[]>
  clearHistory: () => Promise<void>

  startTask: (tabId: string, goal: string) => Promise<BrowserTaskRun>
  listTasks: () => Promise<BrowserTaskRun[]>
  getTask: (taskRunId: string) => Promise<BrowserTaskRun | null>
  getActiveTaskForTab: (tabId: string) => Promise<BrowserTaskRun | null>
  pauseTask: (taskRunId: string) => Promise<BrowserTaskRun>
  resumeTask: (taskRunId: string) => Promise<BrowserTaskRun>
  cancelTask: (taskRunId: string) => Promise<BrowserTaskRun>
  finishTask: (taskRunId: string) => Promise<BrowserTaskRun>
  listActionLogs: (taskRunId: string) => Promise<BrowserActionLog[]>
  onTaskChanged: (callback: (payload: BrowserTaskChangedPayload) => void) => () => void
  onActionLogChanged: (callback: (payload: BrowserActionLogChangedPayload) => void) => () => void

  listDownloads: () => Promise<BrowserDownloadRecord[]>
  getDownload: (downloadId: string) => Promise<BrowserDownloadRecord | null>
  keepDownloadToWorkspace: (downloadId: string) => Promise<BrowserDownloadRecord>
  saveDownloadAs: (downloadId: string) => Promise<BrowserDownloadRecord | null>
  discardDownload: (downloadId: string) => Promise<BrowserDownloadRecord>
  openDownload: (downloadId: string) => Promise<void>
  revealDownload: (downloadId: string) => Promise<void>
  onDownloadChanged: (callback: (payload: BrowserDownloadChangedPayload) => void) => () => void
}
