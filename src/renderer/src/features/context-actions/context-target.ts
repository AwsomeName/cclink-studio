import type { MarkdownSourceRange } from '../markdown/markdown-codec'

export type ContextTarget =
  | {
      kind: 'file'
      workspaceKey: string | null
      path: string
      name: string
      fileType: 'file' | 'directory'
      extension?: string
      expanded?: boolean
    }
  | {
      kind: 'tab'
      workspaceKey: string | null
      tabId: string
      tabType: string
    }
  | {
      kind: 'project'
      workspaceKey: string
      path: string
    }
  | {
      kind: 'activity'
      activityId: string
    }
  | {
      kind: 'sidebar'
      workspaceKey: string | null
      panelId: string
    }
  | {
      kind: 'status-item'
      workspaceKey: string | null
      itemId: string
    }
  | {
      kind: 'layout'
      workspaceKey: string | null
      area: 'sidebar' | 'agent'
    }
  | {
      kind: 'thread'
      workspaceKey: string | null
      conversationId: string
      activeRunId?: string | null
    }
  | {
      kind: 'message'
      workspaceKey: string | null
      conversationId: string
      messageId: string
    }
  | {
      kind: 'editor'
      workspaceKey: string | null
      tabId: string
      filePath: string
      editorKind: 'markdown' | 'source'
      range: MarkdownSourceRange | null
      dirty: boolean
      linkUrl?: string | null
      imageSrc?: string | null
    }
  | {
      kind: 'terminal'
      workspaceKey: string | null
      tabId: string
      sessionId: string
      selectionText: string
      status: string
    }
  | {
      kind: 'data-source'
      workspaceKey: string | null
      sourceId: string
      sourceName: string
    }
  | {
      kind: 'data-collection'
      workspaceKey: string | null
      sourceId: string
      collection: string
    }
  | {
      kind: 'saved-query'
      workspaceKey: string | null
      sourceId: string
      queryId: string
      queryName: string
      collection: string
    }
  | {
      kind: 'data-record'
      workspaceKey: string | null
      tabId: string
      sourceId: string
      collection: string
      recordId: string
    }
  | {
      kind: 'operations-platform'
      workspaceKey: string
      workspacePath: string
      platformId: string
      platformName: string
    }
  | {
      kind: 'production'
      workspaceKey: string
      workspacePath: string
    }
  | {
      kind: 'android'
      workspaceKey: string | null
      tabId: string
      available: boolean
      connected: boolean
      unavailableReason?: string
    }
  | {
      kind: 'setting'
      settingKey: string
      label: string
      modified: boolean
    }
  | {
      kind: 'conversation-selection'
      text: string
    }
  | {
      kind: 'markdown-selection'
      workspaceKey: string | null
      tabId: string
      filePath: string
      range: MarkdownSourceRange
      dirty: boolean
    }

export type ContextTargetKind = ContextTarget['kind']

export const CONTEXT_TARGET_KINDS = [
  'file',
  'tab',
  'project',
  'activity',
  'sidebar',
  'status-item',
  'layout',
  'thread',
  'message',
  'editor',
  'terminal',
  'data-source',
  'data-collection',
  'saved-query',
  'data-record',
  'operations-platform',
  'production',
  'android',
  'setting',
  'conversation-selection',
  'markdown-selection',
] as const satisfies readonly ContextTargetKind[]

type MissingContextTargetKind = Exclude<ContextTargetKind, (typeof CONTEXT_TARGET_KINDS)[number]>
const allContextTargetKindsAreInventoried: MissingContextTargetKind extends never ? true : never =
  true
void allContextTargetKindsAreInventoried

export type CommandSource = 'palette' | 'shortcut' | 'toolbar' | 'context-menu'

export interface CommandContext {
  source: CommandSource
  target?: ContextTarget
  inputValue?: string
}

export function targetMatchesWorkspace(
  target: ContextTarget,
  workspaceKey: string | null,
): boolean {
  if (target.kind === 'project') return true
  if (!('workspaceKey' in target)) return true
  return target.workspaceKey === workspaceKey
}
