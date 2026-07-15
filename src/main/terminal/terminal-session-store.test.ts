import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalRuntimeRef } from '../../shared/terminal'

const mockPaths = vi.hoisted(() => ({ userDataDir: '' }))

vi.mock('electron', () => ({
  app: {
    getPath: () => mockPaths.userDataDir,
  },
}))

import { TerminalSessionStore } from './terminal-session-store'

let tempDir = ''

const runtime: TerminalRuntimeRef = {
  location: 'local',
  transport: 'local',
  backend: 'local-shell',
  workspaceRef: { kind: 'local', path: '/Users/apple/project' },
  cwd: '/Users/apple/project',
}

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'deepink-terminal-session-'))
  mockPaths.userDataDir = tempDir
})

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true })
})

describe('TerminalSessionStore', () => {
  it('persists terminal session records and output buffer', async () => {
    const store = new TerminalSessionStore()

    await store.upsertSession({
      sessionId: 'terminal-1',
      runtime,
      status: 'idle',
      now: 100,
      attachable: false,
    })
    await store.appendExecutionEvent({
      kind: 'started',
      sessionId: 'terminal-1',
      processId: 123,
      timestamp: 110,
    })
    await store.appendExecutionEvent({
      kind: 'output',
      sessionId: 'terminal-1',
      stream: 'stdout',
      data: 'hello\n',
      timestamp: 120,
    })

    const reloaded = new TerminalSessionStore()
    const sessions = await reloaded.listSessions()

    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({
      sessionId: 'terminal-1',
      status: 'running',
      attachable: true,
      processId: 123,
      workspaceKey: '/Users/apple/project',
    })
    expect(sessions[0].outputBuffer.map((line) => line.text)).toContain('hello\n')
  })

  it('extracts command records from user input chunks', async () => {
    const store = new TerminalSessionStore()

    await store.upsertSession({ sessionId: 'terminal-1', runtime })
    await store.appendInput('terminal-1', 'pnpm ', 'user')
    await store.appendInput('terminal-1', 'test\n', 'user')

    const session = await store.getSession('terminal-1')
    expect(session?.lastCommand).toBe('pnpm test')
    expect(session?.commandHistory).toMatchObject([{ command: 'pnpm test', actor: 'user' }])
  })

  it('marks exited sessions as non-attachable', async () => {
    const store = new TerminalSessionStore()

    await store.upsertSession({ sessionId: 'terminal-1', runtime, status: 'running', attachable: true })
    await store.appendExecutionEvent({
      kind: 'exit',
      sessionId: 'terminal-1',
      exitCode: 0,
      timestamp: 200,
    })

    const session = await store.getSession('terminal-1')
    expect(session).toMatchObject({
      status: 'exited',
      attachable: false,
      exitCode: 0,
      exitedAt: 200,
    })
  })
})
