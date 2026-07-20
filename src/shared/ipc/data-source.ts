export type {
  ConnectionTestResult,
  CreateDataSourceInput,
  DataCollection,
  DataQuerySnapshot,
  DataSourceConfig,
  DataSourceErrorCode,
  DataSourceSecret,
  FieldMapping,
  GetRecordInput,
  NormalizedRecord,
  RunDataQueryInput,
  SaveDataQueryInput,
  SavedDataQuery,
  UpdateDataSourceInput,
} from '../data-source'

import type {
  ConnectionTestResult,
  CreateDataSourceInput,
  DataCollection,
  DataQuerySnapshot,
  DataSourceConfig,
  DataSourceErrorCode,
  RunDataQueryInput,
  SaveDataQueryInput,
  SavedDataQuery,
} from '../data-source'

export interface DataSourceOperationError {
  code: DataSourceErrorCode
  message: string
}

export type DataSourceOperationResult<T> =
  | { success: true; data: T }
  | { success: false; error: DataSourceOperationError }

export interface DataSourceApiContract {
  listSources(): Promise<DataSourceOperationResult<DataSourceConfig[]>>
  createSource(input: CreateDataSourceInput): Promise<DataSourceOperationResult<DataSourceConfig>>
  testConnection(id: string): Promise<DataSourceOperationResult<ConnectionTestResult>>
  listCollections(id: string): Promise<DataSourceOperationResult<DataCollection[]>>
  runQuery(input: RunDataQueryInput): Promise<DataSourceOperationResult<DataQuerySnapshot>>
  listSavedQueries(sourceId?: string): Promise<DataSourceOperationResult<SavedDataQuery[]>>
  saveQuery(input: SaveDataQueryInput): Promise<DataSourceOperationResult<SavedDataQuery>>
}
