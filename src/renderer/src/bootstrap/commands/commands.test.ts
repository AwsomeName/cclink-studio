import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/settings-constants'
import type { Command } from '../../stores/command-store'
import { createAgentCommands } from './agent-commands'
import { createBrowserCommands } from './browser-commands'
import { createDiagnosticsCommands } from './diagnostics-commands'
import { createFileCommands } from './file-commands'
import { createSettingsCommands } from './settings-commands'
import { createTabCommands } from './tab-commands'
import { createViewCommands } from './view-commands'
import { createWindowCommands } from './window-commands'
import { createWorkbenchCommands } from './workbench-commands'
import { createMarkdownCommands } from './markdown-commands'
import { createWorkspaceCommands } from './workspace-commands'
import { useSettingsStore } from '../../stores/settings-store'
import { useAgentStore } from '../../stores/agent-store'
import { useCclinkStore } from '../../stores/cclink-store'
import { useUIStore } from '../../stores/ui-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { localWorkspaceRef, remoteWorkspaceRef } from '@shared/workspace-ref'
import { useWorkspaceOpenStore } from '../../features/workspace-open/workspace-open-store'

function createAllCommands(): Command[] {
  return [
    ...createViewCommands({
      toggleSidebar: () => undefined,
      toggleAgentPanel: () => undefined,
      focusAgentPanel: () => undefined,
      resetAgentLayout: () => undefined,
    }),
    ...createTabCommands(),
    ...createFileCommands(),
    ...createSettingsCommands(),
    ...createAgentCommands(),
    ...createBrowserCommands(),
    ...createDiagnosticsCommands(),
    ...createWindowCommands(),
    ...createWorkbenchCommands(),
    ...createMarkdownCommands(),
    ...createWorkspaceCommands(),
  ]
}

describe('bootstrap command modules', () => {
  it('注册命令 ID 不重复', () => {
    const ids = createAllCommands().map((command) => command.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('保留核心工作台命令', () => {
    const ids = new Set(createAllCommands().map((command) => command.id))
    expect(ids).toContain('workbench.newTab')
    expect(ids).toContain('browser.newTab')
    expect(ids).toContain('workbench.closeTab')
    expect(ids).toContain('workbench.focusAgentPanel')
    expect(ids).toContain('agent.newConversation')
    expect(ids).toContain('agent.resetSession')
    expect(ids).toContain('diagnostics.copyWorkspaceState')
    expect(ids).toContain('diagnostics.copyFrameworkLogs')
    expect(ids).toContain('window.reload')
    expect(ids).toContain('workbench.find')
    expect(ids).toContain('workbench.save')
    expect(ids).toContain('markdown.bold')
    expect(ids).toContain('workspace.open')
  })

  it('可配置命令的声明和实际路由只使用 shortcutPolicy', () => {
    const configurable = createAllCommands().filter((command) => command.configurable)
    expect(configurable.length).toBeGreaterThan(0)
    expect(configurable.every((command) => Boolean(command.shortcutPolicy))).toBe(true)
    expect(configurable.every((command) => command.shortcut === undefined)).toBe(true)
  })

  it('通过唯一 workspace.open 命令打开统一入口', async () => {
    useWorkspaceOpenStore.getState().close()

    await createWorkspaceCommands()
      .find((command) => command.id === 'workspace.open')
      ?.action({ source: 'toolbar' })

    expect(useWorkspaceOpenStore.getState()).toMatchObject({ open: true, step: 'sources' })
    useWorkspaceOpenStore.getState().close()
  })

  it('新建 Agent 会话绑定当前工作空间并打开右侧输入框', async () => {
    const workspaceRef = localWorkspaceRef('/workspace/current')
    const createConversation = vi.fn(() => 'conversation-new')
    const setAgentPanelMode = vi.fn()
    const resetSession = vi.fn()
    const dispatchEvent = vi.fn()

    vi.spyOn(useWorkspaceStore, 'getState').mockReturnValue({
      activeWorkspaceRef: workspaceRef,
    } as ReturnType<typeof useWorkspaceStore.getState>)
    vi.spyOn(useAgentStore, 'getState').mockReturnValue({
      createConversation,
    } as unknown as ReturnType<typeof useAgentStore.getState>)
    vi.spyOn(useUIStore, 'getState').mockReturnValue({ setAgentPanelMode } as unknown as ReturnType<
      typeof useUIStore.getState
    >)
    vi.stubGlobal('window', {
      cclinkStudio: { agent: { resetSession } },
      dispatchEvent,
    })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })

    try {
      await createAgentCommands()
        .find((command) => command.id === 'agent.newConversation')
        ?.action({ source: 'toolbar' })

      expect(createConversation).toHaveBeenCalledWith({
        runtime: {
          location: 'local',
          transport: 'local',
          backend: 'cclink-studio-agent',
          workspaceRef,
        },
        activate: true,
      })
      expect(setAgentPanelMode).toHaveBeenCalledWith('right', 'user')
      expect(resetSession).toHaveBeenCalledWith('conversation-new')
      expect(dispatchEvent).toHaveBeenCalledOnce()
    } finally {
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
    }
  })

  it('在远程工作空间把同一新建命令路由到远程会话 owner', async () => {
    const workspaceRef = remoteWorkspaceRef({
      endpointId: 'agent-1',
      workspaceId: 'workspace-1',
      path: '/srv/project',
      label: 'project',
    })
    const createSession = vi.fn(async () => ({ id: 'remote-session' }))
    const setAgentPanelMode = vi.fn()

    vi.spyOn(useWorkspaceStore, 'getState').mockReturnValue({
      activeWorkspaceRef: workspaceRef,
    } as ReturnType<typeof useWorkspaceStore.getState>)
    vi.spyOn(useCclinkStore, 'getState').mockReturnValue({
      createSession,
    } as unknown as ReturnType<typeof useCclinkStore.getState>)
    vi.spyOn(useUIStore, 'getState').mockReturnValue({ setAgentPanelMode } as unknown as ReturnType<
      typeof useUIStore.getState
    >)

    try {
      await createAgentCommands()
        .find((command) => command.id === 'agent.newConversation')
        ?.action({ source: 'toolbar' })

      expect(createSession).toHaveBeenCalledWith(workspaceRef, '会话 · project')
      expect(setAgentPanelMode).toHaveBeenCalledWith('right', 'user')
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('routes application zoom commands through the persisted settings owner', async () => {
    const original = useSettingsStore.getState()
    const updateSettings = vi.fn(async () => true)
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, appZoomLevel: 0 },
      updateSettings,
      error: null,
    })

    try {
      const commands = createViewCommands({
        toggleSidebar: () => undefined,
        toggleAgentPanel: () => undefined,
        focusAgentPanel: () => undefined,
        resetAgentLayout: () => undefined,
      })
      await commands.find((command) => command.id === 'view.zoomOut')?.action()
      await commands.find((command) => command.id === 'view.zoomReset')?.action()

      expect(updateSettings).toHaveBeenNthCalledWith(1, { appZoomLevel: -0.5 })
      expect(updateSettings).toHaveBeenNthCalledWith(2, { appZoomLevel: 0 })
    } finally {
      useSettingsStore.setState({
        settings: original.settings,
        updateSettings: original.updateSettings,
        error: original.error,
      })
    }
  })
})
