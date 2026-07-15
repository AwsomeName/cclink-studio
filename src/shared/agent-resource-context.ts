import type { AgentScope } from './agent-protocol'
import type { BrowserPageDiagnosticSummary, BrowserViewState } from './ipc/browser'
import type { PermissionMode } from './settings-constants'
import type { WorkspaceRef } from './workspace-ref'

export type AgentTaskIntentKind =
  | 'browser_login'
  | 'browser_navigation'
  | 'browser_search'
  | 'browser_publish'
  | 'document_edit'
  | 'android_operation'
  | 'general'

export interface AgentTaskIntentSnapshot {
  kind: AgentTaskIntentKind
  confidence: 'low' | 'medium' | 'high'
  targetSite?: string
  expectedHosts?: string[]
  preferredUrl?: string
  reason: string
}

export interface AgentBrowserResourceSnapshot {
  tabId: string
  isVisible: boolean
  url: string | null
  host: string | null
  title: string | null
  profile: string
  viewState: BrowserViewState | null
  suspectedChallenges: string[]
  consoleIssueCount: number
  networkIssueCount: number
}

export interface AgentWorkspaceResourceSnapshot {
  ref: WorkspaceRef
  key: string | null
  rootPath: string | null
  writable: boolean
}

export interface AgentConfigResourceSnapshot {
  permissionMode: PermissionMode
  agentEngine: string
  defaultBrowserViewMode: string
  defaultBrowserZoomMode: string
}

export interface AgentResourceContextSnapshot {
  version: 1
  generatedAt: number
  scope: AgentScope
  activeBrowser: AgentBrowserResourceSnapshot | null
  workspace: AgentWorkspaceResourceSnapshot
  config: AgentConfigResourceSnapshot
  task: AgentTaskIntentSnapshot
  mountedResourceIds: string[]
  notes: string[]
}

export function browserDiagnosticToResource(
  input: {
    tabId: string
    visibleTabId: string | null
    profile?: string | null
    viewState: BrowserViewState | null
    diagnostics: BrowserPageDiagnosticSummary | null
  },
): AgentBrowserResourceSnapshot {
  const url = input.diagnostics?.url ?? null
  return {
    tabId: input.tabId,
    isVisible: input.visibleTabId === input.tabId,
    url,
    host: safeHost(url),
    title: input.diagnostics?.title || null,
    profile: input.profile || 'default',
    viewState: input.viewState,
    suspectedChallenges: input.diagnostics?.suspectedChallenges ?? [],
    consoleIssueCount: input.diagnostics?.consoleErrors.length ?? 0,
    networkIssueCount: input.diagnostics?.networkIssues.length ?? 0,
  }
}

function safeHost(url: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).host
  } catch {
    return null
  }
}
