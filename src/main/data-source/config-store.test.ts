import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockPaths = vi.hoisted(() => ({ userDataDir: '' }))

vi.mock('electron', () => ({
  app: {
    getPath: () => mockPaths.userDataDir,
  },
}))

import { DataSourceConfigStore } from './config-store'

let tempDir = ''

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'cclink-studio-data-source-store-'))
  mockPaths.userDataDir = tempDir
})

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true })
})

describe('DataSourceConfigStore', () => {
  it('persists non-sensitive data source config', async () => {
    const store = new DataSourceConfigStore()
    await store.upsert({
      id: 'source-1',
      type: 'elasticsearch',
      scope: 'workspace',
      name: 'Articles',
      endpoint: 'https://es.example.com',
      authRef: 'data-source:source-1',
      readOnly: true,
      timeoutMs: 10000,
      maxRows: 100,
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T00:00:00.000Z',
    })

    const raw = await readFile(join(tempDir, 'data-source/connections.json'), 'utf-8')
    expect(raw).toContain('https://es.example.com')
    expect(raw).toContain('data-source:source-1')
    expect(raw).not.toContain('super-secret')

    const reloaded = new DataSourceConfigStore()
    expect(await reloaded.list()).toHaveLength(1)
  })
})
