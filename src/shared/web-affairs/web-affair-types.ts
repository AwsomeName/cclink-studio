import type { WorkspaceRef } from '../workspace-ref'
import type { ArticlePublishingState } from '../article-publishing/article-publishing-types'

export type WebAffairStatus =
  | 'draft'
  | 'active'
  | 'needs-attention'
  | 'waiting-external'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type WebAffairNodeStatus =
  | 'blocked'
  | 'ready'
  | 'running'
  | 'waiting-human'
  | 'waiting-external'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'cancelled'

export type WebAffairNodeExecutor = 'ai' | 'user' | 'external'
export type WebAffairNodeType = 'web-task' | 'human-task' | 'wait-external' | 'verification'
export type WebAffairMaterialState = 'available' | 'missing' | 'changed' | 'unchecked'

export interface WebAffairMaterialRef {
  id: string
  path: string
  name: string
  state: WebAffairMaterialState
  size?: number
  modifiedAt?: string
  checkedAt?: string
  addedAt: string
}

export interface WebAffairEvidence {
  id: string
  kind: 'observation' | 'user-note' | 'page-result' | 'receipt' | 'official-response'
  source: 'browser' | 'user' | 'system' | 'external'
  summary: string
  observedAt: string
  url?: string
  attemptId?: string
  browserTaskRunId?: string
  agentRunId?: string
}

export interface WebAffairNode {
  id: string
  type: WebAffairNodeType
  catalogId?: string
  title: string
  description?: string
  status: WebAffairNodeStatus
  executor: WebAffairNodeExecutor
  accountIds: string[]
  materialIds: string[]
  successCriteria: string[]
  availableTransitions: WebAffairNodeStatus[]
  lastResultNote?: string
  createdAt: string
  updatedAt: string
}

export interface WebAffairEdge {
  id: string
  fromNodeId: string
  toNodeId: string
}

export interface WebAffairFlow {
  version: number
  nodes: WebAffairNode[]
  edges: WebAffairEdge[]
}

export type WebAffairAttemptStatus =
  | 'preparing'
  | 'running-ai'
  | 'checking-runtime'
  | 'waiting-human'
  | 'waiting-external'
  | 'verifying'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'interrupted'

export interface WebAffairRuntimeBindingBase {
  id: string
  attemptId: string
  executionGeneration: number
  launchOperationId: string
  status: 'binding' | 'active' | 'terminal' | 'lost'
  boundAt: string
  lastObservedAt: string
  endedAt?: string
  terminalReason?: string
}

export type WebAffairRuntimeBinding =
  | (WebAffairRuntimeBindingBase & {
      kind: 'agent-run'
      conversationId: string
      agentRunId: string
      agentRuntimeEpoch: number
      agentRuntimeBindingKey: string
    })
  | (WebAffairRuntimeBindingBase & {
      kind: 'browser-task'
      browserTaskRunId: string
      tabId: string
      browserViewRuntimeGeneration: number
      webContentsId: number
      playwrightConnectionGeneration: number
      playwrightPageBindingGeneration: number
    })
  | (WebAffairRuntimeBindingBase & {
      kind: 'browser-tab'
      tabId: string
      browserViewRuntimeGeneration: number
      webContentsId: number
    })

export type ArticlePublishingRuntimeIdentity =
  | Pick<
      Extract<WebAffairRuntimeBinding, { kind: 'agent-run' }>,
      'kind' | 'conversationId' | 'agentRunId' | 'agentRuntimeEpoch' | 'agentRuntimeBindingKey'
    >
  | Pick<
      Extract<WebAffairRuntimeBinding, { kind: 'browser-task' }>,
      | 'kind'
      | 'browserTaskRunId'
      | 'tabId'
      | 'browserViewRuntimeGeneration'
      | 'webContentsId'
      | 'playwrightConnectionGeneration'
      | 'playwrightPageBindingGeneration'
    >
  | Pick<
      Extract<WebAffairRuntimeBinding, { kind: 'browser-tab' }>,
      'kind' | 'tabId' | 'browserViewRuntimeGeneration' | 'webContentsId'
    >

export interface ReconcileArticlePublishingRuntimeInput {
  eventId: string
  workspaceId: string
  affairId: string
  attemptId: string
  executionGeneration: number
  launchOperationId: string
  source:
    | 'agent-terminal'
    | 'browser-terminal'
    | 'tab-lost'
    | 'launch-timeout'
    | 'lease-expired'
    | 'startup'
    | 'shutdown'
    | 'user-check'
    | 'user-cancel'
  observedAt: string
  runtimeBindingId?: string
  runtimeIdentity?: ArticlePublishingRuntimeIdentity
  observedStatus?: string
  lastOwnerAt?: string
  lastProgressAt?: string
  probeDeadline?: string
  reasonCode: string
  reason: string
}

export interface WebAffairAttempt {
  id: string
  nodeId: string
  number: number
  status: WebAffairAttemptStatus
  /** Hard isolation boundary between replacement runtime launches for one Attempt. */
  executionGeneration: number
  /** Idempotency key for one main-process-owned launch operation. */
  launchOperationId: string
  runtimeBindings: WebAffairRuntimeBinding[]
  processedRuntimeEventIds?: string[]
  profileId: string
  accountId: string
  entryUrl: string
  tabId?: string
  conversationId?: string
  agentRunId?: string
  browserTaskRunId?: string
  sideEffectKey: string
  finalActionConfirmedAt?: string
  finalActionSummary?: string
  handoffReason?: string
  handedOffAt?: string
  returnedAt?: string
  reobservedAt?: string
  failureMessage?: string
  evidence: WebAffairEvidence[]
  startedAt: string
  endedAt?: string
}

export interface WebAffairWaitPlan {
  nodeId: string
  status: 'scheduled' | 'due' | 'missed' | 'exhausted' | 'cancelled'
  nextCheckAt: string
  intervalMinutes: number
  maxIntervalMinutes: number
  checkCount: number
  maxChecks: number
  lastCheckedAt?: string
  lastOutcome?: string
}

export type WebAffairFlowDiffOperation =
  | {
      kind: 'add-node'
      tempId: string
      title: string
      nodeType: WebAffairNodeType
      executor: WebAffairNodeExecutor
      catalogId?: string
      description?: string
    }
  | {
      kind: 'update-node'
      nodeId: string
      title?: string
      description?: string
      executor?: WebAffairNodeExecutor
    }
  | { kind: 'remove-node'; nodeId: string }
  | { kind: 'add-edge'; fromNodeId: string; toNodeId: string }
  | { kind: 'remove-edge'; edgeId: string }

export interface WebAffairFlowProposal {
  id: string
  baseVersion: number
  status: 'pending' | 'accepted' | 'rejected' | 'superseded'
  reason: string
  operations: WebAffairFlowDiffOperation[]
  impacts: string[]
  requiresConfirmation: boolean
  proposedBy: 'ai' | 'user' | 'system'
  createdAt: string
  decidedAt?: string
}

export interface WebAffairTemplateRef {
  templateId: string
  version: number
}

export interface WebAffairAccountGroupBinding {
  groupId: string
  groupRevision: number
  /** Membership snapshot: later group edits do not silently alter an existing affair. */
  accountIds: string[]
}

export interface WebAffairEvent {
  id: string
  type:
    | 'created'
    | 'node-status-changed'
    | 'flow-revised'
    | 'material-checked'
    | 'attempt-started'
    | 'attempt-handoff'
    | 'attempt-returned'
    | 'attempt-finished'
    | 'final-action-confirmed'
    | 'wait-scheduled'
    | 'wait-due'
    | 'flow-proposed'
    | 'flow-proposal-decided'
    | 'workspace-assigned'
  nodeId?: string
  attemptId?: string
  summary: string
  occurredAt: string
}

export interface WebAffair {
  id: string
  kind: 'generic' | 'article-publishing'
  /** Stable local workspace identity. `null` is reserved for migrated legacy affairs. */
  workspaceId: string | null
  title: string
  objective: string
  status: WebAffairStatus
  principalId: string
  websiteIds: string[]
  accountIds: string[]
  accountGroupBindings?: WebAffairAccountGroupBinding[]
  materials: WebAffairMaterialRef[]
  flow: WebAffairFlow
  attempts: WebAffairAttempt[]
  waitPlans: WebAffairWaitPlan[]
  flowProposals: WebAffairFlowProposal[]
  templateRef?: WebAffairTemplateRef
  articlePublishing?: ArticlePublishingState
  events: WebAffairEvent[]
  workspaceRef: WorkspaceRef
  createdAt: string
  updatedAt: string
}

export interface WebAffairSnapshot {
  schemaVersion: 7
  revision: number
  affairs: WebAffair[]
}

export interface WebAffairProjectSnapshot extends WebAffairSnapshot {
  workspaceId: string
  unassignedAffairCount: number
  unassignedAffairs: WebAffairLegacySummary[]
}

export interface WebAffairLegacySummary {
  id: string
  title: string
  objective: string
  accountCount: number
  sourceWorkspaceRef: WorkspaceRef
  createdAt: string
  updatedAt: string
}

export interface WebAffairWorkspaceScopeInput {
  workspaceRef: WorkspaceRef
}

export interface ClaimLegacyWebAffairInput extends WebAffairWorkspaceScopeInput {
  affairId: string
}

export interface WebAffairChangedPayload {
  affairId: string
  revision: number
}

export interface CreateWebAffairInput {
  title: string
  objective: string
  principalId: string
  accountIds: string[]
  accountGroupIds?: string[]
  materialPaths: string[]
  nodeTitles: string[]
  workspaceRef: WorkspaceRef
  templateRef?: WebAffairTemplateRef
}

export interface UpdateWebAffairNodeInput extends WebAffairWorkspaceScopeInput {
  affairId: string
  nodeId: string
  status: WebAffairNodeStatus
  resultNote?: string
}

export interface ReviseWebAffairFlowNodeInput {
  /** Existing UUID or a renderer-local `new:*` identifier referenced by edges. */
  id: string
  title: string
  description?: string
  type: WebAffairNodeType
  executor: WebAffairNodeExecutor
  accountIds: string[]
  materialIds: string[]
  successCriteria: string[]
}

export interface ReviseWebAffairFlowInput extends WebAffairWorkspaceScopeInput {
  affairId: string
  expectedVersion: number
  nodes: ReviseWebAffairFlowNodeInput[]
  edges: Array<{ fromNodeId: string; toNodeId: string }>
}

export interface InspectWebAffairMaterialsInput extends WebAffairWorkspaceScopeInput {
  affairId: string
}

export interface StartWebAffairAttemptInput extends WebAffairWorkspaceScopeInput {
  affairId: string
  nodeId: string
  accountId: string
}

export interface BindWebAffairAttemptInput extends WebAffairWorkspaceScopeInput {
  affairId: string
  attemptId: string
  tabId: string
  conversationId: string
  agentRunId: string
  browserTaskRunId: string
}

export interface HandoffWebAffairAttemptInput extends WebAffairWorkspaceScopeInput {
  affairId: string
  attemptId: string
  reason: string
}

export interface ReturnWebAffairAttemptInput extends WebAffairWorkspaceScopeInput {
  affairId: string
  attemptId: string
  observationSummary: string
  url: string
}

export interface ConfirmWebAffairFinalActionInput extends WebAffairWorkspaceScopeInput {
  affairId: string
  attemptId: string
  summary: string
}

export interface FinishWebAffairAttemptInput extends WebAffairWorkspaceScopeInput {
  affairId: string
  attemptId: string
  outcome: 'succeeded' | 'failed' | 'cancelled' | 'interrupted'
  summary: string
  url?: string
  evidenceKind?: WebAffairEvidence['kind']
}

export interface ScheduleWebAffairCheckInput extends WebAffairWorkspaceScopeInput {
  affairId: string
  nodeId: string
  nextCheckAt: string
  intervalMinutes: number
  maxIntervalMinutes: number
  maxChecks: number
}

export interface CompleteWebAffairCheckInput extends WebAffairWorkspaceScopeInput {
  affairId: string
  nodeId: string
  outcome: 'unchanged' | 'approved' | 'rejected'
  summary: string
  url?: string
}

export interface ProposeWebAffairFlowDiffInput extends WebAffairWorkspaceScopeInput {
  affairId: string
  baseVersion: number
  reason: string
  operations: WebAffairFlowDiffOperation[]
  impacts: string[]
  proposedBy: 'ai' | 'user'
}

export interface DecideWebAffairFlowProposalInput extends WebAffairWorkspaceScopeInput {
  affairId: string
  proposalId: string
  decision: 'accept' | 'reject'
}

export interface WebAffairAtomicNodeDefinition {
  id: string
  version: number
  title: string
  description: string
  nodeType: WebAffairNodeType
  executor: WebAffairNodeExecutor
  successCriteria: string[]
}

export interface WebAffairTemplateDefinition {
  id: string
  version: number
  title: string
  description: string
  nodeCatalogIds: string[]
}

export interface WebAffairAdapterDefinition {
  id: string
  version: number
  originPattern: string
  capabilities: Array<'entry' | 'field-hints' | 'status-detection' | 'evidence-extraction'>
  fallback: 'generic-web' | 'human'
}

export interface WebAffairCatalog {
  atomicNodes: WebAffairAtomicNodeDefinition[]
  templates: WebAffairTemplateDefinition[]
  adapters: WebAffairAdapterDefinition[]
}

export type WebAffairErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_RESOURCE_REFERENCE'
  | 'INVALID_TRANSITION'
  | 'FLOW_VERSION_CONFLICT'
  | 'IMMUTABLE_HISTORY'
  | 'EVIDENCE_REQUIRED'
  | 'CONFIRMATION_REQUIRED'
  | 'NOT_FOUND'
  | 'RESOURCE_LIMIT_REACHED'
  | 'STORAGE_UNAVAILABLE'
  | 'SERVICE_UNAVAILABLE'
  | 'WORKSPACE_REQUIRED'
  | 'UNKNOWN'

export interface WebAffairOperationError {
  code: WebAffairErrorCode
  message: string
}

export type WebAffairOperationResult<T> =
  | { success: true; data: T }
  | { success: false; error: WebAffairOperationError }

export const EMPTY_WEB_AFFAIR_SNAPSHOT: WebAffairSnapshot = {
  schemaVersion: 7,
  revision: 0,
  affairs: [],
}
