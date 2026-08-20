import { describe, expect, it } from 'vitest'
import {
  workbenchAuxiliaryReadyInputSchema,
  workbenchBrowserTabProjectionSchema,
  workbenchMoveTabInputSchema,
  workbenchAuxiliaryBrowserCommandInputSchema,
  workbenchWindowProjectionSchema,
} from './workbench-window'

describe('workbench window IPC contract', () => {
  it('accepts a bounded Browser-only auxiliary projection', () => {
    expect(
      workbenchWindowProjectionSchema.parse({
        window: {
          windowId: 'aux-1',
          role: 'auxiliary',
          workspaceKey: '/workspace-a',
          activeTabId: 'browser-1',
          generation: 2,
        },
        tabs: [
          {
            tabId: 'browser-1',
            type: 'browser',
            title: 'Example',
            icon: 'globe',
            workspaceKey: '/workspace-a',
            generation: 2,
            initialUrl: 'https://example.com',
            browserProfile: null,
          },
        ],
      }),
    ).toMatchObject({ window: { role: 'auxiliary' }, tabs: [{ tabId: 'browser-1' }] })
  })

  it('rejects unsupported tab types and multiple M1 auxiliary tabs', () => {
    expect(() =>
      workbenchBrowserTabProjectionSchema.parse({
        tabId: 'editor-1',
        type: 'editor',
        title: 'Draft',
        icon: 'file',
        workspaceKey: '/workspace-a',
        generation: 1,
      }),
    ).toThrow()

    expect(() =>
      workbenchWindowProjectionSchema.parse({
        window: {
          windowId: 'aux-1',
          role: 'auxiliary',
          workspaceKey: '/workspace-a',
          activeTabId: 'browser-1',
          generation: 1,
        },
        tabs: [browserProjection('browser-1'), browserProjection('browser-2')],
      }),
    ).toThrow()
  })

  it('rejects unknown fields and stale-shaped generations before handlers run', () => {
    expect(() =>
      workbenchMoveTabInputSchema.parse({
        tabId: 'browser-1',
        workspaceKey: '/workspace-a',
        sourceWindowId: 'main',
        expectedGeneration: -1,
      }),
    ).toThrow()
    expect(() =>
      workbenchAuxiliaryReadyInputSchema.parse({
        windowId: 'aux-1',
        generation: 1,
        role: 'main',
      }),
    ).toThrow()
  })

  it('requires bounded find correlation fields for auxiliary Browser commands', () => {
    expect(() =>
      workbenchAuxiliaryBrowserCommandInputSchema.parse({
        windowId: 'aux-1',
        tabId: 'browser-1',
        generation: 2,
        action: 'find',
      }),
    ).toThrow()
    expect(
      workbenchAuxiliaryBrowserCommandInputSchema.parse({
        windowId: 'aux-1',
        tabId: 'browser-1',
        generation: 2,
        action: 'find',
        query: 'needle',
        requestToken: 'request-1',
        forward: true,
        findNext: false,
      }),
    ).toMatchObject({ action: 'find', query: 'needle' })
  })
})

function browserProjection(tabId: string) {
  return {
    tabId,
    type: 'browser' as const,
    title: tabId,
    icon: 'globe',
    workspaceKey: '/workspace-a',
    generation: 1,
  }
}
