import type {
  ArticlePublishingDetailResult,
  ArticlePublishingState,
} from '../../shared/article-publishing/article-publishing-types'
import { articlePublishingDetailDefinitions } from '../../shared/article-publishing/article-publishing-plan'

/** Fold current facts into existing checkpoints. This is not an operation history or authority. */
export function foldArticlePublishingPlanResults(
  state: ArticlePublishingState,
  now: string,
): ArticlePublishingState {
  let next = state
  const put = (
    id: string,
    status: ArticlePublishingDetailResult['status'],
    evidence: string,
    reason?: string,
  ) => {
    next = setArticlePublishingPlanResult(next, {
      id,
      status,
      evidence,
      reason,
      observedAt: now,
      generation: state.execution.currentGeneration,
    })
  }
  const current = state.executionProtocol.current
  if (current?.definitionId === 'runtime.prepare-first-inspect')
    put('runtime.ready', 'running', current.startSummary)
  if (current?.definitionId === 'page.first-inspect' && current.runtime)
    put(
      'runtime.ready',
      'completed',
      `Agent ${current.runtime.agentRunId ?? ''} · BrowserTask ${current.runtime.browserTaskRunId ?? ''} · Tab ${current.runtime.tabId} · View g${current.runtime.browserViewRuntimeGeneration} · WebContents ${current.runtime.webContentsId} · Page g${current.runtime.playwrightPageBindingGeneration}`,
    )
  for (const effect of state.sideEffects) {
    // An explicitly authorized rebuild starts new work. Keep prior effects in
    // history, but do not project their dispatches onto the rebuilt plan.
    if (
      state.adapterId === 'bilibili' &&
      state.bilibiliRetry &&
      effect.executionGeneration < state.bilibiliRetry.executionGeneration
    )
      continue
    if (state.adapterId === 'bilibili' && effect.kind === 'publish' && effect.bilibiliSubmission) {
      const facts = effect.bilibiliSubmission
      put(
        'bilibili.submission.observation',
        facts.observationEnded ? 'completed' : 'verifying',
        `截至 ${facts.observedAt}：确认调用${facts.confirmationAttempted ? '已预写尝试记录（不证明点击成功）' : '尚未尝试'}；创建请求${facts.requestObserved ? '已观察到' : '尚未观察到（不证明平台未接收）'}；监听${facts.observationEnded ? '已结束' : '记录尚未结束'}。` +
          (facts.requestMatch
            ? `请求稿件匹配：${
                {
                  matched: '正文与逐图对应',
                  'invalid-body': '请求结构不可读',
                  'text-mismatch': '正文不一致',
                  'image-mismatch': '图片或顺序不一致',
                  'multiple-requests': '观察到多个请求',
                }[facts.requestMatch]
              }。`
            : '') +
          (facts.responseStatus !== undefined ? `响应状态 ${facts.responseStatus}。` : '') +
          (facts.platformCode !== undefined ? `平台结果码 ${facts.platformCode}。` : '') +
          (facts.transportFailed ? '创建请求发生网络失败；不能推断平台未接收。' : ''),
        '这是原操作的观察记录，不是发布成功或可重发证明；续接必须检查仍有效的原 Runtime 与观察器。',
      )
      if (facts.requestObserved && !facts.confirmationAttempted) {
        put('bilibili.agreement.inspect', 'completed', '已观察到直接创建请求，无需首次规范确认。')
        put('bilibili.agreement.confirm', 'skipped', '本次未调用首次确认；已有创建请求，禁止补点。')
      }
      if (facts.platformCode !== undefined && facts.platformCode !== 0)
        put(
          'bilibili.submission.receipt',
          'failed',
          `平台返回错误码 ${facts.platformCode}（HTTP ${facts.responseStatus ?? '未记录'}）；未取得成功回执。`,
          facts.platformCode === 4126021
            ? 'B站账号检查未通过；需检查会员资格与账号限制，处理后再核验。'
            : '平台未返回成功回执；保留提交事实，不自动重发。',
        )
      else if (facts.requestObserved && effect.status !== 'verified')
        put(
          'bilibili.submission.receipt',
          facts.observationEnded ? 'unknown' : 'verifying',
          '已观察到创建请求，尚未取得与本稿对应的成功回执。',
        )
    }
    let id: string | undefined
    if (effect.kind === 'upload-asset')
      id = `asset.${effect.targetId.replace(/:attempt-\d+$/u, '')}.dispatch`
    else if (effect.kind === 'publish') id = 'publish.dispatch'
    else if (effect.targetId.startsWith('initial-draft:'))
      id = `initial.${effect.targetId.split(':')[1]}.dispatch`
    else if (effect.targetId.startsWith('autosave:fill-body:')) id = 'body.dispatch'
    else if (effect.targetId.startsWith('autosave:fill-fields:')) {
      const field = effect.targetId.split(':')[2]
      if (['title', 'summary', 'tags', 'category', 'cover'].includes(field))
        id = `field.${field}.dispatch`
    } else if (effect.targetId.startsWith('manual-save:')) id = 'save.dispatch'
    if (!id) continue
    if (effect.dispatchedAt) {
      put(
        id,
        effect.status === 'verified'
          ? 'completed'
          : effect.status === 'reconciled'
            ? 'skipped'
            : effect.status === 'result-unknown'
              ? 'unknown'
              : 'running',
        `派发闸门已通过 · ${effect.dispatchedAt} · ${effect.kind}/${effect.targetId}；结果另行核验`,
      )
      if (effect.kind === 'publish' && state.adapterId === 'juejin')
        put(
          'fields.open',
          'completed',
          `最终提交前 main 已在掘金可见设置面板核验唯一提交控件 · ${effect.dispatchedAt}`,
        )
      if (effect.kind === 'publish')
        put(
          'publish.preflight',
          'completed',
          `当前发布控件与一次性授权通过主进程闸门 · ${effect.dispatchedAt}`,
        )
    } else if (effect.status === 'reserved')
      put(id, 'running', `一次性授权已预写；尚未派发 · ${effect.reservedAt}`)
    let verifyId: string | undefined
    if (id === 'body.dispatch') verifyId = 'body.verify'
    else if (id === 'save.dispatch') verifyId = 'save.verify'
    else if (id === 'publish.dispatch') verifyId = 'publication.verify'
    else if (id.startsWith('asset.')) verifyId = id.replace(/dispatch$/, 'verify')
    else if (id.startsWith('field.')) verifyId = id.replace(/dispatch$/, 'verify')
    const liveResult = next.checkpoints
      .flatMap((c) => c.details ?? [])
      .find((d) => d.id === verifyId)
    const currentPlatformRejection =
      verifyId === 'publication.verify' &&
      liveResult?.status === 'failed' &&
      liveResult.generation === state.execution.currentGeneration
    if (verifyId && effect.status === 'result-unknown' && !currentPlatformRejection)
      put(
        verifyId,
        'unknown',
        `已派发但没有可信结果 · ${effect.targetId}`,
        next.checkpoints
          .flatMap((c) => c.details ?? [])
          .find((d) => d.id === verifyId && d.generation === state.execution.currentGeneration)
          ?.reason ?? '只核验，不重复派发；恢复时先找回原稿',
      )
    else if (
      verifyId &&
      effect.status === 'dispatched' &&
      !next.checkpoints.some((c) =>
        c.details?.some(
          (d) => d.id === verifyId && d.generation === state.execution.currentGeneration,
        ),
      )
    )
      put(verifyId, 'verifying', `等待派发动作的实际结果 · ${effect.targetId}`)
    if (
      id === 'body.dispatch' &&
      effect.status === 'verified' &&
      state.checkpoints.some((c) => c.stepId === 'fill-body' && c.status === 'completed') &&
      !next.checkpoints.some((c) =>
        c.details?.some((d) => d.id === 'body.verify' && d.status === 'completed' && !d.recheck),
      )
    )
      put(
        'body.verify',
        'completed',
        `正文检查点已由可信页面回读完成；原写入已核验 · ${effect.observedAt} · ${effect.targetId}`,
      )
    // A tool returning successfully is not field/image/publication verification.
  }
  for (const asset of state.assets.filter((a) => a.kind === 'local')) {
    if (asset.status === 'uploading')
      put(`asset.${asset.id}.inspect`, 'completed', `缺失检查已通过 · ${asset.displayPath}`)
    if (asset.status === 'uploaded') {
      // Opening the upload pane is an action, not a requirement to keep it open
      // after upload. Preserve its actual completion and clear the obsolete wait.
      const opened = next.checkpoints
        .flatMap((c) => c.details ?? [])
        .find((d) => d.id === `asset.${asset.id}.open`)
      if (opened?.status === 'completed' && opened.recheck)
        next = setArticlePublishingPlanResult(next, { ...opened, recheck: undefined })
      if (['zhihu', 'xiaohongshu'].includes(state.adapterId) && !opened)
        put(
          `asset.${asset.id}.open`,
          'skipped',
          '图片已核验存在，本次无需再定位上传控件；此前定位动作未记录，不补记成功',
        )

      if (asset.manualResolution?.status === 'present' && asset.uploadAttempts.length === 0)
        put(
          `asset.${asset.id}.dispatch`,
          'skipped',
          '原稿已有该图，经人工确认并由主进程回读，无需重新上传；未补记上传成功',
        )
      put(`asset.${asset.id}.inspect`, 'completed', `已有可信图片记录 · ${asset.displayPath}`)
      put(
        `asset.${asset.id}.verify`,
        'completed',
        asset.manualResolution?.status === 'present'
          ? `用户目视确认存在 · ${asset.manualResolution.resolvedAt}`
          : `页面对应图片已核验 · ${asset.platformUrl ?? asset.displayPath} · ${asset.verifiedAt ?? ''}`,
      )
    }
  }
  if (
    state.draft?.platformDraftId &&
    !state.draft.recovery &&
    state.checkpoints.find((c) => c.stepId === 'open-editor')?.status === 'completed'
  )
    put(
      'initial.anchor',
      'completed',
      `首次保存与原稿复核 · ${state.draft.platformAccountId} · draftId ${state.draft.platformDraftId} · ${state.draft.normalizedTitle} · ${state.draft.lastVerifiedAt}`,
    )
  if (
    ['interrupted', 'cancelled', 'failed', 'waiting-human', 'result-unknown'].includes(
      state.execution.status,
    )
  ) {
    for (const checkpoint of next.checkpoints)
      for (const detail of checkpoint.details ?? []) {
        if (['running', 'verifying'].includes(detail.status))
          put(
            detail.id,
            state.execution.status === 'result-unknown' ? 'unknown' : 'waiting',
            detail.evidence,
            checkpoint.error?.message ??
              `任务${state.execution.status}；没有继续派发权限，恢复后重新核验`,
          )
      }
  }
  // Once the actual public article has passed final verification, editor-only
  // rechecks from earlier interrupted generations no longer describe a live blocker.
  if (state.adapterId === 'zhihu' && state.publication.status === 'published') {
    next = {
      ...next,
      checkpoints: next.checkpoints.map((checkpoint) => ({
        ...checkpoint,
        details: checkpoint.details?.map((detail) =>
          checkpoint.status === 'completed' && detail.status === 'completed' && detail.recheck
            ? { ...detail, recheck: undefined }
            : detail,
        ),
      })),
    }
  }
  const definitions = articlePublishingDetailDefinitions(next)
  return {
    ...next,
    checkpoints: next.checkpoints.map((checkpoint) => ({
      ...checkpoint,
      details: checkpoint.details?.map((detail) => ({
        ...detail,
        nextAction:
          state.execution.status === 'cancelled'
            ? '任务已终止；不能再派发操作。保留现场和证据。'
            : ['interrupted', 'failed', 'result-unknown'].includes(state.execution.status)
              ? state.adapterId === 'weibo'
                ? '保留当前编辑现场；有本次提交回执时只核验对应公开页。没有草稿身份时不自动重填、重传或重发。'
                : '使用任务恢复入口，先从管理页复核原稿和未知动作；不得直接重放。'
              : detail.recheck || ['waiting', 'unknown', 'failed'].includes(detail.status)
                ? `${detail.recheck?.reason ?? detail.reason ?? '尚未核验'}；先处理此卡点并重新检查。`
                : ['running', 'verifying'].includes(detail.status)
                  ? '等待本次真实动作或回读结果；可以终止任务，不能并发重复派发。'
                  : (definitions.find((d) => d.id === detail.id)?.next ?? '等待当前任务的下一步。'),
      })),
    })),
  }
}

export function setArticlePublishingPlanResult(
  state: ArticlePublishingState,
  result: ArticlePublishingDetailResult,
): ArticlePublishingState {
  const definition = articlePublishingDetailDefinitions(state).find((d) => d.id === result.id)
  if (!definition) return state
  return {
    ...state,
    checkpoints: state.checkpoints.map((checkpoint) => {
      if (checkpoint.stepId !== definition.checkpointId) return checkpoint
      const previous = checkpoint.details?.find((d) => d.id === result.id)
      // Business completion is durable. Runtime/recovery evidence is scoped to a generation.
      const isRuntime = /^(recovery\.|runtime\.|page\.|tab\.|account\.)/.test(result.id)
      if (
        previous?.status === 'completed' &&
        (!isRuntime || previous.generation === result.generation) &&
        result.status !== 'completed'
      ) {
        if (
          result.status === 'skipped' ||
          (result.id.endsWith('.dispatch') && ['running', 'verifying'].includes(result.status))
        )
          return checkpoint
        const { id: _id, recheck: _recheck, ...recheck } = result
        return {
          ...checkpoint,
          details: (checkpoint.details ?? []).map((d) =>
            d.id === result.id ? { ...d, recheck } : d,
          ),
        }
      }
      if (
        !previous?.recheck &&
        previous?.status === result.status &&
        previous.evidence === result.evidence &&
        previous.reason === result.reason &&
        previous.generation === result.generation
      )
        return checkpoint
      return {
        ...checkpoint,
        details: [...(checkpoint.details ?? []).filter((d) => d.id !== result.id), result],
      }
    }),
  }
}
