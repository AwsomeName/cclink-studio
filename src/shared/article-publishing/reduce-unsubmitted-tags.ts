import type { ArticlePublishingState } from './article-publishing-types'

export function canReduceUnsubmittedTags(state: ArticlePublishingState): boolean {
  return (
    state.adapterId === 'juejin' &&
    state.execution.status === 'interrupted' &&
    state.execution.currentStepId === 'fill-fields' &&
    state.publication.status === 'not-started' &&
    !state.publication.url &&
    state.fields.tags.length > 1 &&
    state.sideEffects.every(
      (effect) =>
        effect.kind !== 'publish' && ['verified', 'rejected', 'reconciled'].includes(effect.status),
    )
  )
}

export function reduceUnsubmittedTags(
  state: ArticlePublishingState,
  expectedTags: string[],
  tags: string[],
): ArticlePublishingState {
  if (!canReduceUnsubmittedTags(state))
    throw new Error('仅允许修改已中断且没有发布或未知动作的掘金字段任务')
  if (JSON.stringify(expectedTags) !== JSON.stringify(state.fields.tags))
    throw new Error('标签配置已变化，请刷新任务')
  if (
    !tags.length ||
    tags.length >= expectedTags.length ||
    new Set(tags).size !== tags.length ||
    tags.some((tag) => !expectedTags.includes(tag))
  )
    throw new Error('只能删减现有标签，至少保留一个；不能新增标签')
  return {
    ...state,
    fields: { ...state.fields, tags: expectedTags.filter((tag) => tags.includes(tag)) },
    executionProtocol: { ...state.executionProtocol, current: undefined },
    draft: state.draft && {
      ...state.draft,
      recovery: state.draft.recovery && { ...state.draft.recovery, writePermit: undefined },
    },
    checkpoints: state.checkpoints.map((checkpoint) => {
      if (
        !['fill-fields', 'save-draft', 'publish', 'verify-publication'].includes(checkpoint.stepId)
      )
        return checkpoint
      return {
        ...checkpoint,
        status: checkpoint.stepId === 'fill-fields' ? 'needs-reconcile' : 'pending',
        finishedAt: undefined,
        outputRefs: undefined,
        error: undefined,
        details: checkpoint.details?.map((detail) => ({
          ...detail,
          status: 'waiting',
          recheck: undefined,
          reason: '标签配置已修改，恢复后重新核验',
          nextAction: '从原任务恢复入口重新核验原稿和字段',
        })),
      }
    }),
  }
}
