import type {
  ArticlePublishingAsset,
  ArticlePublishingState,
  ReportArticlePublishingAssetInput,
} from '../../shared/article-publishing/article-publishing-types'
import type {
  WebAffairAttempt,
  WebAffairOperationResult,
} from '../../shared/web-affairs/web-affair-types'
import { isPlatformImageUrl } from '../../shared/article-publishing/platform-draft-anchor'
import type { ArticlePublishingPageEvidence } from './article-publishing-checkpoint-rules'

// Stateless calculations only. Runtime identity, receipt updates, lifecycle
// convergence and persistence stay in WebAffairService's mutation queue.
export function evaluateArticlePublishingAssetReport({
  publishing,
  attempt,
  target,
  input,
  trustedPageEvidence,
  timestamp,
}: {
  publishing: ArticlePublishingState
  attempt: WebAffairAttempt
  target: ArticlePublishingAsset
  input: ReportArticlePublishingAssetInput
  trustedPageEvidence?: Pick<ArticlePublishingPageEvidence, 'kind'>
  timestamp: () => string
}): WebAffairOperationResult<{
  assets: ArticlePublishingAsset[]
  now: string
  nextStatus: ArticlePublishingAsset['status']
  uploadAttempts: ArticlePublishingAsset['uploadAttempts']
}> {
  if (input.status === 'reconciling') {
    return assetRuleError('INVALID_TRANSITION', 'reconciling 只能由主进程在恢复时设置')
  }
  if (input.status !== 'uploading' && !input.evidence) {
    return assetRuleError('INVALID_TRANSITION', '图片状态变化必须包含重新观察到的页面证据')
  }
  if (input.status === 'uploaded' && trustedPageEvidence?.kind !== 'asset-uploaded') {
    return assetRuleError('EVIDENCE_REQUIRED', '图片上传成功必须由当前 CSDN 页面适配器读回并核验')
  }
  if (input.status === 'uploading' && trustedPageEvidence?.kind !== 'asset-absent') {
    return assetRuleError(
      'EVIDENCE_REQUIRED',
      '开始上传前必须由当前 CSDN 页面适配器证明图片尚不存在',
    )
  }
  if (['retryable-failed', 'result-unknown', 'failed'].includes(input.status) && !input.error) {
    return assetRuleError('INVALID_TRANSITION', '图片失败或结果未知必须包含结构化原因')
  }
  if (input.status === 'uploading' && target.status === 'reconciling' && !input.evidence) {
    return assetRuleError('INVALID_TRANSITION', '恢复后重新上传前必须先证明页面中不存在已上传结果')
  }
  const now = timestamp()
  const activeAttempt = target.uploadAttempts[target.uploadAttempts.length - 1]
  let uploadAttempts = target.uploadAttempts
  let nextStatus = input.status

  if (input.status === 'uploading') {
    if (!['pending', 'retryable-failed', 'reconciling'].includes(target.status)) {
      return assetRuleError('INVALID_TRANSITION', '当前图片状态不能开始新的上传尝试')
    }
    if (target.uploadAttempts.length >= 3) {
      return assetRuleError('INVALID_TRANSITION', '当前图片已达到 3 次尝试上限，需要人工处理')
    }
    uploadAttempts = [
      ...target.uploadAttempts,
      {
        number: target.uploadAttempts.length + 1,
        status: 'uploading' as const,
        startedAt: now,
        evidence: input.evidence ? [input.evidence] : [],
      },
    ]
  } else {
    if (!activeAttempt) return assetRuleError('INVALID_TRANSITION', '图片尚未开始上传')
    const allowedPrevious: Partial<
      Record<typeof input.status, ArticlePublishingState['assets'][number]['status'][]>
    > = {
      'waiting-platform': ['uploading'],
      verifying: ['waiting-platform', 'reconciling'],
      uploaded: ['verifying', 'reconciling'],
      'retryable-failed': ['uploading', 'waiting-platform', 'verifying', 'reconciling'],
      'result-unknown': ['uploading', 'waiting-platform', 'verifying'],
      failed: ['uploading', 'waiting-platform', 'verifying', 'reconciling'],
    }
    const previous = allowedPrevious[input.status]
    if (previous && !previous.includes(target.status)) {
      return assetRuleError(
        'INVALID_TRANSITION',
        `图片状态不能从 ${target.status} 进入 ${input.status}`,
      )
    }
    if (input.status === 'uploaded' && (!input.platformUrl || !input.evidence)) {
      return assetRuleError('INVALID_TRANSITION', '图片成功必须包含平台 URL 和页面核验证据')
    }
    if (
      input.status === 'uploaded' &&
      target.status !== 'verifying' &&
      target.status !== 'reconciling'
    ) {
      return assetRuleError('INVALID_TRANSITION', '图片必须经过页面核验后才能标记成功')
    }
    if (input.status === 'uploaded') {
      const allowRecoveredEffect = target.status === 'reconciling'
      const uploadEffect = publishing.sideEffects.find(
        (effect) =>
          effect.attemptId === attempt.id &&
          (allowRecoveredEffect || effect.executionGeneration === attempt.executionGeneration) &&
          effect.kind === 'upload-asset' &&
          effect.targetId.startsWith(`${target.id}:`) &&
          ['dispatched', 'result-unknown', 'verified'].includes(effect.status),
      )
      if (!uploadEffect) {
        return assetRuleError('INVALID_TRANSITION', '图片没有匹配的已派发上传凭证，不能标记成功')
      }
    }
    if (input.status === 'retryable-failed' && activeAttempt.number >= 3) nextStatus = 'failed'
    uploadAttempts = target.uploadAttempts.map((attempt, index) =>
      index === target.uploadAttempts.length - 1
        ? {
            ...attempt,
            status:
              input.status === 'uploaded'
                ? ('succeeded' as const)
                : input.status === 'reconciling'
                  ? attempt.status
                  : (nextStatus as typeof attempt.status),
            finishedAt: ['uploaded', 'retryable-failed', 'result-unknown', 'failed'].includes(
              nextStatus,
            )
              ? now
              : attempt.finishedAt,
            evidence: input.evidence
              ? [...attempt.evidence, input.evidence].slice(-40)
              : attempt.evidence,
            error: input.error,
          }
        : attempt,
    )
  }
  const assets = publishing.assets.map((asset) =>
    asset.id === target.id
      ? {
          ...asset,
          status: nextStatus,
          platformUrl: input.status === 'uploaded' ? input.platformUrl : asset.platformUrl,
          verifiedAt: input.status === 'uploaded' ? now : asset.verifiedAt,
          uploadAttempts,
        }
      : asset,
  )
  return { success: true, data: { assets, now, nextStatus, uploadAttempts } }
}

export function evaluateArticlePublishingAssetResolution({
  publishing,
  asset,
  resolution,
  observation,
  missingConfirmationIsCurrent,
  timestamp,
}: {
  publishing: ArticlePublishingState
  asset: ArticlePublishingAsset
  resolution: 'present' | 'missing'
  observation?: { platformUrl: string }
  missingConfirmationIsCurrent?: () => boolean
  timestamp: () => string
}): WebAffairOperationResult<{ assets: ArticlePublishingAsset[]; now: string }> {
  if (
    publishing.adapterId === 'weibo' &&
    resolution === 'missing' &&
    (!missingConfirmationIsCurrent?.() ||
      !['interrupted', 'waiting-human'].includes(publishing.execution.status) ||
      publishing.execution.currentStepId !== 'upload-assets' ||
      publishing.publication.status !== 'not-started' ||
      publishing.sideEffects.some((effect) => effect.kind === 'publish'))
  )
    return assetRuleError(
      'INVALID_TRANSITION',
      '微博缺图确认需要当前原账号编辑器证据，且原任务必须暂停并从未提交',
    )
  const importingExisting =
    ['xiaohongshu', 'toutiao'].includes(publishing.adapterId) &&
    asset.status === 'pending' &&
    asset.uploadAttempts.length === 0 &&
    publishing.draft?.recovery?.status === 'verified' &&
    resolution === 'present' &&
    Boolean(observation)
  const recoveringLostBilibiliUpload =
    publishing.adapterId === 'bilibili' &&
    resolution === 'missing' &&
    asset.status === 'uploaded' &&
    publishing.execution.status === 'interrupted' &&
    publishing.execution.currentStepId === 'upload-assets' &&
    publishing.publication.status === 'not-started'
  if (
    asset.kind !== 'local' ||
    (!importingExisting &&
      !recoveringLostBilibiliUpload &&
      !['result-unknown', 'reconciling'].includes(asset.status))
  ) {
    return assetRuleError('INVALID_TRANSITION', '只有结果未知的本地图片可以人工确认')
  }
  if (
    publishing.adapterId === 'toutiao' &&
    observation &&
    (!['waiting-human', 'interrupted'].includes(publishing.execution.status) ||
      !isPlatformImageUrl('toutiao', observation.platformUrl) ||
      publishing.assets.some((a) => a.id !== asset.id && a.platformUrl === observation.platformUrl))
  )
    return assetRuleError('INVALID_TRANSITION', '头条图片确认必须在暂停状态且不能重复认领同一张图')
  const now = timestamp()
  const nextStatus =
    resolution === 'present' ? ('uploaded' as const) : ('retryable-failed' as const)
  const assets = publishing.assets.map((candidate) =>
    candidate.id === asset.id
      ? {
          ...candidate,
          status: nextStatus,
          ...(observation
            ? { platformUrl: observation.platformUrl }
            : resolution === 'missing'
              ? { platformUrl: undefined, verifiedAt: undefined }
              : {}),
          manualResolution: { status: resolution, resolvedAt: now },
          verifiedAt: resolution === 'present' ? now : candidate.verifiedAt,
          uploadAttempts: candidate.uploadAttempts.map((attempt, index) =>
            index === candidate.uploadAttempts.length - 1
              ? {
                  ...attempt,
                  status:
                    resolution === 'present'
                      ? ('succeeded' as const)
                      : ('retryable-failed' as const),
                  finishedAt: now,
                  evidence: [
                    ...attempt.evidence,
                    resolution === 'present'
                      ? '已通过可见原稿确认图片存在'
                      : '已通过可见原稿确认图片缺失',
                  ].slice(-40),
                }
              : attempt,
          ),
        }
      : candidate,
  )
  return { success: true, data: { assets, now } }
}

function assetRuleError(
  code: 'INVALID_TRANSITION' | 'EVIDENCE_REQUIRED',
  message: string,
): WebAffairOperationResult<never> {
  return { success: false, error: { code, message } }
}
