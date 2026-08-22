import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronMock = vi.hoisted(() => ({ userDataDir: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => electronMock.userDataDir },
}))

import { BrowserInstanceStore } from './browser-instance-store'

let tempDir = ''

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'cclink-browser-instance-store-'))
  electronMock.userDataDir = tempDir
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('BrowserInstanceStore history lifecycle', () => {
  it('keeps browser history when obsolete tab snapshots are removed during upgrade', async () => {
    const store = new BrowserInstanceStore()
    const historyEntry = {
      id: 'history-1',
      url: 'https://example.com/legacy',
      title: '旧网页',
      visitedAt: 1,
    }

    await store.recordHistory(historyEntry)
    await store.record({
      id: 'legacy-tab',
      url: historyEntry.url,
      title: historyEntry.title,
      viewMode: 'desktop',
      zoomMode: 'manual',
      manualZoom: 1,
      closedAt: 1,
    })

    await store.clear()

    expect(await store.list()).toEqual([])
    expect(await store.listHistory()).toEqual([historyEntry])

    const reloaded = new BrowserInstanceStore()
    expect(await reloaded.listHistory()).toEqual([historyEntry])
  })
})
