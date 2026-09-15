import type {
  ArticlePublishingAsset,
  ArticlePublishingState,
} from '../../shared/article-publishing/article-publishing-types'

/** The handshake's exact saved-page proof can settle an interrupted preparation
 * attempt that never reserved any upload. Any possible upload remains blocked. */
export function canResumeUnsubmittedToutiaoImage(
  state: ArticlePublishingState,
  asset: ArticlePublishingAsset,
  proof: {
    draftId: string
    platformAccountId: string
    normalizedTitle: string
    saveState: string
    imageEnumerationComplete?: boolean
    images?: Array<{ src: string; loaded?: boolean }>
  },
): boolean {
  return (
    state.adapterId === 'toutiao' &&
    asset.kind === 'local' &&
    asset.status === 'reconciling' &&
    !asset.platformUrl &&
    proof.saveState === 'saved' &&
    proof.imageEnumerationComplete === true &&
    Array.isArray(proof.images) &&
    proof.draftId === state.draft?.platformDraftId &&
    proof.platformAccountId === state.draft?.platformAccountId &&
    proof.normalizedTitle === state.fields.title.trim() &&
    proof.images.every(
      (image) =>
        image.loaded === true &&
        state.assets.some(
          (known) =>
            known.id !== asset.id && known.status === 'uploaded' && known.platformUrl === image.src,
        ),
    ) &&
    !state.sideEffects.some(
      (effect) =>
        effect.kind === 'upload-asset' &&
        effect.targetId.replace(/:attempt-\d+$/u, '') === asset.id,
    )
  )
}
