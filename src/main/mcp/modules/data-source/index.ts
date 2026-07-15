import type { ToolDefinition, ToolModule } from '../../types'
import type { DataSourceService } from '../../../data-source/data-source-service'
import type { DataQuerySnapshot, NormalizedRecord, RunDataQueryInput } from '../../../data-source/types'
import { DataSourceError } from '../../../data-source/errors'

const DEFAULT_TOOL_LIMIT = 20
const MAX_TOOL_LIMIT = 100

const DATA_SOURCE_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'data_source_list_sources',
    description: '列出 CCLink Studio 已配置的数据源。只返回非敏感连接摘要，不返回凭证。',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'data_source_list_collections',
    description: '列出指定数据源下可查询的 index / collection。',
    inputSchema: {
      type: 'object',
      properties: {
        sourceId: { type: 'string', description: '数据源 ID' },
      },
      required: ['sourceId'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'data_source_list_saved_queries',
    description: '列出指定数据源或全部数据源的 Saved Queries。',
    inputSchema: {
      type: 'object',
      properties: {
        sourceId: { type: 'string', description: '可选的数据源 ID' },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'data_source_search',
    description: '在指定数据源和 index 中按关键词搜索。默认最多返回 20 条归一化记录，不返回 raw。',
    inputSchema: {
      type: 'object',
      properties: {
        sourceId: { type: 'string', description: '数据源 ID' },
        collection: { type: 'string', description: 'index / collection 名称' },
        text: { type: 'string', description: '搜索关键词；为空时执行 match_all' },
        limit: { type: 'number', description: '返回条数，默认 20，最大 100' },
      },
      required: ['sourceId', 'collection'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'data_source_get_record',
    description: '读取指定数据源、index 和 recordId 的单条归一化记录，不返回 raw。',
    inputSchema: {
      type: 'object',
      properties: {
        sourceId: { type: 'string', description: '数据源 ID' },
        collection: { type: 'string', description: 'index / collection 名称' },
        id: { type: 'string', description: '记录 ID' },
      },
      required: ['sourceId', 'collection', 'id'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'data_source_run_saved_query',
    description: '运行一个 Saved Query。默认最多返回 20 条归一化记录，不返回 raw。',
    inputSchema: {
      type: 'object',
      properties: {
        savedQueryId: { type: 'string', description: 'Saved Query ID' },
        limit: { type: 'number', description: '返回条数，默认 20，最大 100' },
      },
      required: ['savedQueryId'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
]

export class DataSourceToolModule implements ToolModule {
  readonly name = 'data-source'
  readonly tools: ToolDefinition[] = DATA_SOURCE_TOOL_DEFINITIONS

  constructor(private readonly service: DataSourceService) {}

  async execute(toolName: string, params: Record<string, unknown>): Promise<unknown> {
    switch (toolName) {
      case 'data_source_list_sources':
        return this.listSources()
      case 'data_source_list_collections':
        return this.service.listCollections(requireString(params.sourceId, 'sourceId'))
      case 'data_source_list_saved_queries':
        return this.listSavedQueries(optionalString(params.sourceId, 'sourceId'))
      case 'data_source_search':
        return this.search(params)
      case 'data_source_get_record':
        return this.getRecord(params)
      case 'data_source_run_saved_query':
        return this.runSavedQuery(params)
      default:
        throw new Error(`未知数据源工具: ${toolName}`)
    }
  }

  private async listSources(): Promise<unknown> {
    const sources = await this.service.listSources()
    return sources.map((source) => ({
      id: source.id,
      type: source.type,
      scope: source.scope,
      name: source.name,
      endpointHost: safeHost(source.endpoint),
      defaultCollection: source.defaultCollection,
      readOnly: source.readOnly,
      maxRows: source.maxRows,
      updatedAt: source.updatedAt,
    }))
  }

  private async listSavedQueries(sourceId?: string): Promise<unknown> {
    const queries = await this.service.listSavedQueries(sourceId)
    return queries.map((query) => ({
      id: query.id,
      sourceId: query.sourceId,
      name: query.name,
      collection: query.collection,
      maxRows: query.maxRows,
      updatedAt: query.updatedAt,
    }))
  }

  private async search(params: Record<string, unknown>): Promise<DataQuerySnapshot> {
    const input: RunDataQueryInput = {
      sourceId: requireString(params.sourceId, 'sourceId'),
      collection: requireString(params.collection, 'collection'),
      query: buildSearchQuery(optionalString(params.text, 'text')),
      maxRows: normalizeLimit(params.limit),
      includeRaw: false,
      caller: 'mcp:data_source_search',
    }
    return stripSnapshotRaw(await this.service.runQuery(input))
  }

  private async getRecord(params: Record<string, unknown>): Promise<NormalizedRecord> {
    return stripRecordRaw(
      await this.service.getRecord({
        sourceId: requireString(params.sourceId, 'sourceId'),
        collection: requireString(params.collection, 'collection'),
        id: requireString(params.id, 'id'),
        includeRaw: false,
        caller: 'mcp:data_source_get_record',
      }),
    )
  }

  private async runSavedQuery(params: Record<string, unknown>): Promise<DataQuerySnapshot> {
    const savedQueryId = requireString(params.savedQueryId, 'savedQueryId')
    const savedQuery = (await this.service.listSavedQueries()).find((query) => query.id === savedQueryId)
    if (!savedQuery) {
      throw new DataSourceError('DATA_SOURCE_NOT_FOUND', `未找到 Saved Query: ${savedQueryId}`)
    }
    return stripSnapshotRaw(
      await this.service.runQuery({
        sourceId: savedQuery.sourceId,
        collection: savedQuery.collection,
        query: savedQuery.query,
        maxRows: normalizeLimit(params.limit ?? savedQuery.maxRows),
        includeRaw: false,
        caller: 'mcp:data_source_run_saved_query',
      }),
    )
  }
}

function buildSearchQuery(text?: string): Record<string, unknown> {
  const q = text?.trim()
  if (!q) return { query: { match_all: {} } }
  return {
    query: {
      multi_match: {
        query: q,
        fields: ['title^3', 'content', 'author', 'tags'],
      },
    },
  }
}

function normalizeLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_TOOL_LIMIT
  return Math.max(1, Math.min(Math.floor(value), MAX_TOOL_LIMIT))
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new DataSourceError('DATA_SOURCE_QUERY_INVALID', `缺少参数: ${field}`)
  }
  return value.trim()
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') {
    throw new DataSourceError('DATA_SOURCE_QUERY_INVALID', `${field} 参数必须是字符串`)
  }
  return value.trim() || undefined
}

function stripSnapshotRaw(snapshot: DataQuerySnapshot): DataQuerySnapshot {
  return {
    ...snapshot,
    records: snapshot.records.map(stripRecordRaw),
  }
}

function stripRecordRaw(record: NormalizedRecord): NormalizedRecord {
  const { raw: _raw, ...rest } = record
  return rest
}

function safeHost(endpoint: string): string {
  try {
    return new URL(endpoint).host
  } catch {
    return ''
  }
}
