import { describe, expect, it, vi } from 'vitest'
import { ArticlePublishingService } from './article-publishing-service'

const WORKSPACE_REF = { kind: 'local' as const, path: '/workspace' }

describe('ArticlePublishingService', () => {
  it('extracts title and deduplicates inline, reference and HTML image occurrences by content hash', async () => {
    const markdown = [
      '---',
      'title: 可恢复文章',
      '---',
      '',
      '第一段摘要。',
      '',
      '![图一](./assets/a.png)',
      '![重复图][same]',
      '<img src="./assets/b.webp" alt="图二">',
      '',
      '[same]: ./assets/a.png',
    ].join('\n')
    const files: Record<string, { content: string; size: number }> = {
      '/workspace/assets/a.png': { content: Buffer.from('same').toString('base64'), size: 4 },
      '/workspace/assets/b.webp': { content: Buffer.from('other').toString('base64'), size: 5 },
    }
    const fileService = {
      readTextDocument: vi.fn(async () => ({
        path: '/workspace/article.md',
        content: markdown,
        size: Buffer.byteLength(markdown),
        modifiedAt: 123,
        hash: 'a'.repeat(64),
      })),
      stat: vi.fn(async (path: string) => ({
        path,
        name: path.split('/').pop(),
        type: 'file',
        size: files[path].size,
        modifiedAt: 123,
        createdAt: 123,
      })),
      readFile: vi.fn(async (path: string) => ({
        content: files[path].content,
        encoding: 'base64',
      })),
    }
    const service = new ArticlePublishingService(
      fileService as never,
      {} as never,
      async (path) => path,
    )

    const result = await service.inspectSource({
      workspaceRef: WORKSPACE_REF,
      markdownPath: '/workspace/article.md',
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.title).toBe('可恢复文章')
    expect(result.data.summary).toBe('第一段摘要。')
    expect(result.data.assets).toHaveLength(2)
    expect(
      result.data.assets.find((asset) => asset.displayPath === 'assets/a.png')?.occurrences,
    ).toHaveLength(2)
    expect(
      result.data.assets.find((asset) => asset.displayPath === 'assets/b.webp')?.occurrences[0].alt,
    ).toBe('图二')
    expect(result.data.blockers).toEqual([])
  })

  it('blocks missing and unsupported local images before opening a webpage', async () => {
    const markdown = '# Bad\n\n![svg](./bad.svg)\n\n![missing](./missing.png)'
    const fileService = {
      readTextDocument: vi.fn(async () => ({
        path: '/workspace/article.md',
        content: markdown,
        size: Buffer.byteLength(markdown),
        modifiedAt: 123,
        hash: 'b'.repeat(64),
      })),
      stat: vi.fn(async () => {
        throw new Error('ENOENT')
      }),
      readFile: vi.fn(async () => {
        throw new Error('ENOENT')
      }),
    }
    const service = new ArticlePublishingService(
      fileService as never,
      {} as never,
      async (path) => path,
    )
    const result = await service.inspectSource({
      workspaceRef: WORKSPACE_REF,
      markdownPath: '/workspace/article.md',
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.blockers).toEqual(
      expect.arrayContaining([
        expect.stringContaining('不支持的图片格式'),
        expect.stringContaining('图片不可用'),
      ]),
    )
  })
})
