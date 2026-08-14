import { describe, expect, it } from 'vitest'
import { browserIpcContracts } from './browser-contract'

describe('browser find IPC contracts', () => {
  it('accepts only bounded shortcut and correlated find requests', () => {
    expect(
      browserIpcContracts.syncFindShortcut.parseArgs([
        {
          configVersion: 3,
          bindings: [{ code: 'KeyF', modifiers: ['primary'] }],
        },
      ]),
    ).toEqual([
      {
        configVersion: 3,
        bindings: [{ code: 'KeyF', modifiers: ['primary'] }],
      },
    ])
    expect(() =>
      browserIpcContracts.findInPage.parseArgs([
        {
          tabId: 'tab-1',
          workspaceKey: '/workspace/a',
          runtimeGeneration: 1,
          requestToken: 'request-1',
          query: '',
          forward: true,
          findNext: false,
        },
      ]),
    ).toThrow()
  })

  it('rejects the reserved quit chord at the process boundary', () => {
    expect(() =>
      browserIpcContracts.syncFindShortcut.parseArgs([
        {
          configVersion: 3,
          bindings: [{ code: 'KeyQ', modifiers: ['primary'] }],
        },
      ]),
    ).toThrow()
  })
})
