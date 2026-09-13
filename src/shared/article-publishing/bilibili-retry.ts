import type { ArticlePublishingState } from './article-publishing-types'

/** A new explicit authorization, never an inference that an unknown send failed. */
export function eligibleBilibiliRetryEffect(state: ArticlePublishingState) {
  if (
    state.adapterId !== 'bilibili' ||
    state.composer?.allowPublish !== true ||
    state.execution.status !== 'result-unknown' ||
    state.publication.status !== 'result-unknown' ||
    state.publication.url
  )
    return undefined
  const effects = state.sideEffects.filter((e) => e.kind === 'publish')
  const retry = state.bilibiliRetry
  const afterConsumedRetry = Boolean(
    retry &&
    retry.attemptId === state.execution.currentAttemptId &&
    retry.executionGeneration === state.execution.currentGeneration &&
    effects.length === 2 &&
    effects.some(
      (e) =>
        e.key === retry.previousEffectKey &&
        e.status === 'result-unknown' &&
        e.bilibiliSubmission?.observationEnded,
    ),
  )
  if (retry ? !afterConsumedRetry : effects.length !== 1) return undefined
  const current = effects.filter((e) => e.executionGeneration === state.execution.currentGeneration)
  if (current.length !== 1) return undefined
  const effect = current[0]
  const observation = effect.bilibiliSubmission
  return effect.status === 'result-unknown' &&
    effect.dispatchedAt &&
    effect.attemptId === state.execution.currentAttemptId &&
    effect.executionGeneration === state.execution.currentGeneration &&
    observation?.observationEnded &&
    (afterConsumedRetry || (!observation.confirmationAttempted && !observation.requestObserved)) &&
    state.assets.every((a) => a.status === 'uploaded' && a.uploadAttempts.length < 3) &&
    state.sideEffects.every(
      (e) =>
        e === effect ||
        e.status === 'verified' ||
        e.status === 'rejected' ||
        (afterConsumedRetry &&
          e.key === retry?.previousEffectKey &&
          e.kind === 'publish' &&
          e.status === 'result-unknown' &&
          e.bilibiliSubmission?.observationEnded === true),
    )
    ? effect
    : undefined
}

export function hasBilibiliRetryAuthorization(state: ArticlePublishingState): boolean {
  const retry = state.bilibiliRetry
  return Boolean(
    state.adapterId === 'bilibili' &&
    state.composer?.allowPublish &&
    retry &&
    retry.attemptId === state.execution.currentAttemptId &&
    retry.executionGeneration === state.execution.currentGeneration &&
    state.publication.status === 'result-unknown' &&
    !state.publication.url &&
    state.sideEffects.some(
      (e) => e.key === retry.previousEffectKey && e.status === 'result-unknown',
    ) &&
    !state.sideEffects.some(
      (e) =>
        e.kind === 'publish' &&
        e.executionGeneration === retry.executionGeneration &&
        (e.dispatchedAt || e.status !== 'reserved'),
    ),
  )
}

export function canCarryUnusedBilibiliRetry(state: ArticlePublishingState): boolean {
  return (
    hasBilibiliRetryAuthorization(state) &&
    state.assets.every((asset) => asset.status === 'pending' && !asset.platformUrl) &&
    !state.sideEffects.some(
      (effect) => effect.executionGeneration === state.execution.currentGeneration,
    )
  )
}
