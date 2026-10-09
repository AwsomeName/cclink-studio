import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import type { FileService } from '../fs/file-service'
import type { AppSettings } from '../settings/types'
import { detectFreeCad } from './freecad-detector'
import { FREECAD_SECTION_INSERT_SCRIPT } from './freecad-section-insert-script'
import {
  CAD_SECTION_INSERT_OPERATION,
  type CadBounds,
  type CadModificationAxis,
  type CadModificationPlanRequest,
  type CadModificationPlanResult,
  type CadModificationResult,
  type CadModificationSnapshot,
  type CadFixedRegionEvidence,
  type CadShapeEvidence,
} from './cad-modification-types'

const DEFAULT_TIMEOUT_MS = 180_000
const DIMENSION_TOLERANCE_MM = 0.05
const FIXED_SIDE_TOLERANCE_MM = 0.01
const FIXED_REGION_ABSOLUTE_TOLERANCE_MM3 = 0.002
const FIXED_REGION_RELATIVE_TOLERANCE = 2e-7
const MAX_BASELINE_BOP_WARNING_GROWTH = 64
const ACCEPTED_BASELINE_BOP_ERRORS = new Set(['InvalidCurveOnSurface'])

interface FreeCadPlanPayload {
  success: true
  mode: 'plan'
  sourceHash: string
  source: CadShapeEvidence
  split: CadModificationPlanResult['split']
  expectedBounds: CadBounds
}

interface FreeCadModifyPayload {
  success: true
  mode: 'modify'
  sourceHashAfter: string
  source: CadShapeEvidence
  split: CadModificationPlanResult['split']
  expectedBounds: CadBounds
  fixedRegion: CadFixedRegionEvidence
  output: CadShapeEvidence & { fileSize: number }
}

interface FreeCadFailurePayload {
  success: false
  error?: string
  traceback?: string
}

type FreeCadPayload = FreeCadPlanPayload | FreeCadModifyPayload | FreeCadFailurePayload

function finiteNumber(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} 必须是有限数字`)
  return value
}

function axisValue(vector: { x: number; y: number; z: number }, axis: CadModificationAxis): number {
  return vector[axis]
}

function otherAxes(axis: CadModificationAxis): CadModificationAxis[] {
  return (['x', 'y', 'z'] as const).filter((candidate) => candidate !== axis)
}

function maxDifference(
  left: { x: number; y: number; z: number },
  right: { x: number; y: number; z: number },
  axes: CadModificationAxis[],
): number {
  return Math.max(...axes.map((axis) => Math.abs(left[axis] - right[axis])))
}

function expectedSizeFromSnapshot(snapshot: CadModificationSnapshot): {
  x: number
  y: number
  z: number
} {
  return {
    x: snapshot.expectedSizeX,
    y: snapshot.expectedSizeY,
    z: snapshot.expectedSizeZ,
  }
}

function validatePlanRequest(request: CadModificationPlanRequest): void {
  if (!['.step', '.stp'].includes(extname(request.inputPath).toLowerCase())) {
    throw new Error('首版只支持 STEP/STP 输入文件')
  }
  if (!['.step', '.stp'].includes(extname(request.outputPath).toLowerCase())) {
    throw new Error('输出文件必须使用 .step 或 .stp 扩展名')
  }
  if (request.inputPath === request.outputPath) throw new Error('输出路径不得覆盖源 STEP')
  if (request.operation !== CAD_SECTION_INSERT_OPERATION) throw new Error('不支持的 CAD 修改操作')
  if (!['x', 'y', 'z'].includes(request.axis)) throw new Error('axis 必须是 x、y 或 z')
  if (!['positive', 'negative'].includes(request.direction)) {
    throw new Error('direction 必须是 positive 或 negative')
  }
  if (!['min', 'max'].includes(request.fixedSide)) throw new Error('fixedSide 必须是 min 或 max')
  if (
    (request.direction === 'positive' && request.fixedSide !== 'min') ||
    (request.direction === 'negative' && request.fixedSide !== 'max')
  ) {
    throw new Error('正方向修改必须固定 min 端，负方向修改必须固定 max 端')
  }
  finiteNumber(request.distanceMm, 'distanceMm')
  finiteNumber(request.splitPlane, 'splitPlane')
  if (request.distanceMm < 0.1 || request.distanceMm > 10) {
    throw new Error('distanceMm 必须在 0.1–10 mm 之间')
  }
}

function validateSnapshot(snapshot: CadModificationSnapshot): void {
  validatePlanRequest(snapshot)
  if (!/^[a-f0-9]{64}$/u.test(snapshot.sourceHash)) throw new Error('sourceHash 格式无效')
  for (const [key, value] of Object.entries(expectedSizeFromSnapshot(snapshot))) {
    finiteNumber(value, `expectedSize${key.toUpperCase()}`)
    if (value <= 0) throw new Error(`expectedSize${key.toUpperCase()} 必须大于 0`)
  }
}

function validateShape(label: string, evidence: CadShapeEvidence): void {
  if (evidence.objectCount !== 1) throw new Error(`${label}必须只包含 1 个 STEP 对象`)
  if (evidence.solidCount !== 1) throw new Error(`${label}必须只包含 1 个实体`)
  if (!evidence.closed) throw new Error(`${label}实体未封闭`)
  if (!evidence.valid) throw new Error(`${label}实体无效`)
  if (!evidence.basicCheckOk) throw new Error(`${label}未通过基础 BRep 完整性检查`)
  if (!Number.isFinite(evidence.volume) || evidence.volume <= 0) {
    throw new Error(`${label}体积无效`)
  }
  validateBopEvidence(label, evidence)
}

function validateBopEvidence(label: string, evidence: CadShapeEvidence): void {
  const bop = evidence.bop
  if (!bop.parserComplete) throw new Error(`${label}BOP 检查结果无法完整解析`)
  if (!Number.isInteger(bop.errorCount) || bop.errorCount < 0) {
    throw new Error(`${label}BOP 错误数量无效`)
  }
  if (!Number.isInteger(bop.unparsedLineCount) || bop.unparsedLineCount !== 0) {
    throw new Error(`${label}BOP 检查包含未解析明细`)
  }
  if (bop.ok) {
    if (bop.errorCount !== 0 || bop.errorTypes.length !== 0 || bop.exceptionType) {
      throw new Error(`${label}BOP 成功结果自相矛盾`)
    }
    return
  }
  if (bop.exceptionType !== 'ValueError' || bop.errorCount === 0 || bop.errorTypes.length === 0) {
    throw new Error(`${label}BOP 异常缺少可验证的错误明细`)
  }
}

function validateFixedRegion(evidence: CadFixedRegionEvidence): number {
  for (const [key, value] of Object.entries(evidence)) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error(`固定区域几何证据 ${key} 无效`)
    }
  }
  if (
    evidence.sourceSolidCount !== 1 ||
    evidence.outputSolidCount !== 1 ||
    !evidence.sourceClosed ||
    !evidence.outputClosed ||
    !evidence.sourceValid ||
    !evidence.outputValid
  ) {
    throw new Error('固定区域未保持为单一、封闭且有效的实体')
  }
  if (evidence.sourceVolume <= 0 || evidence.outputVolume <= 0 || evidence.commonVolume <= 0) {
    throw new Error('固定区域体积证据无效')
  }
  const tolerance = Math.max(
    FIXED_REGION_ABSOLUTE_TOLERANCE_MM3,
    evidence.sourceVolume * FIXED_REGION_RELATIVE_TOLERANCE,
  )
  if (
    evidence.sourceOnlyVolume < 0 ||
    evidence.outputOnlyVolume < 0 ||
    evidence.symmetricDifferenceVolume < 0 ||
    evidence.symmetricDifferenceVolume > tolerance
  ) {
    throw new Error(
      `固定区域几何差异 ${evidence.symmetricDifferenceVolume.toExponential(3)} mm³ 超过门限`,
    )
  }
  const recomputed = evidence.sourceOnlyVolume + evidence.outputOnlyVolume
  const expectedSourceOnly = Math.max(0, evidence.sourceVolume - evidence.commonVolume)
  const expectedOutputOnly = Math.max(0, evidence.outputVolume - evidence.commonVolume)
  if (
    evidence.commonVolume > Math.min(evidence.sourceVolume, evidence.outputVolume) + tolerance ||
    Math.abs(expectedSourceOnly - evidence.sourceOnlyVolume) > tolerance * 1e-3 ||
    Math.abs(expectedOutputOnly - evidence.outputOnlyVolume) > tolerance * 1e-3 ||
    Math.abs(recomputed - evidence.symmetricDifferenceVolume) > tolerance * 1e-3
  ) {
    throw new Error('固定区域几何证据自相矛盾')
  }
  return tolerance
}

function validateBopPolicy(
  source: CadShapeEvidence,
  output: CadShapeEvidence,
): Pick<CadModificationResult['validation'], 'status' | 'bopPolicy' | 'warning'> {
  if (source.bop.ok && output.bop.ok) {
    return { status: 'passed', bopPolicy: 'clean' }
  }
  const sourceTypesAccepted = source.bop.errorTypes.every((type) =>
    ACCEPTED_BASELINE_BOP_ERRORS.has(type),
  )
  const outputAddsNoType = output.bop.errorTypes.every((type) =>
    source.bop.errorTypes.includes(type),
  )
  const boundedGrowth =
    output.bop.errorCount <= source.bop.errorCount + MAX_BASELINE_BOP_WARNING_GROWTH
  if (!source.bop.ok && sourceTypesAccepted && outputAddsNoType && boundedGrowth) {
    return {
      status: 'passed-with-baseline-warning',
      bopPolicy: 'source-baseline-warning',
      warning: `源模型已有 ${source.bop.errorCount} 条 BOP 基线警告；输出为 ${output.bop.errorCount} 条且未新增错误类型。需要在专业 CAD 中复核后再判断可制造性。`,
    }
  }
  throw new Error(
    `输出未通过 BOP 完整性门禁（源 ${source.bop.errorCount} 条，输出 ${output.bop.errorCount} 条）`,
  )
}

export class CadModificationService {
  private readonly children = new Set<ChildProcessWithoutNullStreams>()
  private destroyed = false

  constructor(
    private readonly getSettings: () => AppSettings,
    private readonly fileService: FileService,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  async getBackendStatus() {
    return detectFreeCad(this.getSettings().freecadPath)
  }

  async plan(
    request: CadModificationPlanRequest,
    options: { signal?: AbortSignal } = {},
  ): Promise<CadModificationPlanResult> {
    this.assertActive()
    validatePlanRequest(request)
    if (options.signal?.aborted) throw new Error('CAD 修改已取消')
    await this.fileService.assertNewWritableTarget(request.outputPath)
    const sourceSnapshot = await this.fileService.createAuthorizedFileSnapshot(request.inputPath)
    try {
      const backend = await this.requireBackend()
      if (options.signal?.aborted) throw new Error('CAD 修改已取消')
      const result = await this.runFreeCad<FreeCadPlanPayload>(
        backend.path!,
        { ...request, inputPath: sourceSnapshot.snapshotPath, mode: 'plan' },
        options.signal,
      )
      if (result.sourceHash !== sourceSnapshot.hash) {
        throw new Error('FreeCAD 分析的源快照与已授权文件不一致')
      }
      await sourceSnapshot.verifyUnchanged()
      validateShape('源模型', result.source)
      const expected = result.expectedBounds.size
      return {
        kind: 'cad-modification-plan',
        success: true,
        backend: { path: backend.path!, ...(backend.version ? { version: backend.version } : {}) },
        snapshot: {
          ...request,
          sourceHash: sourceSnapshot.hash,
          expectedSizeX: expected.x,
          expectedSizeY: expected.y,
          expectedSizeZ: expected.z,
        },
        source: result.source,
        split: result.split,
        warning: '该方案只验证一种截面插入修改；确认参数后才会生成新 STEP。基础核验不等于可制造。',
      }
    } finally {
      await sourceSnapshot.cleanup().catch(() => undefined)
    }
  }

  async modify(
    snapshot: CadModificationSnapshot,
    options: { signal?: AbortSignal } = {},
  ): Promise<CadModificationResult> {
    this.assertActive()
    validateSnapshot(snapshot)
    if (options.signal?.aborted) throw new Error('CAD 修改已取消')
    await this.fileService.assertNewWritableTarget(snapshot.outputPath)
    const backend = await this.requireBackend()
    const sourceSnapshot = await this.fileService.createAuthorizedFileSnapshot(snapshot.inputPath)
    if (sourceSnapshot.hash !== snapshot.sourceHash) {
      await sourceSnapshot.cleanup().catch(() => undefined)
      throw new Error('源 STEP 已变化，请重新分析并确认参数')
    }
    let outputDirectory: string
    try {
      outputDirectory = await mkdtemp(join(tmpdir(), 'cclink-cad-output-'))
    } catch (error) {
      await sourceSnapshot.cleanup().catch(() => undefined)
      throw error
    }
    const tempOutputPath = join(
      outputDirectory,
      `output${extname(snapshot.outputPath).toLowerCase()}`,
    )
    try {
      const result = await this.runFreeCad<FreeCadModifyPayload>(
        backend.path!,
        {
          ...snapshot,
          inputPath: sourceSnapshot.snapshotPath,
          outputPath: tempOutputPath,
          mode: 'modify',
        },
        options.signal,
      )
      if (result.sourceHashAfter !== snapshot.sourceHash) {
        throw new Error('源 STEP 在执行期间发生变化，结果未发布')
      }
      validateShape('源模型', result.source)
      validateShape('输出模型', result.output)
      const diskSize = (await stat(tempOutputPath)).size
      if (diskSize <= 0 || result.output.fileSize !== diskSize)
        throw new Error('输出 STEP 文件不完整')
      if (result.output.volume <= result.source.volume) throw new Error('输出体积未按插入操作增加')

      const expectedSize = expectedSizeFromSnapshot(snapshot)
      const scriptExpectedSize = result.expectedBounds.size
      if (maxDifference(expectedSize, scriptExpectedSize, ['x', 'y', 'z']) > 1e-6) {
        throw new Error('已确认的预期尺寸与执行参数不一致')
      }
      const targetDimensionErrorMm = Math.abs(
        axisValue(result.output.bounds.size, snapshot.axis) -
          axisValue(expectedSize, snapshot.axis),
      )
      const fixedSideErrorMm = Math.abs(
        axisValue(result.output.bounds[snapshot.fixedSide], snapshot.axis) -
          axisValue(result.source.bounds[snapshot.fixedSide], snapshot.axis),
      )
      const nonTargetDimensionErrorMm = maxDifference(
        result.output.bounds.size,
        result.source.bounds.size,
        otherAxes(snapshot.axis),
      )
      if (targetDimensionErrorMm > DIMENSION_TOLERANCE_MM) {
        throw new Error(`目标尺寸误差 ${targetDimensionErrorMm.toFixed(4)} mm 超过门限`)
      }
      if (fixedSideErrorMm > FIXED_SIDE_TOLERANCE_MM) {
        throw new Error(`固定端误差 ${fixedSideErrorMm.toFixed(4)} mm 超过门限`)
      }
      if (nonTargetDimensionErrorMm > DIMENSION_TOLERANCE_MM) {
        throw new Error(`非目标方向尺寸误差 ${nonTargetDimensionErrorMm.toFixed(4)} mm 超过门限`)
      }
      const fixedRegionToleranceMm3 = validateFixedRegion(result.fixedRegion)
      const bop = validateBopPolicy(result.source, result.output)

      await sourceSnapshot.verifyUnchanged()
      if (options.signal?.aborted) throw new Error('CAD 修改已取消')
      await this.fileService.publishAuthorizedFile(tempOutputPath, snapshot.outputPath)
      return {
        kind: 'cad-modification-result',
        success: true,
        operation: snapshot.operation,
        inputPath: snapshot.inputPath,
        outputPath: snapshot.outputPath,
        sourceHash: snapshot.sourceHash,
        axis: snapshot.axis,
        direction: snapshot.direction,
        distanceMm: snapshot.distanceMm,
        splitPlane: snapshot.splitPlane,
        fixedSide: snapshot.fixedSide,
        source: result.source,
        output: result.output,
        validation: {
          ...bop,
          sourceHashUnchanged: true,
          targetDimensionErrorMm,
          fixedSideErrorMm,
          fixedRegion: result.fixedRegion,
          fixedRegionToleranceMm3,
          nonTargetDimensionErrorMm,
        },
      }
    } finally {
      await Promise.all([
        sourceSnapshot.cleanup().catch(() => undefined),
        rm(outputDirectory, { recursive: true, force: true }).catch(() => undefined),
      ])
    }
  }

  destroy(): void {
    this.destroyed = true
    for (const child of this.children) child.kill('SIGKILL')
    this.children.clear()
  }

  private assertActive(): void {
    if (this.destroyed) throw new Error('CAD 修改服务已停止')
  }

  private async requireBackend() {
    const backend = await this.getBackendStatus()
    if (!backend.available || !backend.path) {
      throw new Error(backend.error?.message ?? 'FreeCADCmd 编辑后端不可用')
    }
    return backend
  }

  private async runFreeCad<T extends FreeCadPlanPayload | FreeCadModifyPayload>(
    executable: string,
    request: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal?.aborted) throw new Error('CAD 修改已取消')
    const id = randomUUID()
    const requestPath = join(tmpdir(), `cclink-cad-request-${id}.json`)
    const resultPath = join(tmpdir(), `cclink-cad-result-${id}.json`)
    await writeFile(requestPath, JSON.stringify(request), { encoding: 'utf-8', mode: 0o600 })
    try {
      const exitCode = await new Promise<number>((resolve, reject) => {
        const child = spawn(executable, ['-c', '--pass', requestPath, resultPath], {
          stdio: ['pipe', 'pipe', 'pipe'],
        })
        this.children.add(child)
        let settled = false
        const finish = (callback: () => void): void => {
          if (settled) return
          settled = true
          clearTimeout(timeout)
          signal?.removeEventListener('abort', abort)
          this.children.delete(child)
          callback()
        }
        const abort = (): void => {
          child.kill('SIGKILL')
          finish(() => reject(new Error('CAD 修改已取消')))
        }
        const timeout = setTimeout(() => {
          child.kill('SIGKILL')
          finish(() => reject(new Error(`FreeCAD 执行超过 ${this.timeoutMs} ms`)))
        }, this.timeoutMs)
        signal?.addEventListener('abort', abort, { once: true })
        // Drain backend logs without reflecting arbitrary process output into Agent-visible errors.
        child.stdout.resume()
        child.stderr.resume()
        child.once('error', (error) => finish(() => reject(error)))
        child.once('close', (code) => finish(() => resolve(code ?? -1)))
        if (signal?.aborted) {
          abort()
          return
        }
        // FreeCADCmd -c starts an interactive Python console. Submit the fixed adapter as one
        // statement so compound blocks are compiled together instead of line-by-line at prompts.
        child.stdin.end(`exec(${JSON.stringify(FREECAD_SECTION_INSERT_SCRIPT)})\n`)
      })
      let payload: FreeCadPayload | null = null
      try {
        payload = JSON.parse(await readFile(resultPath, 'utf-8')) as FreeCadPayload
      } catch {
        // 下面统一报告固定的 FreeCAD 失败信息。
      }
      if (exitCode !== 0 || !payload?.success) {
        const failure = payload as FreeCadFailurePayload | null
        const diagnostic = failure?.error || `FreeCAD 退出码 ${exitCode}`
        throw new Error(`FreeCAD 修改失败: ${diagnostic.slice(0, 2000)}`)
      }
      return payload as T
    } finally {
      await Promise.all([
        rm(requestPath, { force: true }).catch(() => undefined),
        rm(resultPath, { force: true }).catch(() => undefined),
      ])
    }
  }
}
