import { describe, expect, it, vi } from 'vitest'
import { AgentToolAuthorizationBroker } from './agent-tool-authorization-broker'

const context = {
  conversationId: 'conversation-a',
  agentRunId: 'run-a',
  trustedWorkspace: {
    kind: 'local' as const,
    rootPath: '/workspace/a',
    workspaceKey: '/workspace/a',
  },
}

function createBroker(options: { needsConfirmation?: boolean; approved?: boolean } = {}) {
  const requestConfirmation = vi.fn(async () => options.approved ?? true)
  const broker = new AgentToolAuthorizationBroker({
    needsConfirmation: vi.fn(() => options.needsConfirmation ?? false),
    requestConfirmation,
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

  it('forces SDK Bash confirmation but allows internal MCP to defer to ToolHost', async () => {
    const { broker, requestConfirmation } = createBroker()

    await expect(
      broker.authorizeSdkTool({ toolName: 'Bash', params: { command: 'pwd' }, context }),
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
      params: { command: 'pwd' },
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
