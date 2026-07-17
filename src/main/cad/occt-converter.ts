import { createRequire } from 'node:module'
import { constants } from 'node:fs'
import { access, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type {
  CadBackendStatus,
  CadConversionError,
  CadDiagnostic,
  CadModelBounds,
  CadModelMetadata,
  CadPreviewFormat,
} from '../../shared/ipc/cad'

const require = createRequire(import.meta.url)

interface OcctImportModule {
  ReadStepFile(content: Uint8Array, params: Record<string, unknown> | null): OcctImportResult
}

interface OcctMesh {
  name?: string
  attributes?: {
    position?: { array?: number[] | Float32Array | Float64Array }
    normal?: { array?: number[] | Float32Array | Float64Array }
  }
  index?: { array?: number[] | Uint16Array | Uint32Array }
}

interface OcctImportResult {
  success: boolean
  meshes?: OcctMesh[]
  error?: string
}

interface Vector3 {
  x: number
  y: number
  z: number
}

function occtError(
  code: CadConversionError['code'],
  message: string,
  retryable: boolean,
  detail?: string,
): CadConversionError {
  return { code, message, retryable, detail }
}

async function canRead(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.R_OK)
    return true
  } catch {
    return false
  }
}

function getOcctPackageRoot(): string {
  return dirname(require.resolve('occt-import-js/package.json'))
}

function getOcctWasmPath(): string {
  return join(getOcctPackageRoot(), 'dist', 'occt-import-js.wasm')
}

async function loadOcct(): Promise<OcctImportModule> {
  const factory = require('occt-import-js') as () => Promise<OcctImportModule>
  return factory()
}

export async function detectOpenCascade(): Promise<CadBackendStatus> {
  try {
    const packageRoot = getOcctPackageRoot()
    const wasmPath = getOcctWasmPath()
    if (!(await canRead(wasmPath))) {
      return {
        kind: 'occt-experimental',
        available: false,
        source: 'managed',
        path: packageRoot,
        error: occtError(
          'backend-not-found',
          'OpenCascade wasm 文件不可读。',
          true,
          wasmPath,
        ),
      }
    }
    return {
      kind: 'occt-experimental',
      available: true,
      version: 'occt-import-js',
      path: packageRoot,
      source: 'managed',
    }
  } catch (error) {
    return {
      kind: 'occt-experimental',
      available: false,
      source: 'managed',
      error: occtError(
        'backend-not-found',
        'OpenCascade 导入器未安装或无法加载。',
        true,
        error instanceof Error ? error.message : String(error),
      ),
    }
  }
}

function asNumberArray(value: number[] | Float32Array | Float64Array | undefined): number[] {
  return Array.from(value ?? [])
}

function asIndexArray(value: number[] | Uint16Array | Uint32Array | undefined): number[] {
  return Array.from(value ?? [])
}

function readPoint(positions: number[], vertexIndex: number): Vector3 | null {
  const offset = vertexIndex * 3
  const x = positions[offset]
  const y = positions[offset + 1]
  const z = positions[offset + 2]
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null
  return { x, y, z }
}

function subtract(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function cross(a: Vector3, b: Vector3): Vector3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

function normalize(vector: Vector3): Vector3 {
  const length = Math.hypot(vector.x, vector.y, vector.z)
  if (!Number.isFinite(length) || length <= 0) return { x: 0, y: 0, z: 0 }
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length }
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return Number(value.toPrecision(12)).toString()
}

function computeBounds(meshes: OcctMesh[]): CadModelBounds | undefined {
  const points = meshes.flatMap((mesh) => {
    const positions = asNumberArray(mesh.attributes?.position?.array)
    const result: Vector3[] = []
    for (let index = 0; index + 2 < positions.length; index += 3) {
      const x = positions[index]
      const y = positions[index + 1]
      const z = positions[index + 2]
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        result.push({ x, y, z })
      }
    }
    return result
  })
  if (points.length === 0) return undefined
  const min = {
    x: Math.min(...points.map((point) => point.x)),
    y: Math.min(...points.map((point) => point.y)),
    z: Math.min(...points.map((point) => point.z)),
  }
  const max = {
    x: Math.max(...points.map((point) => point.x)),
    y: Math.max(...points.map((point) => point.y)),
    z: Math.max(...points.map((point) => point.z)),
  }
  return {
    min,
    max,
    size: {
      x: max.x - min.x,
      y: max.y - min.y,
      z: max.z - min.z,
    },
  }
}

function writeAsciiStl(meshes: OcctMesh[]): string {
  const lines = ['solid cclink_studio_occt_preview']
  for (const mesh of meshes) {
    const positions = asNumberArray(mesh.attributes?.position?.array)
    const indices = asIndexArray(mesh.index?.array)
    for (let index = 0; index + 2 < indices.length; index += 3) {
      const a = readPoint(positions, indices[index])
      const b = readPoint(positions, indices[index + 1])
      const c = readPoint(positions, indices[index + 2])
      if (!a || !b || !c) continue
      const normal = normalize(cross(subtract(b, a), subtract(c, a)))
      lines.push(
        `  facet normal ${formatNumber(normal.x)} ${formatNumber(normal.y)} ${formatNumber(normal.z)}`,
        '    outer loop',
        `      vertex ${formatNumber(a.x)} ${formatNumber(a.y)} ${formatNumber(a.z)}`,
        `      vertex ${formatNumber(b.x)} ${formatNumber(b.y)} ${formatNumber(b.z)}`,
        `      vertex ${formatNumber(c.x)} ${formatNumber(c.y)} ${formatNumber(c.z)}`,
        '    endloop',
        '  endfacet',
      )
    }
  }
  lines.push('endsolid cclink_studio_occt_preview', '')
  return lines.join('\n')
}

export async function convertStepWithOpenCascade({
  inputPath,
  outputPath,
  metadataPath,
  previewFormat,
  sourceHash,
  diagnostics,
}: {
  inputPath: string
  outputPath: string
  metadataPath: string
  previewFormat: CadPreviewFormat
  sourceHash: string
  diagnostics: CadDiagnostic[]
}): Promise<CadModelMetadata> {
  const occt = await loadOcct()
  const content = new Uint8Array(await readFile(inputPath))
  const result = occt.ReadStepFile(content, {
    linearUnit: 'millimeter',
    linearDeflectionType: 'bounding_box_ratio',
    linearDeflection: 0.001,
    angularDeflection: 0.5,
  })
  if (!result.success || !result.meshes || result.meshes.length === 0) {
    throw new Error(result.error || 'OpenCascade 未能从 STEP/STP 文件生成 mesh。')
  }

  const bounds = computeBounds(result.meshes)
  await writeFile(outputPath, writeAsciiStl(result.meshes), 'utf-8')
  const metadata: CadModelMetadata = {
    inputPath,
    sourceHash,
    previewPath: outputPath,
    previewFormat,
    bounds,
    unit: 'mm',
    unitConfidence: 'cad-backend',
    generatedAt: new Date().toISOString(),
    generator: 'OpenCascade (occt-import-js)',
    diagnostics: [],
  }
  if (!bounds) {
    diagnostics.push({
      level: 'warning',
      message: 'OpenCascade 转换完成，但未提取到结构件包围盒。',
      detail: metadataPath,
    })
  }
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf-8')
  return metadata
}
