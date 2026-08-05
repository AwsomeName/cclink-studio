import { defineIpcCall } from '../ipc/contract'
import type {
  ClaimLegacyWebConnectionsInput,
  ClaimLegacyWebConnectionsSummary,
  BeginWebResourceDraftInput,
  BeginWebResourceDraftResult,
  CancelWebResourceDraftInput,
  CancelWebResourceDraftResult,
  ConfirmWebConnectionLoginInput,
  CreateWebConnectionInput,
  ImportProjectOpsConfigInput,
  ImportProjectOpsConfigSummary,
  ResolveWebResourceLaunchInput,
  SaveWebResourceDraftInput,
  WebResourceConnection,
  WebResourceOperationResult,
  WebResourceLaunchDescriptor,
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
  beginDraft(
    input: BeginWebResourceDraftInput,
  ): Promise<WebResourceOperationResult<BeginWebResourceDraftResult>>
  saveDraft(
    input: SaveWebResourceDraftInput,
  ): Promise<WebResourceOperationResult<WebResourceConnection>>
  cancelDraft(
    input: CancelWebResourceDraftInput,
  ): Promise<WebResourceOperationResult<CancelWebResourceDraftResult>>
  resolveLaunch(
    input: ResolveWebResourceLaunchInput,
  ): Promise<WebResourceOperationResult<WebResourceLaunchDescriptor>>
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
  beginDraft: defineIpcCall<
    [BeginWebResourceDraftInput],
    WebResourceOperationResult<BeginWebResourceDraftResult>
  >('webResources:beginDraft'),
  saveDraft: defineIpcCall<
    [SaveWebResourceDraftInput],
    WebResourceOperationResult<WebResourceConnection>
  >('webResources:saveDraft'),
  cancelDraft: defineIpcCall<
    [CancelWebResourceDraftInput],
    WebResourceOperationResult<CancelWebResourceDraftResult>
  >('webResources:cancelDraft'),
  resolveLaunch: defineIpcCall<
    [ResolveWebResourceLaunchInput],
    WebResourceOperationResult<WebResourceLaunchDescriptor>
  >('webResources:resolveLaunch'),
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
