import { describe, expect, it } from 'vitest'
import { scopeToAllowedTools, toolBelongsToScope } from './scope'

describe('editor Agent scope', () => {
  it('includes Markdown illustration tools without opening unrelated capabilities', () => {
    const scope = { kind: 'editor' } as const
    expect(scopeToAllowedTools(scope)).toEqual([
      'mcp__cclink_studio__editor_*',
      'mcp__cclink_studio__image_generation_status',
      'mcp__cclink_studio__markdown_illustrate',
    ])
    expect(toolBelongsToScope('markdown_illustrate', scope)).toBe(true)
    expect(toolBelongsToScope('image_generation_status', scope)).toBe(true)
    expect(toolBelongsToScope('browser_navigate', scope)).toBe(false)
  })
})
