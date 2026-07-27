import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockPaths = vi.hoisted(() => ({ userDataDir: '' }))

vi.mock('electron', () => ({
  app: {
    getPath: () => mockPaths.userDataDir,
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, 'utf-8'),
    decryptString: (value: Buffer) => value.toString('utf-8'),
  },
}))

import { DataSourceAdapterRegistry } from './adapter-registry'
import { DataSourceAuditLog } from './audit-log'
import { DataSourceConfigStore } from './config-store'
import { DataSourceCredentialStore } from './credential-store'
import { DataSourceService } from './data-source-service'
import type { DataSourceAdapter } from './adapters/adapter'
import type { DataSourceConfig, DataSourceSecret, RunDataQueryInput } from './types'

let tempDir = ''

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'cclink-studio-data-source-service-'))
  mockPaths.userDataDir = tempDir
})

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true })
})

function createService(adapter: DataSourceAdapter): DataSourceService {
  const registry = new DataSourceAdapterRegistry()
  registry.register(adapter)
  return new DataSourceService({
    configStore: new DataSourceConfigStore(),
    credentialStore: new DataSourceCredentialStore(),
    auditLog: new DataSourceAuditLog(),
    adapterRegistry: registry,
  })
}

describe('DataSourceService', () => {
  it('defers decrypting credentials until an authenticated operation runs', async () => {
    const config: DataSourceConfig = {
      id: 'source-lazy',
      type: 'elasticsearch',
      scope: 'workspace',
      name: 'Lazy source',
      endpoint: 'https://es.example.com',
      authRef: 'data-source:source-lazy',
      readOnly: true,
      timeoutMs: 10_000,
      maxRows: 100,
      createdAt: '2026-07-27T00:00:00.000Z',
      updatedAt: '2026-07-27T00:00:00.000Z',
    }
    const configStore = new DataSourceConfigStore()
    await configStore.upsert(config)
    await new DataSourceCredentialStore().saveSecret({
      sourceId: config.id,
      authType: 'apiKey',
      apiKey: 'lazy-secret',
    })
    const decryptString = vi.fn((value: Buffer) => value.toString('utf-8'))
    const credentialStore = new DataSourceCredentialStore('data-source/secrets.enc', {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(value, 'utf-8'),
      decryptString,
    })
    const registry = new DataSourceAdapterRegistry()
    registry.register({
      type: 'elasticsearch',
      async test(_config, secret) {
        return { ok: secret?.apiKey === 'lazy-secret', sourceId: config.id }
      },
      async listCollections() {
        return []
      },
      async query() {
        throw new Error('not used')
      },
      async getRecord() {
        throw new Error('not used')
      },
    })
    const service = new DataSourceService({
      configStore,
      credentialStore,
      auditLog: new DataSourceAuditLog(),
      adapterRegistry: registry,
    })

    await service.load()
    await expect(service.listSources()).resolves.toHaveLength(1)
    expect(decryptString).not.toHaveBeenCalled()

    await expect(service.testConnection(config.id)).resolves.toMatchObject({ ok: true })
    expect(decryptString).toHaveBeenCalledOnce()
  })

  it('creates a source without leaking secrets into config', async () => {
    const service = createService({
      type: 'elasticsearch',
      async test() {
        return { ok: true, sourceId: 'source-1' }
      },
      async listCollections() {
        return []
      },
      async query() {
        throw new Error('not used')
      },
      async getRecord() {
        throw new Error('not used')
      },
    })

    const config = await service.createSource({
      type: 'elasticsearch',
      name: 'Articles',
      endpoint: 'https://es.example.com/',
      secret: { authType: 'apiKey', apiKey: 'super-secret' },
    })

    expect(config.endpoint).toBe('https://es.example.com')
    expect(config.authRef).toBe(`data-source:${config.id}`)
    const rawConfig = await readFile(join(tempDir, 'data-source/connections.json'), 'utf-8')
    expect(rawConfig).not.toContain('super-secret')
  })

  it('routes query through the adapter and records audit metadata', async () => {
    const querySpy = vi.fn(
      async (
        input: RunDataQueryInput,
        config: DataSourceConfig,
        secret: DataSourceSecret | null,
      ) => ({
        id: 'snapshot-1',
        sourceId: config.id,
        collection: input.collection ?? 'articles-*',
        query: input.query,
        executedAt: '2026-07-15T00:00:00.000Z',
        total: 1,
        returned: 1,
        truncated: false,
        records: [
          {
            id: 'doc-1',
            sourceId: config.id,
            collection: 'articles-*',
            title: 'Hello',
          },
        ],
        secretSeen: secret?.apiKey,
      }),
    )
    const adapter: DataSourceAdapter = {
      type: 'elasticsearch',
      async test() {
        return { ok: true, sourceId: 'unused' }
      },
      async listCollections() {
        return []
      },
      query: querySpy,
      async getRecord() {
        throw new Error('not used')
      },
    }
    const service = createService(adapter)

    const config = await service.createSource({
      type: 'elasticsearch',
      name: 'Articles',
      endpoint: 'https://es.example.com',
      defaultCollection: 'articles-*',
      secret: { authType: 'apiKey', apiKey: 'super-secret' },
    })

    const snapshot = await service.runQuery({
      sourceId: config.id,
      query: { query: { match_all: {} } },
      caller: 'test',
    })

    expect(snapshot.records[0].title).toBe('Hello')
    expect(querySpy.mock.calls[0][2]).toMatchObject({ apiKey: 'super-secret' })
    const audit = await readFile(join(tempDir, 'data-source/audit-log.jsonl'), 'utf-8')
    expect(audit).toContain('"caller":"test"')
    expect(audit).toContain('"action":"query"')
    expect(audit).not.toContain('super-secret')
  })

  it('requires a secret when config has an authRef but no stored credential', async () => {
    const adapter: DataSourceAdapter = {
      type: 'elasticsearch',
      async test() {
        return { ok: true, sourceId: 'unused' }
      },
      async listCollections() {
        return []
      },
      async query() {
        throw new Error('should not execute')
      },
      async getRecord() {
        throw new Error('not used')
      },
    }
    const service = createService(adapter)

    const config = await service.createSource({
      type: 'elasticsearch',
      name: 'Articles',
      endpoint: 'https://es.example.com',
      secret: { authType: 'apiKey', apiKey: 'temporary' },
    })
    await new DataSourceCredentialStore().removeSecret(config.id)

    await expect(
      createService(adapter).runQuery({ sourceId: config.id, query: { query: { match_all: {} } } }),
    ).rejects.toMatchObject({ code: 'DATA_SOURCE_SECRET_MISSING' })
  })

  it('saves, updates, and filters saved queries by source', async () => {
    const adapter: DataSourceAdapter = {
      type: 'elasticsearch',
      async test() {
        return { ok: true, sourceId: 'unused' }
      },
      async listCollections() {
        return []
      },
      async query() {
        throw new Error('not used')
      },
      async getRecord() {
        throw new Error('not used')
      },
    }
    const service = createService(adapter)

    const articles = await service.createSource({
      type: 'elasticsearch',
      name: 'Articles',
      endpoint: 'https://es.example.com',
    })
    const logs = await service.createSource({
      type: 'elasticsearch',
      name: 'Logs',
      endpoint: 'https://logs.example.com',
    })

    const saved = await service.saveQuery({
      sourceId: articles.id,
      name: '  最近文章  ',
      collection: ' articles-* ',
      query: { query: { match_all: {} } },
    })
    await service.saveQuery({
      sourceId: logs.id,
      name: '错误日志',
      collection: 'logs-*',
      query: { query: { term: { level: 'error' } } },
    })
    const updated = await service.saveQuery({
      id: saved.id,
      sourceId: articles.id,
      name: '最近 50 篇文章',
      collection: 'articles-*',
      query: { query: { match_all: {} }, size: 50 },
    })

    expect(updated.id).toBe(saved.id)
    expect(updated.createdAt).toBe(saved.createdAt)
    expect(updated.name).toBe('最近 50 篇文章')
    expect(await service.listSavedQueries(articles.id)).toMatchObject([
      {
        id: saved.id,
        sourceId: articles.id,
        collection: 'articles-*',
        query: { query: { match_all: {} }, size: 50 },
      },
    ])
    expect(await service.listSavedQueries()).toHaveLength(2)

    await expect(
      service.saveQuery({
        id: saved.id,
        sourceId: logs.id,
        name: '错误日志覆盖',
        collection: 'logs-*',
        query: { query: { match_all: {} } },
      }),
    ).rejects.toMatchObject({ code: 'DATA_SOURCE_QUERY_INVALID' })
  })

  it('removes saved queries when deleting a source', async () => {
    const adapter: DataSourceAdapter = {
      type: 'elasticsearch',
      async test() {
        return { ok: true, sourceId: 'unused' }
      },
      async listCollections() {
        return []
      },
      async query() {
        throw new Error('not used')
      },
      async getRecord() {
        throw new Error('not used')
      },
    }
    const service = createService(adapter)

    const source = await service.createSource({
      type: 'elasticsearch',
      name: 'Articles',
      endpoint: 'https://es.example.com',
    })
    await service.saveQuery({
      sourceId: source.id,
      name: '最近文章',
      collection: 'articles-*',
      query: { query: { match_all: {} } },
    })

    await service.deleteSource(source.id)

    expect(await service.listSavedQueries(source.id)).toEqual([])
    const rawSavedQueries = await readFile(join(tempDir, 'data-source/saved-queries.json'), 'utf-8')
    expect(rawSavedQueries).not.toContain(source.id)
  })
})
