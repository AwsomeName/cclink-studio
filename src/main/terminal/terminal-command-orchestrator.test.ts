import { describe, expect, it, vi } from 'vitest'
import type { TerminalPermissionPolicy, TerminalRuntimeRef } from '../../shared/terminal'
import { TerminalSessionRegistry } from './terminal-session-registry'
import { TerminalCommandOrchestrator } from './terminal-command-orchestrator'
import { NoopTerminalExecutionAdapter } from './terminal-noop-execution-adapter'
import type { TerminalExecutionAdapter } from './terminal-execution-adapter'

const runtime: TerminalRuntimeRef = {
  location: 'local',
  transport: 'local',
  backend: 'local-shell',
  workspaceRef: {
    kind: 'local',
    path: '/workspace',
  },
  cwd: '/workspace',
}

const askRiskyPolicy: TerminalPermissionPolicy = {
  mode: 'ask-risky-command',
  requireConfirmationFor: ['write', 'network', 'destructive', 'privileged', 'unknown'],
}

const readOnlyPolicy: TerminalPermissionPolicy = {
  mode: 'read-only',
  requireConfirmationFor: [],
}

function createOrchestrator(
  options: {
    registry?: TerminalSessionRegistry
    requestConfirmation?: ReturnType<typeof vi.fn>
    recordEvent?: ReturnType<typeof vi.fn>
    executionAdapter?: Pick<TerminalExecutionAdapter, 'start' | 'write'>
  } = {},
): {
  registry: TerminalSessionRegistry
  requestConfirmation: ReturnType<typeof vi.fn>
  recordEvent: ReturnType<typeof vi.fn>
  orchestrator: TerminalCommandOrchestrator
} {
  const registry = options.registry ?? new TerminalSessionRegistry()
  const requestConfirmation = options.requestConfirmation ?? vi.fn(async () => true)
  const recordEvent = options.recordEvent ?? vi.fn(async () => undefined)
  const orchestrator = new TerminalCommandOrchestrator({
    sessionRegistry: registry,
    confirmationService: { requestConfirmation },
    executionAdapter: options.executionAdapter,
    auditStore: { recordEvent },
    now: () => 1000,
    idFactory: () => 'audit-1',
  })

  return { registry, requestConfirmation, recordEvent, orchestrator }
}

describe('TerminalCommandOrchestrator', () => {
  it('accepts low-risk commands without confirmation but does not execute them', async () => {
    const { registry, requestConfirmation, recordEvent, orchestrator } = createOrchestrator()
    registry.register({ sessionId: 'terminal-1', runtime, now: 100 })

    await expect(
      orchestrator.submitCommand({
        terminalSessionId: 'terminal-1',
        command: 'pwd',
        actor: 'user',
        permissionPolicy: askRiskyPolicy,
      }),
    ).resolves.toEqual({
      success: true,
      status: 'accepted',
      risk: 'read',
      execution: 'not-started',
      message: 'Terminal 命令已通过权限检查；真实执行尚未接入',
    })

    expect(requestConfirmation).not.toHaveBeenCalled()
    expect(recordEvent).toHaveBeenCalledWith({
      id: 'audit-1',
      terminalSessionId: 'terminal-1',
      workspaceKey: '/workspace',
      timestamp: 1000,
      kind: 'command-submitted',
      actor: 'user',
      command: 'pwd',
      risk: 'read',
      approved: true,
      message: 'Terminal 命令已通过权限检查；真实执行尚未接入',
    })
    expect(registry.get('terminal-1')).toMatchObject({
      status: 'idle',
      lastCommand: 'pwd',
    })
  })

  it('blocks active sessions while waiting for risky command confirmation', async () => {
    let approveCommand = (_approved: boolean): void => {
      throw new Error('确认回调尚未就绪')
    }
    const requestConfirmation = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          approveCommand = resolve
        }),
    )
    const { registry, recordEvent, orchestrator } = createOrchestrator({ requestConfirmation })
    registry.register({ sessionId: 'terminal-1', runtime, now: 100 })
    registry.transition('terminal-1', 'starting', { now: 110 })
    registry.transition('terminal-1', 'running', { now: 120, processId: 42 })

    const resultPromise = orchestrator.submitCommand({
      terminalSessionId: 'terminal-1',
      command: 'rm -rf dist',
      actor: 'user',
      permissionPolicy: askRiskyPolicy,
    })

    expect(registry.get('terminal-1')).toMatchObject({
      status: 'blocked',
      lastCommand: 'rm -rf dist',
      processId: 42,
    })
    expect(requestConfirmation).toHaveBeenCalledWith({
      terminalSessionId: 'terminal-1',
      workspaceKey: '/workspace',
      command: 'rm -rf dist',
      actor: 'user',
      risk: 'destructive',
      reason: '命令风险需要确认',
      cwd: '/workspace',
      runtime,
    })

    approveCommand(true)
    await expect(resultPromise).resolves.toMatchObject({
      success: true,
      status: 'accepted',
      risk: 'destructive',
      execution: 'not-started',
    })
    expect(registry.get('terminal-1')).toMatchObject({
      status: 'running',
      lastCommand: 'rm -rf dist',
      processId: 42,
    })
    expect(recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'command-submitted',
        command: 'rm -rf dist',
        approved: true,
      }),
    )
  })

  it('restores state and does not submit commands when confirmation is denied', async () => {
    const { registry, recordEvent, orchestrator } = createOrchestrator({
      requestConfirmation: vi.fn(async () => false),
    })
    registry.register({ sessionId: 'terminal-1', runtime, now: 100 })
    registry.transition('terminal-1', 'starting', { now: 110 })
    registry.transition('terminal-1', 'running', { now: 120 })

    await expect(
      orchestrator.submitCommand({
        terminalSessionId: 'terminal-1',
        command: 'pnpm install',
        actor: 'user',
        permissionPolicy: askRiskyPolicy,
      }),
    ).resolves.toEqual({
      success: false,
      status: 'denied',
      risk: 'write',
      error: 'Terminal 命令未获确认，真实执行未启动',
    })

    expect(registry.get('terminal-1')).toMatchObject({
      status: 'running',
      lastCommand: 'pnpm install',
    })
    expect(recordEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'command-submitted' }),
    )
  })

  it('records denied commands without requesting confirmation', async () => {
    const { registry, requestConfirmation, recordEvent, orchestrator } = createOrchestrator()
    registry.register({ sessionId: 'terminal-1', runtime, now: 100 })

    await expect(
      orchestrator.submitCommand({
        terminalSessionId: 'terminal-1',
        command: 'touch a.txt',
        actor: 'user',
        permissionPolicy: readOnlyPolicy,
      }),
    ).resolves.toEqual({
      success: false,
      status: 'denied',
      risk: 'write',
      error: '当前 Terminal 为只读模式',
    })

    expect(requestConfirmation).not.toHaveBeenCalled()
    expect(recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'command-denied',
        command: 'touch a.txt',
        risk: 'write',
        approved: false,
        message: '当前 Terminal 为只读模式',
      }),
    )
  })

  it('dispatches accepted idle commands to the execution adapter and audits unavailable backend errors', async () => {
    const executionAdapter = new NoopTerminalExecutionAdapter({
      backend: 'local-shell',
      now: () => 2000,
    })
    const { registry, recordEvent, orchestrator } = createOrchestrator({ executionAdapter })
    registry.register({ sessionId: 'terminal-1', runtime, now: 100 })

    await expect(
      orchestrator.submitCommand({
        terminalSessionId: 'terminal-1',
        command: 'pwd',
        actor: 'user',
        permissionPolicy: askRiskyPolicy,
      }),
    ).resolves.toMatchObject({
      success: true,
      status: 'accepted',
      execution: 'not-started',
    })

    expect(recordEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        kind: 'error',
        terminalSessionId: 'terminal-1',
        workspaceKey: '/workspace',
        actor: 'user',
        command: 'pwd',
        message: 'Terminal 执行适配器尚未接入真实 shell',
        executionError: {
          layer: 'execution-backend',
          code: 'EXECUTION_BACKEND_UNAVAILABLE',
          message: 'Terminal 执行适配器尚未接入真实 shell',
          retryable: false,
          context: {
            backend: 'local-shell',
            operation: 'terminal.start',
            sessionId: 'terminal-1',
          },
        },
      }),
    )
  })

  it('writes user commands to a running interactive terminal and audits generic failures', async () => {
    const executionAdapter = {
      start: vi.fn(async () => ({ sessionId: 'terminal-1', status: 'running' as const })),
      write: vi.fn(async () => {
        throw new Error('write failed')
      }),
    }
    const { registry, recordEvent, orchestrator } = createOrchestrator({ executionAdapter })
    registry.register({ sessionId: 'terminal-1', runtime, now: 100 })
    registry.transition('terminal-1', 'starting', { now: 110 })
    registry.transition('terminal-1', 'running', { now: 120 })

    await expect(
      orchestrator.submitCommand({
        terminalSessionId: 'terminal-1',
        command: 'git status --short',
        actor: 'user',
        permissionPolicy: askRiskyPolicy,
      }),
    ).resolves.toMatchObject({
      success: true,
      status: 'accepted',
      execution: 'not-started',
    })

    expect(executionAdapter.start).not.toHaveBeenCalled()
    expect(executionAdapter.write).toHaveBeenCalledWith({
      sessionId: 'terminal-1',
      data: 'git status --short\n',
      actor: 'user',
    })
    expect(recordEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        kind: 'error',
        actor: 'user',
        command: 'git status --short',
        message: 'write failed',
        executionError: undefined,
      }),
    )
  })

  it('rejects automatic command injection into a running interactive terminal', async () => {
    const executionAdapter = {
      start: vi.fn(),
      write: vi.fn(),
    }
    const { registry, requestConfirmation, recordEvent, orchestrator } = createOrchestrator({
      executionAdapter,
    })
    registry.register({ sessionId: 'terminal-1', runtime, now: 100 })
    registry.transition('terminal-1', 'starting', { now: 110 })
    registry.transition('terminal-1', 'running', { now: 120 })

    await expect(
      orchestrator.submitCommand({
        terminalSessionId: 'terminal-1',
        command: 'scp artifact server:/tmp/artifact',
        actor: 'agent',
        permissionPolicy: askRiskyPolicy,
      }),
    ).resolves.toEqual({
      success: false,
      status: 'rejected',
      error:
        'Terminal 正在运行交互式进程，无法安全注入自动命令；请等待前台命令结束，或在新 Terminal 中执行',
    })

    expect(requestConfirmation).not.toHaveBeenCalled()
    expect(recordEvent).not.toHaveBeenCalled()
    expect(executionAdapter.start).not.toHaveBeenCalled()
    expect(executionAdapter.write).not.toHaveBeenCalled()
  })

  it('rejects missing or busy sessions before permission evaluation', async () => {
    const { registry, requestConfirmation, recordEvent, orchestrator } = createOrchestrator()

    await expect(
      orchestrator.submitCommand({
        terminalSessionId: 'missing',
        command: 'pwd',
        actor: 'user',
        permissionPolicy: askRiskyPolicy,
      }),
    ).resolves.toEqual({
      success: false,
      status: 'rejected',
      error: 'Terminal session 不存在：missing',
    })

    registry.register({ sessionId: 'terminal-1', runtime, now: 100 })
    registry.transition('terminal-1', 'blocked', { now: 110 })

    await expect(
      orchestrator.submitCommand({
        terminalSessionId: 'terminal-1',
        command: 'pwd',
        actor: 'user',
        permissionPolicy: askRiskyPolicy,
      }),
    ).resolves.toEqual({
      success: false,
      status: 'rejected',
      error: 'Terminal session 当前状态不可提交命令：blocked',
    })

    expect(requestConfirmation).not.toHaveBeenCalled()
    expect(recordEvent).not.toHaveBeenCalled()
  })
})
