import { useEffect } from 'react'
import type { AgentWebResourceLaunchRequest } from '@shared/web-resources/web-resource'
import { workspaceRefKey } from '@shared/workspace-ref'
import { openResolvedWebResourceTab } from '../features/web-resources/web-resource-tab'
import { useWorkspaceStore } from '../stores/workspace-store'

export function handleAgentWebResourceLaunch(request: AgentWebResourceLaunchRequest): void {
  try {
    const activeWorkspaceRef = useWorkspaceStore.getState().activeWorkspaceRef
    if (
      activeWorkspaceRef.kind !== 'local' ||
      workspaceRefKey(activeWorkspaceRef) !== request.workspaceKey ||
      workspaceRefKey(request.workspaceRef) !== request.workspaceKey
    ) {
      throw new Error('目标项目当前未激活')
    }
    const tabId = openResolvedWebResourceTab(request.descriptor, request.workspaceRef)
    window.cclinkStudio.webResources.acknowledgeAgentLaunch({
      requestId: request.requestId,
      success: true,
      tabId,
    })
  } catch (error) {
    window.cclinkStudio.webResources.acknowledgeAgentLaunch({
      requestId: request.requestId,
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    })
  }
}

export function useAgentWebResourceLaunchRequests(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return
    return window.cclinkStudio.webResources.onAgentLaunchRequest(handleAgentWebResourceLaunch)
  }, [enabled])
}
