import { describe, expect, it } from 'vitest'
import { buildAgentMessageWithContext } from './message-context'

describe('buildAgentMessageWithContext', () => {
  it('returns the original message when no resources are mounted', () => {
    expect(buildAgentMessageWithContext('继续整理')).toBe('继续整理')
    expect(buildAgentMessageWithContext('继续整理', { resources: [] })).toBe('继续整理')
  })

  it('injects mounted resource indexes without pretending they are file contents', () => {
    const message = buildAgentMessageWithContext('总结这些资料', {
      resources: [
        {
          id: 'file:/Users/apple/project/README.md',
          kind: 'file',
          label: 'README.md',
          detail: '/Users/apple/project/README.md',
          ref: { type: 'file', path: '/Users/apple/project/README.md' },
        },
        {
          id: 'browser:tab-1',
          kind: 'browser',
          label: 'DeepInk 官网',
          ref: { type: 'browser', tabId: 'tab-1' },
        },
      ],
    })

    expect(message).toContain('DeepInk 会话上下文')
    expect(message).toContain('不要把资源索引当作资源正文')
    expect(message).toContain('"label": "README.md"')
    expect(message).toContain('"tabId": "tab-1"')
    expect(message).toContain('用户消息:\n总结这些资料')
  })

  it('limits the resource count to keep prompt context bounded', () => {
    const message = buildAgentMessageWithContext('处理资源', {
      resources: Array.from({ length: 25 }, (_, index) => ({
        id: `file:${index}`,
        kind: 'file',
        label: `file-${index}.md`,
        ref: { type: 'file' },
      })),
    })

    expect(message).toContain('"file-19.md"')
    expect(message).not.toContain('"file-20.md"')
  })

  it('injects mounted skills as execution preferences', () => {
    const message = buildAgentMessageWithContext('评审这个计划', {
      skills: [
        {
          id: 'grill-me',
          name: 'grill-me',
          label: 'grill-me',
          description: '用 /grilling 风格拷问方案。',
          source: 'user',
        },
      ],
    })

    expect(message).toContain('"mountedSkills"')
    expect(message).toContain('"name": "grill-me"')
    expect(message).toContain('Skill 表示用户希望本轮遵循的流程风格')
    expect(message).toContain('用户消息:\n评审这个计划')
  })
})
