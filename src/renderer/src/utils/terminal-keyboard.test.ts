import { describe, expect, it } from 'vitest'
import { resolveTerminalAltArrowSequence } from './terminal-keyboard'

function keyEvent(
  key: string,
  overrides: Partial<Parameters<typeof resolveTerminalAltArrowSequence>[0]> = {},
): Parameters<typeof resolveTerminalAltArrowSequence>[0] {
  return {
    key,
    altKey: true,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...overrides,
  }
}

describe('resolveTerminalAltArrowSequence', () => {
  it('maps Alt+Left and Alt+Right to standard shell word navigation', () => {
    expect(resolveTerminalAltArrowSequence(keyEvent('ArrowLeft'))).toBe('\u001bb')
    expect(resolveTerminalAltArrowSequence(keyEvent('ArrowRight'))).toBe('\u001bf')
  })

  it('maps Alt+Up and Alt+Down to normal shell history navigation', () => {
    expect(resolveTerminalAltArrowSequence(keyEvent('ArrowUp'))).toBe('\u001b[A')
    expect(resolveTerminalAltArrowSequence(keyEvent('ArrowDown'))).toBe('\u001b[B')
  })

  it('leaves other modifier combinations and application cursor mode to xterm', () => {
    expect(resolveTerminalAltArrowSequence(keyEvent('ArrowLeft', { altKey: false }))).toBeNull()
    expect(resolveTerminalAltArrowSequence(keyEvent('ArrowLeft', { shiftKey: true }))).toBeNull()
    expect(resolveTerminalAltArrowSequence(keyEvent('ArrowLeft'), true)).toBeNull()
  })
})
