import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { McpToolHost } from '../tools/tool-host'
import { LocalCodexBackend } from './local-codex-backend'
import { CodexAppServer } from './codex-app-server'

// Opt-in: real native processes and model requests, using the existing file login.
describe.skipIf(process.env.CCLINK_CODEX_RESUME_REAL_SMOKE !== '1')('real Codex resume', () => {
  it('identifies a missing native rollout without making a model request', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'studio-codex-missing-'))
    const server = new CodexAppServer(
      () => {},
      () => {},
    )
    try {
      await server.start(cwd)
      await expect(
        server.request('thread/resume', {
          threadId: '00000000-0000-0000-0000-000000000000',
          excludeTurns: true,
        }),
      ).rejects.toMatchObject({ code: 'CODEX_THREAD_NOT_FOUND', stage: 'thread' })
    } finally {
      await server.stop()
      await rm(cwd, { recursive: true, force: true })
    }
  }, 30_000)
  it('continues the same native thread with fresh processes and tool sessions', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'studio-codex-resume-'))
    const host = new McpToolHost({
      getMode: () => 'auto',
      needsConfirmation: () => false,
      requestConfirmation: async () => false,
    })
    let backend = new LocalCodexBackend(host, () => cwd)
    try {
      await host.start()
      await backend.sendMessage(
        'Remember the marker STUDIO_RESUME_7642. Reply only OK. Do not use tools.',
        {
          workspacePath: cwd,
          disableBuiltinTools: true,
        },
      )
      const sessionId = backend.getSessionId()
      expect(sessionId).toBeTruthy()
      await backend.destroy()
      backend = new LocalCodexBackend(host, () => cwd)
      backend.setSessionId(sessionId)
      let answer = ''
      backend.onEvent((type, payload) => {
        if (type === 'complete') answer = String((payload as { result?: unknown }).result ?? '')
      })
      await backend.sendMessage(
        'What marker did I ask you to remember? Reply only that marker. Do not use tools.',
        {
          workspacePath: cwd,
          disableBuiltinTools: true,
        },
      )
      expect(backend.getSessionId()).toBe(sessionId)
      expect(answer).toContain('STUDIO_RESUME_7642')
    } finally {
      await backend.destroy()
      await host.stop()
      await rm(cwd, { recursive: true, force: true })
    }
  }, 180_000)
})
