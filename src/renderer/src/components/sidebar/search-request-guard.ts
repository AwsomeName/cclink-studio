import type { FsSearchWorkspaceResult } from '../../../../shared/ipc/fs'

export interface SearchRequestIdentity {
  sequence: number
  workspaceKey: string
  generation: number
  requestId: string
}

export function isSearchResponseCurrent(
  request: SearchRequestIdentity,
  latestSequence: number,
  currentWorkspaceKey: string | null,
  currentGeneration: number,
  response: FsSearchWorkspaceResult,
): boolean {
  return (
    request.sequence === latestSequence &&
    currentWorkspaceKey === request.workspaceKey &&
    currentGeneration === request.generation &&
    response.workspaceKey === request.workspaceKey &&
    response.generation === request.generation &&
    response.requestId === request.requestId
  )
}
