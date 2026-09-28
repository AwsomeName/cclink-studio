import type { ArticlePublishingState } from './article-publishing-types'

/** Explicit consent for one more submission of the same saved draft, not a
 * conclusion that the old unknown submission failed. Never rebuild the draft. */
export function eligibleCsdnRetryEffect(state: ArticlePublishingState) {
  if (
    state.adapterId !== 'csdn' ||
    state.csdnRetry ||
    state.execution.status !== 'result-unknown' ||
    state.publication.status !== 'result-unknown' ||
    state.publication.url ||
    !state.draft?.platformDraftId ||
    !state.draft.platformAccountId ||
    !state.draft.lastVerifiedAt ||
    state.draft.url !==
      `https://mp.csdn.net/mp_blog/creation/editor/${state.draft.platformDraftId}` ||
    !state.assets.every((asset) => asset.status === 'uploaded' && asset.platformUrl) ||
    !state.checkpoints
      .filter((step) => !['publish', 'verify-publication'].includes(step.stepId))
      .every((step) => step.status === 'completed')
  )
    return undefined
  const effects = state.sideEffects.filter((effect) => effect.kind === 'publish')
  const effect = effects[0]
  if (
    effects.length !== 1 ||
    !effect.dispatchedAt ||
    effect.status !== 'result-unknown' ||
    effect.attemptId !== state.execution.currentAttemptId
  )
    return undefined
  // Old saves may be reconciled only by the existing exact-draft recovery.
  // An unknown upload must never be carried into this submission-only retry.
  if (
    state.sideEffects.some(
      (item) =>
        item.kind === 'upload-asset' &&
        !['verified', 'reconciled', 'rejected'].includes(item.status),
    )
  )
    return undefined
  return effect
}

export function hasCsdnRetryAuthorization(state: ArticlePublishingState): boolean {
  const retry = state.csdnRetry
  return Boolean(
    state.adapterId === 'csdn' &&
    retry &&
    retry.attemptId === state.execution.currentAttemptId &&
    retry.executionGeneration === state.execution.currentGeneration &&
    retry.draftId === state.draft?.platformDraftId &&
    state.publication.status === 'result-unknown' &&
    !state.publication.url &&
    state.sideEffects.some(
      (effect) =>
        effect.key === retry.previousEffectKey &&
        effect.kind === 'publish' &&
        effect.status === 'result-unknown' &&
        effect.dispatchedAt,
    ) &&
    !state.sideEffects.some(
      (effect) =>
        effect.kind === 'publish' &&
        effect.executionGeneration >= retry.executionGeneration &&
        (effect.dispatchedAt || effect.status !== 'reserved'),
    ),
  )
}
