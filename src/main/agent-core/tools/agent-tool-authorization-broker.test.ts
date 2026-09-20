import { describe, expect, it, vi } from 'vitest'
import { AgentToolAuthorizationBroker } from './agent-tool-authorization-broker'
import type { PermissionMode } from './types'

const context = {
  conversationId: 'conversation-a',
  agentRunId: 'run-a',
  trustedWorkspace: {
    kind: 'local' as const,
    rootPath: '/workspace/a',
    workspaceKey: '/workspace/a',
  },
}

function createBroker(
  options: { needsConfirmation?: boolean; approved?: boolean; mode?: PermissionMode } = {},
) {
  const requestConfirmation = vi.fn(async () => options.approved ?? true)
  const mode = options.mode
  const broker = new AgentToolAuthorizationBroker({
    needsConfirmation: vi.fn(() => options.needsConfirmation ?? false),
    requestConfirmation,
    ...(mode ? { getMode: () => mode } : {}),
  })
  return { broker, requestConfirmation }
}

describe('AgentToolAuthorizationBroker', () => {
  it('forces destructive internal tools through one-shot confirmation in auto mode', async () => {
    const { broker, requestConfirmation } = createBroker()

    await expect(
      broker.authorizeInternalTool({
        toolName: 'android_uninstall_package',
        params: { packageName: 'com.example.canary' },
        annotations: { readOnlyHint: false, destructiveHint: true },
        executionPolicy: null,
        context,
      }),
    ).resolves.toMatchObject({ behavior: 'allow', confirmationGranted: true })
    expect(requestConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'android_uninstall_package',
        riskLevel: 'destructive',
        allowAlways: false,
      }),
    )
  })

  it('does not let an Always-style permission bypass a destructive tool', async () => {
    const { broker, requestConfirmation } = createBroker({ needsConfirmation: false })

    await broker.authorizeInternalTool({
      toolName: 'browser_clear_cookies',
      params: {},
      annotations: { readOnlyHint: false, destructiveHint: true },
      executionPolicy: null,
      context,
    })

    expect(requestConfirmation).toHaveBeenCalledOnce()
  })

  it('rejects Android shell without offering a confirmation path', async () => {
    const { broker, requestConfirmation } = createBroker()

    await expect(
      broker.authorizeSdkTool({
        toolName: 'mcp__cclink_studio__android_shell',
        params: { command: 'rm -rf /sdcard/canary' },
        context,
      }),
    ).resolves.toEqual({
      behavior: 'deny',
      reason: 'Android 任意 shell 不向普通 Agent 开放；请由用户在可见 Terminal/ADB 中人工接管',
    })
    expect(requestConfirmation).not.toHaveBeenCalled()
  })

  it('rejects unclassified external MCP and unknown SDK tools by default', async () => {
    const { broker } = createBroker()

    await expect(
      broker.authorizeSdkTool({
        toolName: 'mcp__external__write_canary',
        params: {},
        context,
      }),
    ).resolves.toMatchObject({ behavior: 'deny' })
    await expect(
      broker.authorizeSdkTool({ toolName: 'FutureDangerousTool', params: {}, context }),
    ).resolves.toMatchObject({ behavior: 'deny' })
  })

  it('classifies SDK Bash by command: plain commands pass, delete commands confirm once', async () => {
    const { broker, requestConfirmation } = createBroker({ mode: 'auto-except-destructive' })

    await expect(
      broker.authorizeSdkTool({ toolName: 'Bash', params: { command: 'pwd' }, context }),
    ).resolves.toEqual({ behavior: 'allow' })
    await expect(
      broker.authorizeSdkTool({
        toolName: 'Bash',
        params: { command: 'pnpm test' },
        context,
      }),
    ).resolves.toEqual({ behavior: 'allow' })
    await expect(
      broker.authorizeSdkTool({
        toolName: 'Bash',
        params: { command: 'rm -rf /workspace/canary' },
        context,
      }),
    ).resolves.toMatchObject({ behavior: 'allow', confirmationGranted: true })
    expect(requestConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ riskLevel: 'destructive', allowAlways: false }),
    )
    await expect(
      broker.authorizeSdkTool({
        toolName: 'mcp__cclink_studio__browser_clear_cookies',
        params: {},
        context,
      }),
    ).resolves.toEqual({ behavior: 'allow' })
  })

  it('reuses one SDK decision across canUseTool and PreToolUse for the same toolUseID', async () => {
    const { broker, requestConfirmation } = createBroker()
    const request = {
      toolName: 'Bash',
      params: { command: 'rm -rf /workspace/canary' },
      context,
      authorizationId: 'tool-use-a',
    }

    const [first, second] = await Promise.all([
      broker.authorizeSdkTool(request),
      broker.authorizeSdkTool(request),
    ])

    expect(first).toEqual(second)
    expect(requestConfirmation).toHaveBeenCalledOnce()
  })

  it('does not duplicate confirmation for an exact bounded host authorization', async () => {
    const { broker, requestConfirmation } = createBroker({ needsConfirmation: true })

    await expect(
      broker.authorizeInternalTool({
        toolName: 'browser_click',
        params: { selector: '#publish' },
        annotations: { readOnlyHint: false, destructiveHint: false },
        executionPolicy: {
          requireConfirmation: false,
          authorizationSatisfied: true,
        },
        context,
      }),
    ).resolves.toEqual({ behavior: 'allow' })
    expect(requestConfirmation).not.toHaveBeenCalled()
  })

  it('does not let a host preauthorization waive the destructive floor', async () => {
    const { broker, requestConfirmation } = createBroker()

    await broker.authorizeInternalTool({
      toolName: 'browser_clear_cookies',
      params: {},
      annotations: { readOnlyHint: false, destructiveHint: true },
      executionPolicy: {
        requireConfirmation: false,
        authorizationSatisfied: true,
      },
      context,
    })

    expect(requestConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ riskLevel: 'destructive', allowAlways: false }),
    )
  })

  it('enforces the same one-shot destructive floor for classified ACP tools', async () => {
    const { broker, requestConfirmation } = createBroker({ needsConfirmation: false })

    await expect(
      broker.authorizeClassifiedTool({
        toolName: 'delete_file',
        params: { path: '/workspace/canary' },
        riskLevel: 'destructive',
        context: { conversationId: 'conversation-a', agentRunId: 'run-a' },
      }),
    ).resolves.toMatchObject({ behavior: 'allow', confirmationGranted: true })

    expect(requestConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conversation-a',
        runId: 'run-a',
        riskLevel: 'destructive',
        allowAlways: false,
      }),
    )
  })
})

describe('AgentToolAuthorizationBroker in auto-except-destructive mode', () => {
  it('auto-allows ordinary Bash in auto mode', async () => {
    const { broker, requestConfirmation } = createBroker({ mode: 'auto' })
    await expect(
      broker.authorizeSdkTool({ toolName: 'Bash', params: { command: 'pnpm test' }, context }),
    ).resolves.toEqual({ behavior: 'allow' })
    expect(requestConfirmation).not.toHaveBeenCalled()
  })

  it('keeps ordinary Bash confirmation in categorized and strict modes', async () => {
    for (const mode of ['categorized', 'strict'] as const) {
      const { broker, requestConfirmation } = createBroker({ mode, needsConfirmation: true })
      await broker.authorizeSdkTool({
        toolName: 'Bash',
        params: { command: 'pnpm test' },
        context,
      })
      expect(requestConfirmation).toHaveBeenCalledOnce()
    }
  })

  it.each([
    'sudo -u root rm /tmp/example',
    'env -u NAME kill 12345',
    'if true; then rm /tmp/example; fi',
    'echo ok # comment\nrm /tmp/example',
    'xargs -I {} rm {}',
  ])('confirms reviewed shell regression: %s', async (command) => {
    const { broker, requestConfirmation } = createBroker({
      mode: 'auto-except-destructive',
      approved: false,
    })
    await expect(
      broker.authorizeSdkTool({ toolName: 'Bash', params: { command }, context }),
    ).resolves.toMatchObject({ behavior: 'deny' })
    expect(requestConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ allowAlways: false }),
    )
  })
  it('auto-allows ordinary SDK tools including non-delete Bash without confirmation', async () => {
    const { broker, requestConfirmation } = createBroker({ mode: 'auto-except-destructive' })

    await expect(
      broker.authorizeSdkTool({
        toolName: 'Read',
        params: { file_path: '/workspace/a/README.md' },
        context,
      }),
    ).resolves.toEqual({ behavior: 'allow' })
    await expect(
      broker.authorizeSdkTool({
        toolName: 'Edit',
        params: { file_path: '/workspace/a/x.ts' },
        context,
      }),
    ).resolves.toEqual({ behavior: 'allow' })
    await expect(
      broker.authorizeSdkTool({
        toolName: 'Bash',
        params: { command: 'pnpm build && pnpm test' },
        context,
      }),
    ).resolves.toEqual({ behavior: 'allow' })
    expect(requestConfirmation).not.toHaveBeenCalled()
  })

  it('confirms delete/kill Bash and KillShell per call without always-allow', async () => {
    const { broker, requestConfirmation } = createBroker({ mode: 'auto-except-destructive' })

    await broker.authorizeSdkTool({
      toolName: 'Bash',
      params: { command: 'rm /workspace/canary.txt' },
      context,
    })
    expect(requestConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'Bash',
        riskLevel: 'destructive',
        allowAlways: false,
        reason: expect.stringContaining('删除类操作'),
        guard: expect.stringContaining('删除类操作'),
      }),
    )

    await broker.authorizeSdkTool({
      toolName: 'KillShell',
      params: { shellId: 'shell-1' },
      context,
    })
    expect(requestConfirmation).toHaveBeenCalledTimes(2)
    expect(requestConfirmation).toHaveBeenLastCalledWith(
      expect.objectContaining({
        toolName: 'KillShell',
        riskLevel: 'destructive',
        allowAlways: false,
      }),
    )
  })

  it('auto-allows annotation-destructive but non-delete tools like browser_evaluate', async () => {
    const { broker, requestConfirmation } = createBroker({ mode: 'auto-except-destructive' })

    await expect(
      broker.authorizeInternalTool({
        toolName: 'browser_evaluate',
        params: { expression: 'document.title' },
        annotations: { readOnlyHint: false, destructiveHint: true },
        executionPolicy: null,
        context,
      }),
    ).resolves.toEqual({ behavior: 'allow' })
    expect(requestConfirmation).not.toHaveBeenCalled()
  })

  it('still confirms annotation-destructive tools in legacy auto mode', async () => {
    const { broker, requestConfirmation } = createBroker({ mode: 'auto' })

    await broker.authorizeInternalTool({
      toolName: 'browser_evaluate',
      params: { expression: 'document.title' },
      annotations: { readOnlyHint: false, destructiveHint: true },
      executionPolicy: null,
      context,
    })
    expect(requestConfirmation).toHaveBeenCalledOnce()
  })

  it('confirms structured delete tools in guarded mode even when they are annotation-writes', async () => {
    const { broker, requestConfirmation } = createBroker({ mode: 'auto-except-destructive' })

    await broker.authorizeInternalTool({
      toolName: 'cad_clear_cache',
      params: {},
      annotations: { readOnlyHint: false, destructiveHint: false },
      executionPolicy: null,
      context,
    })
    expect(requestConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'cad_clear_cache', allowAlways: false }),
    )
  })

  it('keeps module product guards (requireConfirmation) in guarded mode', async () => {
    const { broker, requestConfirmation } = createBroker({ mode: 'auto-except-destructive' })

    await broker.authorizeInternalTool({
      toolName: 'browser_click',
      params: { selector: '#publish' },
      annotations: { readOnlyHint: false, destructiveHint: false },
      executionPolicy: { requireConfirmation: true, reason: '目标动作需要人工卡点' },
      context,
    })
    expect(requestConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ reason: '目标动作需要人工卡点' }),
    )
  })

  it('does not duplicate confirmation for task-authorized actions in guarded mode', async () => {
    const { broker, requestConfirmation } = createBroker({ mode: 'auto-except-destructive' })

    await expect(
      broker.authorizeInternalTool({
        toolName: 'browser_click',
        params: { selector: '#publish' },
        annotations: { readOnlyHint: false, destructiveHint: false },
        executionPolicy: { requireConfirmation: false, authorizationSatisfied: true },
        context,
      }),
    ).resolves.toEqual({ behavior: 'allow' })
    expect(requestConfirmation).not.toHaveBeenCalled()
  })

  it('never lets task preauthorization waive the delete/kill floor', async () => {
    const { broker, requestConfirmation } = createBroker({ mode: 'auto-except-destructive' })

    await broker.authorizeInternalTool({
      toolName: 'browser_clear_cookies',
      params: {},
      annotations: { readOnlyHint: false, destructiveHint: true },
      executionPolicy: { requireConfirmation: false, authorizationSatisfied: true },
      context,
    })
    expect(requestConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ riskLevel: 'destructive', allowAlways: false }),
    )
  })

  it('auto-allows read/write classified ACP tools but keeps destructive classified ones confirmed', async () => {
    const { broker, requestConfirmation } = createBroker({ mode: 'auto-except-destructive' })

    await expect(
      broker.authorizeClassifiedTool({
        toolName: 'exec_command',
        params: { command: 'pnpm test' },
        riskLevel: 'write',
        context,
      }),
    ).resolves.toEqual({ behavior: 'allow' })

    await expect(
      broker.authorizeClassifiedTool({
        toolName: 'exec_command',
        params: { command: 'pkill -f canary' },
        riskLevel: 'destructive',
        context,
      }),
    ).resolves.toMatchObject({ behavior: 'allow', confirmationGranted: true })
    expect(requestConfirmation).toHaveBeenCalledOnce()
  })

  it('keeps the scheduled-task read-only policy unaffected by guarded mode', async () => {
    const { broker } = createBroker({ mode: 'auto-except-destructive' })

    await expect(
      broker.authorizeInternalTool({
        toolName: 'editor_write',
        params: { filePath: '/workspace/a/notes.md', content: 'x' },
        annotations: { readOnlyHint: false, destructiveHint: false },
        executionPolicy: null,
        context: {
          ...context,
          scheduledTaskPolicy: {
            origin: 'scheduled-task',
            taskId: 'task-1',
            taskRevision: 1,
            runId: 'run-1',
            workspaceRoot: '/workspace/a',
            readRoots: ['/workspace/a'],
            allowedTools: ['editor_write'],
          },
        },
      }),
    ).resolves.toMatchObject({ behavior: 'deny', reason: expect.stringContaining('定时任务') })
  })

  it('keeps unknown SDK tools denied in guarded mode', async () => {
    const { broker } = createBroker({ mode: 'auto-except-destructive' })

    await expect(
      broker.authorizeSdkTool({ toolName: 'FutureDangerousTool', params: {}, context }),
    ).resolves.toMatchObject({ behavior: 'deny' })
  })
})
