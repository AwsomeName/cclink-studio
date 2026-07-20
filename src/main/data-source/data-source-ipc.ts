import { z } from 'zod'
import type { IpcMainInvokeEvent } from 'electron'
import { isDataSourceError } from './errors'
import type { DataSourceService } from './data-source-service'
import type { DataSourceOperationResult } from '../../shared/ipc/data-source'
import { registerTrustedIpcHandler, type TrustedRendererGuard } from '../ipc/trusted-renderer-guard'
import {
  createSourceSchema,
  dataSourceIdSchema,
  optionalDataSourceIdSchema,
  runQuerySchema,
  saveQuerySchema,
} from './data-source-ipc-schema'

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
  dataSourceService: DataSourceService,
  trustedRendererGuard: TrustedRendererGuard,
): void {
  const handle = <Args extends unknown[], Result>(
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: Args) => Result,
  ): void => registerTrustedIpcHandler(channel, trustedRendererGuard, handler)

  handle('data-source:list', () => runOperation(() => dataSourceService.listSources()))

  handle('data-source:create', (_event, input: unknown) =>
    runOperation(() => dataSourceService.createSource(createSourceSchema.parse(input))),
  )

  handle('data-source:test', (_event, id: unknown) =>
    runOperation(() => dataSourceService.testConnection(dataSourceIdSchema.parse(id))),
  )

  handle('data-source:list-collections', (_event, id: unknown) =>
    runOperation(() => dataSourceService.listCollections(dataSourceIdSchema.parse(id))),
  )

  handle('data-source:query', (_event, input: unknown) =>
    runOperation(() => dataSourceService.runQuery(runQuerySchema.parse(input))),
  )

  handle('data-source:list-saved-queries', (_event, sourceId: unknown) =>
    runOperation(() =>
      dataSourceService.listSavedQueries(optionalDataSourceIdSchema.parse(sourceId)),
    ),
  )

  handle('data-source:save-query', (_event, input: unknown) =>
    runOperation(() => dataSourceService.saveQuery(saveQuerySchema.parse(input))),
  )
}
