import { chmod, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CadModificationService } from './cad-modification-service'

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
  bop: { ok: false, errorCount: 10, errorTypes: ['InvalidCurveOnSurface'] },
}
const expectedBounds = {
  min: { x: 0, y: 0, z: 0 },
  max: { x: 13, y: 20, z: 30 },
  size: { x: 13, y: 20, z: 30 },
}
const split = { lowSolidCount: 1, highSolidCount: 1, interfaceFaceCount: 1, interfaceArea: 12 }
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
      bop: { ok: false, errorCount: 12, errorTypes: ['InvalidCurveOnSurface'] },
      fileSize: fs.statSync(request.outputPath).size,
    },
  }
}
fs.writeFileSync(resultPath, JSON.stringify(result))
`

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'cclink-cad-modification-'))
  executable = join(tempDir, 'freecadcmd')
  inputPath = join(tempDir, 'source.step')
  outputPath = join(tempDir, 'output.step')
  await writeFile(executable, fakeFreeCad, 'utf-8')
  await chmod(executable, 0o755)
  await writeFile(inputPath, 'source-step', 'utf-8')
})

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true })
})

function createService(): CadModificationService {
  return new CadModificationService(() => ({ freecadPath: executable }) as any, 10_000)
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
})

const realStepPath = process.env.CCLINK_CAD_REAL_STEP
const realFreeCadPath = process.env.CCLINK_CAD_REAL_FREECAD

describe.runIf(Boolean(realStepPath && realFreeCadPath))('CadModificationService real E0', () => {
  it('adds 3 mm on X to the real eyewear STEP and keeps one closed solid', async () => {
    const realOutputDir = await mkdtemp(join(tmpdir(), 'cclink-cad-real-e0-'))
    const realOutputPath = join(realOutputDir, 'eyewear-x-plus-3mm.step')
    const service = new CadModificationService(
      () => ({ freecadPath: realFreeCadPath }) as any,
      180_000,
    )
    try {
      const plan = await service.plan({
        inputPath: realStepPath!,
        outputPath: realOutputPath,
        operation: 'section-insert',
        axis: 'x',
        direction: 'positive',
        distanceMm: 3,
        splitPlane: 3.7637202218503205,
        fixedSide: 'min',
      })
      const result = await service.modify(plan.snapshot)

      expect(result.output.solidCount).toBe(1)
      expect(result.output.closed).toBe(true)
      expect(result.output.valid).toBe(true)
      expect(result.output.basicCheckOk).toBe(true)
      expect(result.output.volume).toBeGreaterThan(result.source.volume)
      expect(result.output.bounds.size.x - result.source.bounds.size.x).toBeCloseTo(3, 6)
      expect(result.validation.status).toBe('passed-with-baseline-warning')
    } finally {
      service.destroy()
      await rm(realOutputDir, { recursive: true, force: true })
    }
  }, 180_000)
})
