import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { McpToolHost } from '../tools/tool-host'
import { LocalCodexBackend } from './local-codex-backend'
import { CodexAppServer } from './codex-app-server'
import { assertCodexPermissionBoundary } from './codex-runtime-policy'

// Opt-in: real native processes and model requests, using the existing file login.
describe.skipIf(process.env.CCLINK_CODEX_RESUME_REAL_SMOKE !== '1')('real Codex resume', () => {
  it('replaces inherited runtime roots before validating a resumed thread', async () => {
    const home = await mkdtemp(join(tmpdir(), 'studio-codex-roots-'))
    const cwd = join(home, 'workspace')
    const extra = join(home, 'old-workspace')
    const sessionId = randomUUID()
    const directory = join(home, 'sessions', '2026', '11', '16')
    await Promise.all([mkdir(cwd), mkdir(extra), mkdir(directory, { recursive: true })])
    // Synthetic local history: no credentials, user content, or model request.
    await writeFile(
      join(directory, `rollout-2026-11-16T00-00-00-${sessionId}.jsonl`),
      [
        {
          type: 'session_meta',
          payload: {
            id: sessionId,
            timestamp: '2026-11-16T00:00:00Z',
            cwd,
            runtime_workspace_roots: [cwd, extra],
            originator: 'cclink_studio',
            cli_version: '0.169.0',
            source: 'cli',
            model_provider: 'openai',
            base_instructions: { text: '' },
          },
        },
        {
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Fixture only.' }],
          },
        },
      ]
        .map((event) => JSON.stringify({ timestamp: '2026-11-16T00:00:00Z', ...event }))
        .join('\n') + '\n',
    )
    vi.stubEnv('CODEX_HOME', home)
    const params = {
      threadId: sessionId,
      cwd,
      excludeTurns: true,
      modelProvider: 'openai',
      approvalPolicy: 'untrusted',
      approvalsReviewer: 'user',
      sandbox: 'workspace-write',
      config: {
        'sandbox_workspace_write.network_access': false,
        'sandbox_workspace_write.writable_roots': [],
        'sandbox_workspace_write.exclude_tmpdir_env_var': true,
        'sandbox_workspace_write.exclude_slash_tmp': true,
      },
    }
    try {
      for (const narrowed of [false, true]) {
        const server = new CodexAppServer(
          () => {},
          () => {},
        )
        try {
          await server.start(cwd)
          const response = await server.request('thread/resume', {
            ...params,
            ...(narrowed ? { runtimeWorkspaceRoots: [cwd] } : {}),
          })
          if (narrowed) {
            expect(response.sandbox).toMatchObject({ writableRoots: [], networkAccess: false })
            expect(() => assertCodexPermissionBoundary(response, true)).not.toThrow()
          } else {
            expect(response.sandbox).toMatchObject({ writableRoots: [extra] })
            expect(() => assertCodexPermissionBoundary(response, true)).toThrow(
              'sandbox.writableRoots',
            )
          }
        } finally {
          await server.stop()
        }
      }
    } finally {
      vi.unstubAllEnvs()
      await rm(home, { recursive: true, force: true })
    }
  }, 30_000)
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
  it.each([true, false])(
    'continues the same native thread (disableBuiltinTools=%s)',
    async (disableBuiltinTools) => {
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
            disableBuiltinTools,
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
            disableBuiltinTools,
          },
        )
        expect(backend.getSessionId()).toBe(sessionId)
        expect(answer).toContain('STUDIO_RESUME_7642')
        expect(backend.getStatus().codexDiagnostic).toMatchObject({
          code: 'CODEX_RUN_SUCCEEDED',
          runtimeVersion: expect.stringMatching(/^\d+\./),
          modelRequestSent: true,
          nativeTools: { allowed: !disableBuiltinTools },
          thread: {
            method: 'thread/resume',
            sameSession: true,
            mismatches: [],
            returned: { networkAccess: false },
          },
          tools: { studioPresent: true, externalWithTools: 0, hasNextCursor: false },
        })
      } finally {
        await backend.destroy()
        await host.stop()
        await rm(cwd, { recursive: true, force: true })
      }
    },
    180_000,
  )
})
