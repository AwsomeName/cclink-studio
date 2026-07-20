import { describe, expect, it } from 'vitest'
import type { AgentMessage } from '../../types'
import {
  canStartComposerHistory,
  collectComposerHistory,
  navigateComposerHistory,
  type ComposerHistoryNavigation,
} from './use-composer-history'

describe('composer history', () => {
  it('collects only non-empty user messages in send order', () => {
    const messages: AgentMessage[] = [
      message('assistant', '回复'),
      message('user', '第一条'),
      message('system', '连接错误'),
      message('user', '第二条\n多行'),
      message('user', '   '),
    ]

    expect(collectComposerHistory(messages)).toEqual(['第一条', '第二条\n多行'])
  })

  it('moves backward and forward, then restores the draft', () => {
    const entries = ['第一条', '第二条', '第三条']
    let navigation: ComposerHistoryNavigation = { index: null, draft: '' }

    let result = navigateComposerHistory(entries, navigation, '正在写的草稿', 'older')!
    expect(result.value).toBe('第三条')
    navigation = result.navigation

    result = navigateComposerHistory(entries, navigation, result.value, 'older')!
    expect(result.value).toBe('第二条')
    navigation = result.navigation

    result = navigateComposerHistory(entries, navigation, result.value, 'newer')!
    expect(result.value).toBe('第三条')
    navigation = result.navigation

    result = navigateComposerHistory(entries, navigation, result.value, 'newer')!
    expect(result.value).toBe('正在写的草稿')
    expect(result.navigation).toEqual({ index: null, draft: '' })
  })

  it('stays at the oldest entry when pressing up again', () => {
    const result = navigateComposerHistory(
      ['第一条', '第二条'],
      { index: 0, draft: '草稿' },
      '第一条',
      'older',
    )

    expect(result).toEqual({
      navigation: { index: 0, draft: '草稿' },
      value: '第一条',
    })
  })

  it('starts only for an empty composer or a collapsed caret at the beginning', () => {
    expect(canStartComposerHistory('', 0, 0)).toBe(true)
    expect(canStartComposerHistory('草稿', 0, 0)).toBe(true)
    expect(canStartComposerHistory('草稿', 2, 2)).toBe(false)
    expect(canStartComposerHistory('草稿', 0, 2)).toBe(false)
  })
})

function message(role: AgentMessage['role'], rawText: string): AgentMessage {
  return {
    id: `${role}-${rawText}`,
    role,
    content: [{ type: 'text', text: rawText }],
    rawText,
    timestamp: 1,
  }
}
