import { mkdtemp, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  paths: { userData: '', downloads: '' },
  openPath: vi.fn().mockResolvedValue(''),
  showItemInFolder: vi.fn(),
}))

vi.mock('electron', () => ({
  app: {
    getPath: (name: 'userData' | 'downloads') => electronMocks.paths[name],
  },
  shell: {
    openPath: electronMocks.openPath,
    showItemInFolder: electronMocks.showItemInFolder,
  },
}))

import { BrowserDownloadStore } from './browser-download-store'

let tempDir = ''
let workspaceDir = ''
let stores: BrowserDownloadStore[] = []

function createStore(): { store: BrowserDownloadStore; send: ReturnType<typeof vi.fn> } {
  const send = vi.fn()
  const mainWindow = {
    isDestroyed: () => false,
    webContents: { send },
  } as any
  const store = new BrowserDownloadStore(mainWindow, () => workspaceDir)
  stores.push(store)
  return { store, send }
}

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'cclink-studio-download-store-'))
  workspaceDir = join(tempDir, 'workspace')
  electronMocks.paths.userData = join(tempDir, 'user-data')
  electronMocks.paths.downloads = join(tempDir, 'downloads')
  electronMocks.openPath.mockResolvedValue('')
  electronMocks.showItemInFolder.mockClear()
  stores = []
})

afterEach(async () => {
  await Promise.all(stores.map((store) => store.flushPersistence()))
  vi.clearAllMocks()
  if (tempDir) await rm(tempDir, { recursive: true, force: true })
})

describe('BrowserDownloadStore', () => {
  it('routes download updates to the current tab owner before falling back to main', async () => {
    const send = vi.fn()
    const ownerSend = vi.fn(() => true)
    const store = new BrowserDownloadStore(
      { isDestroyed: () => false, webContents: { send } } as any,
      () => workspaceDir,
      ownerSend,
    )
    stores.push(store)
    await store.load()

    await store.startDownload({
      id: 'download-owner',
      trigger: 'user',
      tabId: 'browser-detached',
      workspaceKey: null,
      sourceUrl: 'https://example.test/file.pdf',
      suggestedFilename: 'file.pdf',
    })

    expect(ownerSend).toHaveBeenCalledWith(
      'browser-detached',
      'browserDownload:changed',
      expect.any(Object),
    )
    expect(send).not.toHaveBeenCalled()
  })

  it('stores agent downloads in the task temporary directory', async () => {
    const { store } = createStore()
    await store.load()

    const { record, targetPath } = await store.startDownload({
      id: 'download-1',
      trigger: 'agent',
      taskRunId: 'task-1',
      tabId: 'browser',
      workspaceKey: null,
      sourceUrl: 'https://example.test/file.pdf',
      suggestedFilename: 'file.pdf',
    })

    expect(record.retention).toBe('temporary')
    expect(record.tempPath).toBe(targetPath)
    expect(targetPath).toBe(
      join(electronMocks.paths.userData, 'agent-downloads', 'task-1', 'file.pdf'),
    )
  })

  it('stores manual downloads in the system downloads directory', async () => {
    const { store } = createStore()
    await store.load()

    const { record, targetPath } = await store.startDownload({
      id: 'download-1',
      trigger: 'user',
      tabId: 'browser',
      workspaceKey: null,
      sourceUrl: 'https://example.test/file.pdf',
      suggestedFilename: 'file.pdf',
    })

    expect(record.retention).toBe('kept')
    expect(record.savedPath).toBe(targetPath)
    expect(targetPath).toBe(join(electronMocks.paths.downloads, 'file.pdf'))
  })

  it('keeps temporary agent downloads inside the workspace .cclink-studio folder', async () => {
    const { store } = createStore()
    await store.load()
    const { targetPath } = await store.startDownload({
      id: 'download-1',
      trigger: 'agent',
      taskRunId: 'task-1',
      tabId: 'browser',
      workspaceKey: workspaceDir,
      sourceUrl: 'https://example.test/file.pdf',
      suggestedFilename: 'file.pdf',
    })
    await writeFile(targetPath, 'pdf')
    store.completeDownload('download-1', targetPath)

    const kept = await store.keepDownloadToWorkspace('download-1')

    expect(kept.retention).toBe('kept')
    expect(kept.savedPath).toBe(
      join(workspaceDir, '.cclink-studio', 'downloads', 'task-1', 'file.pdf'),
    )
    await expect(stat(kept.savedPath!)).resolves.toBeTruthy()
  })

  it('persists records and reloads them in a new store instance', async () => {
    const { store } = createStore()
    await store.load()
    const { targetPath } = await store.startDownload({
      id: 'download-1',
      trigger: 'agent',
      taskRunId: 'task-1',
      tabId: 'browser',
      workspaceKey: null,
      sourceUrl: 'https://example.test/file.pdf',
      suggestedFilename: 'file.pdf',
    })
    store.completeDownload('download-1', targetPath)
    await store.flushPersistence()

    const persisted = await readPersistedDownloads()
    expect(persisted).toHaveLength(1)

    const { store: reloaded } = createStore()
    await reloaded.load()

    expect(reloaded.getDownload('download-1')).toMatchObject({
      id: 'download-1',
      status: 'completed',
      retention: 'temporary',
    })
  })

  it('opens and reveals the persisted file path', async () => {
    const { store } = createStore()
    await store.load()
    const { targetPath } = await store.startDownload({
      id: 'download-1',
      trigger: 'agent',
      taskRunId: 'task-1',
      tabId: 'browser',
      workspaceKey: null,
      sourceUrl: 'https://example.test/file.pdf',
      suggestedFilename: 'file.pdf',
    })
    await writeFile(targetPath, 'pdf')
    store.completeDownload('download-1', targetPath)

    await store.openDownload('download-1')
    store.revealDownload('download-1')

    expect(electronMocks.openPath).toHaveBeenCalledWith(targetPath)
    expect(electronMocks.showItemInFolder).toHaveBeenCalledWith(targetPath)
  })

  it('marks records as missing when the downloaded file was removed externally', async () => {
    const { store } = createStore()
    await store.load()
    const { targetPath } = await store.startDownload({
      id: 'download-1',
      trigger: 'agent',
      taskRunId: 'task-1',
      tabId: 'browser',
      workspaceKey: null,
      sourceUrl: 'https://example.test/file.pdf',
      suggestedFilename: 'file.pdf',
    })
    await writeFile(targetPath, 'pdf')
    store.completeDownload('download-1', targetPath)
    await unlink(targetPath)

    expect(store.getDownload('download-1')?.fileMissing).toBe(true)
    await expect(store.openDownload('download-1')).rejects.toThrow('下载文件已不存在')
  })
})

async function readPersistedDownloads(): Promise<unknown[]> {
  const filePath = join(electronMocks.paths.userData, 'browser-downloads.json')
  let lastError: unknown = null
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const raw = await readFile(filePath, 'utf-8')
      return JSON.parse(raw) as unknown[]
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
  throw lastError
}
