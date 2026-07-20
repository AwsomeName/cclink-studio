import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureFixedUserDataPath, getUserDataPathDiagnostics } from './user-data-path'

describe('configureFixedUserDataPath', () => {
  let tempDir = ''

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'cclink-studio-user-data-'))
  })

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('pins userData to the fixed CCLink Studio app data directory', () => {
    const appData = join(tempDir, 'Application Support')
    const setName = vi.fn()
    const setPath = vi.fn()
    const app = {
      getPath: vi.fn((name: string) => {
        if (name === 'appData') return appData
        throw new Error(`unexpected path: ${name}`)
      }),
      setName,
      setPath,
    }

    const fixedPath = configureFixedUserDataPath(app as never)

    expect(fixedPath).toBe(join(appData, 'CCLink Studio'))
    expect(existsSync(fixedPath)).toBe(true)
    expect(setName).toHaveBeenCalledWith('CCLink Studio 开源版')
    expect(setPath).toHaveBeenCalledWith('userData', join(appData, 'CCLink Studio'))
    expect(getUserDataPathDiagnostics()).toEqual({ fixedUserDataPath: fixedPath })
  })
})
