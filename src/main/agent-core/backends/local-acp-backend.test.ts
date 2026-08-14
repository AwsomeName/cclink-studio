import { join } from 'node:path'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildCodexAcpEnvironment,
  LocalAcpBackend,
  probeCodexAcpExecutable,
} from './local-acp-backend'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('Codex ACP runtime boundary', () => {
  it('only injects the dedicated Codex key and isolated home', () => {
    const environment = buildCodexAcpEnvironment({
      apiKey: 'codex-only-secret',
      codexHome: '/tmp/cclink-codex-home',
    })

    expect(environment).toMatchObject({
      CODEX_API_KEY: 'codex-only-secret',
      CODEX_HOME: '/tmp/cclink-codex-home',
      HOME: '/tmp/cclink-codex-home',
      NO_BROWSER: '1',
      INITIAL_AGENT_MODE: 'agent',
    })
    expect(environment).not.toHaveProperty('OPENAI_API_KEY')
    expect(environment).not.toHaveProperty('ANTHROPIC_API_KEY')
    expect(environment).not.toHaveProperty('CODEX_PATH')
  })

  it('accepts the pinned repository ACP executable', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'cclink-codex-acp-test-'))
    temporaryDirectories.push(codexHome)

    await expect(
      probeCodexAcpExecutable({
        executablePath: join(process.cwd(), 'node_modules', '.bin', 'codex-acp'),
        codexHome,
      }),
    ).resolves.toMatchObject({ version: '1.3.0' })
  })

  it('maps text, tool, permission, session and cancel over stdio', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cclink-codex-acp-fake-'))
    temporaryDirectories.push(root)
    const executable = join(root, 'fake-codex-acp.mjs')
    await writeFile(executable, FAKE_CODEX_ACP, { mode: 0o700 })
    const decisions: string[] = []
    const events: Array<{ type: string; data: unknown }> = []
    const backend = new LocalAcpBackend({
      executablePath: executable,
      apiKey: 'test-key',
      codexHome: join(root, 'home'),
      requestPermission: async (request) => {
        decisions.push(request.toolName)
        return true
      },
    })
    backend.onEvent((type, data) => events.push({ type, data }))

    await backend.sendMessage('hello', {
      conversationId: 'codex-thread',
      workspacePath: root,
    })

    expect(backend.getSessionId()).toBe('fake-session-1')
    expect(decisions).toEqual(['write_file'])
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'stream',
          data: expect.objectContaining({
            protocol: 'studio-agent-event-v1',
            event: expect.objectContaining({ type: 'text-delta', text: 'hello from fake ACP' }),
          }),
        }),
        expect.objectContaining({
          type: 'complete',
          data: expect.objectContaining({ result: 'hello from fake ACP' }),
        }),
      ]),
    )

    const completedBeforeCancel = events.filter((event) => event.type === 'complete').length
    const pending = backend.sendMessage('WAIT', {
      conversationId: 'codex-thread',
      workspacePath: root,
    })
    await vi.waitFor(() => expect(backend.getStatus().connected).toBe(true))
    await backend.abort()
    await pending
    expect(events.filter((event) => event.type === 'complete')).toHaveLength(completedBeforeCancel)

    await backend.destroy()
  })
})

const FAKE_CODEX_ACP = `#!/usr/bin/env node
import readline from 'node:readline'

if (process.argv.includes('--version')) {
  process.stdout.write('@agentclientprotocol/codex-acp 1.3.0\\n')
  process.exit(0)
}

const lines = readline.createInterface({ input: process.stdin })
let pendingPromptId = null
const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n')

lines.on('line', (line) => {
  const message = JSON.parse(line)
  if (message.method === 'initialize') {
    send({ jsonrpc: '2.0', id: message.id, result: {
      protocolVersion: 1,
      agentInfo: { name: '@agentclientprotocol/codex-acp', version: '1.3.0' },
      agentCapabilities: { loadSession: true, sessionCapabilities: { resume: true } },
      authMethods: [{ id: 'api-key', name: 'API Key' }]
    } })
  } else if (message.method === 'authenticate') {
    send({ jsonrpc: '2.0', id: message.id, result: {} })
  } else if (message.method === 'session/new') {
    send({ jsonrpc: '2.0', id: message.id, result: { sessionId: 'fake-session-1' } })
  } else if (message.method === 'session/resume') {
    send({ jsonrpc: '2.0', id: message.id, result: {} })
  } else if (message.method === 'session/prompt') {
    pendingPromptId = message.id
    const text = message.params.prompt[0]?.text ?? ''
    if (text.includes('WAIT')) return
    send({ jsonrpc: '2.0', method: 'session/update', params: {
      sessionId: message.params.sessionId,
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hello from fake ACP' }, messageId: 'fake-message-1' }
    } })
    send({ jsonrpc: '2.0', id: 'permission-1', method: 'session/request_permission', params: {
      sessionId: message.params.sessionId,
      toolCall: { toolCallId: 'tool-1', kind: 'edit', title: 'Write file', name: 'write_file', rawInput: { path: 'demo.txt' } },
      options: [
        { optionId: 'allow', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'reject', name: 'Reject once', kind: 'reject_once' }
      ]
    } })
  } else if (message.id === 'permission-1') {
    send({ jsonrpc: '2.0', method: 'session/update', params: {
      sessionId: 'fake-session-1',
      update: { sessionUpdate: 'tool_call', toolCallId: 'tool-1', kind: 'edit', status: 'in_progress', title: 'Write file', name: 'write_file', rawInput: { path: 'demo.txt' } }
    } })
    send({ jsonrpc: '2.0', method: 'session/update', params: {
      sessionId: 'fake-session-1',
      update: { sessionUpdate: 'tool_call_update', toolCallId: 'tool-1', status: 'completed', rawOutput: 'ok' }
    } })
    send({ jsonrpc: '2.0', id: pendingPromptId, result: { stopReason: 'end_turn' } })
    pendingPromptId = null
  } else if (message.method === 'session/cancel' && pendingPromptId !== null) {
    send({ jsonrpc: '2.0', id: pendingPromptId, result: { stopReason: 'cancelled' } })
    pendingPromptId = null
  } else if (message.method === 'session/close') {
    send({ jsonrpc: '2.0', id: message.id, result: {} })
  }
})
`
