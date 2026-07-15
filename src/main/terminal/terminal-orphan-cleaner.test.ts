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

import { cleanupTerminalOrphans } from './terminal-orphan-cleaner'
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
  tempDir = await mkdtemp(join(tmpdir(), 'deepink-terminal-orphan-'))
  mockPaths.userDataDir = tempDir
})

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true })
})

describe('cleanupTerminalOrphans', () => {
  it('kills verified stale terminal processes and marks records unrecoverable', async () => {
    const store = new TerminalSessionStore()
    const killProcess = vi.fn()

    await store.upsertSession({
      sessionId: 'terminal-1',
      runtime,
      status: 'running',
      processId: 321,
      attachable: true,
      now: 100,
    })

    const summary = await cleanupTerminalOrphans(store, {
      now: () => 500,
      isProcessAlive: vi.fn().mockResolvedValue(true),
      isDeepInkTerminalProcess: vi.fn().mockResolvedValue(true),
      killProcess,
      wait: async () => undefined,
      graceMs: 0,
    })

    expect(summary).toMatchObject({ scanned: 1, killed: 1, skipped: 0, failed: 0 })
    if (process.platform === 'win32') {
      expect(killProcess).toHaveBeenCalledWith(321, 'SIGHUP')
      expect(killProcess).toHaveBeenCalledWith(321, 'SIGKILL')
    } else {
      expect(killProcess).toHaveBeenCalledWith(-321, 'SIGHUP')
      expect(killProcess).toHaveBeenCalledWith(-321, 'SIGKILL')
    }
    const session = await store.getSession('terminal-1')
    expect(session).toMatchObject({
      status: 'exited',
      attachable: false,
      exitedAt: 500,
      errorMessage: 'DeepInk 启动时已清理上次残留 Terminal 进程',
    })
  })

  it('does not kill alive processes that cannot be verified as DeepInk terminals', async () => {
    const store = new TerminalSessionStore()
    const killProcess = vi.fn()

    await store.upsertSession({
      sessionId: 'terminal-1',
      runtime,
      status: 'running',
      processId: 321,
      attachable: true,
      now: 100,
    })

    const summary = await cleanupTerminalOrphans(store, {
      now: () => 500,
      isProcessAlive: vi.fn().mockResolvedValue(true),
      isDeepInkTerminalProcess: vi.fn().mockResolvedValue(false),
      killProcess,
      wait: async () => undefined,
    })

    expect(summary).toMatchObject({ scanned: 1, killed: 0, skipped: 1, failed: 0 })
    expect(killProcess).not.toHaveBeenCalled()
    const session = await store.getSession('terminal-1')
    expect(session).toMatchObject({
      status: 'error',
      attachable: false,
    })
    expect(session?.errorMessage).toContain('无法确认归属')
  })

  it('marks missing live records as exited', async () => {
    const store = new TerminalSessionStore()

    await store.upsertSession({
      sessionId: 'terminal-1',
      runtime,
      status: 'running',
      processId: 321,
      attachable: true,
      now: 100,
    })

    const summary = await cleanupTerminalOrphans(store, {
      now: () => 500,
      isProcessAlive: vi.fn().mockResolvedValue(false),
      isDeepInkTerminalProcess: vi.fn().mockResolvedValue(false),
      wait: async () => undefined,
    })

    expect(summary).toMatchObject({ scanned: 1, killed: 0, missing: 1 })
    const session = await store.getSession('terminal-1')
    expect(session).toMatchObject({
      status: 'exited',
      attachable: false,
      exitedAt: 500,
    })
    expect(session?.errorMessage).toContain('不可恢复')
  })
})
