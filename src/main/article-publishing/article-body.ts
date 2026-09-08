import { readFile, stat } from 'node:fs/promises'
import MarkdownIt from 'markdown-it'
import type { ArticlePublishingState } from '../../shared/article-publishing/article-publishing-types'

/** Frozen source + observed image URLs, never Agent-authored replacement HTML. */
export async function prepareArticleBody(state: ArticlePublishingState): Promise<string> {
  const info = await stat(state.source.markdownPath)
  if (info.size !== state.source.size || info.mtimeMs !== state.source.modifiedAt)
    throw new Error('原 Markdown 已变化，不能填写冻结任务')
  let markdown = await readFile(state.source.markdownPath, 'utf8')
  const replacements = state.assets
    .flatMap((asset) => {
      const url = asset.kind === 'local' ? asset.platformUrl : asset.sourcePath
      if (!url || (asset.kind === 'local' && asset.status !== 'uploaded'))
        throw new Error(`图片尚未核验：${asset.displayPath}`)
      if (!/^https?:\/\//u.test(url)) throw new Error('图片地址不是可显示的网页地址')
      return asset.occurrences.map((o) => ({ ...o, url }))
    })
    .sort((a, b) => b.start - a.start)
  for (const occurrence of replacements)
    markdown = markdown.slice(0, occurrence.start) + occurrence.url + markdown.slice(occurrence.end)
  return new MarkdownIt({ html: false, linkify: false }).render(markdown)
}
