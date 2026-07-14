import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockPaths = vi.hoisted(() => ({ userDataDir: '' }))

vi.mock('electron', () => ({
  app: {
    getPath: () => mockPaths.userDataDir,
  },
}))

import { WorkspaceStateService } from './workspace-state-service'

let tempDir = ''

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'deepink-workspace-state-'))
  mockPaths.userDataDir = tempDir
})

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true })
})

describe('WorkspaceStateService', () => {
  it('returns an empty global snapshot when no state file exists', async () => {
    const service = new WorkspaceStateService()
    await service.loadState()

    const snapshot = service.getSnapshot(null)

    expect(snapshot.version).toBe(1)
    expect(snapshot.workspaceId).toBe('global')
    expect(snapshot.ownerKey).toBeNull()
    expect(snapshot.workspaceKey).toBeNull()
    expect(snapshot.workspacePath).toBeNull()
    expect(snapshot.sections).toEqual({})
  })

  it('persists sections and loads them in a new service instance', async () => {
    const service = new WorkspaceStateService()
    await service.loadState()
    await service.setSection(null, 'tabs', { activeTabId: 'browser' })

    const reloaded = new WorkspaceStateService()
    await reloaded.loadState()

    expect(reloaded.getSnapshot(null).sections.tabs).toEqual({ activeTabId: 'browser' })
  })

  it('keeps workspace scoped state isolated', async () => {
    const service = new WorkspaceStateService()
    await service.loadState()

    await service.setSection('/tmp/a', 'fileTree', { selectedPath: '/tmp/a/one.md' })
    await service.setSection('/tmp/b', 'fileTree', { selectedPath: '/tmp/b/two.md' })

    expect(service.getSnapshot('/tmp/a').sections.fileTree).toEqual({ selectedPath: '/tmp/a/one.md' })
    expect(service.getSnapshot('/tmp/b').sections.fileTree).toEqual({ selectedPath: '/tmp/b/two.md' })
  })

  it('keeps owner scoped state isolated for the same workspace', async () => {
    const service = new WorkspaceStateService()
    await service.loadState()

    await service.setSection('/tmp/a', 'tabs', { activeTabId: 'owner-a' }, 'local:a')
    await service.setSection('/tmp/a', 'tabs', { activeTabId: 'owner-b' }, 'local:b')

    expect(service.getSnapshot('/tmp/a', 'local:a').sections.tabs).toEqual({
      activeTabId: 'owner-a',
    })
    expect(service.getSnapshot('/tmp/a', 'local:b').sections.tabs).toEqual({
      activeTabId: 'owner-b',
    })
  })

  it('reads legacy snapshots when first entering an owner scoped workspace', async () => {
    const service = new WorkspaceStateService()
    await service.loadState()

    await service.setSection('/tmp/a', 'layout', { activePanel: 'files' })

    const migrated = service.getSnapshot('/tmp/a', 'local:new')

    expect(migrated.ownerKey).toBe('local:new')
    expect(migrated.workspaceKey).toBe('/tmp/a')
    expect(migrated.sections.layout).toEqual({ activePanel: 'files' })
  })

  it('keeps remote workspace keys isolated from local paths', async () => {
    const service = new WorkspaceStateService()
    await service.loadState()

    const remoteKey = 'cclink://mac-mini/%2Ftmp%2Fa'
    await service.setSection('/tmp/a', 'tabs', { activeTabId: 'local' })
    await service.setSection(remoteKey, 'tabs', { activeTabId: 'remote' })

    const localSnapshot = service.getSnapshot('/tmp/a')
    const remoteSnapshot = service.getSnapshot(remoteKey)

    expect(localSnapshot.workspaceKey).toBe('/tmp/a')
    expect(remoteSnapshot.workspaceKey).toBe(remoteKey)
    expect(localSnapshot.sections.tabs).toEqual({ activeTabId: 'local' })
    expect(remoteSnapshot.sections.tabs).toEqual({ activeTabId: 'remote' })
  })

  it('clears only the requested workspace', async () => {
    const service = new WorkspaceStateService()
    await service.loadState()

    await service.setSection('/tmp/a', 'layout', { sidebarVisible: false })
    await service.setSection('/tmp/b', 'layout', { sidebarVisible: true })
    await service.clear('/tmp/a')

    expect(service.getSnapshot('/tmp/a').sections).toEqual({})
    expect(service.getSnapshot('/tmp/b').sections.layout).toEqual({ sidebarVisible: true })
  })

  it('writes a versioned state file', async () => {
    const service = new WorkspaceStateService()
    await service.loadState()
    await service.setSection(null, 'layout', { activePanel: 'files' })

    const raw = await readFile(join(tempDir, 'workspace-state.json'), 'utf-8')
    const parsed = JSON.parse(raw) as { version?: number; workspaces?: unknown }

    expect(parsed.version).toBe(1)
    expect(parsed.workspaces).toBeTruthy()
  })

  it('treats a missing version field as V1 and loads normally', async () => {
    await writeFile(
      join(tempDir, 'workspace-state.json'),
      JSON.stringify({ workspaces: {} }),
      'utf-8',
    )

    const service = new WorkspaceStateService()
    await service.loadState()

    expect(service.getSnapshot(null).version).toBe(1)
  })

  it('preserves a future-version state file without downgrading or wiping data', async () => {
    const futureSnapshot = {
      version: 1,
      workspaceId: 'global',
      ownerKey: null,
      workspaceKey: null,
      workspacePath: null,
      updatedAt: 0,
      sections: { tabs: { activeTabId: 'future' } },
    }
    await writeFile(
      join(tempDir, 'workspace-state.json'),
      JSON.stringify({ version: 99, workspaces: { global: futureSnapshot } }),
      'utf-8',
    )

    const service = new WorkspaceStateService()
    await service.loadState()

    expect(service.getSnapshot(null).sections.tabs).toEqual({ activeTabId: 'future' })

    const raw = await readFile(join(tempDir, 'workspace-state.json'), 'utf-8')
    const parsed = JSON.parse(raw) as { version?: number }
    expect(parsed.version).toBe(99)
  })

  it('passes a current-version file through migration unchanged', async () => {
    await writeFile(
      join(tempDir, 'workspace-state.json'),
      JSON.stringify({
        version: 1,
        workspaces: {
          global: {
            version: 1,
            workspaceId: 'global',
            ownerKey: null,
            workspaceKey: null,
            workspacePath: null,
            updatedAt: 0,
            sections: { layout: { activePanel: 'files' } },
          },
        },
      }),
      'utf-8',
    )

    const service = new WorkspaceStateService()
    await service.loadState()

    expect(service.getSnapshot(null).sections.layout).toEqual({ activePanel: 'files' })
  })
})
