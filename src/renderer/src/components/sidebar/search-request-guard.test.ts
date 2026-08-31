import { describe, expect, it } from 'vitest'
import type { FsSearchWorkspaceResult } from '../../../../shared/ipc/fs'
import { isSearchResponseCurrent, type SearchRequestIdentity } from './search-request-guard'

function response(request: SearchRequestIdentity): FsSearchWorkspaceResult {
  return {
    workspaceKey: request.workspaceKey,
    generation: request.generation,
    requestId: request.requestId,
    query: 'needle',
    results: [],
    truncated: false,
    scannedEntries: 1,
  }
}

describe('isSearchResponseCurrent', () => {
  const requestA: SearchRequestIdentity = {
    sequence: 1,
    workspaceKey: '/workspace/a',
    generation: 7,
    requestId: 'a',
  }

  it('accepts only the exact current workspace generation and request', () => {
    expect(isSearchResponseCurrent(requestA, 1, '/workspace/a', 7, response(requestA))).toBe(true)
    expect(isSearchResponseCurrent(requestA, 2, '/workspace/a', 7, response(requestA))).toBe(false)
    expect(isSearchResponseCurrent(requestA, 1, '/workspace/b', 8, response(requestA))).toBe(false)
    expect(
      isSearchResponseCurrent(requestA, 1, '/workspace/a', 7, {
        ...response(requestA),
        requestId: 'late-other-query',
      }),
    ).toBe(false)
  })
})
