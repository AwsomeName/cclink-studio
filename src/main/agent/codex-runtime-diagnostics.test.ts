import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { probeCodexRuntime } from './codex-runtime-diagnostics'
import { CodexAppServer } from '../agent-core/backends/codex-app-server'
import { codexRpcError } from '../agent-core/backends/codex-runtime-policy'

const fixture = vi.hoisted(() => ({
  missing: false,
  denied: false,
  spawnError: false,
  exitCode: null as number | null,
  timeout: false,
  rejectMethod: '',
  calls: [] as string[],
  account: { type: 'chatgpt', email: 'private@example.test' } as unknown,
  config: {} as Record<string, unknown>,
  children: [] as EventEmitter[],
}))
vi.mock('node:fs/promises', async (original) => ({
  ...(await original<typeof import('node:fs/promises')>()),
  access: vi.fn(async (path: string) => {
    if (fixture.denied) throw Object.assign(new Error('denied'), { code: 'EACCES' })
    if (fixture.missing || path !== '/fixture/codex')
      throw Object.assign(new Error('missing'), { code: 'ENOENT' })
  }),
}))
vi.mock('../agent-core/runtime/claude-process-launch', () => ({
  claudeProcessCommand: (command: string, args: string[]) => ({ command, args }),
}))
vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => {
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      exitCode: null as number | null,
      signalCode: null as string | null,
      kill: vi.fn((_signal: string) => {}),
    })
    fixture.children.push(child)
    child.kill.mockImplementation(() => {
      child.exitCode = 0
      child.emit('exit', 0, null)
    })
    child.stdin.on('data', (chunk: Buffer) => {
      const message = JSON.parse(chunk.toString())
      if (!message.id) return
      fixture.calls.push(message.method)
      queueMicrotask(() => {
        if (fixture.spawnError)
          return child.emit(
            'error',
            Object.assign(new Error('SECRET_SPAWN_DETAIL'), { code: 'EACCES' }),
          )
        if (fixture.exitCode !== null) {
          child.exitCode = fixture.exitCode
          child.emit('exit', fixture.exitCode, null)
          return
        }
        if (fixture.timeout) return
        const result =
          message.method === 'account/read'
            ? { account: fixture.account, requiresOpenaiAuth: true }
            : message.method === 'config/read'
              ? { config: fixture.config }
              : {}
        child.stdout.write(
          JSON.stringify({
            id: message.id,
            ...(fixture.rejectMethod === message.method
              ? { error: { code: -32600, message: 'SECRET_PROVIDER_DETAIL sk-sensitive' } }
              : { result }),
          }) + '\n',
        )
      })
    })
    return child
  }),
}))

beforeEach(() => {
  Object.assign(fixture, {
    missing: false,
    denied: false,
    spawnError: false,
    exitCode: null,
    timeout: false,
    rejectMethod: '',
    calls: [],
    children: [],
    account: { type: 'chatgpt', email: 'private@example.test' },
    config: {},
  })
  vi.stubEnv('PATH', '/fixture')
})
afterEach(() => vi.unstubAllEnvs())

describe('read-only Codex diagnostics through the actual app-server transport', () => {
  it('stops an in-flight probe when the host lifetime ends', async () => {
    fixture.timeout = true
    const controller = new AbortController()
    const pending = probeCodexRuntime(controller.signal)
    await vi.waitFor(() => expect(fixture.children).toHaveLength(1))
    controller.abort()
    await pending
    expect(fixture.children[0]).toMatchObject({ exitCode: 0 })
    expect(fixture.calls).not.toContain('account/read')
  })
  it('retains an MCP HTTP failure classification without exporting the URL or its secret', () => {
    const error = codexRpcError(
      -32603,
      'cclink_studio initialize HTTP status 502 at http://127.0.0.1/mcp?session=private-secret',
      'thread',
    )
    expect(error).toMatchObject({
      code: 'CODEX_MCP_HTTP_502',
      stage: 'thread',
      state: 'run-failed',
    })
    expect(error.message).toContain('HTTP 502')
    expect(error.message).not.toContain('private-secret')
  })
  it('distinguishes missing executable from a file without execution permission', async () => {
    fixture.missing = true
    expect(await probeCodexRuntime()).toMatchObject({
      state: 'not-found',
      code: 'CODEX_NOT_FOUND',
      stage: 'discovery',
    })
    expect(fixture.children).toHaveLength(0)
    fixture.denied = true
    expect(await probeCodexRuntime()).toMatchObject({
      state: 'start-failed',
      code: 'CODEX_NOT_EXECUTABLE',
    })
  })
  it('checks login without a model request and never returns account identity or credentials', async () => {
    const result = await probeCodexRuntime()
    expect(result).toMatchObject({ state: 'ready', auth: 'chatgpt', executable: '/fixture/codex' })
    expect(fixture.calls).toEqual(['initialize', 'account/read', 'config/read'])
    expect(JSON.stringify(result)).not.toContain('private@example.test')
    expect(fixture.children[0]).toMatchObject({ exitCode: 0 })
  })
  it.each([
    [null, 'not-logged-in', 'CODEX_AUTH_REQUIRED'],
    [{ type: 'apiKey', key: 'secret' }, 'unsupported-auth', 'CODEX_AUTH_UNSUPPORTED'],
  ])('classifies authentication %j', async (account, state, code) => {
    fixture.account = account
    expect(await probeCodexRuntime()).toMatchObject({ state, code, stage: 'account' })
    expect(fixture.calls).not.toContain('thread/start')
  })
  it('classifies a custom provider separately from a missing login', async () => {
    fixture.config = { model_provider: 'custom', api_key: 'secret-config' }
    const result = await probeCodexRuntime()
    expect(result).toMatchObject({ state: 'unsupported-config', stage: 'config' })
    expect(JSON.stringify(result)).not.toContain('secret-config')
  })
  it('reports spawn failure and early exit without copying raw process diagnostics', async () => {
    fixture.spawnError = true
    const failed = await probeCodexRuntime()
    expect(failed).toMatchObject({
      state: 'start-failed',
      stage: 'spawn',
      code: 'CODEX_SPAWN_EACCES',
    })
    expect(JSON.stringify(failed)).not.toContain('SECRET_SPAWN_DETAIL')
    fixture.spawnError = false
    fixture.exitCode = 42
    expect(await probeCodexRuntime()).toMatchObject({
      state: 'start-failed',
      code: 'CODEX_PROCESS_EXITED',
      exitCode: 42,
    })
  })
  it('reports protocol rejection without including a provider error payload', async () => {
    fixture.rejectMethod = 'account/read'
    const result = await probeCodexRuntime()
    expect(result).toMatchObject({
      state: 'start-failed',
      stage: 'account',
      code: 'CODEX_RPC_-32600',
    })
    expect(JSON.stringify(result)).not.toContain('SECRET_PROVIDER_DETAIL')
    expect(JSON.stringify(result)).not.toContain('sk-sensitive')
  })
  it('bounds handshake timeout and cleans up the child', async () => {
    fixture.timeout = true
    const server = new CodexAppServer(
      () => {},
      () => {},
      10,
    )
    try {
      await expect(server.start('/tmp')).rejects.toMatchObject({
        code: 'CODEX_REQUEST_TIMEOUT',
        stage: 'initialize',
      })
    } finally {
      await server.stop()
    }
    expect(fixture.children[0]).toMatchObject({ exitCode: 0 })
  })
})
