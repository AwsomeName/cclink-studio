import type { ArticlePublishingState } from '../../shared/article-publishing/article-publishing-types'
import type { CsdnPageProbe } from './csdn-publishing-adapter'

export function isEmptyBilibiliComposer(probe: CsdnPageProbe, uid: string | undefined): boolean {
  return Boolean(
    uid &&
    probe.adapterId === 'bilibili' &&
    probe.url === 'https://t.bilibili.com/' &&
    probe.platformAccountId === uid &&
    probe.editor.recognized &&
    probe.editor.initialDraftBodyEmpty &&
    probe.editor.bodyTextLength === 0 &&
    !probe.title.value &&
    probe.editor.imageEnumerationComplete &&
    probe.editor.images.length === 0,
  )
}

/** An explicitly reconciled missing upload may retry in a verified empty composer.
 * An uploaded image, unverified side effect, body write or submission may never be replayed. */
export function canRetryEmptyBilibiliComposer(
  state: ArticlePublishingState,
  probe: CsdnPageProbe,
): boolean {
  return (
    state.adapterId === 'bilibili' &&
    state.publication.status === 'not-started' &&
    state.execution.currentStepId === 'upload-assets' &&
    isEmptyBilibiliComposer(probe, state.composer?.platformAccountId) &&
    state.assets.every(
      (a) => !a.platformUrl && ['pending', 'retryable-failed'].includes(a.status),
    ) &&
    state.sideEffects.every(
      (effect) =>
        !effect.dispatchedAt ||
        (effect.kind === 'upload-asset' &&
          effect.status === 'rejected' &&
          state.assets.some(
            (a) =>
              effect.targetId.startsWith(`${a.id}:attempt-`) &&
              a.manualResolution?.status === 'missing',
          )),
    )
  )
}
