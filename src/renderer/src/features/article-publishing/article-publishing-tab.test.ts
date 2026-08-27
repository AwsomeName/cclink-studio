import { describe, expect, it } from 'vitest'
import { createArticleMarkdownOpenDialogOptions } from './article-publishing-tab'

describe('article publishing Markdown picker', () => {
  it('opens in the current local workspace by default', () => {
    expect(
      createArticleMarkdownOpenDialogOptions({
        kind: 'local',
        path: '/Users/apple/project',
      }),
    ).toEqual({
      title: '选择要发布的 Markdown',
      defaultPath: '/Users/apple/project',
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
    })
  })
})
