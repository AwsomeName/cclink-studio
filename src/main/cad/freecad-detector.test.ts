import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { detectFreeCad } from './freecad-detector'

let tempDir = ''

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'cclink-studio-freecad-detector-'))
})

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true })
})

describe('detectFreeCad', () => {
  it('accepts a configured executable path', async () => {
    const freeCadPath = join(tempDir, 'FreeCADCmd')
    await writeFile(freeCadPath, '#!/bin/sh\necho "FreeCAD 1.0"\n', 'utf-8')
    await chmod(freeCadPath, 0o755)

    const status = await detectFreeCad(freeCadPath)

    expect(status).toMatchObject({
      kind: 'local-freecad',
      available: true,
      path: freeCadPath,
      source: 'configured',
      version: 'FreeCAD 1.0',
    })
  })

  it('keeps only the bounded FreeCAD version line when the executable prints environment noise', async () => {
    const freeCadPath = join(tempDir, 'FreeCADCmd-noisy')
    await writeFile(
      freeCadPath,
      '#!/bin/sh\necho "SECRET_TOKEN=must-not-leak"\necho "FreeCAD 1.2 Revision: test"\n',
      'utf-8',
    )
    await chmod(freeCadPath, 0o755)

    const status = await detectFreeCad(freeCadPath)

    expect(status.version).toBe('FreeCAD 1.2 Revision: test')
    expect(JSON.stringify(status)).not.toContain('must-not-leak')
  })

  it('rejects a configured path that is missing', async () => {
    const freeCadPath = join(tempDir, 'missing-FreeCADCmd')

    const status = await detectFreeCad(freeCadPath)

    expect(status.available).toBe(false)
    expect(status.path).toBe(freeCadPath)
    expect(status.source).toBe('configured')
    expect(status.error?.code).toBe('backend-not-found')
  })
})
