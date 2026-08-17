import { describe, expect, it } from 'vitest'
import {
  deriveRemoteSessionTitle,
  isGenericRemoteSessionTitle,
  resolveRemoteSessionTitle,
} from './cclink-session-title'

describe('CCLink remote session titles', () => {
  it('recognizes generated placeholder titles', () => {
    expect(isGenericRemoteSessionTitle('远程会话 292188')).toBe(true)
    expect(isGenericRemoteSessionTitle('会话 · gl-bp')).toBe(true)
    expect(isGenericRemoteSessionTitle('检查发布流程')).toBe(false)
  })

  it('derives a readable bounded title from the first user message', () => {
    expect(deriveRemoteSessionTitle('  检查   发布流程\n是否完整  ')).toBe('检查 发布流程 是否完整')
    expect(deriveRemoteSessionTitle('一'.repeat(31))).toBe(`${'一'.repeat(30)}…`)
  })

  it('keeps a meaningful local title when sync only returns a placeholder', () => {
    expect(
      resolveRemoteSessionTitle({
        currentTitle: '检查发布流程',
        incomingTitle: '远程会话 292188',
        sessionId: 'session-292188',
      }),
    ).toBe('检查发布流程')
  })
})
