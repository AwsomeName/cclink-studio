import { beforeEach, describe, expect, it } from 'vitest'
import type { TerminalCommandConfirmationRequest } from '../types'
import { useTerminalStore } from './terminal-store'

function createRequest(id: string, command = 'rm -rf dist'): TerminalCommandConfirmationRequest {
  return {
    id,
    createdAt: 1_000,
    expiresAt: 61_000,
    terminalSessionId: 'terminal-1',
    workspaceKey: '/Users/apple/Desktop/CCLink Studio',
    command,
    actor: 'agent',
    risk: 'destructive',
    reason: '命令风险需要确认',
    cwd: '/Users/apple/Desktop/CCLink Studio',
    runtime: {
      location: 'local',
      transport: 'local',
      backend: 'local-shell',
      workspaceRef: {
        kind: 'local',
        path: '/Users/apple/Desktop/CCLink Studio',
      },
    },
  }
}

beforeEach(() => {
  useTerminalStore.getState().clearPendingConfirmations()
  useTerminalStore.getState().clearOutput('terminal-1')
})

describe('useTerminalStore', () => {
  it('projects execution events without resurrecting cleared sessions from a cache', () => {
    const store = useTerminalStore.getState()
    const snapshot = {
      sessionId: 'code',
      runtime: createRequest('test').runtime,
      status: 'idle' as const,
      createdAt: 1,
      updatedAt: 1,
      codeBlockSource: { conversationId: 'chat', messageId: 'message', contentIndex: 0, line: 0 },
    }
    store.mergeSessions([snapshot])
    store.appendExecutionEvent({ kind: 'started', sessionId: 'code', processId: 42, timestamp: 3 })
    store.mergeSessions([snapshot])
    expect(useTerminalStore.getState().sessions[0]).toMatchObject({
      status: 'running',
      processId: 42,
    })
    store.mergeSessions([])
    expect(useTerminalStore.getState().sessions).toEqual([])
  })
  it('adds and removes terminal confirmation requests', () => {
    const store = useTerminalStore.getState()

    store.addPendingConfirmation(createRequest('terminal-confirmation-1'))
    expect(useTerminalStore.getState().pendingConfirmations).toHaveLength(1)

    store.removePendingConfirmation('terminal-confirmation-1')
    expect(useTerminalStore.getState().pendingConfirmations).toEqual([])
  })

  it('replaces duplicate confirmation requests by id', () => {
    const store = useTerminalStore.getState()

    store.addPendingConfirmation(createRequest('terminal-confirmation-1', 'rm -rf dist'))
    store.addPendingConfirmation(createRequest('terminal-confirmation-1', 'sudo reboot'))

    expect(useTerminalStore.getState().pendingConfirmations).toHaveLength(1)
    expect(useTerminalStore.getState().pendingConfirmations[0].command).toBe('sudo reboot')
  })

  it('appends terminal output lines from execution events', () => {
    const store = useTerminalStore.getState()

    store.appendOutputLine({
      sessionId: 'terminal-1',
      kind: 'command',
      text: '$ pwd\n',
      timestamp: 1000,
    })
    store.appendExecutionEvent({
      kind: 'output',
      sessionId: 'terminal-1',
      data: '/workspace\n',
      stream: 'stdout',
      timestamp: 1001,
    })
    store.appendExecutionEvent({
      kind: 'exit',
      sessionId: 'terminal-1',
      exitCode: 0,
      timestamp: 1002,
    })

    expect(useTerminalStore.getState().outputBySessionId['terminal-1']).toMatchObject([
      { kind: 'command', text: '$ pwd\n' },
      { kind: 'stdout', text: '/workspace\n' },
      { kind: 'system', text: '\nTerminal 进程已退出，退出码 0\n' },
    ])
  })
})
