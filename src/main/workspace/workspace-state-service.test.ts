import { cp, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'fs/promises'
import { createHash } from 'crypto'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceStateSnapshot } from '../../shared/ipc/workspace-state'

const mockPaths = vi.hoisted(() => ({ userDataDir: '' }))

vi.mock('electron', () => ({
  app: {
    getPath: () => mockPaths.userDataDir,
  },
}))

import { WorkspaceStateService } from './workspace-state-service'

let tempDir = ''
let workspaceA = ''
let workspaceB = ''

function workspaceId(workspacePath: string, ownerKey?: string | null): string {
  return createHash('sha256').update(`${ownerKey}\0${workspacePath}`).digest('hex').slice(0, 16)
}

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'cclink-studio-workspace-state-'))
  workspaceA = join(tempDir, 'workspace-a')
  workspaceB = join(tempDir, 'workspace-b')
  await Promise.all([
    mkdir(workspaceA, { recursive: true }),
    mkdir(workspaceB, { recursive: true }),
  ])
  workspaceA = await realpath(workspaceA)
  workspaceB = await realpath(workspaceB)
  mockPaths.userDataDir = tempDir
})

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true })
})

describe('WorkspaceStateService', () => {
  it('returns an empty global snapshot when no state file exists', async () => {
    const service = new WorkspaceStateService()
    await service.loadState()

    const snapshot = await service.getSnapshot(null)

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

    expect((await reloaded.getSnapshot(null)).sections.tabs).toEqual({
      activeTabId: 'browser',
    })
  })

  it('flushes writes that were submitted before shutdown', async () => {
    const service = new WorkspaceStateService()
    await service.loadState()

    const pendingWrite = service.setSection(workspaceA, 'agentConversations', {
      activeConversationId: 'archived-conversation',
    })
    await service.flush()
    await pendingWrite

    const reloaded = new WorkspaceStateService()
    await reloaded.loadState()
    expect((await reloaded.getSnapshot(workspaceA)).sections.agentConversations).toEqual({
      activeConversationId: 'archived-conversation',
    })
  })

  it('keeps workspace scoped state isolated', async () => {
    const service = new WorkspaceStateService()
    await service.loadState()

    await service.setSection(workspaceA, 'fileTree', {
      selectedPath: join(workspaceA, 'one.md'),
    })
    await service.setSection(workspaceB, 'fileTree', {
      selectedPath: join(workspaceB, 'two.md'),
    })

    expect((await service.getSnapshot(workspaceA)).sections.fileTree).toEqual({
      selectedPath: join(workspaceA, 'one.md'),
    })
    expect((await service.getSnapshot(workspaceB)).sections.fileTree).toEqual({
      selectedPath: join(workspaceB, 'two.md'),
    })
  })

  it('keeps owner scoped state isolated for the same workspace', async () => {
    const service = new WorkspaceStateService()
    await service.loadState()

    await service.setSection(workspaceA, 'tabs', { activeTabId: 'owner-a' }, 'local:a')
    await service.setSection(workspaceA, 'tabs', { activeTabId: 'owner-b' }, 'local:b')

    expect((await service.getSnapshot(workspaceA, 'local:a')).sections.tabs).toEqual({
      activeTabId: 'owner-a',
    })
    expect((await service.getSnapshot(workspaceA, 'local:b')).sections.tabs).toEqual({
      activeTabId: 'owner-b',
    })
  })

  it('does not mix unowned state into owner scoped state', async () => {
    const service = new WorkspaceStateService()
    await service.loadState()

    await service.setSection(workspaceA, 'layout', { activePanel: 'files' })

    const owned = await service.getSnapshot(workspaceA, 'local:new')

    expect(owned.ownerKey).toBe('local:new')
    expect(owned.workspaceKey).toBe(workspaceA)
    expect(owned.sections).toEqual({})
  })

  it('lists local workspace summaries for recent project recovery', async () => {
    const service = new WorkspaceStateService()
    await service.loadState()

    await service.setSection(workspaceA, 'tabs', { activeTabId: 'legacy' })
    await service.setSection(workspaceA, 'tabs', { activeTabId: 'owner-a' }, 'local:a')
    await service.setSection(workspaceB, 'tabs', { activeTabId: 'owner-b' }, 'local:a')
    await service.setSection('official://device/%2Ftmp%2Fremote', 'tabs', { activeTabId: 'remote' })

    const summaries = service.listLocalWorkspaces('local:a')

    expect(summaries.map((summary) => summary.workspacePath).sort()).toEqual(
      [workspaceA, workspaceB].sort(),
    )
    expect(summaries.find((summary) => summary.workspacePath === workspaceA)?.ownerKey).toBe(
      'local:a',
    )
  })

  it('keeps namespaced workspace keys isolated from local paths', async () => {
    const service = new WorkspaceStateService()
    await service.loadState()

    const namespacedKey = `official://mac-mini/${encodeURIComponent(workspaceA)}`
    await service.setSection(workspaceA, 'tabs', { activeTabId: 'local' })
    await service.setSection(namespacedKey, 'tabs', { activeTabId: 'namespaced' })

    const localSnapshot = await service.getSnapshot(workspaceA)
    const namespacedSnapshot = await service.getSnapshot(namespacedKey)

    expect(localSnapshot.workspaceKey).toBe(workspaceA)
    expect(namespacedSnapshot.workspaceKey).toBe(namespacedKey)
    expect(localSnapshot.sections.tabs).toEqual({ activeTabId: 'local' })
    expect(namespacedSnapshot.sections.tabs).toEqual({ activeTabId: 'namespaced' })
  })

  it('rejects project-state access outside the user home directory', async () => {
    const outsideHome = await mkdtemp(join(tmpdir(), 'cclink-studio-outside-home-'))
    const service = new WorkspaceStateService()
    await service.loadState()

    try {
      expect(await service.resolveLocalWorkspace(outsideHome)).toEqual(
        expect.objectContaining({ valid: false, workspacePath: null }),
      )
      await expect(service.setSection(outsideHome, 'tabs', {})).rejects.toThrow(
        '工作区路径不在用户主目录下',
      )
    } finally {
      await rm(outsideHome, { recursive: true, force: true })
    }
  })

  it('clears only the requested workspace', async () => {
    const service = new WorkspaceStateService()
    await service.loadState()

    await service.setSection(workspaceA, 'layout', { sidebarVisible: false })
    await service.setSection(workspaceB, 'layout', { sidebarVisible: true })
    await service.clear(workspaceA)

    expect((await service.getSnapshot(workspaceA)).sections).toEqual({})
    expect((await service.getSnapshot(workspaceB)).sections.layout).toEqual({
      sidebarVisible: true,
    })
  })

  it('writes a versioned state file', async () => {
    const service = new WorkspaceStateService()
    await service.loadState()
    await service.setSection(null, 'layout', { activePanel: 'files' })

    const raw = await readFile(join(tempDir, 'workspace-state.json'), 'utf-8')
    const parsed = JSON.parse(raw) as { version?: number; workspaces?: unknown }

    expect(parsed.version).toBe(2)
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

    expect((await service.getSnapshot(null)).version).toBe(1)
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

    expect((await service.getSnapshot(null)).sections.tabs).toEqual({
      activeTabId: 'future',
    })

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

    expect((await service.getSnapshot(null)).sections.layout).toEqual({
      activePanel: 'files',
    })
  })

  it('removes browser tabs created by the legacy global restore flow', async () => {
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
            sections: {
              tabs: {
                tabs: [
                  {
                    id: 'legacy-browser',
                    type: 'browser',
                    title: '恢复的页面',
                    initialUrl: 'https://www.zhihu.com/signin',
                    restore: { viewMode: 'desktop', zoomMode: 'fit', manualZoom: 1 },
                  },
                  { id: 'editor', type: 'editor', title: 'README.md', icon: 'file' },
                ],
                activeTabId: 'legacy-browser',
              },
              browserTabs: {
                tabs: {
                  'legacy-browser': { url: 'https://www.zhihu.com/signin' },
                },
              },
            },
          },
        },
      }),
      'utf-8',
    )

    const service = new WorkspaceStateService()
    await service.loadState()

    expect((await service.getSnapshot(null)).sections.tabs).toEqual({
      tabs: [{ id: 'editor', type: 'editor', title: 'README.md', icon: 'file' }],
      activeTabId: 'editor',
    })
    expect((await service.getSnapshot(null)).sections.browserTabs).toEqual({ tabs: {} })
  })

  it('serializes concurrent section writes without losing sections', async () => {
    const service = new WorkspaceStateService()
    await service.loadState()

    await Promise.all([
      service.setSection(workspaceA, 'tabs', { activeTabId: 'tab-a' }),
      service.setSection(workspaceA, 'browserTabs', {
        tabs: { browser: { url: 'https://example.com' } },
      }),
      service.setSection(workspaceA, 'editorDrafts', { files: { draft: { dirty: true } } }),
      service.setSection(workspaceA, 'agentConversations', { conversationOrder: ['agent-a'] }),
    ])

    const reloaded = new WorkspaceStateService()
    await reloaded.loadState()
    const sections = (await reloaded.getSnapshot(workspaceA)).sections

    expect(sections.tabs).toEqual({ activeTabId: 'tab-a' })
    expect(sections.browserTabs).toEqual({ tabs: { browser: { url: 'https://example.com' } } })
    expect(sections.editorDrafts).toEqual({ files: { draft: { dirty: true } } })
    expect(sections.agentConversations).toEqual({ conversationOrder: ['agent-a'] })
  })

  it('stores local project state under the project hidden directory', async () => {
    const service = new WorkspaceStateService()
    await service.loadState()
    await mkdir(join(workspaceA, '.git', 'info'), { recursive: true })

    await service.setSection(workspaceA, 'tabs', { activeTabId: 'project-tab' }, 'local:a')

    const ownerFile = `${createHash('sha256').update('local:a').digest('hex').slice(0, 16)}.json`
    const projectState = JSON.parse(
      await readFile(join(workspaceA, '.cclink-studio', 'state', ownerFile), 'utf-8'),
    ) as { snapshot: WorkspaceStateSnapshot }
    const centralState = JSON.parse(
      await readFile(join(tempDir, 'workspace-state.json'), 'utf-8'),
    ) as { workspaces: Record<string, unknown> }
    const gitExclude = await readFile(join(workspaceA, '.git', 'info', 'exclude'), 'utf-8')

    expect(projectState.snapshot.sections.tabs).toEqual({ activeTabId: 'project-tab' })
    expect(centralState.workspaces[workspaceId(workspaceA, 'local:a')]).toBeUndefined()
    expect(gitExclude).toContain('/.cclink-studio/state/')
  })

  it('adds project-state exclusions for Git worktrees whose .git marker is a file', async () => {
    const commonGitDir = join(tempDir, 'git-common')
    const worktreeGitDir = join(commonGitDir, 'worktrees', 'workspace-a')
    await mkdir(join(commonGitDir, 'info'), { recursive: true })
    await mkdir(worktreeGitDir, { recursive: true })
    await writeFile(join(worktreeGitDir, 'commondir'), '../..\n', 'utf-8')
    await writeFile(join(workspaceA, '.git'), `gitdir: ${worktreeGitDir}\n`, 'utf-8')
    const service = new WorkspaceStateService()
    await service.loadState()

    await service.setSection(workspaceA, 'tabs', { activeTabId: 'worktree-tab' }, 'local:a')

    const gitExclude = await readFile(join(commonGitDir, 'info', 'exclude'), 'utf-8')
    expect(gitExclude).toContain('/.cclink-studio/project.json')
    expect(gitExclude).toContain('/.cclink-studio/state/')
  })

  it('migrates a legacy central project snapshot into the project directory', async () => {
    const legacySnapshot: WorkspaceStateSnapshot = {
      version: 1,
      workspaceId: workspaceId(workspaceA),
      ownerKey: null,
      workspaceKey: workspaceA,
      workspacePath: workspaceA,
      updatedAt: 10,
      sections: { tabs: { activeTabId: 'legacy-tab' } },
    }
    await writeFile(
      join(tempDir, 'workspace-state.json'),
      JSON.stringify({
        version: 1,
        workspaces: { [legacySnapshot.workspaceId]: legacySnapshot },
      }),
      'utf-8',
    )
    const service = new WorkspaceStateService()
    await service.loadState()

    const migrated = await service.getSnapshot(workspaceA)
    const projectState = JSON.parse(
      await readFile(join(workspaceA, '.cclink-studio', 'state', 'unowned.json'), 'utf-8'),
    ) as { snapshot: WorkspaceStateSnapshot }
    const centralState = JSON.parse(
      await readFile(join(tempDir, 'workspace-state.json'), 'utf-8'),
    ) as { workspaces: Record<string, unknown> }

    expect(migrated.sections.tabs).toEqual({ activeTabId: 'legacy-tab' })
    expect(projectState.snapshot.sections.tabs).toEqual({ activeTabId: 'legacy-tab' })
    expect(centralState.workspaces[legacySnapshot.workspaceId]).toBeUndefined()
  })

  it('keeps project state when the project directory is moved', async () => {
    const service = new WorkspaceStateService()
    await service.loadState()
    await service.setSection(workspaceA, 'tabs', { activeTabId: 'moved-tab' }, 'local:a')
    const movedPath = join(tempDir, 'workspace-moved')

    await rename(workspaceA, movedPath)
    const resolvedMovedPath = await realpath(movedPath)
    const restored = await service.getSnapshot(resolvedMovedPath, 'local:a')

    expect(restored.workspacePath).toBe(resolvedMovedPath)
    expect(restored.sections.tabs).toEqual({ activeTabId: 'moved-tab' })
    expect(service.listLocalWorkspaces('local:a').map((entry) => entry.workspacePath)).toEqual([
      resolvedMovedPath,
    ])
  })

  it('forks project identity when a project directory is copied', async () => {
    const service = new WorkspaceStateService()
    await service.loadState()
    await service.setSection(workspaceA, 'tabs', { activeTabId: 'source-tab' }, 'local:a')
    await rm(workspaceB, { recursive: true, force: true })
    await cp(workspaceA, workspaceB, { recursive: true })
    workspaceB = await realpath(workspaceB)

    const copiedBeforeWrite = await service.getSnapshot(workspaceB, 'local:a')
    await service.setSection(workspaceB, 'tabs', { activeTabId: 'copy-tab' }, 'local:a')

    expect(copiedBeforeWrite.sections).toEqual({})
    expect((await service.getSnapshot(workspaceA, 'local:a')).sections.tabs).toEqual({
      activeTabId: 'source-tab',
    })
    expect((await service.getSnapshot(workspaceB, 'local:a')).sections.tabs).toEqual({
      activeTabId: 'copy-tab',
    })
  })

  it('recovers project identity from project state when the manifest is corrupted', async () => {
    const service = new WorkspaceStateService()
    await service.loadState()
    await service.setSection(workspaceA, 'tabs', { activeTabId: 'recoverable-tab' }, 'local:a')
    await writeFile(join(workspaceA, '.cclink-studio', 'project.json'), '{broken-manifest', 'utf-8')

    const reloaded = new WorkspaceStateService()
    await reloaded.loadState()

    expect((await reloaded.getSnapshot(workspaceA, 'local:a')).sections.tabs).toEqual({
      activeTabId: 'recoverable-tab',
    })
    const repairedManifest = JSON.parse(
      await readFile(join(workspaceA, '.cclink-studio', 'project.json'), 'utf-8'),
    ) as { projectId?: string }
    expect(repairedManifest.projectId).toBeTruthy()
  })

  it('rejects corrupted project state instead of treating it as an empty workspace', async () => {
    const service = new WorkspaceStateService()
    await service.loadState()
    await service.setSection(workspaceA, 'tabs', { activeTabId: 'important-tab' }, 'local:a')
    const ownerFile = `${createHash('sha256').update('local:a').digest('hex').slice(0, 16)}.json`
    const statePath = join(workspaceA, '.cclink-studio', 'state', ownerFile)
    await writeFile(statePath, '{broken-state', 'utf-8')
    await rm(`${statePath}.bak`, { force: true })

    await expect(service.getSnapshot(workspaceA, 'local:a')).rejects.toThrow(
      '项目状态及备份均不可读取',
    )
  })

  it('keeps a valid project backup when the primary state file is corrupted', async () => {
    const service = new WorkspaceStateService()
    await service.loadState()
    await service.setSection(workspaceA, 'tabs', { activeTabId: 'first-tab' }, 'local:a')
    await service.setSection(workspaceA, 'tabs', { activeTabId: 'second-tab' }, 'local:a')
    const ownerFile = `${createHash('sha256').update('local:a').digest('hex').slice(0, 16)}.json`
    const statePath = join(workspaceA, '.cclink-studio', 'state', ownerFile)
    await writeFile(statePath, '{broken-state', 'utf-8')

    expect((await service.getSnapshot(workspaceA, 'local:a')).sections.tabs).toEqual({
      activeTabId: 'first-tab',
    })
    await service.setSection(workspaceA, 'layout', { sidebarVisible: false }, 'local:a')

    const backup = JSON.parse(await readFile(`${statePath}.bak`, 'utf-8')) as {
      snapshot: WorkspaceStateSnapshot
    }
    expect(backup.snapshot.sections.tabs).toEqual({ activeTabId: 'first-tab' })
  })

  it('uses the central fallback only when project metadata cannot be written', async () => {
    await writeFile(join(workspaceA, '.cclink-studio'), 'blocked', 'utf-8')
    const service = new WorkspaceStateService()
    await service.loadState()

    await service.setSection(workspaceA, 'tabs', { activeTabId: 'fallback-tab' }, 'local:a')

    const centralState = JSON.parse(
      await readFile(join(tempDir, 'workspace-state.json'), 'utf-8'),
    ) as { workspaces: Record<string, WorkspaceStateSnapshot> }
    const summary = service
      .listLocalWorkspaces('local:a')
      .find((entry) => entry.workspacePath === workspaceA)

    expect(centralState.workspaces[workspaceId(workspaceA, 'local:a')].sections.tabs).toEqual({
      activeTabId: 'fallback-tab',
    })
    expect(summary?.storage).toBe('fallback')
  })

  it('falls back to the backup file when the primary state file is corrupted', async () => {
    const service = new WorkspaceStateService()
    await service.loadState()
    await service.setSection(null, 'layout', { activePanel: 'files' })
    await service.setSection(null, 'tabs', { activeTabId: 'browser' })
    await writeFile(join(tempDir, 'workspace-state.json'), '{broken-json', 'utf-8')

    const reloaded = new WorkspaceStateService()
    await reloaded.loadState()

    expect((await reloaded.getSnapshot(null)).sections.layout).toEqual({
      activePanel: 'files',
    })
  })

  it('does not overwrite global state when both the primary file and backup are corrupted', async () => {
    await writeFile(join(tempDir, 'workspace-state.json'), '{broken-primary', 'utf-8')
    await writeFile(join(tempDir, 'workspace-state.json.bak'), '{broken-backup', 'utf-8')
    const service = new WorkspaceStateService()

    await service.loadState()

    await expect(service.getSnapshot(null)).rejects.toThrow('工作台状态索引及备份均不可读取')
    await expect(service.setSection(null, 'layout', { activePanel: 'files' })).rejects.toThrow(
      '工作台状态索引及备份均不可读取',
    )
    expect(await readFile(join(tempDir, 'workspace-state.json'), 'utf-8')).toBe('{broken-primary')
  })

  it('still restores project-local state when the central index is corrupted', async () => {
    const service = new WorkspaceStateService()
    await service.loadState()
    await service.setSection(workspaceA, 'tabs', { activeTabId: 'local-project' }, 'local:a')
    await writeFile(join(tempDir, 'workspace-state.json'), '{broken-primary', 'utf-8')
    await writeFile(join(tempDir, 'workspace-state.json.bak'), '{broken-backup', 'utf-8')

    const reloaded = new WorkspaceStateService()
    await reloaded.loadState()

    expect((await reloaded.getSnapshot(workspaceA, 'local:a')).sections.tabs).toEqual({
      activeTabId: 'local-project',
    })
  })

  it('reports workspace state diagnostics', async () => {
    const service = new WorkspaceStateService()
    await service.loadState()
    await service.setSection(workspaceA, 'tabs', { activeTabId: 'tab-a' })

    const diagnostics = service.getDiagnostics()

    expect(diagnostics.userDataPath).toBe(tempDir)
    expect(diagnostics.stateFilePath).toBe(join(tempDir, 'workspace-state.json'))
    expect(diagnostics.backupFilePath).toBe(join(tempDir, 'workspace-state.json.bak'))
    expect(diagnostics.workspaceCount).toBe(1)
    expect(diagnostics.fileVersion).toBe(2)
  })
})
