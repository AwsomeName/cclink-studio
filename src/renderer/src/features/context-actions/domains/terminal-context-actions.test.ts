import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalStatus, TerminalTabRef } from '@shared/terminal'
import { remoteWorkspaceRef, workspaceRefKey } from '@shared/workspace-ref'
import type { Tab } from '../../../types'
import { useCclinkStore } from '../../../stores/cclink-store'
import { useTabStore } from '../../../stores/tab-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { registerTerminalContextSurface } from '../terminal-context-surface'
import {
  appendRemoteTerminalSelectionDraft,
  createTerminalContextCommands,
} from './terminal-context-actions'

const runtime: TerminalTabRef['runtime'] = {
  location: 'local',
  transport: 'local',
  backend: 'local-shell',
  workspaceRef: { kind: 'local', path: '/workspace' },
  cwd: '/workspace',
}

function terminal(status: TerminalStatus): TerminalTabRef {
  return {
    runtime,
    permissionPolicy: {
      mode: 'ask-risky-command',
      requireConfirmationFor: ['write', 'destructive', 'privileged', 'unknown'],
    },
    status,
    closePolicy: 'terminate-process',
    sessionId: 'terminal-session-old',
    auditLogId: 'terminal-audit-old',
    processId: status === 'running' ? 1234 : undefined,
  }
}

function setTerminalTab(status: TerminalStatus, terminalRuntime = runtime): void {
  const currentTerminal = { ...terminal(status), runtime: terminalRuntime }
  const tab: Tab = {
    id: 'terminal-tab',
    type: 'terminal',
    title: 'Terminal · workspace',
    icon: '⌨️',
    terminal: currentTerminal,
    terminalRecord: {
      sessionId: currentTerminal.sessionId!,
      runtime: terminalRuntime,
      status,
      createdAt: 1,
      updatedAt: 2,
      outputBuffer: [{ id: 'old-output', kind: 'stdout', text: 'old\n', timestamp: 2 }],
    },
  }
  useTabStore.setState({ tabs: [tab], activeTabId: tab.id })
}

function target(status: TerminalStatus, workspaceKey = '/workspace', selectionText = '') {
  return {
    kind: 'terminal' as const,
    workspaceKey,
    tabId: 'terminal-tab',
    sessionId: 'terminal-session-old',
    selectionText,
    status,
  }
}

let unregisterTerminalSurface = (): void => undefined

function restartCommand() {
  return createTerminalContextCommands().find((command) => command.id === 'terminal.restart')!
}

beforeEach(() => {
  vi.restoreAllMocks()
  useCclinkStore.setState(useCclinkStore.getInitialState(), true)
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0)
    return 1
  })
  vi.stubGlobal('window', {
    dispatchEvent: vi.fn(),
    cclinkStudio: {
      dialog: {
        showMessageBox: vi.fn().mockResolvedValue({ response: 1 }),
      },
      terminal: {
        terminatePty: vi.fn().mockResolvedValue({ success: true }),
        recordLifecycleEvent: vi.fn().mockResolvedValue({ success: true }),
      },
    },
  })
})

afterEach(() => {
  unregisterTerminalSurface()
  unregisterTerminalSurface = () => undefined
  vi.unstubAllGlobals()
})

describe('terminal restart command', () => {
  it.each(['exited', 'error'] as const)(
    'restarts a final %s session with a new identity and without terminating it again',
    async (status) => {
      setTerminalTab(status)

      await restartCommand().action({ source: 'toolbar', target: target(status) })

      const restartedTab = useTabStore.getState().tabs[0]
      expect(window.cclinkStudio.dialog.showMessageBox).not.toHaveBeenCalled()
      expect(window.cclinkStudio.terminal.terminatePty).not.toHaveBeenCalled()
      expect(restartedTab.terminal).toMatchObject({
        runtime,
        status: 'idle',
        processId: undefined,
      })
      expect(restartedTab.terminal?.sessionId).not.toBe('terminal-session-old')
      expect(restartedTab.terminal?.auditLogId).not.toBe('terminal-audit-old')
      expect(restartedTab.terminalRecord).toBeUndefined()
      expect(window.cclinkStudio.terminal.recordLifecycleEvent).toHaveBeenCalledTimes(1)
      expect(window.cclinkStudio.terminal.recordLifecycleEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          terminalSessionId: restartedTab.terminal?.sessionId,
          kind: 'created',
          message: '由工具栏重新启动',
        }),
      )
    },
  )

  it('confirms and terminates a running session before creating the replacement', async () => {
    setTerminalTab('running')

    await restartCommand().action({ source: 'context-menu', target: target('running') })

    const restartedTab = useTabStore.getState().tabs[0]
    expect(window.cclinkStudio.dialog.showMessageBox).toHaveBeenCalledOnce()
    expect(window.cclinkStudio.terminal.terminatePty).toHaveBeenCalledWith('terminal-session-old')
    expect(restartedTab.terminal?.sessionId).not.toBe('terminal-session-old')
    expect(window.cclinkStudio.terminal.recordLifecycleEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        terminalSessionId: 'terminal-session-old',
        kind: 'terminated',
        message: '由上下文菜单重启',
      }),
    )
    expect(window.cclinkStudio.terminal.recordLifecycleEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        terminalSessionId: restartedTab.terminal?.sessionId,
        kind: 'created',
        message: '由上下文菜单重新启动',
      }),
    )
  })

  it('keeps the current session when termination fails', async () => {
    setTerminalTab('running')
    vi.mocked(window.cclinkStudio.terminal.terminatePty).mockResolvedValueOnce({
      success: false,
      error: 'close failed',
    })

    await expect(
      restartCommand().action({ source: 'context-menu', target: target('running') }),
    ).rejects.toThrow('close failed')

    expect(useTabStore.getState().tabs[0].terminal?.sessionId).toBe('terminal-session-old')
    expect(window.cclinkStudio.terminal.recordLifecycleEvent).not.toHaveBeenCalled()
  })

  it('disables restart while the terminal is still initializing', () => {
    expect(
      restartCommand().enabled?.({ source: 'context-menu', target: target('starting') }),
    ).toEqual({
      enabled: false,
      reason: 'Terminal 正在启动',
    })
  })
})

describe('terminal selection to remote Agent', () => {
  const remoteRef = remoteWorkspaceRef({
    endpointId: 'agent-1',
    workspaceId: 'workspace-1',
    path: '/workspace',
  })
  const remoteRuntime: TerminalTabRef['runtime'] = {
    location: 'remote',
    transport: 'cclink',
    backend: 'remote-shell',
    workspaceRef: remoteRef,
    endpointId: remoteRef.endpointId,
    cwd: remoteRef.path,
  }

  it('adds the selected remote Terminal output to the current remote Agent draft', () => {
    const selectionText = 'Active: active (running)\nMain PID: 774295'
    const workspaceKey = workspaceRefKey(remoteRef)!
    setTerminalTab('running', remoteRuntime)
    useWorkspaceStore.setState({ activeWorkspaceRef: remoteRef, generation: 1 })
    unregisterTerminalSurface = registerTerminalContextSurface('terminal-session-old', {
      getSelectionText: () => selectionText,
      copy: vi.fn(),
      paste: vi.fn(),
      clear: vi.fn(),
      openFind: vi.fn(),
      closeFind: vi.fn(),
    })

    const command = createTerminalContextCommands().find(
      (item) => item.id === 'terminal.sendSelectionToAgent',
    )!
    command.action({
      source: 'context-menu',
      target: target('running', workspaceKey, selectionText),
    })

    expect(useCclinkStore.getState().remoteAgentDrafts[workspaceKey]).toContain(selectionText)
    expect(window.dispatchEvent).toHaveBeenCalledOnce()
  })

  it('fails closed when the visible remote Agent belongs to another workspace', () => {
    const selectionText = 'do not cross workspaces'
    const workspaceKey = workspaceRefKey(remoteRef)!
    setTerminalTab('running', remoteRuntime)
    useWorkspaceStore.setState({
      activeWorkspaceRef: remoteWorkspaceRef({
        endpointId: 'agent-1',
        workspaceId: 'workspace-2',
        path: '/other',
      }),
      generation: 2,
    })
    unregisterTerminalSurface = registerTerminalContextSurface('terminal-session-old', {
      getSelectionText: () => selectionText,
      copy: vi.fn(),
      paste: vi.fn(),
      clear: vi.fn(),
      openFind: vi.fn(),
      closeFind: vi.fn(),
    })
    const command = createTerminalContextCommands().find(
      (item) => item.id === 'terminal.sendSelectionToAgent',
    )!

    expect(() =>
      command.action({
        source: 'context-menu',
        target: target('running', workspaceKey, selectionText),
      }),
    ).toThrow('当前远程 Agent 已切换到其他项目')
    expect(useCclinkStore.getState().remoteAgentDrafts).toEqual({})
  })

  it('rejects a selection that would exceed the remote message byte limit', () => {
    expect(() => appendRemoteTerminalSelectionDraft('', '错'.repeat(3_000))).toThrow(
      '超过远程消息 8 KiB 限制',
    )
  })
})
