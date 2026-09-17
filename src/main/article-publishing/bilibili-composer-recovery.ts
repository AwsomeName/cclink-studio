import type { ArticlePublishingState } from '../../shared/article-publishing/article-publishing-types'
import type { CsdnPageProbe } from './csdn-publishing-adapter'
import { bilibiliPublishingTitle } from './bilibili-publishing-adapter'

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

/** Resume an interrupted upload stage when the temporary composer still contains
 * exactly the already verified gallery. No body, title, or publication may exist. */
export function canResumeExactBilibiliComposer(
  state: ArticlePublishingState,
  probe: CsdnPageProbe,
): boolean {
  const expectedUrls = state.assets.map((asset) => asset.platformUrl).filter(Boolean) as string[]
  const actualUrls = probe.editor.images.filter((image) => image.loaded).map((image) => image.src)
  return Boolean(
    state.adapterId === 'bilibili' &&
    state.publication.status === 'not-started' &&
    state.execution.currentStepId === 'upload-assets' &&
    probe.adapterId === 'bilibili' &&
    probe.url === 'https://t.bilibili.com/' &&
    probe.platformAccountId === state.composer?.platformAccountId &&
    probe.editor.recognized &&
    probe.editor.initialDraftBodyEmpty &&
    probe.editor.bodyTextLength === 0 &&
    !probe.title.value &&
    state.assets.length > 0 &&
    state.assets.every(
      (asset) => asset.status === 'uploaded' && Boolean(asset.platformUrl && asset.verifiedAt),
    ) &&
    actualUrls.length === expectedUrls.length &&
    new Set(actualUrls).size === actualUrls.length &&
    expectedUrls.every((url, index) => actualUrls[index] === url) &&
    state.sideEffects.every((effect) => effect.kind === 'upload-asset'),
  )
}

/** B站动态编辑器重启后可能只把正文恢复到 DOM，同时在站点内部继续保留旧附件。
 * 因此只要旧图片上传曾经派发，就不能根据“当前 DOM 图集为空”推断附件已经丢失。 */
export function canRebuildLostBilibiliComposer(
  state: ArticlePublishingState,
  probe: CsdnPageProbe,
  bodyMatchesFrozen: boolean,
): boolean {
  return Boolean(
    state.adapterId === 'bilibili' &&
    state.publication.status === 'not-started' &&
    ['fill-body', 'fill-fields', 'save-draft', 'publish'].includes(
      state.execution.currentStepId ?? '',
    ) &&
    probe.adapterId === 'bilibili' &&
    probe.url === 'https://t.bilibili.com/' &&
    probe.platformAccountId === state.composer?.platformAccountId &&
    probe.editor.recognized &&
    probe.editor.imageEnumerationComplete &&
    probe.editor.images.length === 0 &&
    (probe.editor.bodyTextLength === 0 || bodyMatchesFrozen) &&
    (!probe.title.value || probe.title.value === bilibiliPublishingTitle(state.fields.title)) &&
    state.assets.length > 0 &&
    state.assets.every(
      (asset) => asset.status === 'uploaded' && Boolean(asset.platformUrl && asset.verifiedAt),
    ) &&
    !state.sideEffects.some(
      (effect) => effect.kind === 'upload-asset' && Boolean(effect.dispatchedAt),
    ) &&
    !state.sideEffects.some((effect) => effect.kind === 'publish'),
  )
}

/** Continue a rebuild already persisted by main after a later launch/restart. */
export function canResumeRebuiltBilibiliComposer(
  state: ArticlePublishingState,
  probe: CsdnPageProbe,
  bodyMatchesFrozen: boolean,
): boolean {
  return Boolean(
    state.adapterId === 'bilibili' &&
    state.publication.status === 'not-started' &&
    state.execution.currentStepId === 'upload-assets' &&
    probe.adapterId === 'bilibili' &&
    probe.url === 'https://t.bilibili.com/' &&
    probe.platformAccountId === state.composer?.platformAccountId &&
    probe.editor.recognized &&
    probe.editor.imageEnumerationComplete &&
    probe.editor.images.length === 0 &&
    (probe.editor.bodyTextLength === 0 || bodyMatchesFrozen) &&
    (!probe.title.value || probe.title.value === bilibiliPublishingTitle(state.fields.title)) &&
    state.assets.length > 0 &&
    state.assets.every(
      (asset) =>
        asset.status === 'pending' && !asset.platformUrl && asset.uploadAttempts.length === 0,
    ) &&
    !state.sideEffects.some(
      (effect) => effect.kind === 'upload-asset' && Boolean(effect.dispatchedAt),
    ) &&
    !state.sideEffects.some((effect) => effect.kind === 'publish'),
  )
}
