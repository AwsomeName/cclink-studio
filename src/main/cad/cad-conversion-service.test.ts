import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../../shared/settings-constants'
import type { AppSettings } from '../settings/types'
import { CadConversionService } from './cad-conversion-service'

const electronMock = vi.hoisted(() => ({ userData: '' }))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => electronMock.userData),
  },
}))

let tempDir = ''
let settings: AppSettings

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'cclink-studio-cad-service-'))
  electronMock.userData = tempDir
  settings = {
    ...DEFAULT_SETTINGS,
    cadBackend: 'none',
    cadCacheEnabled: true,
    cadCacheLimitMb: 128,
  } as AppSettings
})

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true })
})

describe('CadConversionService', () => {
  it('reports native mesh files as directly previewable', async () => {
    const service = new CadConversionService(() => settings)

    const support = await service.getModelSupport('/project/part.stl')

    expect(support).toMatchObject({
      extension: '.stl',
      mode: 'native-mesh',
      canPreview: true,
      requiresBackend: false,
    })
  })

  it('reports STEP files as requiring a configured backend', async () => {
    const service = new CadConversionService(() => settings)

    const support = await service.getModelSupport('/project/part.step')

    expect(support).toMatchObject({
      extension: '.step',
      mode: 'cad-conversion',
      canPreview: false,
      requiresBackend: true,
      preferredFormat: 'stl',
    })
    expect(support.backend?.error?.code).toBe('backend-not-configured')
  })

  it('does not pretend mesh models can be reverse-converted to STEP', async () => {
    const service = new CadConversionService(() => settings)
    const sourcePath = join(tempDir, 'part.3mf')
    await writeFile(sourcePath, '3mf mesh', 'utf-8')

    const result = await service.convertModel({ inputPath: sourcePath, targetFormat: 'stl' })

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('reverse-conversion-unsupported')
    expect(result.error?.message).toContain('网格模型反向转换')
  })

  it('reports and clears CAD conversion cache', async () => {
    const service = new CadConversionService(() => settings)
    await mkdir(join(tempDir, 'cad-cache', 'hash-a'), { recursive: true })
    const previewPath = join(tempDir, 'cad-cache', 'hash-a', 'preview.stl')
    await writeFile(previewPath, 'solid preview\nendsolid preview\n', 'utf-8')

    const before = await service.getCacheStatus()
    expect(before.entryCount).toBe(1)
    expect(before.bytes).toBeGreaterThan(0)

    const after = await service.clearCache()
    expect(after.entryCount).toBe(0)
    expect(after.bytes).toBe(0)
  })

  it('inspects cached CAD metadata for a model file', async () => {
    const service = new CadConversionService(() => settings)
    const sourcePath = join(tempDir, 'part.step')
    await writeFile(sourcePath, 'ISO-10303-21;', 'utf-8')
    const sourceHash = createHash('sha256').update('ISO-10303-21;').digest('hex')
    await mkdir(join(tempDir, 'cad-cache', sourceHash), { recursive: true })
    await writeFile(
      join(tempDir, 'cad-cache', sourceHash, 'metadata.json'),
      JSON.stringify({
        inputPath: sourcePath,
        sourceHash,
        previewPath: join(tempDir, 'cad-cache', sourceHash, 'preview.stl'),
        previewFormat: 'stl',
        bounds: {
          min: { x: 0, y: 0, z: 0 },
          max: { x: 12, y: 5, z: 1.2 },
          size: { x: 12, y: 5, z: 1.2 },
        },
        unit: 'mm',
        unitConfidence: 'cad-backend',
        generatedAt: '2026-07-15T00:00:00.000Z',
        generator: 'FreeCAD',
        diagnostics: [],
      }),
      'utf-8',
    )

    const result = await service.inspectModel(sourcePath)

    expect(result.cacheHit).toBe(true)
    expect(result.sourceHash).toBe(sourceHash)
    expect(result.metadata?.bounds?.size).toEqual({ x: 12, y: 5, z: 1.2 })
    expect(result.metadata?.unitConfidence).toBe('cad-backend')
  })

  it('converts STEP files with the OpenCascade experimental backend', async () => {
    settings = {
      ...settings,
      cadBackend: 'occt-experimental',
    }
    const service = new CadConversionService(() => settings)
    const sourcePath = join(tempDir, 'cube.stp')
    const fixturePath = join(
      process.cwd(),
      'node_modules/occt-import-js/test/testfiles/cube-10x10mm/Cube 10x10.stp',
    )
    await writeFile(sourcePath, await readFile(fixturePath))

    const status = await service.getBackendStatus()
    const result = await service.convertModel({ inputPath: sourcePath, targetFormat: 'stl' })

    expect(status).toMatchObject({
      kind: 'occt-experimental',
      available: true,
    })
    expect(result.success).toBe(true)
    expect(result.previewPath).toMatch(/preview\.stl$/)
    expect(result.metadata?.generator).toBe('OpenCascade (occt-import-js)')
    expect(result.metadata?.bounds?.size.x).toBeGreaterThan(0)
  })
})
