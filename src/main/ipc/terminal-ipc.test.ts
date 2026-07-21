import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockIpcMain = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
    mockIpcMain.handlers.set(channel, handler)
  }),
}))

vi.mock('electron', () => ({
  ipcMain: mockIpcMain,
}))

import { registerTerminalIpc as registerProductionTerminalIpc } from './terminal-ipc'

const trustedRendererGuard = {
  assert: vi.fn(),
  isTrusted: vi.fn(() => true),
}

function registerTerminalIpc(...args: any[]): void {
  ;(registerProductionTerminalIpc as (...values: any[]) => void)(
    args[0],
    trustedRendererGuard,
    ...args.slice(1),
  )
}

const terminalRuntime = {
  location: 'local',
  transport: 'local',
  backend: 'local-shell',
  workspaceRef: { kind: 'local', path: '/workspace' },
  cwd: '/workspace',
}

describe('registerTerminalIpc', () => {
  beforeEach(() => {
    mockIpcMain.handlers.clear()
    mockIpcMain.handle.mockClear()
    trustedRendererGuard.assert.mockReset()
    trustedRendererGuard.isTrusted.mockReset()
    trustedRendererGuard.isTrusted.mockReturnValue(true)
  })

  it('rejects an untrusted sender before resolving confirmations', () => {
    const terminalConfirmationService = {
      resolveConfirmation: vi.fn(() => true),
    } as any
    trustedRendererGuard.assert.mockImplementationOnce(() => {
      throw new Error('untrusted')
    })
    registerTerminalIpc(terminalConfirmationService)

    const handler = mockIpcMain.handlers.get('terminal:resolveCommandConfirmation')
    expect(() => handler?.({ sender: {} }, 'confirmation-1', true)).toThrow('untrusted')
    expect(terminalConfirmationService.resolveConfirmation).not.toHaveBeenCalled()
  })

  it('registers command confirmation resolver', () => {
    const terminalConfirmationService = {
      resolveConfirmation: vi.fn(() => true),
    } as any

    registerTerminalIpc(terminalConfirmationService)

    expect(mockIpcMain.handle).toHaveBeenCalledWith(
      'terminal:resolveCommandConfirmation',
      expect.any(Function),
    )

    const handler = mockIpcMain.handlers.get('terminal:resolveCommandConfirmation')
    expect(handler?.({}, 'confirmation-1', true)).toEqual({ success: true })
    expect(terminalConfirmationService.resolveConfirmation).toHaveBeenCalledWith(
      'confirmation-1',
      true,
    )
  })

  it('returns success false when no pending confirmation exists', () => {
    const terminalConfirmationService = {
      resolveConfirmation: vi.fn(() => false),
    } as any

    registerTerminalIpc(terminalConfirmationService)

    const handler = mockIpcMain.handlers.get('terminal:resolveCommandConfirmation')
    expect(handler?.({}, 'missing', false)).toEqual({ success: false })
  })

  it('lists terminal audit events with a normalized filter', async () => {
    const terminalConfirmationService = {
      resolveConfirmation: vi.fn(() => true),
    } as any
    const terminalAuditStore = {
      listEvents: vi.fn(async () => [{ id: 'audit-1' }]),
      clearSession: vi.fn(),
      clearAll: vi.fn(),
    } as any

    registerTerminalIpc(terminalConfirmationService, terminalAuditStore)

    const handler = mockIpcMain.handlers.get('terminal:listAuditEvents')
    await expect(
      handler?.(
        {},
        {
          terminalSessionId: 'terminal-1',
          workspaceKey: 123,
          limit: 2.8,
        },
      ),
    ).resolves.toEqual([{ id: 'audit-1' }])
    expect(terminalAuditStore.listEvents).toHaveBeenCalledWith({
      terminalSessionId: 'terminal-1',
      workspaceKey: null,
      limit: 2,
    })
  })

  it('lists terminal session snapshots from the registry', async () => {
    const terminalSessionRegistry = {
      list: vi.fn(() => [
        {
          sessionId: 'terminal-1',
          runtime: terminalRuntime,
          status: 'running',
          createdAt: 100,
          updatedAt: 200,
          processId: 42,
          lastCommand: 'pwd',
        },
      ]),
    } as any

    registerTerminalIpc(
      { resolveConfirmation: vi.fn() } as any,
      { listEvents: vi.fn() } as any,
      terminalSessionRegistry,
    )

    const handler = mockIpcMain.handlers.get('terminal:listSessions')
    await expect(handler?.({})).resolves.toEqual([
      {
        sessionId: 'terminal-1',
        runtime: terminalRuntime,
        status: 'running',
        createdAt: 100,
        updatedAt: 200,
        processId: 42,
        exitCode: undefined,
        signal: undefined,
        exitedAt: undefined,
        errorMessage: undefined,
        lastCommand: 'pwd',
        workspaceKey: null,
        permissionPolicy: undefined,
        closePolicy: undefined,
        attachable: true,
        outputBuffer: [],
        commandHistory: [],
      },
    ])
  })

  it('degrades terminal session listing when registry is unavailable', async () => {
    registerTerminalIpc({ resolveConfirmation: vi.fn() } as any, { listEvents: vi.fn() } as any)

    await expect(mockIpcMain.handlers.get('terminal:listSessions')?.({})).resolves.toEqual([])
  })

  it('updates the authoritative terminal registry before publishing execution events', () => {
    const order: string[] = []
    let executionListener: ((event: any) => void) | undefined
    const terminalSessionRegistry = {
      get: vi.fn(() => ({ sessionId: 'terminal-1', status: 'running' })),
      transition: vi.fn(() => order.push('registry')),
    } as any
    const terminalExecutionAdapter = {
      onEvent: vi.fn((listener) => {
        executionListener = listener
      }),
    } as any
    const webContents = {
      send: vi.fn(() => order.push('renderer')),
    } as any
    const terminalSessionStore = {
      appendExecutionEvent: vi.fn(async () => undefined),
    } as any

    registerTerminalIpc(
      { resolveConfirmation: vi.fn() } as any,
      { recordEvent: vi.fn(async () => undefined) } as any,
      terminalSessionRegistry,
      undefined,
      terminalExecutionAdapter,
      webContents,
      terminalSessionStore,
    )
    executionListener?.({
      kind: 'exit',
      sessionId: 'terminal-1',
      timestamp: 200,
      exitCode: 0,
    })

    expect(order).toEqual(['registry', 'renderer'])
    expect(terminalSessionRegistry.transition).toHaveBeenCalledWith('terminal-1', 'exited', {
      now: 200,
      exitCode: 0,
      errorMessage: undefined,
    })
    expect(webContents.send).toHaveBeenCalledWith(
      'terminal:executionEvent',
      expect.objectContaining({ kind: 'exit', sessionId: 'terminal-1' }),
    )
  })

  it('submits terminal commands through the orchestrator with normalized input', async () => {
    const terminalCommandOrchestrator = {
      submitCommand: vi.fn(async () => ({
        success: true,
        status: 'accepted',
        risk: 'read',
        execution: 'not-started',
        message: 'ok',
      })),
    } as any

    registerTerminalIpc(
      { resolveConfirmation: vi.fn() } as any,
      { listEvents: vi.fn() } as any,
      undefined,
      terminalCommandOrchestrator,
    )

    const handler = mockIpcMain.handlers.get('terminal:submitCommand')
    await expect(
      handler?.(
        {},
        {
          terminalSessionId: ' terminal-1 ',
          command: '  pwd  ',
          actor: 'user',
          workspaceKey: 123,
          permissionPolicy: {
            mode: 'ask-risky-command',
            requireConfirmationFor: ['write', 'write', 'not-risk'],
            allowlist: [' pwd ', ''],
            denylist: [' rm -rf   dist '],
          },
        },
      ),
    ).resolves.toEqual({
      success: true,
      status: 'accepted',
      risk: 'read',
      execution: 'not-started',
      message: 'ok',
    })

    expect(terminalCommandOrchestrator.submitCommand).toHaveBeenCalledWith({
      terminalSessionId: 'terminal-1',
      command: 'pwd',
      actor: 'user',
      workspaceKey: null,
      permissionPolicy: {
        mode: 'ask-risky-command',
        requireConfirmationFor: ['write'],
        allowlist: ['pwd'],
        denylist: ['rm -rf dist'],
      },
    })
  })

  it('rejects terminal command submission when orchestrator is unavailable', async () => {
    registerTerminalIpc({ resolveConfirmation: vi.fn() } as any, { listEvents: vi.fn() } as any)

    await expect(
      mockIpcMain.handlers.get('terminal:submitCommand')?.(
        {},
        {
          terminalSessionId: 'terminal-1',
          command: 'pwd',
          actor: 'user',
          permissionPolicy: {
            mode: 'ask-risky-command',
            requireConfirmationFor: ['write'],
          },
        },
      ),
    ).resolves.toEqual({
      success: false,
      status: 'rejected',
      error: 'Terminal 命令编排器未就绪',
    })
  })

  it('rejects confirmation resolution when the confirmation service is unavailable', async () => {
    registerTerminalIpc(null, { listEvents: vi.fn() } as any)

    expect(
      mockIpcMain.handlers.get('terminal:resolveCommandConfirmation')?.({}, 'confirm-1', true),
    ).toEqual({
      success: false,
      error: 'Terminal 确认服务未就绪',
    })
  })

  it('rejects invalid terminal command submission input', async () => {
    const terminalCommandOrchestrator = {
      submitCommand: vi.fn(),
    } as any

    registerTerminalIpc(
      { resolveConfirmation: vi.fn() } as any,
      { listEvents: vi.fn() } as any,
      undefined,
      terminalCommandOrchestrator,
    )

    await expect(
      mockIpcMain.handlers.get('terminal:submitCommand')?.(
        {},
        {
          terminalSessionId: 'terminal-1',
          command: '   ',
          actor: 'robot',
          permissionPolicy: {
            mode: 'unknown-mode',
            requireConfirmationFor: ['write'],
          },
        },
      ),
    ).resolves.toEqual({
      success: false,
      status: 'rejected',
      error: 'Terminal 命令提交参数无效',
    })
    expect(terminalCommandOrchestrator.submitCommand).not.toHaveBeenCalled()
  })

  it('records terminal lifecycle audit events with sanitized input', async () => {
    const terminalAuditStore = {
      recordEvent: vi.fn(async () => undefined),
    } as any

    registerTerminalIpc({ resolveConfirmation: vi.fn() } as any, terminalAuditStore)

    const handler = mockIpcMain.handlers.get('terminal:recordLifecycleEvent')
    await expect(
      handler?.(
        {},
        {
          terminalSessionId: 'terminal-1',
          workspaceKey: 123,
          kind: 'created',
          message: 'x'.repeat(600),
        },
      ),
    ).resolves.toEqual({ success: true })
    expect(terminalAuditStore.recordEvent).toHaveBeenCalledWith({
      terminalSessionId: 'terminal-1',
      workspaceKey: null,
      kind: 'created',
      message: 'x'.repeat(500),
    })
  })

  it('registers terminal sessions on created lifecycle events', async () => {
    const terminalAuditStore = {
      recordEvent: vi.fn(async () => undefined),
    } as any
    const terminalSessionRegistry = {
      get: vi.fn(() => null),
      register: vi.fn(),
      remove: vi.fn(),
      transition: vi.fn(),
    } as any

    registerTerminalIpc(
      { resolveConfirmation: vi.fn() } as any,
      terminalAuditStore,
      terminalSessionRegistry,
    )

    const handler = mockIpcMain.handlers.get('terminal:recordLifecycleEvent')
    await expect(
      handler?.(
        {},
        {
          terminalSessionId: 'terminal-1',
          workspaceKey: '/workspace',
          kind: 'created',
          runtime: terminalRuntime,
        },
      ),
    ).resolves.toEqual({ success: true })

    expect(terminalSessionRegistry.register).toHaveBeenCalledWith({
      sessionId: 'terminal-1',
      runtime: terminalRuntime,
    })
    expect(terminalAuditStore.recordEvent).toHaveBeenCalledWith({
      terminalSessionId: 'terminal-1',
      workspaceKey: '/workspace',
      kind: 'created',
      message: undefined,
    })
  })

  it('does not register created sessions when runtime is missing', async () => {
    const terminalAuditStore = {
      recordEvent: vi.fn(async () => undefined),
    } as any
    const terminalSessionRegistry = {
      get: vi.fn(() => null),
      register: vi.fn(),
      remove: vi.fn(),
      transition: vi.fn(),
    } as any

    registerTerminalIpc(
      { resolveConfirmation: vi.fn() } as any,
      terminalAuditStore,
      terminalSessionRegistry,
    )

    const handler = mockIpcMain.handlers.get('terminal:recordLifecycleEvent')
    await expect(
      handler?.(
        {},
        {
          terminalSessionId: 'terminal-1',
          kind: 'created',
        },
      ),
    ).resolves.toEqual({ success: true })

    expect(terminalSessionRegistry.register).not.toHaveBeenCalled()
    expect(terminalAuditStore.recordEvent).toHaveBeenCalled()
  })

  it('removes terminal sessions on closed lifecycle events', async () => {
    const terminalAuditStore = {
      recordEvent: vi.fn(async () => undefined),
    } as any
    const terminalSessionRegistry = {
      get: vi.fn(),
      register: vi.fn(),
      remove: vi.fn(),
      transition: vi.fn(),
    } as any

    registerTerminalIpc(
      { resolveConfirmation: vi.fn() } as any,
      terminalAuditStore,
      terminalSessionRegistry,
    )

    const handler = mockIpcMain.handlers.get('terminal:recordLifecycleEvent')
    await expect(
      handler?.(
        {},
        {
          terminalSessionId: 'terminal-1',
          kind: 'closed',
        },
      ),
    ).resolves.toEqual({ success: true })

    expect(terminalSessionRegistry.remove).toHaveBeenCalledWith('terminal-1')
  })

  it('transitions active terminal sessions to exited before terminated removal', async () => {
    const terminalAuditStore = {
      recordEvent: vi.fn(async () => undefined),
    } as any
    const terminalSessionRegistry = {
      get: vi.fn(() => ({ sessionId: 'terminal-1', status: 'running' })),
      register: vi.fn(),
      remove: vi.fn(),
      transition: vi.fn(),
    } as any

    registerTerminalIpc(
      { resolveConfirmation: vi.fn() } as any,
      terminalAuditStore,
      terminalSessionRegistry,
    )

    const handler = mockIpcMain.handlers.get('terminal:recordLifecycleEvent')
    await expect(
      handler?.(
        {},
        {
          terminalSessionId: 'terminal-1',
          kind: 'terminated',
        },
      ),
    ).resolves.toEqual({ success: true })

    expect(terminalSessionRegistry.transition).toHaveBeenCalledWith('terminal-1', 'exited', {
      exitCode: undefined,
      errorMessage: 'Terminal 关闭时请求结束进程',
    })
    expect(terminalSessionRegistry.remove).toHaveBeenCalledWith('terminal-1')
  })

  it('rejects invalid terminal lifecycle audit events', async () => {
    const terminalAuditStore = {
      recordEvent: vi.fn(),
    } as any

    registerTerminalIpc({ resolveConfirmation: vi.fn() } as any, terminalAuditStore)

    const handler = mockIpcMain.handlers.get('terminal:recordLifecycleEvent')
    await expect(
      handler?.(
        {},
        {
          terminalSessionId: 'terminal-1',
          kind: 'command-submitted',
        },
      ),
    ).resolves.toEqual({
      success: false,
      error: 'Terminal 生命周期审计事件无效',
    })
    expect(terminalAuditStore.recordEvent).not.toHaveBeenCalled()
  })

  it('clears one terminal audit session', async () => {
    const terminalAuditStore = {
      listEvents: vi.fn(),
      clearSession: vi.fn(async () => undefined),
      clearAll: vi.fn(),
    } as any

    registerTerminalIpc({ resolveConfirmation: vi.fn() } as any, terminalAuditStore)

    const handler = mockIpcMain.handlers.get('terminal:clearAuditSession')
    await expect(handler?.({}, 'terminal-1')).resolves.toEqual({ success: true })
    expect(terminalAuditStore.clearSession).toHaveBeenCalledWith('terminal-1')
  })

  it('rejects clearing an empty terminal audit session id', async () => {
    const terminalAuditStore = {
      clearSession: vi.fn(),
    } as any

    registerTerminalIpc({ resolveConfirmation: vi.fn() } as any, terminalAuditStore)

    const handler = mockIpcMain.handlers.get('terminal:clearAuditSession')
    await expect(handler?.({}, '')).resolves.toEqual({
      success: false,
      error: 'terminalSessionId 不能为空',
    })
    expect(terminalAuditStore.clearSession).not.toHaveBeenCalled()
  })

  it('clears all terminal audit events', async () => {
    const terminalAuditStore = {
      clearAll: vi.fn(async () => undefined),
    } as any

    registerTerminalIpc({ resolveConfirmation: vi.fn() } as any, terminalAuditStore)

    const handler = mockIpcMain.handlers.get('terminal:clearAuditEvents')
    await expect(handler?.({})).resolves.toEqual({ success: true })
    expect(terminalAuditStore.clearAll).toHaveBeenCalled()
  })

  it('degrades audit operations when audit store is unavailable', async () => {
    registerTerminalIpc({ resolveConfirmation: vi.fn() } as any)

    await expect(
      mockIpcMain.handlers.get('terminal:recordLifecycleEvent')?.(
        {},
        {
          terminalSessionId: 'terminal-1',
          kind: 'created',
        },
      ),
    ).resolves.toEqual({
      success: false,
      error: 'Terminal 审计存储未就绪',
    })
    await expect(mockIpcMain.handlers.get('terminal:listAuditEvents')?.({}, {})).resolves.toEqual(
      [],
    )
    await expect(mockIpcMain.handlers.get('terminal:clearAuditEvents')?.({})).resolves.toEqual({
      success: false,
      error: 'Terminal 审计存储未就绪',
    })
  })
})
