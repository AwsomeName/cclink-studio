import { defineIpcCall } from '../ipc/contract'
import type {
  BindWebAffairAttemptInput,
  ClaimLegacyWebAffairInput,
  CompleteWebAffairCheckInput,
  ConfirmWebAffairFinalActionInput,
  CreateWebAffairInput,
  DecideWebAffairFlowProposalInput,
  FinishWebAffairAttemptInput,
  HandoffWebAffairAttemptInput,
  InspectWebAffairMaterialsInput,
  ProposeWebAffairFlowDiffInput,
  ReturnWebAffairAttemptInput,
  ReviseWebAffairFlowInput,
  ScheduleWebAffairCheckInput,
  StartWebAffairAttemptInput,
  UpdateWebAffairNodeInput,
  WebAffair,
  WebAffairCatalog,
  WebAffairChangedPayload,
  WebAffairOperationResult,
  WebAffairProjectSnapshot,
  WebAffairWorkspaceScopeInput,
} from './web-affair-types'

export interface WebAffairsApiContract {
  getSnapshot(
    input: WebAffairWorkspaceScopeInput,
  ): Promise<WebAffairOperationResult<WebAffairProjectSnapshot>>
  getCatalog(): Promise<WebAffairOperationResult<WebAffairCatalog>>
  createAffair(input: CreateWebAffairInput): Promise<WebAffairOperationResult<WebAffair>>
  claimLegacyAffair(input: ClaimLegacyWebAffairInput): Promise<WebAffairOperationResult<WebAffair>>
  updateNode(input: UpdateWebAffairNodeInput): Promise<WebAffairOperationResult<WebAffair>>
  reviseFlow(input: ReviseWebAffairFlowInput): Promise<WebAffairOperationResult<WebAffair>>
  inspectMaterials(
    input: InspectWebAffairMaterialsInput,
  ): Promise<WebAffairOperationResult<WebAffair>>
  startAttempt(input: StartWebAffairAttemptInput): Promise<WebAffairOperationResult<WebAffair>>
  bindAttempt(input: BindWebAffairAttemptInput): Promise<WebAffairOperationResult<WebAffair>>
  handoffAttempt(input: HandoffWebAffairAttemptInput): Promise<WebAffairOperationResult<WebAffair>>
  returnAttempt(input: ReturnWebAffairAttemptInput): Promise<WebAffairOperationResult<WebAffair>>
  confirmFinalAction(
    input: ConfirmWebAffairFinalActionInput,
  ): Promise<WebAffairOperationResult<WebAffair>>
  finishAttempt(input: FinishWebAffairAttemptInput): Promise<WebAffairOperationResult<WebAffair>>
  scheduleCheck(input: ScheduleWebAffairCheckInput): Promise<WebAffairOperationResult<WebAffair>>
  completeCheck(input: CompleteWebAffairCheckInput): Promise<WebAffairOperationResult<WebAffair>>
  proposeFlowDiff(
    input: ProposeWebAffairFlowDiffInput,
  ): Promise<WebAffairOperationResult<WebAffair>>
  decideFlowProposal(
    input: DecideWebAffairFlowProposalInput,
  ): Promise<WebAffairOperationResult<WebAffair>>
  onChanged(callback: (payload: WebAffairChangedPayload) => void): () => void
}

export const webAffairsIpc = {
  getSnapshot: defineIpcCall<
    [WebAffairWorkspaceScopeInput],
    WebAffairOperationResult<WebAffairProjectSnapshot>
  >('webAffairs:getSnapshot'),
  getCatalog: defineIpcCall<[], WebAffairOperationResult<WebAffairCatalog>>(
    'webAffairs:getCatalog',
  ),
  createAffair: defineIpcCall<[CreateWebAffairInput], WebAffairOperationResult<WebAffair>>(
    'webAffairs:createAffair',
  ),
  claimLegacyAffair: defineIpcCall<
    [ClaimLegacyWebAffairInput],
    WebAffairOperationResult<WebAffair>
  >('webAffairs:claimLegacyAffair'),
  updateNode: defineIpcCall<[UpdateWebAffairNodeInput], WebAffairOperationResult<WebAffair>>(
    'webAffairs:updateNode',
  ),
  reviseFlow: defineIpcCall<[ReviseWebAffairFlowInput], WebAffairOperationResult<WebAffair>>(
    'webAffairs:reviseFlow',
  ),
  inspectMaterials: defineIpcCall<
    [InspectWebAffairMaterialsInput],
    WebAffairOperationResult<WebAffair>
  >('webAffairs:inspectMaterials'),
  startAttempt: defineIpcCall<[StartWebAffairAttemptInput], WebAffairOperationResult<WebAffair>>(
    'webAffairs:startAttempt',
  ),
  bindAttempt: defineIpcCall<[BindWebAffairAttemptInput], WebAffairOperationResult<WebAffair>>(
    'webAffairs:bindAttempt',
  ),
  handoffAttempt: defineIpcCall<
    [HandoffWebAffairAttemptInput],
    WebAffairOperationResult<WebAffair>
  >('webAffairs:handoffAttempt'),
  returnAttempt: defineIpcCall<[ReturnWebAffairAttemptInput], WebAffairOperationResult<WebAffair>>(
    'webAffairs:returnAttempt',
  ),
  confirmFinalAction: defineIpcCall<
    [ConfirmWebAffairFinalActionInput],
    WebAffairOperationResult<WebAffair>
  >('webAffairs:confirmFinalAction'),
  finishAttempt: defineIpcCall<[FinishWebAffairAttemptInput], WebAffairOperationResult<WebAffair>>(
    'webAffairs:finishAttempt',
  ),
  scheduleCheck: defineIpcCall<[ScheduleWebAffairCheckInput], WebAffairOperationResult<WebAffair>>(
    'webAffairs:scheduleCheck',
  ),
  completeCheck: defineIpcCall<[CompleteWebAffairCheckInput], WebAffairOperationResult<WebAffair>>(
    'webAffairs:completeCheck',
  ),
  proposeFlowDiff: defineIpcCall<
    [ProposeWebAffairFlowDiffInput],
    WebAffairOperationResult<WebAffair>
  >('webAffairs:proposeFlowDiff'),
  decideFlowProposal: defineIpcCall<
    [DecideWebAffairFlowProposalInput],
    WebAffairOperationResult<WebAffair>
  >('webAffairs:decideFlowProposal'),
} as const

export const webAffairsIpcEvents = {
  changed: 'webAffairs:changed',
} as const
