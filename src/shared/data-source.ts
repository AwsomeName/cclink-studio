export type DataSourceType = 'elasticsearch'

export type DataSourceScope = 'workspace' | 'global'

export type DataSourceAuthType = 'apiKey' | 'basic' | 'bearer' | 'none'

export type DataSourceErrorCode =
  | 'DATA_SOURCE_NOT_FOUND'
  | 'DATA_SOURCE_SECRET_MISSING'
  | 'DATA_SOURCE_AUTH_FAILED'
  | 'DATA_SOURCE_NETWORK_ERROR'
  | 'DATA_SOURCE_TLS_ERROR'
  | 'DATA_SOURCE_TIMEOUT'
  | 'DATA_SOURCE_COLLECTION_NOT_FOUND'
  | 'DATA_SOURCE_QUERY_INVALID'
  | 'DATA_SOURCE_QUERY_REJECTED'
  | 'DATA_SOURCE_RESULT_TOO_LARGE'
  | 'DATA_SOURCE_ADAPTER_UNSUPPORTED'
  | 'DATA_SOURCE_INTERNAL_ERROR'

export interface FieldMapping {
  title?: string[]
  content?: string[]
  sourceUrl?: string[]
  author?: string[]
  publishedAt?: string[]
  collectedAt?: string[]
  updatedAt?: string[]
  tags?: string[]
}

export interface DataSourceConfig {
  id: string
  type: DataSourceType
  scope: DataSourceScope
  name: string
  endpoint: string
  defaultCollection?: string
  authRef?: string
  readOnly: true
  timeoutMs: number
  maxRows: number
  fieldMapping?: FieldMapping
  createdAt: string
  updatedAt: string
}

export interface DataSourceSecret {
  sourceId: string
  authType: DataSourceAuthType
  username?: string
  password?: string
  apiKey?: string
  token?: string
}

export interface DataCollection {
  sourceId: string
  name: string
  kind: 'index'
  docsCount?: number
  health?: 'green' | 'yellow' | 'red' | 'unknown'
}

export interface NormalizedRecord {
  id: string
  sourceId: string
  collection: string
  title?: string
  content?: string
  sourceUrl?: string
  author?: string
  publishedAt?: string
  collectedAt?: string
  updatedAt?: string
  tags?: string[]
  score?: number
  raw?: unknown
}

export interface DataQuerySnapshot {
  id: string
  sourceId: string
  collection: string
  query: unknown
  executedAt: string
  total: number
  returned: number
  truncated: boolean
  records: NormalizedRecord[]
  nextCursor?: string
}

export interface SavedDataQuery {
  id: string
  sourceId: string
  name: string
  collection: string
  query: unknown
  fieldMapping?: FieldMapping
  maxRows?: number
  createdAt: string
  updatedAt: string
}

export interface SaveDataQueryInput {
  id?: string
  sourceId: string
  name: string
  collection: string
  query: unknown
  fieldMapping?: FieldMapping
  maxRows?: number
}

export interface CreateDataSourceInput {
  type: DataSourceType
  scope?: DataSourceScope
  name: string
  endpoint: string
  defaultCollection?: string
  timeoutMs?: number
  maxRows?: number
  fieldMapping?: FieldMapping
  secret?: Omit<DataSourceSecret, 'sourceId'>
}

export interface UpdateDataSourceInput {
  name?: string
  endpoint?: string
  defaultCollection?: string
  timeoutMs?: number
  maxRows?: number
  fieldMapping?: FieldMapping
  secret?: Omit<DataSourceSecret, 'sourceId'>
}

export interface ConnectionTestResult {
  ok: boolean
  sourceId: string
  message?: string
  clusterName?: string
  version?: string
}

export interface RunDataQueryInput {
  sourceId: string
  collection?: string
  query: unknown
  maxRows?: number
  includeRaw?: boolean
  caller?: string
}

export interface GetRecordInput {
  sourceId: string
  collection: string
  id: string
  includeRaw?: boolean
  caller?: string
}

export interface DataSourceAuditEvent {
  id: string
  timestamp: string
  caller: string
  sourceId: string
  collection?: string
  action: 'test' | 'list-collections' | 'query' | 'get-record'
  ok: boolean
  durationMs: number
  total?: number
  returned?: number
  errorCode?: DataSourceErrorCode
}
