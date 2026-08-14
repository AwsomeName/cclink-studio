import { describe, expect, it, vi } from 'vitest'
import type { MediaProject } from '../../shared/media-production/media-project-types'
import {
  parseStoryboardModelOutput,
  StoryboardProposalService,
} from './storyboard-proposal-service'

const PROJECT: MediaProject = {
  schemaVersion: 1,
  id: '11111111-1111-4111-8111-111111111111',
  workspaceRef: { kind: 'local', path: '/Users/example/workspace' },
  revision: 3,
  title: '旧标题',
  source: { path: '/Users/example/workspace/brief.md', snapshot: '# 新产品\n让创作更简单。' },
  brief: {
    platform: 'douyin',
    aspectRatio: '9:16',
    targetDurationSeconds: 12,
    brand: { primaryColor: '#5B8CFF', callToAction: '立即体验' },
  },
  scenes: [],
  createdAt: 1,
  updatedAt: 2,
}

const RESPONSE = JSON.stringify({
  title: '新产品发布',
  scenes: [
    {
      durationSeconds: 5,
      narration: '创作从未如此简单。',
      subtitle: '让创作更简单',
      visualDescription: '创作者打开工作台开始创作',
      searchTerms: ['创作', '工作台'],
      generationPrompt: '真实创作者，现代工作台，竖屏，避免文字',
    },
    {
      durationSeconds: 7,
      narration: '现在就来体验。',
      subtitle: '立即体验',
      visualDescription: '产品界面与品牌色收尾',
      searchTerms: ['产品界面'],
      generationPrompt: '简洁产品界面，蓝色品牌光效，避免文字',
    },
  ],
})

describe('StoryboardProposalService', () => {
  it('turns validated Agent JSON into a revision-bound proposal', async () => {
    const requestInternalText = vi.fn(async () => `\`\`\`json\n${RESPONSE}\n\`\`\``)
    const service = new StoryboardProposalService(
      () => ({ requestInternalText }) as never,
      () => 123,
    )

    const result = await service.propose(PROJECT)

    expect(result).toMatchObject({
      success: true,
      proposal: {
        projectId: PROJECT.id,
        baseRevision: 3,
        title: '新产品发布',
        createdAt: 123,
        scenes: [
          { order: 0, materialKind: 'unassigned' },
          { order: 1, materialKind: 'unassigned' },
        ],
      },
    })
    expect(requestInternalText).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: 'media-storyboard',
        workspacePath: PROJECT.workspaceRef.path,
      }),
    )
  })

  it('rejects unknown fields instead of applying untrusted model output', () => {
    expect(() =>
      parseStoryboardModelOutput(
        RESPONSE.replace('"title":"新产品发布"', '"title":"新产品发布","extra":true'),
      ),
    ).toThrow('未知字段')
  })

  it('degrades without affecting the current project when Agent is unavailable', async () => {
    const result = await new StoryboardProposalService(() => null).propose(PROJECT)
    expect(result).toEqual({
      success: false,
      error: expect.objectContaining({ code: 'MEDIA_PROJECT_AGENT_UNAVAILABLE' }),
    })
  })
})
