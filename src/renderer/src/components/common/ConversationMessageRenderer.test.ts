import { describe, expect, it } from 'vitest'
import type { ContentBlock } from '../../types'
import { buildContentRenderUnits, getMessageCopyText } from './ConversationMessageRenderer'

describe('ConversationMessageRenderer', () => {
  it('groups consecutive tool blocks into one execution unit', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', text: '开始' },
      {
        type: 'tool_use',
        id: 'tool-1',
        name: 'mcp__cclink_studio__browser_navigate',
        input: { url: 'https://example.com' },
      },
      {
        type: 'tool_result',
        tool_use_id: 'tool-1',
        content: 'ok',
      },
      { type: 'text', text: '完成' },
    ]

    expect(buildContentRenderUnits(blocks)).toEqual([
      { type: 'block', block: blocks[0] },
      { type: 'tool_group', blocks: [blocks[1], blocks[2]] },
      { type: 'block', block: blocks[3] },
    ])
  })

  it('starts a new execution unit after non-tool content', () => {
    const blocks: ContentBlock[] = [
      {
        type: 'tool_use',
        id: 'tool-1',
        name: 'fs_read_file',
        input: { path: 'README.md' },
      },
      { type: 'thinking', thinking: 'Need another check.' },
      {
        type: 'tool_use',
        id: 'tool-2',
        name: 'terminal_run',
        input: { command: 'pnpm typecheck' },
      },
    ]

    expect(buildContentRenderUnits(blocks)).toEqual([
      { type: 'tool_group', blocks: [blocks[0]] },
      { type: 'thinking_group', blocks: [blocks[1]] },
      { type: 'tool_group', blocks: [blocks[2]] },
    ])
  })

  it('groups consecutive thinking blocks and separates them from text', () => {
    const blocks: ContentBlock[] = [
      { type: 'thinking', thinking: 'First thought.' },
      { type: 'thinking', thinking: 'Second thought.' },
      { type: 'text', text: 'Visible answer.' },
      { type: 'thinking', thinking: 'Follow-up thought.' },
    ]

    expect(buildContentRenderUnits(blocks)).toEqual([
      { type: 'thinking_group', blocks: [blocks[0], blocks[1]] },
      { type: 'block', block: blocks[2] },
      { type: 'thinking_group', blocks: [blocks[3]] },
    ])
  })

  it('uses raw text when copying a complete message', () => {
    expect(
      getMessageCopyText({
        id: 'message-1',
        role: 'assistant',
        content: [{ type: 'text', text: 'rendered' }],
        rawText: 'original document text',
        timestamp: 1,
      }),
    ).toBe('original document text')
  })

  it('falls back to structured block text when raw text is empty', () => {
    expect(
      getMessageCopyText({
        id: 'message-2',
        role: 'assistant',
        content: [
          { type: 'text', text: 'answer' },
          {
            type: 'tool_result',
            tool_use_id: 'tool-1',
            content: 'tool output',
          },
        ],
        rawText: '',
        timestamp: 1,
      }),
    ).toBe('answer\n\ntool output')
  })
})
