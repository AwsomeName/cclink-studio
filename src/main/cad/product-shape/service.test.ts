import { mkdtemp, readFile, rm, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../../../shared/settings-constants'
import { CadConversionService } from '../cad-conversion-service'
import { FileService } from '../../fs/file-service'
import { detectFreeCad } from '../freecad-detector'
import { ProductShapeService } from './service'
import { checkOutline } from '../../../shared/cad/product-shape'
const profile = vi.hoisted(() => ({ path: '' }))
vi.mock('electron', () => ({ app: { getPath: () => profile.path }, shell: {} }))
describe('product shape', () => {
  it('rejects inverted, self-intersecting and concave profiles', () => {
    for (const points of [
      [
        [0, 0],
        [10, 0],
        [0, -8],
      ],
      [
        [0, 0],
        [10, 10],
        [10, 0],
        [0, 10],
      ],
      [
        [0, 0],
        [10, 0],
        [4, 3],
        [10, 10],
        [0, 10],
      ],
    ])
      expect(() => checkOutline(points)).toThrow()
  })
  it.runIf(process.env.CCLINK_SHAPE_REAL === '1')(
    'reopens the locked revision in Blender and checks its exported open FreeCAD solid',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'studio-shape-real-'))
      profile.path = root
      const files = new FileService({ getActiveWorkspace: () => root })
      const service = new ProductShapeService(files, () => detectFreeCad())
      try {
        await files.withAccess(
          { trustedWorkspace: { kind: 'local', rootPath: root } },
          async () => {
            const source = await service.execute(
              'cad_create_shape',
              {
                brief: '右前角削平的收音盒',
                points: [
                  [0, 0],
                  [68, 0],
                  [75, 8],
                  [75, 41],
                  [0, 41],
                ],
                heightMm: 23,
              },
              root,
            )
            const change = {
              sourceId: source.id,
              brief: '固定下边，收窄右前角',
              lockedEdge: 0,
              targetVertex: 2,
              newPointMm: [75, 13],
            }
            await expect(
              service.execute('cad_revise_shape', { ...change, targetVertex: 0 }, root),
            ).rejects.toThrow('锁定侧面')
            const parentBytes = await readFile(source.files[0])
            const child = await service.execute('cad_revise_shape', change, root)
            expect(await readFile(source.files[0])).toEqual(parentBytes)
            expect(child.lockedFaceDeviationMm).toBe(0)
            expect(child.targetAfterMm).toEqual([75, 13])
            await expect(
              service.execute(
                'cad_shell_shape',
                { sourceId: source.id, wallMm: 2, floorMm: 3 },
                root,
              ),
            ).rejects.toThrow('子版')
            const result = await service.execute(
              'cad_shell_shape',
              { sourceId: child.id, wallMm: 2, floorMm: 3 },
              root,
            )
            expect(result).toMatchObject({
              sourceId: child.id,
              sourceBlendHash: child.blendHash,
              solidCount: 1,
            })
            expect(result.outerWidthMm).toBeCloseTo(75, 5)
            expect(result.innerWidthMm).toBeCloseTo(71, 5)
            expect(result.points[2]).toEqual([75, 13])
            const previewService = new CadConversionService(() => ({
              ...DEFAULT_SETTINGS,
              cadBackend: 'local-freecad',
            }))
            const preview = await previewService.convertModel({ inputPath: result.outputPath })
            expect(preview.success, JSON.stringify(preview.error)).toBe(true)
            expect(preview.metadata?.bounds?.size.x).toBeCloseTo(75, 4)
            await appendFile(child.files[0], 'external change')
            await expect(
              service.execute(
                'cad_shell_shape',
                { sourceId: child.id, wallMm: 2, floorMm: 3 },
                root,
              ),
            ).rejects.toThrow('外部变化')
          },
        )
      } finally {
        service.destroy()
        await rm(root, { recursive: true, force: true })
      }
    },
    120000,
  )
})
