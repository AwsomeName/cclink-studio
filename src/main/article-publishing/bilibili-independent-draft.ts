import { readFile, stat } from 'node:fs/promises'
import MarkdownIt from 'markdown-it'
import type { WebAffair } from '../../shared/web-affairs/web-affair-types'
import type { ArticlePublishingSourcePreview } from '../../shared/article-publishing/article-publishing-types'

/** An inactive unknown post keeps its own replay protection, but need not block
 * an explicitly different document. Missing or changed source evidence fails closed. */
export async function isIndependentBilibiliDraft(
  previous: WebAffair,
  preview: ArticlePublishingSourcePreview,
): Promise<boolean> {
  const state = previous.articlePublishing
  if (
    state?.adapterId !== 'bilibili' ||
    state.execution.status !== 'result-unknown' ||
    state.publication.status !== 'result-unknown' ||
    !state.execution.currentAttemptId ||
    !previous.attempts.some(
      (a) => a.id === state.execution.currentAttemptId && a.status === 'interrupted',
    ) ||
    previous.attempts.some(
      (a) => !['interrupted', 'cancelled', 'failed', 'succeeded'].includes(a.status),
    ) ||
    state.source.markdownPath === preview.source.markdownPath ||
    state.fields.title.replace(/\s/gu, '') === preview.title.replace(/\s/gu, '')
  )
    return false
  const readUnchanged = async (source: ArticlePublishingSourcePreview['source']) => {
    const before = await stat(source.markdownPath)
    if (
      !before.isFile() ||
      before.size > 10 * 1024 * 1024 ||
      before.size !== source.size ||
      before.mtimeMs !== source.modifiedAt
    )
      throw new Error('source changed')
    const text = await readFile(source.markdownPath, 'utf8')
    const after = await stat(source.markdownPath)
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs)
      throw new Error('source changed')
    const parser = new MarkdownIt()
    const tokens = parser.parse(text, {})
    // Ignore headings and image labels: changing only those is not a new body.
    const body = tokens
      .flatMap((token, index) =>
        token.type === 'inline' && tokens[index - 1]?.type !== 'heading_open'
          ? (token.children ?? [])
              .filter((child) => child.type === 'text' || child.type === 'code_inline')
              .map((child) => child.content)
          : [],
      )
      .join('')
      .replace(/[\s\u200b]/gu, '')
    return body
  }
  try {
    const [oldBody, newBody] = await Promise.all([
      readUnchanged(state.source),
      readUnchanged(preview.source),
    ])
    return Boolean(oldBody && newBody && oldBody !== newBody)
  } catch {
    return false
  }
}
