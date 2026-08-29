import { z } from 'zod'
import { isDataSourceError } from './errors'
import type { DataSourceService } from './data-source-service'
import type { DataSourceOperationResult } from '../../shared/ipc/data-source'
import { dataSourceIpcContracts } from '../../shared/ipc/data-source-contract'
import {
  registerTrustedIpcContract,
  type TrustedRendererGuard,
} from '../ipc/trusted-renderer-guard'

function ok<T>(data: T): DataSourceOperationResult<T> {
  return { success: true, data }
}

function fail<T>(error: unknown): DataSourceOperationResult<T> {
  if (isDataSourceError(error)) {
    return { success: false, error: { code: error.code, message: error.message } }
  }
  if (error instanceof z.ZodError) {
    return {
      success: false,
      error: {
        code: 'DATA_SOURCE_QUERY_INVALID',
        message: error.issues.map((issue) => issue.message).join('; '),
      },
    }
  }
  if (error instanceof Error) {
    return {
      success: false,
      error: { code: 'DATA_SOURCE_INTERNAL_ERROR', message: error.message },
    }
  }
  return {
    success: false,
    error: { code: 'DATA_SOURCE_INTERNAL_ERROR', message: '未知数据源错误' },
  }
}

async function runOperation<T>(fn: () => Promise<T>): Promise<DataSourceOperationResult<T>> {
  try {
    return ok(await fn())
  } catch (error) {
    return fail(error)
  }
}

export function registerDataSourceIpc(
  dataSourceService: DataSourceService | (() => DataSourceService | null),
  trustedRendererGuard: TrustedRendererGuard,
): void {
  const getService = (): DataSourceService => {
    const service =
      typeof dataSourceService === 'function' ? dataSourceService() : dataSourceService
    if (!service) throw new Error('数据源能力当前不可用，请查看 Agent 能力状态')
    return service
  }

  registerTrustedIpcContract(dataSourceIpcContracts.listSources, trustedRendererGuard, () =>
    runOperation(() => getService().listSources()),
  )

  registerTrustedIpcContract(
    dataSourceIpcContracts.createSource,
    trustedRendererGuard,
    (_event, input) => runOperation(() => getService().createSource(input)),
  )

  registerTrustedIpcContract(
    dataSourceIpcContracts.testConnection,
    trustedRendererGuard,
    (_event, id) => runOperation(() => getService().testConnection(id)),
  )

  registerTrustedIpcContract(
    dataSourceIpcContracts.listCollections,
    trustedRendererGuard,
    (_event, id) => runOperation(() => getService().listCollections(id)),
  )

  registerTrustedIpcContract(
    dataSourceIpcContracts.runQuery,
    trustedRendererGuard,
    (_event, input) => runOperation(() => getService().runQuery(input)),
  )

  registerTrustedIpcContract(
    dataSourceIpcContracts.listSavedQueries,
    trustedRendererGuard,
    (_event, sourceId) => runOperation(() => getService().listSavedQueries(sourceId)),
  )

  registerTrustedIpcContract(
    dataSourceIpcContracts.saveQuery,
    trustedRendererGuard,
    (_event, input) => runOperation(() => getService().saveQuery(input)),
  )
}
