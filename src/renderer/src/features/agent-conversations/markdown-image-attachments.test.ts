import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAgentStore } from '../../stores/agent-store'
import { useImageImportJobs } from './image-import-jobs'
import {
  attachMarkdownImages,
  describeMarkdownImageAttach,
  markdownImageDestinations,
  planMarkdownImageAttachments,
} from './markdown-image-attachments'

const DOC = '/ws/日记/1125_周三.md'

describe('planMarkdownImageAttachments', () => {
  it('finds both image forms in order and resolves them beside the document', () => {
    expect(
      markdownImageDestinations(
        '![甲](1125.assets/a.png "t") 文字 <img src="1125.assets/b.png" alt="乙" width="160">',
      ),
    ).toEqual(['1125.assets/a.png', '1125.assets/b.png'])
  })

  it('keeps local workspace images, counts network and outside references apart', () => {
    const plan = planMarkdownImageAttachments(
      [
        '![a](1125.assets/a.png)',
        '![a again](./1125.assets/a.png)',
        '![b](<../共享/b.png>)',
        '![net](https://example.com/c.png)',
        '![outside](/etc/d.png)',
      ].join('\n'),
      DOC,
      '/ws',
    )
    expect(plan).toEqual({
      local: ['/ws/日记/1125.assets/a.png', '/ws/共享/b.png'],
      remote: 1,
      outside: 1,
    })
  })
})

describe('attachMarkdownImages', () => {
  beforeEach(() => {
    useAgentStore.setState(useAgentStore.getInitialState(), true)
    useImageImportJobs.setState({ jobs: {} })
    vi.stubGlobal('window', {
      cclinkStudio: {
        fs: {
          stat: vi.fn(async () => ({ size: 1200 })),
          renderFile: vi.fn(async () => ({
            kind: 'image',
            mimeType: 'image/png',
            content: 'iVBORw0KGgo=',
          })),
        },
      },
    })
    vi.stubGlobal('atob', (value: string) => Buffer.from(value, 'base64').toString('binary'))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('attaches up to the per-message limit and leaves the rest as paths', async () => {
    const conversationId = useAgentStore.getState().activeConversationId
    const markdown = Array.from({ length: 7 }, (_, i) => `![p${i}](1125.assets/p${i}.png)`)
      .concat('![net](https://example.com/x.png)')
      .join('\n')
    const result = await attachMarkdownImages({
      conversationId,
      markdown,
      documentPath: DOC,
      workspaceRoot: '/ws',
    })
    expect(result).toMatchObject({ attached: 5, pathOnly: 2, remote: 1 })
    expect(describeMarkdownImageAttach(result)).toBe(
      '附带 5 张图片，另 2 张只附路径，1 张网络图片未下载',
    )
    expect(useImageImportJobs.getState().jobs[`local:${conversationId}`]).toBeDefined()
  })

  it('does nothing when the text has no local image', async () => {
    const conversationId = useAgentStore.getState().activeConversationId
    const result = await attachMarkdownImages({
      conversationId,
      markdown: '没有图片的段落',
      documentPath: DOC,
      workspaceRoot: '/ws',
    })
    expect(result).toEqual({ attached: 0, pathOnly: 0, remote: 0 })
    expect(describeMarkdownImageAttach(result)).toBe('')
  })

  it('keeps unreadable images as paths', async () => {
    const conversationId = useAgentStore.getState().activeConversationId
    ;(window.cclinkStudio.fs.stat as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('gone'),
    )
    const result = await attachMarkdownImages({
      conversationId,
      markdown: '![a](1125.assets/a.png)\n![b](1125.assets/b.png)',
      documentPath: DOC,
      workspaceRoot: '/ws',
    })
    expect(result).toMatchObject({ attached: 1, pathOnly: 1 })
  })
})
