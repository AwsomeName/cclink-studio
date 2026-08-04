import type { WebAffairProjectSnapshot } from '@shared/web-affairs/web-affair-types'
import { workspaceRefKey, type WorkspaceRef } from '@shared/workspace-ref'
import type { Tab } from '../../types'

/**
 * Find stale affair projections in the currently loaded workspace.
 *
 * Legacy tabs may not carry a workspaceRef; because they came from this workspace's persisted
 * tab section, they are treated as belonging to the workspace currently being reconciled.
 */
export function getStaleWebAffairTabIds(
  tabs: Tab[],
  snapshot: WebAffairProjectSnapshot,
  workspaceRef: WorkspaceRef,
): string[] {
  const currentWorkspaceKey = workspaceRefKey(workspaceRef)
  const affairIds = new Set(snapshot.affairs.map((affair) => affair.id))
  return tabs.flatMap((tab) => {
    if (tab.type !== 'web-affair' || !tab.webAffair?.affairId) return []
    const tabWorkspaceKey = workspaceRefKey(tab.workspaceRef ?? workspaceRef)
    if (tabWorkspaceKey !== currentWorkspaceKey) return []
    return affairIds.has(tab.webAffair.affairId) ? [] : [tab.id]
  })
}
