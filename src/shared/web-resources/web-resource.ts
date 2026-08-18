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
  WebResourceSnapshot,
  WebAccount,
  WebAccountGroup,
  CreateWebAccountGroupInput,
  UpdateWebAccountGroupInput,
  ArchiveWebAccountGroupInput,
  ArchiveWebAccountInput,
  MergeWebAccountsInput,
} from './web-resource-types'

export interface WebResourcesApiContract {
  getSnapshot(
    input: WebResourceProjectScopeInput,
  ): Promise<WebResourceOperationResult<WebResourceSnapshot>>
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
  createAccountGroup(
    input: CreateWebAccountGroupInput,
  ): Promise<WebResourceOperationResult<WebAccountGroup>>
  updateAccountGroup(
    input: UpdateWebAccountGroupInput,
  ): Promise<WebResourceOperationResult<WebAccountGroup>>
  archiveAccountGroup(
    input: ArchiveWebAccountGroupInput,
  ): Promise<WebResourceOperationResult<WebAccountGroup>>
  archiveAccount(input: ArchiveWebAccountInput): Promise<WebResourceOperationResult<WebAccount>>
  mergeAccounts(input: MergeWebAccountsInput): Promise<WebResourceOperationResult<WebAccount>>
}

export const webResourcesIpc = {
  getSnapshot: defineIpcCall<
    [WebResourceProjectScopeInput],
    WebResourceOperationResult<WebResourceSnapshot>
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
  createAccountGroup: defineIpcCall<
    [CreateWebAccountGroupInput],
    WebResourceOperationResult<WebAccountGroup>
  >('webResources:createAccountGroup'),
  updateAccountGroup: defineIpcCall<
    [UpdateWebAccountGroupInput],
    WebResourceOperationResult<WebAccountGroup>
  >('webResources:updateAccountGroup'),
  archiveAccountGroup: defineIpcCall<
    [ArchiveWebAccountGroupInput],
    WebResourceOperationResult<WebAccountGroup>
  >('webResources:archiveAccountGroup'),
  archiveAccount: defineIpcCall<[ArchiveWebAccountInput], WebResourceOperationResult<WebAccount>>(
    'webResources:archiveAccount',
  ),
  mergeAccounts: defineIpcCall<[MergeWebAccountsInput], WebResourceOperationResult<WebAccount>>(
    'webResources:mergeAccounts',
  ),
} as const
