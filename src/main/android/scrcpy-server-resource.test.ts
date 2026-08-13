import { describe, expect, it, vi } from 'vitest'
import { selectScrcpyServerResource } from './scrcpy-server-resource'

describe('selectScrcpyServerResource', () => {
  it('uses the bundled JAR when no managed resource is available', () => {
    expect(selectScrcpyServerResource(null, '/app/resources/scrcpy-server.jar')).toEqual({
      path: '/app/resources/scrcpy-server.jar',
      version: '2.3.1',
      source: 'bundled',
    })
  })

  it('keeps the managed lease when a verified managed resource is available', () => {
    const release = vi.fn()
    const managed = {
      path: '/user-data/runtime-components/scrcpy-server.jar',
      version: '2.3.1' as const,
      source: 'managed' as const,
      release,
    }

    expect(selectScrcpyServerResource(managed, '/app/resources/scrcpy-server.jar')).toBe(managed)
  })
})
