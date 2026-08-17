import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  AgentComposer,
  AgentPanelSurface,
  isAgentComposerCandidateSelectionKey,
  resolveAgentComposerKeyDecision,
} from './agent-panel-surface'

beforeAll(() => {
  vi.stubGlobal('React', React)
})

afterAll(() => {
  vi.unstubAllGlobals()
})

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
    expect(resolveAgentComposerKeyDecision({ ...base, canSubmit: false })).toBe('block-submit')
    expect(resolveAgentComposerKeyDecision({ ...base, handledBeforeSubmit: true })).toBe('handled')
  })

  it('keeps Shift+Enter as a newline while a candidate menu is open', () => {
    expect(isAgentComposerCandidateSelectionKey({ key: 'Enter', shiftKey: false })).toBe(true)
    expect(isAgentComposerCandidateSelectionKey({ key: 'Enter', shiftKey: true })).toBe(false)
    expect(isAgentComposerCandidateSelectionKey({ key: 'Tab', shiftKey: false })).toBe(true)
  })

  it('renders the same Panel and Composer roots for either runtime', () => {
    const renderRuntime = (runtime: 'local' | 'remote'): string =>
      renderToStaticMarkup(
        React.createElement(
          AgentPanelSurface,
          { variant: 'side', runtime },
          React.createElement(AgentComposer, {
            value: '',
            onChange: () => undefined,
            onSubmit: () => undefined,
            canSubmit: false,
            placeholder: '输入消息',
            textareaClassName: 'agent-input',
            containerClassName: 'agent-composer-wrap',
          }),
        ),
      )

    const local = renderRuntime('local')
    const remote = renderRuntime('remote')
    expect(local).toContain('data-agent-panel-runtime="local"')
    expect(remote).toContain('data-agent-panel-runtime="remote"')
    expect(local.match(/<textarea/gu)).toHaveLength(1)
    expect(remote.match(/<textarea/gu)).toHaveLength(1)
    expect(local).toContain('agent-composer-wrap')
    expect(remote).toContain('agent-composer-wrap')
  })
})
