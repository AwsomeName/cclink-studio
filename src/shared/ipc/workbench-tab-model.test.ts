import { describe, expect, it } from 'vitest'
import { workbenchTabDescriptorSchema } from './workbench-tab-model'

const localBrowser = {
  id: 'browser-1',
  type: 'browser',
  title: '浏览器',
  icon: '🌐',
  initialUrl: 'https://example.com/',
  workspaceRef: { kind: 'local', path: '/workspace' },
}

describe('workbenchTabDescriptorSchema Browser ownership', () => {
  it('rejects local Profile-only and unbound Browser descriptors', () => {
    expect(
      workbenchTabDescriptorSchema.safeParse({
        ...localBrowser,
        browserProfile: 'profile-only',
      }).success,
    ).toBe(false)
    expect(workbenchTabDescriptorSchema.safeParse(localBrowser).success).toBe(false)
  })

  it('accepts exactly one account or draft binding with its Profile', () => {
    expect(
      workbenchTabDescriptorSchema.safeParse({
        ...localBrowser,
        browserProfile: 'account-profile',
        webResourceRef: { accountId: 'account-1' },
      }).success,
    ).toBe(true)
    expect(
      workbenchTabDescriptorSchema.safeParse({
        ...localBrowser,
        browserProfile: 'draft-profile',
        webResourceDraftRef: { draftId: 'draft-1' },
      }).success,
    ).toBe(true)
  })

  it('keeps local HTML previews and remote Browser descriptors outside this invariant', () => {
    expect(
      workbenchTabDescriptorSchema.safeParse({
        ...localBrowser,
        initialUrl: 'file:///workspace/index.html',
        filePath: '/workspace/index.html',
      }).success,
    ).toBe(true)
    expect(
      workbenchTabDescriptorSchema.safeParse({
        ...localBrowser,
        workspaceRef: {
          kind: 'remote',
          transport: 'cclink',
          endpointId: 'agent-1',
          workspaceId: 'workspace-1',
          path: '/workspace',
        },
      }).success,
    ).toBe(true)
  })
})
