import { mkdtemp, writeFile, stat, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import type { ArticlePublishingState } from '../../shared/article-publishing/article-publishing-types'
import { prepareArticleBody } from './article-body'

const directories: string[] = []
afterEach(async () => {
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true })
})
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'article-body-'))
  directories.push(directory)
  const path = join(directory, 'article.md')
  const markdown =
    '# 标题\n\n前文\n\n![第一张](./一.png)\n\n中间文字\n\n![第二张](./二.png)\n\n结尾<script>alert(1)</script>'
  await writeFile(path, markdown)
  const info = await stat(path)
  const assets = ['./一.png', './二.png'].map((name, index) => ({
    id: `local:图:${name}`,
    kind: 'local',
    status: 'uploaded',
    displayPath: name,
    platformUrl: `https://img-blog.csdnimg.cn/image-${index}.png`,
    occurrences: [
      { start: markdown.indexOf(name), end: markdown.indexOf(name) + name.length, alt: '' },
    ],
  }))
  return {
    path,
    state: {
      source: { markdownPath: path, size: info.size, modifiedAt: info.mtimeMs },
      assets,
    } as ArticlePublishingState,
  }
}
describe('frozen article with observed images', () => {
  it('keeps both images at their original paragraph positions and escapes raw HTML', async () => {
    const { state } = await fixture()
    const html = await prepareArticleBody(state)
    expect(html).toMatch(/前文[\s\S]*image-0.png[\s\S]*中间文字[\s\S]*image-1.png[\s\S]*结尾/u)
    expect(html).toContain('alt="第一张"')
    expect(html).not.toContain('./一.png')
    expect(html).not.toContain('<script>')
  })
  it('refuses missing upload verification, even when a URL was observed', async () => {
    const { state } = await fixture()
    state.assets[0].status = 'verifying'
    await expect(prepareArticleBody(state)).rejects.toThrow('图片尚未核验')
  })
  it('refuses source edits after freezing instead of writing changed content', async () => {
    const { state, path } = await fixture()
    await writeFile(path, 'changed')
    await expect(prepareArticleBody(state)).rejects.toThrow('原 Markdown 已变化')
  })
})
