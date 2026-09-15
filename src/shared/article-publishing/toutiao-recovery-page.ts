import type { ArticlePublishingState } from './article-publishing-types'

/** A failed Agent handshake can still have a verified, saved draft Page.
 * Reuse that current operation's identity for image reconciliation only. This
 * does not bind an Agent, issue a write permit, or resolve an upload. */
export function toutiaoRecoveryPage(state: ArticlePublishingState | undefined) {
  if (!state) return undefined
  const { execution, draft, executionProtocol } = state
  const operation = executionProtocol.current
  if (
    state.adapterId !== 'toutiao' ||
    execution.status !== 'interrupted' ||
    execution.currentStepId !== 'upload-assets' ||
    state.publication.status !== 'not-started' ||
    !state.assets.some((asset) => ['reconciling', 'result-unknown'].includes(asset.status)) ||
    draft?.recovery?.status !== 'verified' ||
    draft.recovery.executionGeneration !== execution.currentGeneration ||
    operation?.definitionId !== 'runtime.prepare-first-inspect' ||
    operation.status !== 'interrupted' ||
    operation.attemptId !== execution.currentAttemptId ||
    operation.executionGeneration !== execution.currentGeneration ||
    operation.launchOperationId !== execution.currentLaunchOperationId
  )
    return undefined
  return operation.runtime
}
