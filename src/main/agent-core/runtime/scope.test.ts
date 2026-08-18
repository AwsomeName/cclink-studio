import { describe, expect, it } from 'vitest'
import { scopeToAllowedTools, toolBelongsToScope } from './scope'

describe('editor Agent scope', () => {
  it('includes Markdown illustration tools without opening unrelated capabilities', () => {
    const scope = { kind: 'editor' } as const
    expect(scopeToAllowedTools(scope)).toEqual([
      'mcp__cclink_studio__editor_*',
      'mcp__cclink_studio__image_generation_status',
      'mcp__cclink_studio__markdown_illustrate',
      'mcp__cclink_studio__web_accounts_list',
    ])
    expect(toolBelongsToScope('markdown_illustrate', scope)).toBe(true)
    expect(toolBelongsToScope('image_generation_status', scope)).toBe(true)
    expect(toolBelongsToScope('browser_navigate', scope)).toBe(false)
    expect(toolBelongsToScope('web_accounts_list', scope)).toBe(true)
  })

  it('keeps the read-only account catalog available in every focused scope', () => {
    const browserScope = { kind: 'browser', instanceId: 'tab-1' } as const
    const androidScope = { kind: 'android', deviceId: 'device-1' } as const

    expect(scopeToAllowedTools(browserScope)).toContain('mcp__cclink_studio__web_accounts_list')
    expect(scopeToAllowedTools(androidScope)).toContain('mcp__cclink_studio__web_accounts_list')
    expect(toolBelongsToScope('web_accounts_list', browserScope)).toBe(true)
    expect(toolBelongsToScope('web_accounts_list', androidScope)).toBe(true)
  })
})
