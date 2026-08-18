import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAgentStore } from '../../../stores/agent-store'
import { useFsStore } from '../../../stores/fs-store'
import { useTabStore } from '../../../stores/tab-store'
import { resolveMenuContributions } from '../menu-contribution-registry'
import { createFileContextCommands } from './file-context-actions'
import {
  createTabContextCommands,
  renameWorkbenchTab,
  tabMenuContributions,
} from './tab-context-actions'

beforeEach(() => {
  vi.unstubAllGlobals()
  useTabStore.setState(useTabStore.getInitialState(), true)
  useAgentStore.setState(useAgentStore.getInitialState(), true)
  useFsStore.setState(useFsStore.getInitialState(), true)
})

describe('renameWorkbenchTab', () => {
  it('renames browser tabs', async () => {
    useTabStore.getState().openTab({
      type: 'browser',
      title: '浏览器',
      icon: '🌐',
      forceNew: true,
    })
    const tab = useTabStore.getState().tabs[0]

    await expect(renameWorkbenchTab(tab.id, '  知乎工作台  ')).resolves.toBe(true)
    expect(useTabStore.getState().tabs[0].title).toBe('知乎工作台')
  })

  it('keeps the current title when the new title is empty or cancelled', async () => {
    useTabStore.getState().openTab({
      type: 'settings',
      title: '设置',
      icon: '⚙️',
    })
    const tab = useTabStore.getState().tabs[0]

    await expect(renameWorkbenchTab(tab.id, '   ')).resolves.toBe(false)
    await expect(renameWorkbenchTab(tab.id, null)).resolves.toBe(false)
    expect(useTabStore.getState().tabs[0].title).toBe('设置')
  })

  it('keeps conversation tabs and their backing conversations in sync', async () => {
    const conversationId = useAgentStore.getState().createConversation({
      surface: 'workbench-tab',
      activate: false,
    })
    useTabStore.getState().openTab({
      type: 'conversation',
      title: '新工作会话',
      icon: '🤖',
      conversation: {
        surface: 'workbench-tab',
        runtime: useAgentStore.getState().conversations[conversationId].runtime,
        sessionId: conversationId,
      },
    })
    const tab = useTabStore.getState().tabs[0]

    await expect(renameWorkbenchTab(tab.id, '设计复盘')).resolves.toBe(true)
    expect(useTabStore.getState().tabs[0].title).toBe('设计复盘')
    expect(useAgentStore.getState().conversations[conversationId].title).toBe('设计复盘')
  })

  it('delegates file-backed tabs to the file rename operation', async () => {
    const confirmRename = vi.fn().mockResolvedValue(true)
    useFsStore.setState({ confirmRename })
    useTabStore.getState().openTab({
      type: 'editor',
      title: '旧名称.md',
      icon: '📄',
      filePath: '/project/旧名称.md',
    })
    const tab = useTabStore.getState().tabs[0]

    await expect(renameWorkbenchTab(tab.id, '新名称.md')).resolves.toBe(true)
    expect(confirmRename).toHaveBeenCalledWith('/project/旧名称.md', '新名称.md')
    expect(useTabStore.getState().tabs[0].title).toBe('旧名称.md')
  })

  it('reports file rename failures without changing the tab title', async () => {
    const confirmRename = vi.fn().mockResolvedValue(false)
    useFsStore.setState({ confirmRename, operationError: '重命名失败: 目标文件已存在' })
    useTabStore.getState().openTab({
      type: 'editor',
      title: '旧名称.md',
      icon: '📄',
      filePath: '/project/旧名称.md',
    })
    const tab = useTabStore.getState().tabs[0]
    const command = createTabContextCommands().find((item) => item.id === 'workbench.renameTab')!

    await expect(
      command.action({
        source: 'context-menu',
        target: {
          kind: 'tab',
          workspaceKey: null,
          tabId: tab.id,
          tabType: 'editor',
        },
        inputValue: '新名称.md',
      }),
    ).rejects.toThrow('目标文件已存在')
    expect(useTabStore.getState().tabs[0].title).toBe('旧名称.md')
  })
})

describe('tab management context commands', () => {
  function openBrowserTabs(...titles: string[]): string[] {
    for (const title of titles) {
      useTabStore.getState().openTab({ type: 'browser', title, icon: '🌐', forceNew: true })
    }
    return useTabStore.getState().tabs.map((tab) => tab.id)
  }

  it('closes only tabs to the right of the target', async () => {
    const [first, second] = openBrowserTabs('一', '二', '三')
    const command = createTabContextCommands().find(
      (item) => item.id === 'workbench.closeTabsToRight',
    )!

    await command.action({
      source: 'context-menu',
      target: { kind: 'tab', workspaceKey: null, tabId: second, tabType: 'browser' },
    })

    expect(useTabStore.getState().tabs.map((tab) => tab.id)).toEqual([first, second])
  })

  it('keeps the target while closing every other tab', async () => {
    const [, second] = openBrowserTabs('一', '二', '三')
    const command = createTabContextCommands().find(
      (item) => item.id === 'workbench.closeOtherTabs',
    )!

    await command.action({
      source: 'context-menu',
      target: { kind: 'tab', workspaceKey: null, tabId: second, tabType: 'browser' },
    })

    expect(useTabStore.getState().tabs.map((tab) => tab.id)).toEqual([second])
  })
})

describe('file-backed tab path context commands', () => {
  it('copies the absolute and workspace-relative file paths through the shared file commands', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    useFsStore.setState({ workspacePath: '/project' })
    useTabStore.getState().openTab({
      type: 'editor',
      title: 'note.md',
      icon: '📄',
      filePath: '/project/docs/note.md',
      workspaceRef: { kind: 'local', path: '/project' },
    })
    const tab = useTabStore.getState().tabs[0]
    const context = {
      source: 'context-menu' as const,
      target: {
        kind: 'tab' as const,
        workspaceKey: '/project',
        tabId: tab.id,
        tabType: tab.type,
      },
    }
    const commands = createFileContextCommands()

    await commands.find((item) => item.id === 'fileTree.copyAbsolutePath')!.action(context)
    await commands.find((item) => item.id === 'fileTree.copyRelativePath')!.action(context)

    expect(writeText).toHaveBeenNthCalledWith(1, '/project/docs/note.md')
    expect(writeText).toHaveBeenNthCalledWith(2, 'docs/note.md')
  })

  it('shows path actions only for local file-backed tabs', () => {
    useTabStore.getState().openTab({
      type: 'editor',
      title: 'note.md',
      icon: '📄',
      filePath: '/project/note.md',
      workspaceRef: { kind: 'local', path: '/project' },
    })
    useTabStore.getState().openTab({
      type: 'remote-file',
      title: 'remote.md',
      icon: '📄',
      filePath: '/remote.md',
      workspaceRef: {
        kind: 'remote',
        transport: 'cclink',
        endpointId: 'endpoint-1',
        workspaceId: 'workspace-1',
        path: '/remote',
      },
      remoteFile: {
        serverId: 'endpoint-1',
        workspaceId: 'workspace-1',
        workspacePath: '/remote',
        path: '/remote.md',
      },
    })
    const [localTab, remoteTab] = useTabStore.getState().tabs
    const contributionIds = (tabId: string, workspaceKey: string) =>
      resolveMenuContributions(tabMenuContributions, {
        source: 'context-menu',
        target: { kind: 'tab', workspaceKey, tabId, tabType: 'editor' },
      }).map((item) => item.id)

    expect(contributionIds(localTab.id, '/project')).toEqual(
      expect.arrayContaining(['tab.copy-absolute-path', 'tab.copy-relative-path']),
    )
    expect(contributionIds(remoteTab.id, 'cclink://endpoint-1/workspace-1')).not.toEqual(
      expect.arrayContaining(['tab.copy-absolute-path', 'tab.copy-relative-path']),
    )
  })
})
