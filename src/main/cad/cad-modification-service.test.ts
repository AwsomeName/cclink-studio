import { chmod, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CadModificationService } from './cad-modification-service'
import { FileService } from '../fs/file-service'

let tempDir = ''
let executable = ''
let inputPath = ''
let outputPath = ''

const fakeFreeCad = String.raw`#!/usr/bin/env node
const fs = require('node:fs')
const crypto = require('node:crypto')
if (process.argv.includes('--version')) {
  console.log('FreeCAD 1.1 fake')
  process.exit(0)
}
const passIndex = process.argv.indexOf('--pass')
const requestPath = process.argv[passIndex + 1]
const resultPath = process.argv[passIndex + 2]
const request = JSON.parse(fs.readFileSync(requestPath, 'utf8'))
const sourceHash = crypto.createHash('sha256').update(fs.readFileSync(request.inputPath)).digest('hex')
const source = {
  objectCount: 1,
  solidCount: 1,
  faceCount: 100,
  volume: 100,
  closed: true,
  valid: true,
  basicCheckOk: true,
  bounds: {
    min: { x: 0, y: 0, z: 0 },
    max: { x: 10, y: 20, z: 30 },
    size: { x: 10, y: 20, z: 30 },
  },
  bop: {
    ok: false,
    errorCount: 10,
    errorTypes: ['InvalidCurveOnSurface'],
    parserComplete: true,
    exceptionType: 'ValueError',
    unparsedLineCount: 0,
  },
}
const expectedBounds = {
  min: { x: 0, y: 0, z: 0 },
  max: { x: 13, y: 20, z: 30 },
  size: { x: 13, y: 20, z: 30 },
}
const split = { lowSolidCount: 1, highSolidCount: 1, interfaceFaceCount: 1, interfaceArea: 12 }
const fakeMode = process.env.CCLINK_CAD_FAKE_MODE
let result
if (request.mode === 'plan') {
  result = { success: true, mode: 'plan', sourceHash, source, split, expectedBounds }
} else {
  fs.writeFileSync(request.outputPath, 'modified-step')
  result = {
    success: true,
    mode: 'modify',
    sourceHashAfter: sourceHash,
    source,
    split,
    expectedBounds,
    output: {
      ...source,
      faceCount: 110,
      volume: 130,
      bounds: expectedBounds,
      bop: fakeMode === 'unknown-bop'
        ? {
            ok: false,
            errorCount: 1,
            errorTypes: [],
            parserComplete: false,
            exceptionType: 'RuntimeError',
            unparsedLineCount: 1,
          }
        : {
            ok: false,
            errorCount: 12,
            errorTypes: ['InvalidCurveOnSurface'],
            parserComplete: true,
            exceptionType: 'ValueError',
            unparsedLineCount: 0,
          },
      fileSize: fs.statSync(request.outputPath).size,
    },
    fixedRegion: {
      guardBandMm: 0.05,
      sourceVolume: 40,
      outputVolume: 40,
      sourceOnlyVolume: 0,
      outputOnlyVolume: 0,
      symmetricDifferenceVolume: fakeMode === 'fixed-region-change' ? 1 : 0,
      sourceSolidCount: 1,
      outputSolidCount: 1,
      sourceClosed: true,
      outputClosed: true,
      sourceValid: true,
      outputValid: true,
    },
  }
}
const writeResult = () => fs.writeFileSync(resultPath, JSON.stringify(result))
if (fakeMode === 'slow-plan' && request.mode === 'plan') setTimeout(writeResult, 5000)
else writeResult()
`

beforeEach(async () => {
  delete process.env.CCLINK_CAD_FAKE_MODE
  tempDir = await mkdtemp(join(tmpdir(), 'cclink-cad-modification-'))
  executable = join(tempDir, 'freecadcmd')
  inputPath = join(tempDir, 'source.step')
  outputPath = join(tempDir, 'output.step')
  await writeFile(executable, fakeFreeCad, 'utf-8')
  await chmod(executable, 0o755)
  await writeFile(inputPath, 'source-step', 'utf-8')
})

afterEach(async () => {
  delete process.env.CCLINK_CAD_FAKE_MODE
  if (tempDir) await rm(tempDir, { recursive: true, force: true })
})

function createService(): CadModificationService {
  return new CadModificationService(
    () => ({ freecadPath: executable }) as any,
    new FileService({ getActiveWorkspace: () => tempDir }),
    10_000,
  )
}

describe('CadModificationService', () => {
  it('plans and atomically publishes one validated STEP copy with a visible baseline warning', async () => {
    const service = createService()
    const plan = await service.plan({
      inputPath,
      outputPath,
      operation: 'section-insert',
      axis: 'x',
      direction: 'positive',
      distanceMm: 3,
      splitPlane: 5,
      fixedSide: 'min',
    })

    expect(plan.snapshot).toMatchObject({
      sourceHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      expectedSizeX: 13,
      expectedSizeY: 20,
      expectedSizeZ: 30,
    })

    const result = await service.modify(plan.snapshot)

    expect(result.validation).toMatchObject({
      status: 'passed-with-baseline-warning',
      sourceHashUnchanged: true,
      targetDimensionErrorMm: 0,
      fixedSideErrorMm: 0,
      nonTargetDimensionErrorMm: 0,
      bopPolicy: 'source-baseline-warning',
    })
    expect(result.validation.warning).toContain('专业 CAD')
    expect(await readdir(tempDir)).toEqual(expect.arrayContaining(['source.step', 'output.step']))
    expect((await readdir(tempDir)).some((name) => name.startsWith('.cclink-cad-'))).toBe(false)
    service.destroy()
  })

  it('rejects a stale source hash before starting FreeCAD', async () => {
    const service = createService()
    const plan = await service.plan({
      inputPath,
      outputPath,
      operation: 'section-insert',
      axis: 'x',
      direction: 'positive',
      distanceMm: 3,
      splitPlane: 5,
      fixedSide: 'min',
    })
    await writeFile(inputPath, 'changed-source-step', 'utf-8')

    await expect(service.modify(plan.snapshot)).rejects.toThrow('源 STEP 已变化')
    service.destroy()
  })

  it('never overwrites an existing output file', async () => {
    const service = createService()
    await writeFile(outputPath, 'existing', 'utf-8')

    await expect(
      service.plan({
        inputPath,
        outputPath,
        operation: 'section-insert',
        axis: 'x',
        direction: 'positive',
        distanceMm: 3,
        splitPlane: 5,
        fixedSide: 'min',
      }),
    ).rejects.toThrow('输出文件已存在')
    service.destroy()
  })

  it('rejects fixed-region geometry changes even when the endpoint dimensions still match', async () => {
    const service = createService()
    const plan = await service.plan({
      inputPath,
      outputPath,
      operation: 'section-insert',
      axis: 'x',
      direction: 'positive',
      distanceMm: 3,
      splitPlane: 5,
      fixedSide: 'min',
    })
    process.env.CCLINK_CAD_FAKE_MODE = 'fixed-region-change'

    await expect(service.modify(plan.snapshot)).rejects.toThrow('固定区域几何差异')
    await expect(readdir(tempDir)).resolves.not.toContain('output.step')
    service.destroy()
  })

  it('fails closed when a BOP exception cannot be completely parsed', async () => {
    const service = createService()
    const plan = await service.plan({
      inputPath,
      outputPath,
      operation: 'section-insert',
      axis: 'x',
      direction: 'positive',
      distanceMm: 3,
      splitPlane: 5,
      fixedSide: 'min',
    })
    process.env.CCLINK_CAD_FAKE_MODE = 'unknown-bop'

    await expect(service.modify(plan.snapshot)).rejects.toThrow('BOP 检查结果无法完整解析')
    await expect(readdir(tempDir)).resolves.not.toContain('output.step')
    service.destroy()
  })

  it('kills an in-flight FreeCAD planning process when the Agent run is cancelled', async () => {
    process.env.CCLINK_CAD_FAKE_MODE = 'slow-plan'
    const service = createService()
    const controller = new AbortController()
    const planning = service.plan(
      {
        inputPath,
        outputPath,
        operation: 'section-insert',
        axis: 'x',
        direction: 'positive',
        distanceMm: 3,
        splitPlane: 5,
        fixedSide: 'min',
      },
      { signal: controller.signal },
    )
    setTimeout(() => controller.abort(), 800)

    await expect(planning).rejects.toThrow('CAD 修改已取消')
    await expect(readdir(tempDir)).resolves.not.toContain('output.step')
    service.destroy()
  })
})

const realStepPath = process.env.CCLINK_CAD_REAL_STEP
const realFreeCadPath = process.env.CCLINK_CAD_REAL_FREECAD

describe.runIf(Boolean(realStepPath && realFreeCadPath))('CadModificationService real E0', () => {
  const coreCase = {
    caseName: 'core-x-positive-3mm',
    axis: 'x',
    direction: 'positive',
    fixedSide: 'min',
    distanceMm: 3,
    splitPlane: 3.7637202218503205,
  } as const
  const matrix = [
    {
      caseName: 'matrix-x-positive-minimum',
      axis: 'x',
      direction: 'positive',
      fixedSide: 'min',
      distanceMm: 0.1,
      splitPlane: 3.7637202218503205,
    },
    {
      caseName: 'matrix-x-negative-maximum',
      axis: 'x',
      direction: 'negative',
      fixedSide: 'max',
      distanceMm: 10,
      splitPlane: 3.7637202218503205,
    },
    {
      caseName: 'matrix-y-positive-intermediate',
      axis: 'y',
      direction: 'positive',
      fixedSide: 'min',
      distanceMm: 0.5,
      splitPlane: -11.251129445148461,
    },
    {
      caseName: 'matrix-y-negative-intermediate',
      axis: 'y',
      direction: 'negative',
      fixedSide: 'max',
      distanceMm: 3,
      splitPlane: -11.251129445148461,
    },
    {
      caseName: 'matrix-z-positive-maximum',
      axis: 'z',
      direction: 'positive',
      fixedSide: 'min',
      distanceMm: 10,
      splitPlane: 14.955289631225183,
    },
    {
      caseName: 'matrix-z-negative-minimum',
      axis: 'z',
      direction: 'negative',
      fixedSide: 'max',
      distanceMm: 0.1,
      splitPlane: 20.014504569762714,
    },
  ] as const

  it.each([coreCase, ...matrix])(
    'modifies the real eyewear STEP: $caseName ($axis $direction $distanceMm mm)',
    async ({ axis, direction, fixedSide, distanceMm, splitPlane }) => {
      const realOutputDir = await mkdtemp(join(tmpdir(), 'cclink-cad-real-e0-'))
      const realOutputPath = join(
        realOutputDir,
        `eyewear-${axis}-${direction}-${distanceMm}mm.step`,
      )
      const service = new CadModificationService(
        () => ({ freecadPath: realFreeCadPath }) as any,
        new FileService({ getActiveWorkspace: () => '/' }),
        180_000,
      )
      try {
        const plan = await service.plan({
          inputPath: realStepPath!,
          outputPath: realOutputPath,
          operation: 'section-insert',
          axis,
          direction,
          distanceMm,
          splitPlane,
          fixedSide,
        })
        const result = await service.modify(plan.snapshot)

        expect(result.output.solidCount).toBe(1)
        expect(result.output.closed).toBe(true)
        expect(result.output.valid).toBe(true)
        expect(result.output.basicCheckOk).toBe(true)
        expect(result.output.volume).toBeGreaterThan(result.source.volume)
        expect(result.output.bounds.size[axis] - result.source.bounds.size[axis]).toBeCloseTo(
          distanceMm,
          6,
        )
        expect(result.validation.fixedRegion.symmetricDifferenceVolume).toBeLessThanOrEqual(
          result.validation.fixedRegionToleranceMm3,
        )
        expect(result.validation.status).toBe('passed-with-baseline-warning')
      } finally {
        service.destroy()
        await rm(realOutputDir, { recursive: true, force: true })
      }
    },
    180_000,
  )
})
