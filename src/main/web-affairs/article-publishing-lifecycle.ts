import { randomUUID } from 'node:crypto'
import type {
  ArticlePublishingCurrentOperation,
  ArticlePublishingOperationTransition,
  ArticlePublishingRuntimeSnapshot,
  ArticlePublishingState,
} from '../../shared/article-publishing/article-publishing-types'
import type {
  WebAffair,
  WebAffairAttempt,
  WebAffairNodeStatus,
} from '../../shared/web-affairs/web-affair-types'
import { ALLOWED_TRANSITIONS, deriveAffairStatus } from './web-affair-flow'

// No stored state, execution, I/O or timers. The service validates identity and
// evidence, serializes commands, and persists the returned affair atomically.
const ARTICLE_OPERATION_TRANSITION_LIMIT = 200

export type ArticlePublishingLifecycleTarget =
  | 'preparing'
  | 'running'
  | 'checking-runtime'
  | 'waiting-human'
  | 'interrupted'
  | 'cancelled'
  | 'failed'
  | 'result-unknown'
  | 'published'

export function createArticlePublishingOperation(
  definitionId: ArticlePublishingCurrentOperation['definitionId'],
  checkpointId: ArticlePublishingCurrentOperation['checkpointId'],
  owner: ArticlePublishingCurrentOperation['owner'],
  attempt: Pick<WebAffairAttempt, 'id' | 'executionGeneration' | 'launchOperationId'>,
  now: string,
  startSummary: string,
  goalSummary: string,
  status: ArticlePublishingCurrentOperation['status'] = 'running',
  runtime?: ArticlePublishingRuntimeSnapshot,
): ArticlePublishingCurrentOperation {
  return {
    operationRunId: randomUUID(),
    revision: 1,
    definitionId,
    checkpointId,
    status,
    owner,
    attemptId: attempt.id,
    executionGeneration: attempt.executionGeneration,
    launchOperationId: attempt.launchOperationId,
    startSummary,
    goalSummary,
    ...(status === 'running' ? { startedAt: now } : {}),
    lastTransitionAt: now,
    ...(runtime ? { runtime } : {}),
  }
}

export function appendArticlePublishingTransition(
  publishing: ArticlePublishingState,
  transition: Omit<ArticlePublishingOperationTransition, 'id'>,
): ArticlePublishingState['executionProtocol'] {
  return {
    ...publishing.executionProtocol,
    recentTransitions: [
      ...publishing.executionProtocol.recentTransitions,
      { id: randomUUID(), ...transition },
    ].slice(-ARTICLE_OPERATION_TRANSITION_LIMIT),
  }
}

export function reduceArticlePublishingLifecycle(
  affair: WebAffair,
  attempt: WebAffairAttempt,
  requestedTarget: ArticlePublishingLifecycleTarget,
  now: string,
  reason: string,
  options: {
    publicationUrl?: string
    runtimeCheck?: ArticlePublishingState['execution']['runtimeCheck']
  } = {},
): WebAffair {
  const publishing = affair.articlePublishing
  if (!publishing || affair.kind !== 'article-publishing') return affair

  const hasUnknownFinalAction =
    publishing.publication.status === 'dispatched' ||
    publishing.publication.status === 'verifying' ||
    publishing.publication.status === 'result-unknown' ||
    publishing.sideEffects.some(
      (effect) =>
        effect.kind === 'publish' &&
        (effect.status === 'dispatched' || effect.status === 'result-unknown'),
    )
  const target =
    hasUnknownFinalAction && ['interrupted', 'cancelled', 'failed'].includes(requestedTarget)
      ? ('result-unknown' as const)
      : requestedTarget

  const attemptStatus: WebAffairAttempt['status'] =
    target === 'preparing'
      ? 'preparing'
      : target === 'running'
        ? 'running-ai'
        : target === 'checking-runtime'
          ? 'checking-runtime'
          : target === 'waiting-human'
            ? 'waiting-human'
            : target === 'published'
              ? 'succeeded'
              : target === 'failed'
                ? 'failed'
                : target === 'cancelled'
                  ? 'cancelled'
                  : 'interrupted'
  const nodeStatus: WebAffairNodeStatus =
    target === 'preparing' || target === 'running'
      ? 'running'
      : target === 'checking-runtime' || target === 'result-unknown'
        ? 'verifying'
        : target === 'waiting-human' || target === 'interrupted'
          ? 'waiting-human'
          : target === 'published'
            ? 'completed'
            : target === 'failed'
              ? 'failed'
              : 'cancelled'
  const isRuntimeLoss = ['checking-runtime', 'interrupted', 'result-unknown'].includes(target)
  const isTerminal = ['interrupted', 'cancelled', 'failed', 'result-unknown', 'published'].includes(
    target,
  )
  const closesExecution = isTerminal || target === 'waiting-human'
  const currentStepId = publishing.execution.currentStepId
  const nextAttempt: WebAffairAttempt = {
    ...attempt,
    status: attemptStatus,
    runtimeBindings: closesExecution
      ? attempt.runtimeBindings.map((binding) =>
          binding.executionGeneration === attempt.executionGeneration && binding.status === 'active'
            ? {
                ...binding,
                status: 'terminal' as const,
                endedAt: now,
                lastObservedAt: now,
                terminalReason: reason,
              }
            : binding,
        )
      : attempt.runtimeBindings,
    ...(isTerminal && target !== 'result-unknown' ? { endedAt: attempt.endedAt ?? now } : {}),
    ...(target === 'failed' || target === 'interrupted' || target === 'result-unknown'
      ? { failureMessage: attempt.failureMessage ?? reason }
      : {}),
  }
  const attempts = affair.attempts.map((item) => (item.id === attempt.id ? nextAttempt : item))
  const nodes = affair.flow.nodes.map((node) =>
    node.id === attempt.nodeId
      ? {
          ...node,
          status: nodeStatus,
          lastResultNote: reason,
          availableTransitions: [...ALLOWED_TRANSITIONS[nodeStatus]],
          updatedAt: now,
        }
      : node,
  )
  const checkpoints = publishing.checkpoints.map((checkpoint) => {
    if (checkpoint.stepId !== currentStepId) return checkpoint
    if (
      target === 'running' &&
      ['pending', 'needs-reconcile', 'waiting-human'].includes(checkpoint.status)
    ) {
      return {
        ...checkpoint,
        status: 'running' as const,
        attemptCount: checkpoint.attemptCount + 1,
        startedAt: now,
        finishedAt: undefined,
      }
    }
    if (
      (isRuntimeLoss || target === 'cancelled') &&
      ['running', 'waiting-platform', 'verifying'].includes(checkpoint.status)
    ) {
      return { ...checkpoint, status: 'needs-reconcile' as const, finishedAt: undefined }
    }
    if (
      target === 'failed' &&
      ['running', 'waiting-platform', 'verifying'].includes(checkpoint.status)
    ) {
      return { ...checkpoint, status: 'failed' as const, finishedAt: now }
    }
    return checkpoint
  })
  const assets = publishing.assets.map((asset) =>
    isRuntimeLoss && ['uploading', 'waiting-platform', 'verifying'].includes(asset.status)
      ? { ...asset, status: 'reconciling' as const }
      : asset,
  )
  const sideEffects = publishing.sideEffects.map((effect) =>
    closesExecution && effect.status === 'dispatched'
      ? { ...effect, status: 'result-unknown' as const, observedAt: now }
      : closesExecution && effect.status === 'reserved'
        ? { ...effect, status: 'rejected' as const, observedAt: now }
        : effect,
  )
  const publication =
    target === 'published'
      ? { status: 'published' as const, url: options.publicationUrl, observedAt: now }
      : target === 'result-unknown' && hasUnknownFinalAction
        ? { ...publishing.publication, status: 'result-unknown' as const, observedAt: now }
        : publishing.publication
  const executionStatus: ArticlePublishingState['execution']['status'] = target
  const currentOperation = publishing.executionProtocol.current
  let executionProtocol = publishing.executionProtocol
  if (
    closesExecution &&
    currentOperation &&
    !['interrupted', 'result-unknown', 'failed'].includes(currentOperation.status)
  ) {
    const operationStatus =
      target === 'waiting-human'
        ? ('waiting-human' as const)
        : target === 'result-unknown'
          ? ('result-unknown' as const)
          : target === 'failed'
            ? ('failed' as const)
            : ('interrupted' as const)
    executionProtocol = appendArticlePublishingTransition(publishing, {
      operationRunId: currentOperation.operationRunId,
      kind: 'operation-interrupted',
      occurredAt: now,
      summary: reason,
      ...(currentOperation.runtime ? { currentRuntime: currentOperation.runtime } : {}),
    })
    executionProtocol = {
      ...executionProtocol,
      current:
        target === 'published'
          ? undefined
          : {
              ...currentOperation,
              revision: currentOperation.revision + 1,
              status: operationStatus,
              owner: target === 'waiting-human' ? ('human' as const) : currentOperation.owner,
              lastTransitionAt: now,
            },
    }
  }
  const draft =
    closesExecution && publishing.draft?.recovery?.writePermit
      ? {
          ...publishing.draft,
          recovery: {
            ...publishing.draft.recovery,
            writePermit: undefined,
          },
        }
      : publishing.draft
  const articlePublishing: ArticlePublishingState = {
    ...publishing,
    draft,
    assets,
    checkpoints,
    sideEffects,
    executionProtocol,
    execution: {
      ...publishing.execution,
      status: executionStatus,
      currentAttemptId: attempt.id,
      currentGeneration: attempt.executionGeneration,
      currentLaunchOperationId: attempt.launchOperationId,
      ...(target === 'checking-runtime'
        ? { runtimeCheck: options.runtimeCheck ?? publishing.execution.runtimeCheck }
        : { runtimeCheck: undefined }),
      ...(target === 'running'
        ? {}
        : { lastAgentRunId: undefined, lastBrowserTaskRunId: undefined }),
    },
    publication,
  }
  return {
    ...affair,
    attempts,
    flow: { ...affair.flow, nodes },
    status: ['checking-runtime', 'waiting-human', 'interrupted', 'result-unknown'].includes(target)
      ? 'needs-attention'
      : deriveAffairStatus(nodes),
    articlePublishing,
    updatedAt: now,
  }
}
