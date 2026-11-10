import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalCodexBackend, codexPatchStaysInWorkspace } from './local-codex-backend'
import { McpToolHost } from '../tools/tool-host'
import { codexEnvironment } from './codex-app-server'

afterEach(() => vi.unstubAllEnvs())

it('does not pass Claude credentials or Electron process mode to Codex', () => {
  vi.stubEnv('ANTHROPIC_API_KEY', 'must-not-inherit')
  vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', 'must-not-inherit')
  vi.stubEnv('ELECTRON_RUN_AS_NODE', '1')
  vi.stubEnv('OPENAI_API_KEY', 'must-not-inherit')
  vi.stubEnv('CODEX_API_KEY', 'must-not-inherit')
  vi.stubEnv('OPENAI_BASE_URL', 'https://example.test')
  const env = codexEnvironment()
  expect(env.ANTHROPIC_API_KEY).toBeUndefined()
  expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
  expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined()
  expect(env.OPENAI_API_KEY).toBeUndefined()
  expect(env.CODEX_API_KEY).toBeUndefined()
  expect(env.OPENAI_BASE_URL).toBeUndefined()
  expect(process.env.ANTHROPIC_API_KEY).toBe('must-not-inherit')
})

it('validates both patch paths and rename destinations through symlinked parents', async () => {
  const root = await mkdtemp(join(tmpdir(), 'studio-codex-paths-'))
  const cwd = join(root, 'workspace')
  const outside = join(root, 'outside')
  await mkdir(cwd)
  await mkdir(outside)
  await symlink(outside, join(cwd, 'escape'))
  const change = (path: string, move_path: string | null = null) => [
    { path, kind: { type: 'update', move_path } },
  ]
  try {
    expect(await codexPatchStaysInWorkspace(change('file.txt', 'nested/new.txt'), cwd)).toBe(true)
    expect(await codexPatchStaysInWorkspace(change('file.txt', '../outside/new.txt'), cwd)).toBe(
      false,
    )
    expect(
      await codexPatchStaysInWorkspace(change('file.txt', join(outside, 'new.txt')), cwd),
    ).toBe(false)
    expect(await codexPatchStaysInWorkspace(change('escape/new.txt'), cwd)).toBe(false)
    expect(await codexPatchStaysInWorkspace(change('file.txt', 'escape/new.txt'), cwd)).toBe(false)
    expect(
      await codexPatchStaysInWorkspace(
        [{ path: 'file.txt', kind: { type: 'future-operation' } }],
        cwd,
      ),
    ).toBe(false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

describe.skipIf(process.env.CCLINK_CODEX_REAL_SMOKE !== '1')('real local Codex', () => {
  it('uses Studio MCP, resumes its thread and honours a denied destructive operation', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'studio-codex-real-'))
    const calls: string[] = []
    const confirmations: string[] = []
    const host = new McpToolHost({
      getMode: () => 'auto-except-destructive',
      needsConfirmation: (_name, annotations) => annotations?.readOnlyHint !== true,
      requestConfirmation: async (input) => {
        confirmations.push(input.toolName)
        return false
      },
    })
    host.registerModule({
      name: 'probe',
      tools: [
        {
          name: 'studio_probe',
          description: 'Returns the exact secret test marker for this Studio workspace.',
          inputSchema: { type: 'object', properties: {} },
          annotations: { readOnlyHint: true, destructiveHint: false },
        },
      ],
      execute: async () => {
        calls.push('studio_probe')
        return { marker: 'STUDIO_CODEX_MCP_7291' }
      },
    })
    // Permit read tools, deny all writes and destructive native calls.
    const authorize = vi.spyOn(host, 'authorizeSdkTool')
    const classified = vi.spyOn(host, 'authorizeClassifiedTool')
    await host.start()
    let backend = new LocalCodexBackend(host, () => cwd)
    const events: Array<{ type: string; data: unknown }> = []
    backend.onEvent((type, data) => events.push({ type, data }))
    try {
      await backend.sendMessage(
        'Call the cclink_studio studio_probe tool once. Then reply with the marker it returns. Do not use shell or other tools.',
        { conversationId: 'probe', runId: 'run-1', workspacePath: cwd },
      )
      expect(calls, JSON.stringify(events)).toEqual(['studio_probe'])
      expect(JSON.stringify(events)).toContain('STUDIO_CODEX_MCP_7291')
      const id = backend.getSessionId()
      expect(id).toBeTruthy()
      await backend.destroy()
      backend = new LocalCodexBackend(host, () => cwd)
      backend.setSessionId(id)
      backend.onEvent((type, data) => events.push({ type, data }))
      await backend.sendMessage(
        'What exact marker did the tool return in our previous turn? Reply with only that marker, without using tools.',
        { conversationId: 'probe', runId: 'run-2', workspacePath: cwd },
      )
      expect(backend.getSessionId()).toBe(id)
      expect(JSON.stringify(events.at(-1))).toContain('STUDIO_CODEX_MCP_7291')
      await writeFile(join(cwd, 'keep.txt'), 'KEEP')
      await backend.sendMessage(
        'Delete keep.txt using a shell command. If permission is denied, stop; do not retry or use another tool.',
        { conversationId: 'probe', runId: 'run-3', workspacePath: cwd },
      )
      expect(await readFile(join(cwd, 'keep.txt'), 'utf8')).toBe('KEEP')
      expect(
        authorize.mock.calls.length + classified.mock.calls.length,
        JSON.stringify(events.slice(-30)),
      ).toBeGreaterThan(0)
      expect(confirmations.length).toBeGreaterThan(0)
      const beforePatch = classified.mock.calls.length
      await backend.sendMessage(
        'Use the native apply_patch tool to delete keep.txt. This is a separate permission check. If denied, stop without retrying or using shell.',
        { conversationId: 'probe', runId: 'run-4', workspacePath: cwd },
      )
      expect(await readFile(join(cwd, 'keep.txt'), 'utf8')).toBe('KEEP')
      expect(classified.mock.calls.length, JSON.stringify(events.slice(-30))).toBeGreaterThan(
        beforePatch,
      )
    } finally {
      await backend.destroy()
      await host.stop()
      await rm(cwd, { recursive: true, force: true })
    }
  }, 180_000)
})
