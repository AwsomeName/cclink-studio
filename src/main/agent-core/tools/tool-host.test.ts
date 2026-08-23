import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { McpToolHost, type ToolConfirmationInput } from './tool-host'
import type { ToolModule } from './types'

describe('McpToolHost tool session context', () => {
  let host: McpToolHost | null = null

  afterEach(async () => {
    await host?.stop()
    host = null
  })

  it('attaches conversationId to tool confirmation requests', async () => {
    const requestConfirmation = vi.fn(async () => true)
    const execute = vi.fn(async () => ({ ok: true }))
    host = new McpToolHost({
      needsConfirmation: () => true,
      requestConfirmation,
    })
    host.registerModule(createModule(execute))
    const port = await host.start()
    const token = host.createToolSession({
      conversationId: 'conv-123',
      workspaceKey: '/workspace/a',
      trustedWorkspace: {
        kind: 'local',
        rootPath: '/workspace/a',
        workspaceKey: '/workspace/a',
      },
      agentRunId: 'run-123',
      agentGoal: 'write the file',
    })

    const response = await fetch(`http://127.0.0.1:${port}/mcp?session=${token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'test_write', arguments: { value: 1 } },
      }),
    })

    expect(response.status).toBe(200)
    expect(requestConfirmation).toHaveBeenCalledWith(
      expect.objectContaining<ToolConfirmationInput>({
        conversationId: 'conv-123',
        runId: 'run-123',
        toolName: 'test_write',
        params: { value: 1 },
        riskLevel: 'write',
      }),
    )
    expect(execute).toHaveBeenCalledWith(
      'test_write',
      { value: 1 },
      expect.objectContaining({
        conversationId: 'conv-123',
        workspaceKey: '/workspace/a',
        trustedWorkspace: {
          kind: 'local',
          rootPath: '/workspace/a',
          workspaceKey: '/workspace/a',
        },
        agentRunId: 'run-123',
        agentGoal: 'write the file',
        confirmationGranted: true,
        abortSignal: expect.any(AbortSignal),
      }),
    )
  })

  it('cancels a pending confirmation for the exact run before the tool can execute', async () => {
    let resolveConfirmation!: (approved: boolean) => void
    const requestConfirmation = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveConfirmation = resolve
        }),
    )
    const cancelForRun = vi.fn((conversationId: string, runId: string) => {
      expect({ conversationId, runId }).toEqual({
        conversationId: 'conversation-1',
        runId: 'run-1',
      })
      resolveConfirmation(false)
    })
    const execute = vi.fn(async () => ({ ok: true }))
    host = new McpToolHost({
      needsConfirmation: () => true,
      requestConfirmation,
      cancelForRun,
    })
    host.registerModule(createModule(execute))
    const port = await host.start()
    const token = host.createToolSession({
      conversationId: 'conversation-1',
      workspaceKey: '/workspace/a',
      agentRunId: 'run-1',
    })
    const responsePromise = callMcp(port, token, 'tools/call', {
      name: 'test_write',
      arguments: { value: 1 },
    })
    await vi.waitFor(() => expect(requestConfirmation).toHaveBeenCalledTimes(1))

    await host.cancelToolSession(token)
    const response = await responsePromise

    expect(cancelForRun).toHaveBeenCalledWith('conversation-1', 'run-1')
    expect(response.result.isError).toBe(true)
    expect(execute).not.toHaveBeenCalled()
  })

  it('signals an already-started cooperative tool when its exact run is cancelled', async () => {
    let observedSignal: AbortSignal | undefined
    const execute = vi.fn(
      async (
        _toolName: string,
        _args: Record<string, unknown>,
        context?: { abortSignal?: AbortSignal },
      ) =>
        new Promise<never>((_resolve, reject) => {
          observedSignal = context?.abortSignal
          context?.abortSignal?.addEventListener('abort', () => reject(new Error('tool aborted')), {
            once: true,
          })
        }),
    )
    host = new McpToolHost({
      needsConfirmation: () => false,
      requestConfirmation: vi.fn(async () => true),
    })
    host.registerModule(createModule(execute))
    const port = await host.start()
    const token = host.createToolSession({
      conversationId: 'conversation-1',
      workspaceKey: '/workspace/a',
      agentRunId: 'run-1',
    })
    const responsePromise = callMcp(port, token, 'tools/call', {
      name: 'test_write',
      arguments: { value: 1 },
    })
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1))

    const cancellation = host.cancelToolSession(token)
    const response = await responsePromise
    await cancellation

    expect(observedSignal?.aborted).toBe(true)
    expect(response.result.isError).toBe(true)
    expect(response.result.content[0]?.text).toContain('tool aborted')
  })

  it('keeps cancellation pending until a signal-ignorant in-flight tool settles', async () => {
    let finishTool!: (value: { ok: boolean }) => void
    const execute = vi.fn(
      () =>
        new Promise<{ ok: boolean }>((resolve) => {
          finishTool = resolve
        }),
    )
    host = new McpToolHost({
      needsConfirmation: () => false,
      requestConfirmation: vi.fn(async () => true),
    })
    host.registerModule(createModule(execute))
    const port = await host.start()
    const token = host.createToolSession({
      conversationId: 'conversation-1',
      workspaceKey: '/workspace/a',
      agentRunId: 'run-1',
    })
    const responsePromise = callMcp(port, token, 'tools/call', {
      name: 'test_write',
      arguments: { value: 1 },
    })
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1))

    let cancellationSettled = false
    const cancellation = host.cancelToolSession(token).finally(() => {
      cancellationSettled = true
    })
    await Promise.resolve()
    expect(cancellationSettled).toBe(false)

    finishTool({ ok: true })
    await cancellation
    const response = await responsePromise

    expect(cancellationSettled).toBe(true)
    expect(response.result.isError).toBe(true)
    expect(response.result.content[0]?.text).toContain('run 已取消')
  })

  it('enforces a module runtime policy even when global auto mode allows the tool', async () => {
    const requestConfirmation = vi.fn(async () => true)
    const execute = vi.fn(async () => ({ ok: true }))
    host = new McpToolHost({
      needsConfirmation: () => false,
      requestConfirmation,
    })
    host.registerModule({
      ...createModule(execute),
      getExecutionPolicy: async () => ({
        requireConfirmation: true,
        riskLevel: 'destructive',
        reason: '最终发布动作',
        allowAlways: false,
      }),
    })
    const port = await host.start()

    await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'test_write', arguments: { value: 2 } },
      }),
    })

    expect(requestConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: '最终发布动作',
        allowAlways: false,
        riskLevel: 'destructive',
      }),
    )
    expect(execute).toHaveBeenCalledWith('test_write', { value: 2 }, { confirmationGranted: true })
  })

  it('hides disabled module tools and rejects calls from stale clients', async () => {
    const execute = vi.fn(async () => ({ ok: true }))
    host = new McpToolHost({
      needsConfirmation: () => false,
      requestConfirmation: vi.fn(async () => true),
    })
    host.registerModule(createModule(execute))

    expect(host.getAllTools()).toHaveLength(1)
    expect(host.setModuleEnabled('test', false)).toBe(true)
    expect(host.getAllTools()).toEqual([])
    expect(host.getRegisteredModules()).toMatchObject([
      { name: 'test', enabled: false, tools: [{ name: 'test_write' }] },
    ])

    const port = await host.start()
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'test_write', arguments: {} },
      }),
    })
    const payload = (await response.json()) as {
      result: { content: Array<{ text: string }>; isError?: boolean }
    }

    expect(payload.result.isError).toBe(true)
    expect(payload.result.content[0]?.text).toContain('已在设置中禁用')
    expect(execute).not.toHaveBeenCalled()
  })

  it('hard-limits scheduled task sessions independently from global auto mode', async () => {
    const root = await mkdtemp(join(tmpdir(), 'scheduled-tool-policy-'))
    const workspace = join(root, 'workspace')
    const outside = join(root, 'outside.md')
    await mkdir(workspace)
    await writeFile(join(workspace, 'README.md'), '# Allowed\n')
    await writeFile(outside, '# Secret\n')
    const editorExecute = vi.fn(async () => ({ ok: true }))
    const terminalExecute = vi.fn(async () => ({ ok: true }))
    const requestConfirmation = vi.fn(async () => true)
    host = new McpToolHost({
      needsConfirmation: () => true,
      requestConfirmation,
    })
    host.registerModule(createEditorModule(editorExecute))
    host.registerModule(createTerminalModule(terminalExecute))
    const port = await host.start()
    const token = host.createToolSession({
      conversationId: 'scheduled-conversation',
      workspaceKey: workspace,
      scheduledTaskPolicy: {
        origin: 'scheduled-task',
        taskId: 'task-1',
        taskRevision: 1,
        runId: 'run-1',
        workspaceRoot: workspace,
        readRoots: [workspace],
        allowedTools: ['editor_read', 'editor_list'],
      },
    })

    const listed = await callMcp(port, token, 'tools/list')
    expect(listed.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      'editor_read',
      'editor_list',
    ])
    const terminal = await callMcp(port, token, 'tools/call', {
      name: 'terminal_run',
      arguments: { command: 'touch escaped' },
    })
    expect(terminal.result.isError).toBe(true)
    expect(terminal.result.content[0].text).toContain('不支持工具')
    const escapedRead = await callMcp(port, token, 'tools/call', {
      name: 'editor_read',
      arguments: { filePath: outside },
    })
    expect(escapedRead.result.isError).toBe(true)
    expect(escapedRead.result.content[0].text).toContain('只能读取声明')
    const allowedRead = await callMcp(port, token, 'tools/call', {
      name: 'editor_read',
      arguments: { filePath: join(workspace, 'README.md') },
    })
    expect(allowedRead.result.isError).toBeUndefined()
    expect(terminalExecute).not.toHaveBeenCalled()
    expect(editorExecute).toHaveBeenCalledTimes(1)
    expect(requestConfirmation).not.toHaveBeenCalled()
    await rm(root, { recursive: true, force: true })
  })
})

function createModule(
  execute: ToolModule['execute'] = vi.fn(async () => ({ ok: true })),
): ToolModule {
  return {
    name: 'test',
    tools: [
      {
        name: 'test_write',
        description: 'write',
        inputSchema: {
          type: 'object',
          properties: {},
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
        },
      },
    ],
    execute,
  }
}

function createEditorModule(execute: ToolModule['execute']): ToolModule {
  const tool = (name: string): ToolModule['tools'][number] => ({
    name,
    description: name,
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false },
  })
  return {
    name: 'editor',
    tools: [tool('editor_read'), tool('editor_list'), tool('editor_write')],
    execute,
  }
}

function createTerminalModule(execute: ToolModule['execute']): ToolModule {
  return {
    name: 'terminal',
    tools: [
      {
        name: 'terminal_run',
        description: 'run',
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: false, destructiveHint: true },
      },
    ],
    execute,
  }
}

async function callMcp(
  port: number,
  token: string,
  method: string,
  params?: Record<string, unknown>,
): Promise<any> {
  const response = await fetch(`http://127.0.0.1:${port}/mcp?session=${token}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  return response.json()
}
