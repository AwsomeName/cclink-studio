import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalStatus, TerminalTabRef } from '@shared/terminal'
import type { Tab } from '../../../types'
import { useTabStore } from '../../../stores/tab-store'
import { createTerminalContextCommands } from './terminal-context-actions'

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

function setTerminalTab(status: TerminalStatus): void {
  const currentTerminal = terminal(status)
  const tab: Tab = {
    id: 'terminal-tab',
    type: 'terminal',
    title: 'Terminal · workspace',
    icon: '⌨️',
    terminal: currentTerminal,
    terminalRecord: {
      sessionId: currentTerminal.sessionId!,
      runtime,
      status,
      createdAt: 1,
      updatedAt: 2,
      outputBuffer: [{ id: 'old-output', kind: 'stdout', text: 'old\n', timestamp: 2 }],
    },
  }
  useTabStore.setState({ tabs: [tab], activeTabId: tab.id })
}

function target(status: TerminalStatus) {
  return {
    kind: 'terminal' as const,
    workspaceKey: '/workspace',
    tabId: 'terminal-tab',
    sessionId: 'terminal-session-old',
    selectionText: '',
    status,
  }
}

function restartCommand() {
  return createTerminalContextCommands().find((command) => command.id === 'terminal.restart')!
}

describe('terminal restart command', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubGlobal('window', {
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
