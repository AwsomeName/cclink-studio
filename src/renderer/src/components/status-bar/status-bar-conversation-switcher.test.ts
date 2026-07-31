import { describe, expect, it } from 'vitest'
import {
  formatStatusBarConversationTitle,
  STATUS_BAR_CONVERSATION_TITLE_LIMIT,
} from './status-bar-conversation-switcher'

describe('status bar conversation switcher', () => {
  it('shows at most ten Unicode characters from a conversation title', () => {
    expect(formatStatusBarConversationTitle('人物调研')).toBe('人物调研')
    expect(formatStatusBarConversationTitle('一二三四五六七八九十')).toBe('一二三四五六七八九十')
    expect(formatStatusBarConversationTitle('一二三四五六七八九十一')).toBe('一二三四五六七八九十…')
    expect(formatStatusBarConversationTitle('😀一二三四五六七八九十')).toBe('😀一二三四五六七八九…')
    expect(STATUS_BAR_CONVERSATION_TITLE_LIMIT).toBe(10)
  })

  it('falls back to the default title when the name is blank', () => {
    expect(formatStatusBarConversationTitle('   ')).toBe('新会话')
  })
})
