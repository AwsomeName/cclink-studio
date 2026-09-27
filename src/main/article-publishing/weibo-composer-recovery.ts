import type { ArticlePublishingState } from '../../shared/article-publishing/article-publishing-types'
import type { CsdnPageProbe } from './csdn-publishing-adapter'

export function isEmptyWeiboComposer(probe: CsdnPageProbe, uid: string | undefined): boolean {
  return Boolean(
    uid &&
    probe.adapterId === 'weibo' &&
    probe.url === 'https://weibo.com/' &&
    probe.platformAccountId === uid &&
    probe.editor.recognized &&
    probe.editor.initialDraftBodyEmpty &&
    probe.editor.bodyTextLength === 0 &&
    !probe.title.value &&
    probe.editor.imageEnumerationComplete &&
    probe.editor.images.length === 0,
  )
}

/** Empty DOM alone never resolves an interrupted upload. The existing explicit
 * missing-image confirmation must have reconciled every dispatched upload first. */
export function canRetryConfirmedMissingWeiboComposer(
  state: ArticlePublishingState,
  probe: CsdnPageProbe,
): boolean {
  return Boolean(
    state.adapterId === 'weibo' &&
    state.publication.status === 'not-started' &&
    state.execution.currentStepId === 'upload-assets' &&
    isEmptyWeiboComposer(probe, state.composer?.platformAccountId) &&
    state.assets.length > 0 &&
    state.assets.every(
      (asset) =>
        asset.kind === 'local' &&
        !asset.platformUrl &&
        !asset.verifiedAt &&
        (asset.status === 'pending'
          ? asset.uploadAttempts.length === 0
          : asset.status === 'retryable-failed' &&
            asset.manualResolution?.status === 'missing' &&
            asset.uploadAttempts.length > 0 &&
            asset.uploadAttempts.every((upload) => upload.status === 'retryable-failed')),
    ) &&
    state.sideEffects.every(
      (effect) =>
        effect.kind === 'upload-asset' &&
        (!effect.dispatchedAt ||
          (effect.status === 'rejected' &&
            state.assets.some(
              (asset) =>
                effect.targetId.startsWith(`${asset.id}:attempt-`) &&
                asset.manualResolution?.status === 'missing',
            ))),
    ),
  )
}
