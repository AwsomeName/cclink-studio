import { DataSourceAdapterRegistry } from './adapter-registry'
import { DataSourceAuditLog } from './audit-log'
import { DataSourceConfigStore } from './config-store'
import { DataSourceCredentialStore } from './credential-store'
import { SavedQueryStore } from './saved-query-store'
import { ElasticsearchAdapter } from './adapters/elasticsearch-adapter'
import { DataSourceError, toDataSourceError } from './errors'
import type {
  ConnectionTestResult,
  CreateDataSourceInput,
  DataCollection,
  DataQuerySnapshot,
  DataSourceConfig,
  DataSourceSecret,
  GetRecordInput,
  NormalizedRecord,
  RunDataQueryInput,
  SaveDataQueryInput,
  SavedDataQuery,
  UpdateDataSourceInput,
} from './types'

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_ROWS = 100
const MAX_TIMEOUT_MS = 60_000
const MAX_ROWS = 500

function nowIso(): string {
  return new Date().toISOString()
}

function newSourceId(): string {
  return `ds_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function newSavedQueryId(): string {
  return `saved-query-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function normalizeTimeoutMs(value: number | undefined): number {
  if (!Number.isFinite(value) || !value) return DEFAULT_TIMEOUT_MS
  return Math.max(1000, Math.min(Math.floor(value), MAX_TIMEOUT_MS))
}

function normalizeMaxRows(value: number | undefined): number {
  if (!Number.isFinite(value) || !value) return DEFAULT_MAX_ROWS
  return Math.max(1, Math.min(Math.floor(value), MAX_ROWS))
}

function sanitizeEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new DataSourceError(
      'DATA_SOURCE_QUERY_INVALID',
      '数据源 endpoint 必须以 http:// 或 https:// 开头',
    )
  }
  return trimmed
}

function publicConfig(config: DataSourceConfig): DataSourceConfig {
  return { ...config }
}

export interface DataSourceServiceOptions {
  configStore?: DataSourceConfigStore
  credentialStore?: DataSourceCredentialStore
  savedQueryStore?: SavedQueryStore
  auditLog?: DataSourceAuditLog
  adapterRegistry?: DataSourceAdapterRegistry
}

export class DataSourceService {
  private readonly configStore: DataSourceConfigStore
  private readonly credentialStore: DataSourceCredentialStore
  private readonly savedQueryStore: SavedQueryStore
  private readonly auditLog: DataSourceAuditLog
  private readonly adapterRegistry: DataSourceAdapterRegistry

  constructor(options: DataSourceServiceOptions = {}) {
    this.configStore = options.configStore ?? new DataSourceConfigStore()
    this.credentialStore = options.credentialStore ?? new DataSourceCredentialStore()
    this.savedQueryStore = options.savedQueryStore ?? new SavedQueryStore()
    this.auditLog = options.auditLog ?? new DataSourceAuditLog()
    this.adapterRegistry = options.adapterRegistry ?? new DataSourceAdapterRegistry()
    if (!options.adapterRegistry) {
      this.adapterRegistry.register(new ElasticsearchAdapter())
    }
  }

  async load(): Promise<void> {
    await Promise.all([this.configStore.load(), this.savedQueryStore.load()])
  }

  async listSources(): Promise<DataSourceConfig[]> {
    const sources = await this.configStore.list()
    return sources.map(publicConfig)
  }

  async createSource(input: CreateDataSourceInput): Promise<DataSourceConfig> {
    if (input.type !== 'elasticsearch') {
      throw new DataSourceError(
        'DATA_SOURCE_ADAPTER_UNSUPPORTED',
        `不支持的数据源类型: ${input.type}`,
      )
    }
    const timestamp = nowIso()
    const id = newSourceId()
    const config: DataSourceConfig = {
      id,
      type: input.type,
      scope: input.scope ?? 'workspace',
      name: input.name.trim(),
      endpoint: sanitizeEndpoint(input.endpoint),
      defaultCollection: input.defaultCollection?.trim() || undefined,
      authRef: input.secret ? `data-source:${id}` : undefined,
      readOnly: true,
      timeoutMs: normalizeTimeoutMs(input.timeoutMs),
      maxRows: normalizeMaxRows(input.maxRows),
      fieldMapping: input.fieldMapping,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    if (!config.name) {
      throw new DataSourceError('DATA_SOURCE_QUERY_INVALID', '数据源名称不能为空')
    }
    if (input.secret) {
      await this.credentialStore.saveSecret({ ...input.secret, sourceId: id })
    }
    return this.configStore.upsert(config)
  }

  async updateSource(id: string, patch: UpdateDataSourceInput): Promise<DataSourceConfig> {
    const existing = await this.requireConfig(id)
    const updated: DataSourceConfig = {
      ...existing,
      name: patch.name !== undefined ? patch.name.trim() : existing.name,
      endpoint: patch.endpoint !== undefined ? sanitizeEndpoint(patch.endpoint) : existing.endpoint,
      defaultCollection:
        patch.defaultCollection !== undefined
          ? patch.defaultCollection.trim() || undefined
          : existing.defaultCollection,
      timeoutMs:
        patch.timeoutMs !== undefined ? normalizeTimeoutMs(patch.timeoutMs) : existing.timeoutMs,
      maxRows: patch.maxRows !== undefined ? normalizeMaxRows(patch.maxRows) : existing.maxRows,
      fieldMapping: patch.fieldMapping !== undefined ? patch.fieldMapping : existing.fieldMapping,
      authRef: patch.secret ? `data-source:${id}` : existing.authRef,
      updatedAt: nowIso(),
    }
    if (!updated.name) {
      throw new DataSourceError('DATA_SOURCE_QUERY_INVALID', '数据源名称不能为空')
    }
    if (patch.secret) {
      await this.credentialStore.saveSecret({ ...patch.secret, sourceId: id })
    }
    return this.configStore.upsert(updated)
  }

  async deleteSource(id: string): Promise<void> {
    await this.configStore.remove(id)
    await this.credentialStore.removeSecret(id)
    await this.savedQueryStore.removeBySource(id)
  }

  async testConnection(id: string): Promise<ConnectionTestResult> {
    const start = Date.now()
    try {
      const config = await this.requireConfig(id)
      const result = await this.adapterRegistry
        .get(config.type)
        .test(config, await this.getSecret(config))
      await this.recordAudit({
        caller: 'user',
        sourceId: id,
        action: 'test',
        ok: true,
        durationMs: Date.now() - start,
      })
      return result
    } catch (error) {
      await this.recordAuditError(id, 'test', start, error)
      throw error
    }
  }

  async listCollections(id: string): Promise<DataCollection[]> {
    const start = Date.now()
    try {
      const config = await this.requireConfig(id)
      const collections = await this.adapterRegistry
        .get(config.type)
        .listCollections(config, await this.getSecret(config))
      await this.recordAudit({
        caller: 'user',
        sourceId: id,
        action: 'list-collections',
        ok: true,
        durationMs: Date.now() - start,
        returned: collections.length,
      })
      return collections
    } catch (error) {
      await this.recordAuditError(id, 'list-collections', start, error)
      throw error
    }
  }

  async runQuery(input: RunDataQueryInput): Promise<DataQuerySnapshot> {
    const start = Date.now()
    try {
      const config = await this.requireConfig(input.sourceId)
      const snapshot = await this.adapterRegistry.get(config.type).query(
        {
          ...input,
          maxRows: normalizeMaxRows(input.maxRows ?? config.maxRows),
        },
        config,
        await this.getSecret(config),
      )
      await this.recordAudit({
        caller: input.caller ?? 'user',
        sourceId: input.sourceId,
        collection: snapshot.collection,
        action: 'query',
        ok: true,
        durationMs: Date.now() - start,
        total: snapshot.total,
        returned: snapshot.returned,
      })
      return snapshot
    } catch (error) {
      await this.recordAuditError(input.sourceId, 'query', start, error, input.collection)
      throw error
    }
  }

  async getRecord(input: GetRecordInput): Promise<NormalizedRecord> {
    const start = Date.now()
    try {
      const config = await this.requireConfig(input.sourceId)
      const record = await this.adapterRegistry
        .get(config.type)
        .getRecord(input, config, await this.getSecret(config))
      await this.recordAudit({
        caller: input.caller ?? 'user',
        sourceId: input.sourceId,
        collection: input.collection,
        action: 'get-record',
        ok: true,
        durationMs: Date.now() - start,
        returned: 1,
      })
      return record
    } catch (error) {
      await this.recordAuditError(input.sourceId, 'get-record', start, error, input.collection)
      throw error
    }
  }

  async listSavedQueries(sourceId?: string): Promise<SavedDataQuery[]> {
    return this.savedQueryStore.list(sourceId)
  }

  async saveQuery(input: SaveDataQueryInput): Promise<SavedDataQuery> {
    await this.requireConfig(input.sourceId)
    const name = input.name.trim()
    const collection = input.collection.trim()
    if (!name || !collection) {
      throw new DataSourceError('DATA_SOURCE_QUERY_INVALID', 'Saved Query 名称和 index 不能为空')
    }
    const timestamp = nowIso()
    const existing = input.id
      ? (await this.savedQueryStore.list()).find((query) => query.id === input.id)
      : undefined
    if (input.id && existing?.sourceId && existing.sourceId !== input.sourceId) {
      throw new DataSourceError('DATA_SOURCE_QUERY_INVALID', 'Saved Query 不属于当前数据源')
    }
    const saved: SavedDataQuery = {
      id: input.id ?? newSavedQueryId(),
      sourceId: input.sourceId,
      name,
      collection,
      query: input.query,
      fieldMapping: input.fieldMapping,
      maxRows: input.maxRows !== undefined ? normalizeMaxRows(input.maxRows) : undefined,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    }
    return this.savedQueryStore.upsert(saved)
  }

  private async requireConfig(id: string): Promise<DataSourceConfig> {
    const config = await this.configStore.get(id)
    if (!config) {
      throw new DataSourceError('DATA_SOURCE_NOT_FOUND', `未找到数据源: ${id}`)
    }
    return config
  }

  private async getSecret(config: DataSourceConfig): Promise<DataSourceSecret | null> {
    if (!config.authRef) return null
    const secret = await this.credentialStore.getSecret(config.id)
    if (!secret) {
      throw new DataSourceError('DATA_SOURCE_SECRET_MISSING', `数据源缺少凭证: ${config.name}`)
    }
    return secret
  }

  private async recordAudit(input: Parameters<DataSourceAuditLog['record']>[0]): Promise<void> {
    try {
      await this.auditLog.record(input)
    } catch (error) {
      console.warn('[DataSourceService] 写入审计日志失败:', (error as Error).message)
    }
  }

  private async recordAuditError(
    sourceId: string,
    action: 'test' | 'list-collections' | 'query' | 'get-record',
    start: number,
    error: unknown,
    collection?: string,
  ): Promise<void> {
    const normalized = toDataSourceError(error)
    await this.recordAudit({
      caller: 'user',
      sourceId,
      collection,
      action,
      ok: false,
      durationMs: Date.now() - start,
      errorCode: normalized.code,
    })
  }
}
