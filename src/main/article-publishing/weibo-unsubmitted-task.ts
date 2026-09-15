import type { WebAffair } from '../../shared/web-affairs/web-affair-types'
import type { ArticlePublishingSourcePreview } from '../../shared/article-publishing/article-publishing-types'

/** A stopped preparation-only task cannot have submitted a post. Preserve its
 * history while admitting a different document; unknown submissions stay blocked. */
export function canStartAfterUnsubmittedWeiboTask(
  previous: WebAffair,
  preview: ArticlePublishingSourcePreview,
): boolean {
  const state = previous.articlePublishing
  if (
    state?.adapterId !== 'weibo' ||
    state.composer?.allowPublish !== false ||
    state.execution.status !== 'interrupted' ||
    state.publication.status !== 'not-started' ||
    state.sideEffects.some((effect) => effect.kind === 'publish') ||
    state.execution.lastAgentRunId ||
    state.execution.lastBrowserTaskRunId ||
    state.source.markdownPath === preview.source.markdownPath ||
    state.fields.title.replace(/\s/gu, '') === preview.title.replace(/\s/gu, '')
  )
    return false
  const attempt = previous.attempts.find((item) => item.id === state.execution.currentAttemptId)
  const bindings = attempt?.runtimeBindings.filter(
    (binding) => binding.executionGeneration === state.execution.currentGeneration,
  )
  return Boolean(
    attempt?.status === 'interrupted' &&
    previous.attempts.every((item) =>
      ['interrupted', 'cancelled', 'failed', 'succeeded'].includes(item.status),
    ) &&
    bindings?.some((binding) => binding.kind === 'agent-run') &&
    bindings.some((binding) => binding.kind === 'browser-task') &&
    bindings.every((binding) => binding.status === 'terminal' && binding.endedAt),
  )
}
