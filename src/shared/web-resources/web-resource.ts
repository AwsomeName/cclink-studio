import { defineIpcCall } from '../ipc/contract'
import type {
  CreateWebConnectionInput,
  ImportProjectOpsConfigInput,
  ImportProjectOpsConfigSummary,
  WebResourceConnection,
  WebResourceOperationResult,
  WebResourceSnapshot,
} from './web-resource-types'

export interface WebResourcesApiContract {
  getSnapshot(): Promise<WebResourceOperationResult<WebResourceSnapshot>>
  createConnection(
    input: CreateWebConnectionInput,
  ): Promise<WebResourceOperationResult<WebResourceConnection>>
  importProjectOpsConfig(
    input: ImportProjectOpsConfigInput,
  ): Promise<WebResourceOperationResult<ImportProjectOpsConfigSummary>>
}

export const webResourcesIpc = {
  getSnapshot: defineIpcCall<[], WebResourceOperationResult<WebResourceSnapshot>>(
    'webResources:getSnapshot',
  ),
  createConnection: defineIpcCall<
    [CreateWebConnectionInput],
    WebResourceOperationResult<WebResourceConnection>
  >('webResources:createConnection'),
  importProjectOpsConfig: defineIpcCall<
    [ImportProjectOpsConfigInput],
    WebResourceOperationResult<ImportProjectOpsConfigSummary>
  >('webResources:importProjectOpsConfig'),
} as const
