import { describe, expect, it, vi } from 'vitest'
import { CclinkRemoteService } from './cclink-remote-service'
import { PermissionManager } from '../mcp/permission'
import { AgentToolAuthorizationBroker } from '../agent-core/tools/agent-tool-authorization-broker'
import {
  createCclinkEnvelope,
  type CclinkAgentToolMessage,
  type CclinkProtocolMessage,
} from '../../shared/cclink'
import type { PermissionMode } from '../../shared/settings-constants'
import type { RemoteWorkspaceRef } from '../../shared/workspace-ref'

vi.mock('electron', () => ({
  Notification: { isSupported: () => false },
  shell: { beep: vi.fn() },
}))

const ref: RemoteWorkspaceRef = {
  kind: 'remote',
  transport: 'cclink',
  endpointId: 'agent',
  workspaceId: 'workspace',
  path: '/srv/project',
}

async function setup(mode: PermissionMode = 'auto') {
  const permissions = new PermissionManager({ isDestroyed: () => true } as never)
  permissions.setMode(mode)
  const broker = new AgentToolAuthorizationBroker(permissions)
  const service = new CclinkRemoteService({} as never, null, {
    load: async () => ({
      version: 1,
      messages: {},
      sessions: [
        {
          id: 'session',
          name: '测试',
          serverId: 'agent',
          workspaceId: 'workspace',
          workspacePath: ref.path,
          status: 'idle',
          createdAt: 1,
          updatedAt: 1,
          messageCount: 0,
          contextUsage: 0,
        },
      ],
    }),
    save: async () => {},
  } as never)
  service.setToolAuthorizationHost({
    planRemoteToolAuthorization: (input) => broker.planRemoteTool(input),
    onPermissionModeChanged: (listener) => permissions.onModeChanged(listener),
  })
  await service.initialize()
  vi.spyOn(service, 'connect').mockResolvedValue({ state: 'online' })
  vi.spyOn(service, 'getStatus').mockResolvedValue({
    ref,
    state: 'online',
    compatibility: 'compatible',
    workspacePath: ref.path,
    capabilities: {
      file: { tree: true, read: true, write: true, create: true, rename: true, delete: true },
      shell: { pty: false },
      agent: { session: true, stream: true },
    },
  })
  const send = vi.spyOn(service.getRequestRouter(), 'send').mockResolvedValue(undefined)
  const request = vi
    .spyOn(service.getRequestRouter(), 'request')
    .mockImplementation(async (_server, message) => ({
      ...createCclinkEnvelope('tool_approval_ack'),
      session_id: 'session',
      tool_use_id: (message as { tool_use_id: string }).tool_use_id,
      approved: (message as { approved: boolean }).approved,
      status: 'accepted',
    }))
  await service.sendAgentMessage(ref, 'session', '在这个工作空间完成常规开发任务')
  const runId = send.mock.calls[0][1].request_id!
  const handle = (event: CclinkProtocolMessage, server = 'agent') =>
    (
      service as unknown as {
        handleProtocolMessage(server: string, event: CclinkProtocolMessage): Promise<void>
      }
    ).handleProtocolMessage(server, event)
  const event = (extra: Partial<CclinkAgentToolMessage> = {}): CclinkAgentToolMessage => ({
    ...createCclinkEnvelope('agent_tool', { request_id: runId, trace_id: runId }),
    session_id: 'session',
    msg_id: 'message',
    tool_use_id: 'tool',
    tool: 'Bash',
    input: { command: 'pnpm test', cwd: ref.path },
    state: 'pending',
    requires_approval: true,
    ...extra,
  })
  const tool = (id = 'tool') =>
    service
      .listMessages('session')
      .find((message) => message.type === 'agentTool' && message.tool.id === id)
  return { service, permissions, request, handle, event, tool, runId }
}

describe('remote tools use the Studio authorization broker', () => {
  it.each<PermissionMode>(['auto', 'auto-except-destructive'])(
    'continuously permits ordinary work in %s and truthfully marks app decisions',
    async (mode) => {
      const { handle, event, request, tool } = await setup(mode)
      const operations = [
        { tool: 'Read', input: { file_path: '/srv/project/a.ts' } },
        { tool: 'Write', input: { file_path: '/srv/project/b.ts', content: 'export {}' } },
        {
          tool: 'Edit',
          input: { file_path: '/srv/project/a.ts', old_string: 'a', new_string: 'b' },
        },
        { tool: 'Bash', input: { command: 'pnpm test', cwd: ref.path } },
      ]
      for (const [index, operation] of operations.entries()) {
        await handle(event({ ...operation, tool_use_id: `tool-${index}` }))
        expect(tool(`tool-${index}`)).toMatchObject({
          tool: { requiresApproval: false, approvalResolved: true },
        })
      }
      expect(request).toHaveBeenCalledTimes(4)
      for (const [, message] of request.mock.calls)
        expect(message).toMatchObject({ approved: true, explicit_user_decision: false })
    },
  )

  it.each<Partial<CclinkAgentToolMessage>>([
    { input: { command: 'rm -rf build' } },
    { input: { command: 'kill 12345' } },
    { input: { command: 'bash -c "$COMMAND"' } },
    {
      tool: 'Edit',
      tool_kind: 'delete',
      input: { file_path: '/srv/project/a', old_string: 'a', new_string: '' },
    },
    { tool: 'Write', input: { file_path: '/etc/config', content: 'x' } },
    { tool: 'Write', input: { file_path: '/srv/project/a' } },
    { tool: 'mcp__cclink_studio__browser_click' },
    { tool: 'UnknownTool' },
    { payload_truncated: true },
    { input: { command: 'pnpm test', command_truncated: true } },
    { requires_explicit_approval: true },
    { risk_level: 'high' },
    { input: { command: 'pnpm test', cwd: '../../' } },
    { input: { command: 'pwsh -Command Remove-Item canary' } },
    { tool: 'NotebookEdit', input: { notebook_path: '/srv/project/a.ipynb', edit_mode: 'delete' } },
  ])('retains a human decision for unsafe or incomplete evidence: %j', async (extra) => {
    const { handle, event, request, tool } = await setup('auto-except-destructive')
    await handle(event(extra))
    expect(request).not.toHaveBeenCalled()
    expect(tool()).toMatchObject({
      tool: { requiresApproval: true, policyReason: expect.any(String) },
    })
  })

  it('keeps manual refusal and approval one-shot with truthful source and no future delete grant', async () => {
    const { handle, event, request, tool, service, runId } = await setup()
    await handle(event({ input: { command: 'rm canary' } }))
    await service.resolveToolApproval({
      ref,
      sessionId: 'session',
      requestId: runId,
      toolUseId: 'tool',
      approved: false,
    })
    expect(request.mock.calls[0][1]).toMatchObject({
      approved: false,
      explicit_user_decision: true,
    })
    expect(tool()).toMatchObject({ tool: { state: 'denied', requiresApproval: false } })
    await handle(event({ tool_use_id: 'second-delete', input: { command: 'rm another-canary' } }))
    expect(tool('second-delete')).toMatchObject({ tool: { requiresApproval: true } })
    expect(request).toHaveBeenCalledOnce()
  })

  it('rechecks an existing regular request after the user changes the shared mode, but retains deletes', async () => {
    const { handle, event, request, permissions, tool } = await setup('strict')
    await handle(event())
    await handle(event({ tool_use_id: 'delete', input: { command: 'rm canary' } }))
    expect(request).not.toHaveBeenCalled()
    permissions.setMode('auto-except-destructive')
    await vi.waitFor(() => expect(tool()).toMatchObject({ tool: { requiresApproval: false } }))
    expect(tool('delete')).toMatchObject({ tool: { requiresApproval: true } })
    expect(request).toHaveBeenCalledOnce()
  })

  it('permits reads but asks for writes in categorized mode', async () => {
    const { handle, event, request, tool } = await setup('categorized')
    await handle(event({ tool: 'Read', input: { file_path: '/srv/project/a' } }))
    await handle(
      event({
        tool: 'Write',
        tool_use_id: 'write',
        input: { file_path: '/srv/project/a', content: 'x' },
      }),
    )
    expect(request).toHaveBeenCalledOnce()
    expect(tool('write')).toMatchObject({ tool: { requiresApproval: true } })
  })

  it.each(['Task', 'Agent', 'Skill', 'ExitPlanMode'])(
    'applies the existing SDK write policy to %s without an extra remote-only prompt',
    async (toolName) => {
      const { handle, event, request } = await setup('auto')
      await handle(event({ tool: toolName, input: { description: 'current workspace task' } }))
      expect(request).toHaveBeenCalledOnce()
      await handle(
        event({ tool: toolName, tool_use_id: 'explicit', requires_explicit_approval: true }),
      )
      expect(request).toHaveBeenCalledOnce()
    },
  )

  it('does not import a local Always grant into a remote workspace', async () => {
    const { permissions, handle, event, request } = await setup('strict')
    ;(permissions as unknown as { alwaysAllowed: Set<string> }).alwaysAllowed.add('Bash')
    await handle(event())
    expect(request).not.toHaveBeenCalled()
  })

  it.each(['foreign-run', 'expired', 'wrong-device', 'stopped', 'disconnect'] as const)(
    'never auto-approves stale or unrelated requests: %s',
    async (scenario) => {
      const { service, handle, event, request, permissions } = await setup('strict')
      if (scenario === 'stopped') service.stopTrackingAgentRun(ref, 'session')
      if (scenario === 'disconnect') {
        await handle(event())
        await service.disconnect()
      } else {
        await handle(
          event({
            ...(scenario === 'foreign-run' ? { request_id: 'foreign', trace_id: 'foreign' } : {}),
            ...(scenario === 'expired' ? { expires_at: Date.now() - 1_000 } : {}),
          }),
          scenario === 'wrong-device' ? 'other-device' : 'agent',
        )
      }
      permissions.setMode('auto')
      await Promise.resolve()
      expect(request).not.toHaveBeenCalled()
    },
  )

  it('rechecks a stricter mode after async connection/capability work, before sending', async () => {
    const { service, handle, event, permissions, request } = await setup()
    let connected!: () => void
    vi.mocked(service.connect).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          connected = () => resolve({ state: 'online' })
        }),
    )
    const pending = handle(event())
    permissions.setMode('strict')
    connected()
    await pending
    expect(request).not.toHaveBeenCalled()
  })

  it('keeps a card on delivery failure and does not flood retries on duplicate events', async () => {
    const { handle, event, request, tool, service, runId } = await setup()
    request.mockRejectedValueOnce(new Error('network unavailable'))
    await handle(event())
    await handle(event())
    expect(request).toHaveBeenCalledOnce()
    expect(tool()).toMatchObject({ tool: { requiresApproval: true } })
    await service.resolveToolApproval({
      ref,
      sessionId: 'session',
      requestId: runId,
      toolUseId: 'tool',
      approved: true,
    })
    expect(request).toHaveBeenCalledTimes(2)
    expect(request.mock.calls[1][1]).toMatchObject({ explicit_user_decision: true })
  })

  it('does not flash a manual card when progress races an automatic decision awaiting ACK', async () => {
    const { service, handle, event, request } = await setup()
    let acknowledge!: () => void
    request.mockImplementationOnce(
      async () =>
        new Promise((resolve) => {
          acknowledge = () =>
            resolve({
              ...createCclinkEnvelope('tool_approval_ack'),
              session_id: 'session',
              tool_use_id: 'tool',
              approved: true,
              status: 'accepted',
            })
        }),
    )
    const events: boolean[] = []
    service.onRealtimeEvent((value) => {
      if (value.message?.type === 'agentTool')
        events.push(value.message.tool.requiresApproval === true)
    })
    const initial = handle(event())
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce())
    const progress = handle(
      event({ state: 'executing', requires_approval: undefined, input: undefined }),
    )
    await Promise.resolve()
    expect(events).not.toContain(true)
    acknowledge()
    await Promise.all([initial, progress])
    expect(events).not.toContain(true)
    expect(request).toHaveBeenCalledOnce()
  })

  it('keeps the remote confirmation usable when the shared policy host is unavailable', async () => {
    const { service, handle, event, request, tool } = await setup()
    service.setToolAuthorizationHost(null)
    await handle(event())
    expect(request).not.toHaveBeenCalled()
    expect(tool()).toMatchObject({
      tool: { requiresApproval: true, policyReason: expect.stringContaining('暂不可用') },
    })
  })
})
