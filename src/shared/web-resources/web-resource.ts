import { defineIpcCall } from '../ipc/contract'
import type {
  ClaimLegacyWebConnectionsInput,
  ClaimLegacyWebConnectionsSummary,
  ConfirmWebConnectionLoginInput,
  CreateWebConnectionInput,
  ImportProjectOpsConfigInput,
  ImportProjectOpsConfigSummary,
  WebResourceConnection,
  WebResourceOperationResult,
  WebResourceProjectScopeInput,
  WebResourceProjectSnapshot,
} from './web-resource-types'

export interface WebResourcesApiContract {
  getSnapshot(
    input: WebResourceProjectScopeInput,
  ): Promise<WebResourceOperationResult<WebResourceProjectSnapshot>>
  createConnection(
    input: CreateWebConnectionInput,
  ): Promise<WebResourceOperationResult<WebResourceConnection>>
  confirmLogin(
    input: ConfirmWebConnectionLoginInput,
  ): Promise<WebResourceOperationResult<WebResourceConnection>>
  claimLegacyConnections(
    input: ClaimLegacyWebConnectionsInput,
  ): Promise<WebResourceOperationResult<ClaimLegacyWebConnectionsSummary>>
  importProjectOpsConfig(
    input: ImportProjectOpsConfigInput,
  ): Promise<WebResourceOperationResult<ImportProjectOpsConfigSummary>>
}

export const webResourcesIpc = {
  getSnapshot: defineIpcCall<
    [WebResourceProjectScopeInput],
    WebResourceOperationResult<WebResourceProjectSnapshot>
  >('webResources:getSnapshot'),
  createConnection: defineIpcCall<
    [CreateWebConnectionInput],
    WebResourceOperationResult<WebResourceConnection>
  >('webResources:createConnection'),
  confirmLogin: defineIpcCall<
    [ConfirmWebConnectionLoginInput],
    WebResourceOperationResult<WebResourceConnection>
  >('webResources:confirmLogin'),
  claimLegacyConnections: defineIpcCall<
    [ClaimLegacyWebConnectionsInput],
    WebResourceOperationResult<ClaimLegacyWebConnectionsSummary>
  >('webResources:claimLegacyConnections'),
  importProjectOpsConfig: defineIpcCall<
    [ImportProjectOpsConfigInput],
    WebResourceOperationResult<ImportProjectOpsConfigSummary>
  >('webResources:importProjectOpsConfig'),
} as const
