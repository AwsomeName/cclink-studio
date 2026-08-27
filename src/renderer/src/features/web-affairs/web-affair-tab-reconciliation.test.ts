import { describe, expect, it } from 'vitest'
import type { WebAffairProjectSnapshot } from '@shared/web-affairs/web-affair-types'
import type { Tab } from '../../types'
import { getStaleWebAffairTabIds } from './web-affair-tab-reconciliation'

describe('getStaleWebAffairTabIds', () => {
  it('removes current-workspace legacy and missing affair tabs without touching valid or foreign tabs', () => {
    const workspaceRef = { kind: 'local' as const, path: '/workspace/a' }
    const tabs = [
      affairTab('valid', 'affair-a', workspaceRef),
      affairTab('stale', 'missing-a', workspaceRef),
      affairTab('legacy', 'legacy-unassigned'),
      affairTab('foreign', 'missing-b', { kind: 'local', path: '/workspace/b' }),
      { id: 'editor', type: 'editor', title: 'file', icon: 'f', workspaceRef },
    ] satisfies Tab[]
    const snapshot = {
      schemaVersion: 4,
      revision: 1,
      workspaceId: 'workspace-a-id',
      unassignedAffairCount: 1,
      unassignedAffairs: [],
      affairs: [{ id: 'affair-a' }],
    } as unknown as WebAffairProjectSnapshot

    expect(getStaleWebAffairTabIds(tabs, snapshot, workspaceRef)).toEqual(['stale', 'legacy'])
  })
})

function affairTab(id: string, affairId: string, workspaceRef?: Tab['workspaceRef']): Tab {
  return { id, type: 'web-affair', title: id, icon: 'a', workspaceRef, webAffair: { affairId } }
}
