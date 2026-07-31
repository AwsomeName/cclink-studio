import { defineIpcCall } from '../ipc/contract'
import type {
  CreateWebConnectionInput,
  WebResourceConnection,
  WebResourceOperationResult,
  WebResourceSnapshot,
} from './web-resource-types'

export interface WebResourcesApiContract {
  getSnapshot(): Promise<WebResourceOperationResult<WebResourceSnapshot>>
  createConnection(
    input: CreateWebConnectionInput,
  ): Promise<WebResourceOperationResult<WebResourceConnection>>
}

export const webResourcesIpc = {
  getSnapshot: defineIpcCall<[], WebResourceOperationResult<WebResourceSnapshot>>(
    'webResources:getSnapshot',
  ),
  createConnection: defineIpcCall<
    [CreateWebConnectionInput],
    WebResourceOperationResult<WebResourceConnection>
  >('webResources:createConnection'),
} as const
