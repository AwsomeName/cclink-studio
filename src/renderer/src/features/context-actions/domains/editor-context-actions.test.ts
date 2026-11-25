import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { localWorkspaceRef, workspaceRefKey } from '@shared/workspace-ref'
import { useAgentStore } from '../../../stores/agent-store'
import { useTabStore } from '../../../stores/tab-store'
import type { CommandContext } from '../context-target'
import { registerEditorContextSurface, type EditorContextSurface } from '../editor-context-surface'
import { createEditorContextCommands } from './editor-context-actions'

const EMBEDDED_ID = 'today:/diary/1125_周三.md'
const SELECTED = '统一账号'

function command(id: string) {
  const found = createEditorContextCommands().find((item) => item.id === id)
  if (!found) throw new Error(`missing ${id}`)
  return found
}

function surface(): EditorContextSurface {
  return {
    getSelectionText: () => SELECTED,
    cut: vi.fn(),
    copy: vi.fn(),
    paste: vi.fn(),
    selectAll: vi.fn(),
    openFind: vi.fn(),
    closeFind: vi.fn(),
  }
}

function selectionContext(tabId: string): CommandContext {
  const conversation =
    useAgentStore.getState().conversations[useAgentStore.getState().activeConversationId]
  const workspaceRef = conversation?.runtime.workspaceRef
  return {
    source: 'toolbar',
    target: {
      kind: 'markdown-selection',
      workspaceKey: workspaceRef ? workspaceRefKey(workspaceRef) : '',
      tabId,
      filePath: '/diary/1125_周三.md',
      range: {
        startLine: 142,
        endLine: 142,
        startColumn: 1,
        endColumn: 5,
        selectedText: SELECTED,
        sourceSnapshot: `**${SELECTED}**`,
      },
      dirty: false,
    },
  } as CommandContext
}

function openHome(): void {
  useTabStore.getState().openTab({ type: 'workspace-home', title: '我的空间', icon: '⌂' })
}

let unregister: (() => void) | null = null

beforeEach(() => {
  useTabStore.setState(useTabStore.getInitialState(), true)
  useAgentStore.setState(useAgentStore.getInitialState(), true)
  const { activeConversationId, conversations } = useAgentStore.getState()
  const active = conversations[activeConversationId]
  useAgentStore.setState({
    conversations: {
      ...conversations,
      [activeConversationId]: {
        ...active,
        runtime: { ...active.runtime, workspaceRef: localWorkspaceRef('/diary') },
      },
    },
  })
  vi.stubGlobal('requestAnimationFrame', () => 0)
})

afterEach(() => {
  unregister?.()
  unregister = null
  vi.unstubAllGlobals()
})

describe('editor context commands on page-embedded editors', () => {
  it('copies from an editor embedded in the active home page', async () => {
    openHome()
    const embedded = surface()
    unregister = registerEditorContextSurface(EMBEDDED_ID, embedded, { embedded: true })

    await command('editor.copy').action(selectionContext(EMBEDDED_ID))
    expect(embedded.copy).toHaveBeenCalledTimes(1)
  })

  it('mounts the selection of an embedded editor on the active conversation', async () => {
    openHome()
    unregister = registerEditorContextSurface(EMBEDDED_ID, surface(), { embedded: true })

    await command('markdown.sendSelectionToConversation').action(selectionContext(EMBEDDED_ID))

    const state = useAgentStore.getState()
    const mounted = state.conversations[state.activeConversationId]?.mountedResources ?? []
    expect(mounted).toHaveLength(1)
    expect(mounted[0]).toMatchObject({
      kind: 'file-range',
      label: '1125_周三.md:L142-L142',
      ref: { tabId: EMBEDDED_ID, startLine: 142, endLine: 142, selectedText: SELECTED },
    })
  })

  it('rejects an embedded editor once the home page is no longer the active tab', async () => {
    openHome()
    useTabStore.getState().openTab({
      type: 'agent-role',
      title: '角色配置',
      icon: '◇',
      agentRole: { roleId: 'fact-checker', version: 1 },
    })
    unregister = registerEditorContextSurface(EMBEDDED_ID, surface(), { embedded: true })

    await expect(
      Promise.resolve().then(() => command('editor.copy').action(selectionContext(EMBEDDED_ID))),
    ).rejects.toThrow('编辑器 Tab 已切换')
  })

  it('still rejects a real editor tab that is not active', async () => {
    useTabStore.getState().openTab({
      type: 'editor',
      title: 'a.md',
      icon: '📝',
      filePath: '/a.md',
      forceNew: true,
    })
    const editorTabId = useTabStore.getState().tabs[0].id
    useTabStore.getState().openTab({
      type: 'agent-role',
      title: '角色配置',
      icon: '◇',
      agentRole: { roleId: 'fact-checker', version: 1 },
    })
    unregister = registerEditorContextSurface(editorTabId, surface())

    await expect(
      Promise.resolve().then(() => command('editor.copy').action(selectionContext(editorTabId))),
    ).rejects.toThrow('编辑器 Tab 已切换')
  })
})

describe('Markdown table context commands', () => {
  function editorContext(table: { headerRow: boolean } | null): CommandContext {
    return {
      source: 'context-menu',
      target: {
        kind: 'editor',
        workspaceKey: null,
        tabId: EMBEDDED_ID,
        filePath: '/diary/1125_周三.md',
        editorKind: 'markdown',
        range: null,
        dirty: false,
        table,
      },
    } as CommandContext
  }

  it('shows table commands only inside a table', () => {
    const deleteRow = command('markdown.table.deleteRow')
    expect(deleteRow.visible?.(editorContext(null))).toBe(false)
    expect(deleteRow.visible?.(editorContext({ headerRow: false }))).toBe(true)
  })

  it('disables deleting the header row but not the whole table', () => {
    expect(
      command('markdown.table.deleteRow').enabled?.(editorContext({ headerRow: true })),
    ).toEqual({
      enabled: false,
      reason: '表头行不能单独删除，可删除整个表格',
    })
    expect(command('markdown.table.delete').enabled).toBeUndefined()
  })

  it('runs the table action on the embedded editor surface', async () => {
    openHome()
    const runMarkdownAction = vi.fn(() => true)
    unregister = registerEditorContextSurface(
      EMBEDDED_ID,
      { ...surface(), getSelectionText: () => '', runMarkdownAction },
      { embedded: true },
    )
    await command('markdown.table.deleteRow').action(editorContext({ headerRow: false }))
    expect(runMarkdownAction).toHaveBeenCalledWith('table-delete-row')
  })
})
