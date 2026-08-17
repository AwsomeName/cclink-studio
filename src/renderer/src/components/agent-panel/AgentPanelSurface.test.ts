import { describe, expect, it } from 'vitest'
import { resolveAgentComposerKeyDecision } from './AgentPanelSurface'

describe('AgentComposer keyboard policy', () => {
  it('never submits an IME candidate confirmation', () => {
    expect(
      resolveAgentComposerKeyDecision({
        key: 'Enter',
        shiftKey: false,
        isComposing: true,
        keyCode: 13,
        handledBeforeSubmit: false,
        canSubmit: true,
      }),
    ).toBe('ignore-composition')
    expect(
      resolveAgentComposerKeyDecision({
        key: 'Enter',
        shiftKey: false,
        isComposing: false,
        keyCode: 229,
        handledBeforeSubmit: false,
        canSubmit: true,
      }),
    ).toBe('ignore-composition')
  })

  it('submits only an unmodified enabled Enter that was not handled by a candidate menu', () => {
    const base = {
      key: 'Enter',
      shiftKey: false,
      isComposing: false,
      keyCode: 13,
      handledBeforeSubmit: false,
      canSubmit: true,
    }
    expect(resolveAgentComposerKeyDecision(base)).toBe('submit')
    expect(resolveAgentComposerKeyDecision({ ...base, shiftKey: true })).toBe('none')
    expect(resolveAgentComposerKeyDecision({ ...base, canSubmit: false })).toBe('none')
    expect(resolveAgentComposerKeyDecision({ ...base, handledBeforeSubmit: true })).toBe('handled')
  })
})
