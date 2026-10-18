import type {
  ArticlePublishingState,
  ReportArticlePublishingCheckpointInput,
} from '../../shared/article-publishing/article-publishing-types'
import type {
  WebAffairAttempt,
  WebAffairOperationResult,
} from '../../shared/web-affairs/web-affair-types'
import { parseBilibiliPublicationUrl } from '../article-publishing/bilibili-publication'
import { parseJikePublicationUrl } from '../article-publishing/jike-publication'
import { parseToutiaoPublicationUrl } from '../article-publishing/toutiao-publication'
import { parseWeiboPublicationUrl } from '../article-publishing/weibo-publication'

export interface ArticlePublishingPageEvidence {
  /** Main-only live guard; never persisted or accepted from IPC. */
  isCurrent?: () => boolean
  adapterId: 'csdn' | 'zhihu' | 'juejin' | 'xiaohongshu' | 'weibo' | 'toutiao' | 'bilibili' | 'jike'
  adapterVersion: 1
  observedAt: string
  url: string
  kind: 'checkpoint' | 'asset-absent' | 'asset-uploaded' | 'published'
  platformAccountId?: string
  draftId?: string
  normalizedTitle?: string
  saveState?: 'saved' | 'saving' | 'unknown'
  /** Main adapter compared the complete frozen body, links and image positions. */
  bodyMatchesFrozen?: boolean
}

// Main-only consistency rules. The service authenticates the reporter and owns
// the queue, state transition and commit; this module does not grant execution.
export function evaluateArticlePublishingCheckpoint({
  publishing,
  attempt,
  checkpoint,
  input,
  trustedPageEvidence,
}: {
  publishing: ArticlePublishingState
  attempt: WebAffairAttempt
  checkpoint: ArticlePublishingState['checkpoints'][number]
  input: ReportArticlePublishingCheckpointInput
  trustedPageEvidence?: ArticlePublishingPageEvidence
}): WebAffairOperationResult<{ eligibleEffects: ArticlePublishingState['sideEffects'] }> {
  // Recovery only settled the old save lock. A fresh complete body comparison
  // can now verify that dispatched write without manufacturing another write.
  const recoveredBodyEffect =
    input.stepId === 'fill-body' &&
    trustedPageEvidence?.bodyMatchesFrozen === true &&
    trustedPageEvidence.draftId === publishing.draft?.platformDraftId &&
    trustedPageEvidence.platformAccountId === publishing.draft?.platformAccountId &&
    trustedPageEvidence.normalizedTitle === publishing.fields.title.trim() &&
    trustedPageEvidence.saveState === 'saved'
      ? [...publishing.sideEffects]
          .reverse()
          .find(
            (effect) =>
              effect.attemptId === attempt.id &&
              effect.status === 'reconciled' &&
              effect.executionGeneration < attempt.executionGeneration &&
              effect.kind === 'save-draft' &&
              effect.targetId.startsWith('autosave:fill-body:') &&
              Boolean(effect.dispatchedAt),
          )
      : undefined
  const eligibleEffects = publishing.sideEffects.filter(
    (effect) =>
      effect.attemptId === attempt.id &&
      // A pre-dispatch rejection has no platform effect and must not shadow a
      // later real write. Dispatched/unknown writes still require reconciliation.
      !(effect.status === 'rejected' && !effect.dispatchedAt) &&
      (effect.status !== 'reconciled' || effect === recoveredBodyEffect),
  )
  if (input.status === 'completed') {
    const expectedEvidenceKind = input.stepId === 'verify-publication' ? 'published' : 'checkpoint'
    if (
      trustedPageEvidence?.kind !== expectedEvidenceKind ||
      trustedPageEvidence.adapterId !== publishing.adapterId
    ) {
      return checkpointError('EVIDENCE_REQUIRED', '检查点完成必须附带当前 CSDN 页面适配器证据')
    }
    if (input.stepId === 'verify-account' && !trustedPageEvidence.platformAccountId) {
      return checkpointError('EVIDENCE_REQUIRED', '账号核验必须保存真实 CSDN 平台账号标识')
    }
    if (
      !['weibo', 'bilibili', 'jike'].includes(publishing.adapterId) &&
      ['upload-assets', 'fill-body', 'fill-fields', 'save-draft'].includes(input.stepId) &&
      (!trustedPageEvidence.platformAccountId ||
        !trustedPageEvidence.draftId ||
        trustedPageEvidence.saveState !== 'saved')
    ) {
      return checkpointError(
        'EVIDENCE_REQUIRED',
        '网页写入步骤完成必须读回同一账号、同一草稿和已保存状态',
      )
    }
    if (
      input.stepId === 'upload-assets' &&
      publishing.assets.some((asset) => asset.kind === 'local' && asset.status !== 'uploaded')
    ) {
      return checkpointError('INVALID_TRANSITION', '仍有正文图片未完成页面核验，不能完成上传步骤')
    }
    if (
      ['weibo', 'bilibili', 'jike'].includes(publishing.adapterId) &&
      (trustedPageEvidence.platformAccountId !== publishing.composer?.platformAccountId ||
        (['fill-body', 'fill-fields', 'save-draft'].includes(input.stepId) &&
          trustedPageEvidence.bodyMatchesFrozen !== true))
    )
      return checkpointError(
        'EVIDENCE_REQUIRED',
        '图文动态完成步骤必须核验目标 UID、冻结正文和逐图现场',
      )
    if (
      ['weibo', 'bilibili', 'jike'].includes(publishing.adapterId) &&
      ['publish', 'verify-publication'].includes(input.stepId) &&
      publishing.composer?.allowPublish !== true
    )
      return checkpointError('EVIDENCE_REQUIRED', '本任务未授权动态提交，禁止标记发布成功')
    // A verified autosave of this draft already fulfills saving. Do not force an
    // extra click merely to manufacture a manual-save receipt. Unknown writes
    // still require reconciliation, and the current adapter must verify identity.
    const verifiedAutosave =
      input.stepId === 'save-draft' &&
      trustedPageEvidence.draftId === publishing.draft?.platformDraftId &&
      trustedPageEvidence.platformAccountId === publishing.draft?.platformAccountId &&
      trustedPageEvidence.normalizedTitle === publishing.fields.title.trim() &&
      !eligibleEffects.some(
        (effect) => effect.kind === 'save-draft' && effect.status !== 'verified',
      )
        ? eligibleEffects.find(
            (effect) =>
              effect.kind === 'save-draft' &&
              effect.targetId.startsWith('autosave:') &&
              effect.status === 'verified',
          )
        : undefined
    // An already matching Zhihu title is a read-only branch. Main must have
    // observed both the skipped write and its current-generation verification.
    const verifiedWeiboPreparation =
      ['weibo', 'bilibili', 'jike'].includes(publishing.adapterId) &&
      ['fill-fields', 'save-draft'].includes(input.stepId) &&
      trustedPageEvidence.bodyMatchesFrozen === true
    // A recovered Toutiao draft may already contain the complete frozen article.
    // Main must prove the read-only branch; never create a fictitious write receipt.
    const unchangedToutiaoDraft =
      publishing.adapterId === 'toutiao' &&
      ['fill-body', 'save-draft'].includes(input.stepId) &&
      publishing.draft?.recovery?.status === 'verified' &&
      publishing.draft.recovery.executionGeneration === attempt.executionGeneration &&
      trustedPageEvidence.isCurrent?.() === true &&
      trustedPageEvidence.bodyMatchesFrozen === true &&
      trustedPageEvidence.saveState === 'saved' &&
      trustedPageEvidence.draftId === publishing.draft.platformDraftId &&
      trustedPageEvidence.platformAccountId === publishing.draft.platformAccountId &&
      trustedPageEvidence.normalizedTitle === publishing.fields.title.trim() &&
      publishing.assets.every(
        (asset) => asset.status === 'uploaded' && Boolean(asset.platformUrl),
      ) &&
      ['dispatch', 'verify'].every((suffix) =>
        checkpoint.details?.some(
          (detail) =>
            detail.id === `${input.stepId === 'fill-body' ? 'body' : 'save'}.${suffix}` &&
            detail.generation === attempt.executionGeneration &&
            detail.status === (suffix === 'dispatch' ? 'skipped' : 'completed'),
        ),
      ) &&
      !eligibleEffects.some(
        (effect) => effect.kind === 'save-draft' && effect.status !== 'verified',
      )
    const unchangedPlatformFields =
      publishing.adapterId !== 'csdn' &&
      input.stepId === 'fill-fields' &&
      trustedPageEvidence.draftId === publishing.draft?.platformDraftId &&
      trustedPageEvidence.platformAccountId === publishing.draft?.platformAccountId &&
      trustedPageEvidence.normalizedTitle === publishing.fields.title.trim() &&
      (['title', 'summary', 'tags', 'category', 'cover'] as const)
        .filter((field) =>
          ['zhihu', 'xiaohongshu'].includes(publishing.adapterId)
            ? field === 'title'
            : field === 'cover'
              ? Boolean(publishing.fields.coverAssetId)
              : Array.isArray(publishing.fields[field])
                ? publishing.fields[field].length > 0
                : Boolean(publishing.fields[field]),
        )
        .flatMap((field) => [`field.${field}.dispatch`, `field.${field}.verify`])
        .every((id) =>
          checkpoint.details?.some(
            (detail) =>
              detail.id === id &&
              ((detail.generation === attempt.executionGeneration &&
                detail.status === (id.endsWith('.dispatch') ? 'skipped' : 'completed')) ||
                (id.endsWith('.dispatch') &&
                  detail.status === 'completed' &&
                  detail.generation < attempt.executionGeneration &&
                  trustedPageEvidence?.isCurrent?.() === true &&
                  trustedPageEvidence.bodyMatchesFrozen === true &&
                  publishing.sideEffects.some(
                    (effect) =>
                      effect.attemptId === attempt.id &&
                      effect.executionGeneration === detail.generation &&
                      effect.kind === 'save-draft' &&
                      effect.status === 'reconciled' &&
                      Boolean(effect.dispatchedAt) &&
                      effect.targetId.startsWith(`autosave:fill-fields:${id.split('.')[1]}:`),
                  ))),
          ),
        ) &&
      !eligibleEffects.some(
        (effect) =>
          effect.kind === 'save-draft' &&
          effect.targetId.startsWith('autosave:fill-fields:') &&
          effect.status !== 'verified',
      )
    const requiredEffect =
      input.stepId === 'save-draft'
        ? (verifiedAutosave ??
          eligibleEffects.find(
            (effect) => effect.kind === 'save-draft' && !effect.targetId.startsWith('autosave:'),
          ))
        : ['fill-body', 'fill-fields'].includes(input.stepId)
          ? eligibleEffects.find(
              (effect) =>
                effect.kind === 'save-draft' &&
                effect.targetId.startsWith(`autosave:${input.stepId}:`),
            )
          : input.stepId === 'publish'
            ? eligibleEffects.find((effect) => effect.kind === 'publish')
            : undefined
    if (
      ['fill-body', 'fill-fields', 'save-draft', 'publish'].includes(input.stepId) &&
      !unchangedPlatformFields &&
      !verifiedWeiboPreparation &&
      !unchangedToutiaoDraft &&
      (!requiredEffect ||
        (!['dispatched', 'result-unknown', 'verified'].includes(requiredEffect.status) &&
          requiredEffect !== recoveredBodyEffect))
    ) {
      return checkpointError(
        'INVALID_TRANSITION',
        '当前步骤没有匹配的已派发副作用凭证，不能标记完成',
      )
    }
    if (input.stepId === 'verify-publication') {
      const publicationUrl = input.outputRefs?.['publicationUrl']
      const publishEffect = eligibleEffects.find((effect) => effect.kind === 'publish')
      if (!publicationUrl || !isPlatformPublicationUrl(publicationUrl, publishing.adapterId)) {
        return checkpointError('INVALID_TRANSITION', '发布核验必须返回当前平台可复核的公开作品 URL')
      }
      if (
        !publishEffect ||
        !['dispatched', 'result-unknown', 'verified'].includes(publishEffect.status)
      ) {
        return checkpointError(
          'INVALID_TRANSITION',
          '没有本 Attempt 的发布动作凭证，不能核验发布结果',
        )
      }
    }
  }
  return { success: true, data: { eligibleEffects } }
}

export function isPlatformPublicationUrl(
  rawUrl: string,
  platform: 'csdn' | 'zhihu' | 'juejin' | 'xiaohongshu' | 'weibo' | 'toutiao' | 'bilibili' | 'jike',
): boolean {
  try {
    const url = new URL(rawUrl)
    return (
      url.protocol === 'https:' &&
      ((platform === 'toutiao' && Boolean(parseToutiaoPublicationUrl(rawUrl))) ||
        (platform === 'weibo' && Boolean(parseWeiboPublicationUrl(rawUrl))) ||
        (platform === 'bilibili' && Boolean(parseBilibiliPublicationUrl(rawUrl))) ||
        (platform === 'jike' && Boolean(parseJikePublicationUrl(rawUrl))) ||
        (platform === 'xiaohongshu' &&
          url.origin === 'https://www.xiaohongshu.com' &&
          /^\/explore\/[a-f\d]{24}\/?$/iu.test(url.pathname)) ||
        (platform === 'juejin' &&
          url.origin === 'https://juejin.cn' &&
          /^\/post\/\d+\/?$/u.test(url.pathname)) ||
        (platform === 'csdn' &&
          url.hostname === 'blog.csdn.net' &&
          /^\/[^/]+\/article\/details\/\d+\/?$/u.test(url.pathname)) ||
        (platform === 'zhihu' &&
          url.hostname === 'zhuanlan.zhihu.com' &&
          /^\/p\/\d+\/?$/u.test(url.pathname)))
    )
  } catch {
    return false
  }
}

function checkpointError(
  code: 'EVIDENCE_REQUIRED' | 'INVALID_TRANSITION',
  message: string,
): WebAffairOperationResult<never> {
  return { success: false, error: { code, message } }
}
