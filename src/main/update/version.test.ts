import { describe, expect, it } from 'vitest'
import { compareStableVersions } from './version'

describe('compareStableVersions', () => {
  it('compares all stable semantic version components', () => {
    expect(compareStableVersions('1.2.4', '1.2.3')).toBeGreaterThan(0)
    expect(compareStableVersions('1.2.3', '1.2.3')).toBe(0)
    expect(compareStableVersions('1.1.9', '1.2.0')).toBeLessThan(0)
  })

  it('rejects prerelease and malformed versions', () => {
    expect(() => compareStableVersions('1.2.3-beta.1', '1.2.3')).toThrow()
    expect(() => compareStableVersions('01.2.3', '1.2.3')).toThrow()
  })
})
