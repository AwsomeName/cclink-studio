import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ContentBlock } from '../../types'
import {
  ConversationMessageRenderer,
  buildContentRenderUnits,
  getMessageCopyText,
  getToolExecutionSummary,
  parseCadModificationResult,
} from './ConversationMessageRenderer'

beforeAll(() => vi.stubGlobal('React', React))
afterAll(() => vi.unstubAllGlobals())

describe('ConversationMessageRenderer', () => {
  it('keeps large tool output out of a collapsed group while preserving the copyable record', () => {
    const content = 'large-result-marker'.repeat(10000)
    const message = {
      id: 'large',
      role: 'assistant' as const,
      rawText: '',
      timestamp: 1,
      content: [{ type: 'tool_result' as const, tool_use_id: 'read', content }],
    }
    const rendered = renderToStaticMarkup(
      createElement(ConversationMessageRenderer, {
        message,
        conversationId: 'test',
        workspaceKey: null,
      }),
    )
    expect(rendered).toContain('执行过程')
    expect(rendered).not.toContain('large-result-marker')
    expect(getMessageCopyText(message)).toBe(content)
  })

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

  it('does not count tool requests without results as completed actions', () => {
    const blocks: Array<Extract<ContentBlock, { type: 'tool_use' | 'tool_result' }>> = [
      {
        type: 'tool_use',
        id: 'tool-pending',
        name: 'editor_write',
        input: { filePath: '/project/report.md' },
      },
      {
        type: 'tool_use',
        id: 'tool-complete',
        name: 'editor_write',
        input: { filePath: '/project/ok.md' },
      },
      {
        type: 'tool_result',
        tool_use_id: 'tool-complete',
        content: '{"persisted":true,"verified":true}',
      },
    ]

    expect(getToolExecutionSummary(blocks)).toEqual({
      actionCount: 2,
      completedCount: 1,
      failedCount: 0,
      pendingCount: 1,
    })
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

  it('does not render non-HTTPS image resources as image sources', () => {
    const rendered = renderToStaticMarkup(
      createElement(ConversationMessageRenderer, {
        message: {
          id: 'unsafe-image',
          role: 'user',
          rawText: '图片',
          timestamp: 1,
          content: [{ type: 'text', text: '图片' }],
          resources: [
            {
              id: 'unsafe-image-resource',
              kind: 'image',
              label: '不安全图片',
              ref: { type: 'image', sourceUrl: 'javascript:alert(1)' },
            },
          ],
        },
        conversationId: 'test',
        workspaceKey: null,
      }),
    )

    expect(rendered).not.toContain('<img')
    expect(rendered).not.toContain('src="javascript:')
  })

  it('renders a concise evidence summary for a successful STEP modification result', () => {
    const content = JSON.stringify({
      kind: 'cad-modification-result',
      success: true,
      outputPath: '/workspace/model-x-plus-3.step',
      axis: 'x',
      distanceMm: 3,
      output: {
        solidCount: 1,
        volume: 11200.35,
        bounds: { size: { x: 151.1735, y: 42.9023, z: 50.5921 } },
      },
      validation: {
        status: 'passed-with-baseline-warning',
        warning: '源模型已有 BOP 基线警告，需要专业 CAD 复核。',
      },
    })

    expect(parseCadModificationResult(content)?.summary).toBe(
      'STEP 已生成 · X +3 mm · 151.17 × 42.90 × 50.59 mm',
    )
    expect(parseCadModificationResult('not-json')).toBeNull()
  })
})
