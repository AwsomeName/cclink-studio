import { app } from 'electron'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AppSettings } from '../settings/types'
import { detectFreeCad } from './freecad-detector'
import type {
  CadBackendStatus,
  CadCacheStatus,
  CadConvertRequest,
  CadConvertResult,
  CadConversionError,
  CadDiagnostic,
  CadInspectModelResult,
  CadModelBounds,
  CadModelMetadata,
  CadModelSupport,
  CadPreviewFormat,
} from '../../shared/ipc/cad'

const execFileAsync = promisify(execFile)
const DEFAULT_CONVERSION_TIMEOUT_MS = 120_000
const SUPPORTED_SOURCE_EXTENSIONS = new Set(['.step', '.stp'])
const NATIVE_MODEL_EXTENSIONS = new Set(['.stl', '.3mf', '.glb', '.gltf', '.fbx'])

function cadError(
  code: CadConversionError['code'],
  message: string,
  retryable: boolean,
  detail?: string,
): CadConversionError {
  return { code, message, retryable, detail }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.R_OK)
    return true
  } catch {
    return false
  }
}

async function fileHash(filePath: string): Promise<string> {
  const content = await readFile(filePath)
  return createHash('sha256').update(content).digest('hex')
}

function getExtension(filePath: string): string {
  return extname(filePath).toLowerCase()
}

function normalizeTargetFormat(format?: CadPreviewFormat): CadPreviewFormat {
  if (format === 'obj' || format === 'glb') return format
  return 'stl'
}

function buildFreeCadScript(): string {
  return `
import json
import sys
import FreeCAD as App
import Import
import Mesh

input_path = sys.argv[1]
output_path = sys.argv[2]
metadata_path = sys.argv[3]
doc = App.newDocument("CCLinkStudioCadConversion")
Import.insert(input_path, doc.Name)
App.ActiveDocument.recompute()
objects = []
for obj in doc.Objects:
    if hasattr(obj, "Shape") and not obj.Shape.isNull():
        objects.append(obj)
if not objects:
    raise RuntimeError("FreeCAD did not find any shape objects in the STEP file")
bbox = None
for obj in objects:
    shape_bbox = obj.Shape.BoundBox
    if bbox is None:
        bbox = shape_bbox
    else:
        bbox.add(shape_bbox)
Mesh.export(objects, output_path)
metadata = {
    "inputPath": input_path,
    "previewPath": output_path,
    "previewFormat": "stl",
    "unit": "mm",
    "unitConfidence": "cad-backend",
    "generatedAt": App.Version()[0] if hasattr(App, "Version") else "",
    "generator": "FreeCAD",
    "diagnostics": [],
}
if bbox is not None:
    metadata["bounds"] = {
        "min": {"x": bbox.XMin, "y": bbox.YMin, "z": bbox.ZMin},
        "max": {"x": bbox.XMax, "y": bbox.YMax, "z": bbox.ZMax},
        "size": {"x": bbox.XLength, "y": bbox.YLength, "z": bbox.ZLength},
    }
with open(metadata_path, "w", encoding="utf-8") as metadata_file:
    json.dump(metadata, metadata_file)
App.closeDocument(doc.Name)
`.trim()
}

export class CadConversionService {
  constructor(private readonly getSettings: () => AppSettings) {}

  private getCacheRoot(): string {
    return join(app.getPath('userData'), 'cad-cache')
  }

  async getBackendStatus(): Promise<CadBackendStatus> {
    const settings = this.getSettings()
    if (settings.cadBackend === 'none') {
      return {
        kind: 'none',
        available: false,
        source: 'disabled',
        error: cadError('backend-not-configured', 'STEP/STP 预览未启用。', true),
      }
    }
    if (settings.cadBackend === 'local-freecad') {
      return detectFreeCad(settings.freecadPath)
    }
    if (settings.cadBackend === 'managed-freecad') {
      return {
        kind: 'managed-freecad',
        available: false,
        source: 'managed',
        error: cadError('backend-not-implemented', '托管 FreeCAD 运行时下载尚未实现。', true),
      }
    }
    return {
      kind: 'occt-experimental',
      available: false,
      source: 'managed',
      error: cadError('backend-not-implemented', 'OpenCascade 实验后端尚未实现。', true),
    }
  }

  async getModelSupport(inputPath: string): Promise<CadModelSupport> {
    const extension = getExtension(inputPath)
    if (NATIVE_MODEL_EXTENSIONS.has(extension)) {
      return {
        inputPath,
        extension,
        mode: 'native-mesh',
        canPreview: true,
        requiresBackend: false,
        message: '该模型格式可直接使用内置 3D 预览器打开。',
      }
    }

    if (SUPPORTED_SOURCE_EXTENSIONS.has(extension)) {
      const backend = await this.getBackendStatus()
      return {
        inputPath,
        extension,
        mode: 'cad-conversion',
        canPreview: backend.available,
        requiresBackend: true,
        preferredFormat: 'stl',
        backend,
        message: backend.available
          ? '该 CAD 文件可通过已配置后端转换为预览 mesh。'
          : (backend.error?.message ?? '该 CAD 文件需要启用 STEP/STP 转换后端。'),
      }
    }

    return {
      inputPath,
      extension,
      mode: 'unsupported',
      canPreview: false,
      requiresBackend: false,
      message: `暂不支持预览 ${extension || 'unknown'} 文件。`,
    }
  }

  async getCacheStatus(): Promise<CadCacheStatus> {
    const settings = this.getSettings()
    const cachePath = this.getCacheRoot()
    const stats = await calculateDirectoryStats(cachePath)
    return {
      enabled: settings.cadCacheEnabled,
      limitMb: settings.cadCacheLimitMb,
      cachePath,
      entryCount: stats.entryCount,
      bytes: stats.bytes,
    }
  }

  async clearCache(): Promise<CadCacheStatus> {
    await rm(this.getCacheRoot(), { recursive: true, force: true })
    return this.getCacheStatus()
  }

  async inspectModel(inputPath: string): Promise<CadInspectModelResult> {
    const diagnostics: CadDiagnostic[] = []
    const support = await this.getModelSupport(inputPath)
    if (!(await fileExists(inputPath))) {
      diagnostics.push({
        level: 'error',
        message: '源文件不存在或不可读。',
        detail: inputPath,
      })
      return {
        support,
        cacheHit: false,
        diagnostics,
      }
    }

    const sourceHash = await fileHash(inputPath)
    const metadataPath = this.getMetadataPath(sourceHash)
    const metadata = await readCadMetadata(metadataPath)
    if (metadata) {
      diagnostics.push({ level: 'info', message: '命中 CAD metadata 缓存。', detail: metadataPath })
    }

    return {
      support,
      sourceHash,
      cacheHit: Boolean(metadata),
      metadata,
      diagnostics,
    }
  }

  async convertModel(request: CadConvertRequest): Promise<CadConvertResult> {
    const diagnostics: CadDiagnostic[] = []
    const inputPath = request.inputPath
    const sourceExtension = getExtension(inputPath)
    const targetFormat = normalizeTargetFormat(request.targetFormat)

    if (!SUPPORTED_SOURCE_EXTENSIONS.has(sourceExtension)) {
      return {
        success: false,
        diagnostics,
        error: cadError(
          'unsupported-format',
          `暂不支持转换 ${sourceExtension || 'unknown'} 文件。`,
          false,
        ),
      }
    }
    if (targetFormat !== 'stl') {
      return {
        success: false,
        diagnostics,
        error: cadError(
          'unsupported-format',
          `第一版 CAD 转换仅支持导出 STL，暂不支持 ${targetFormat}。`,
          true,
        ),
      }
    }
    if (!(await fileExists(inputPath))) {
      return {
        success: false,
        diagnostics,
        error: cadError('source-file-invalid', `源文件不存在或不可读: ${inputPath}`, true),
      }
    }

    const settings = this.getSettings()
    const backendStatus = await this.getBackendStatus()
    if (!backendStatus.available || !backendStatus.path) {
      return {
        success: false,
        diagnostics: [
          ...diagnostics,
          {
            level: 'error',
            message: backendStatus.error?.message ?? 'CAD 转换后端不可用。',
            detail: backendStatus.error?.detail,
          },
        ],
        error: backendStatus.error ?? cadError('backend-not-found', 'CAD 转换后端不可用。', true),
      }
    }

    const sourceHash = await fileHash(inputPath)
    const cacheDir = join(this.getCacheRoot(), sourceHash)
    const previewPath = join(cacheDir, `preview.${targetFormat}`)
    const metadataPath = join(cacheDir, 'metadata.json')
    if (settings.cadCacheEnabled && !request.force && (await fileExists(previewPath))) {
      diagnostics.push({ level: 'info', message: '命中 CAD 转换缓存。', detail: previewPath })
      return {
        success: true,
        previewPath,
        format: targetFormat,
        sourceHash,
        cached: true,
        metadata: await readCadMetadata(metadataPath),
        diagnostics,
      }
    }

    await mkdir(cacheDir, { recursive: true })
    const scriptPath = join(cacheDir, 'deepink-freecad-convert.py')
    await writeFile(scriptPath, buildFreeCadScript(), 'utf-8')

    diagnostics.push({
      level: 'info',
      message: '开始调用 FreeCAD 转换 STEP/STP。',
      detail: `${basename(inputPath)} -> ${basename(previewPath)}`,
    })

    try {
      await execFileAsync(backendStatus.path, [scriptPath, inputPath, previewPath, metadataPath], {
        timeout: DEFAULT_CONVERSION_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
      })
      const outputStat = await stat(previewPath).catch(() => null)
      if (!outputStat || outputStat.size <= 0) {
        return {
          success: false,
          diagnostics,
          error: cadError(
            'conversion-empty-output',
            'FreeCAD 转换完成，但没有生成有效预览文件。',
            true,
          ),
        }
      }
      const metadata = await normalizeCadMetadata({
        metadataPath,
        inputPath,
        previewPath,
        previewFormat: targetFormat,
        sourceHash,
        diagnostics,
      })
      diagnostics.push({ level: 'info', message: 'CAD 转换完成。', detail: previewPath })
      if (settings.cadCacheEnabled) {
        await this.pruneCacheIfNeeded(diagnostics)
      }
      return {
        success: true,
        previewPath,
        format: targetFormat,
        sourceHash,
        cached: false,
        metadata,
        diagnostics,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const timedOut = /timed out|timeout/i.test(message)
      return {
        success: false,
        diagnostics,
        error: cadError(
          timedOut ? 'conversion-timeout' : 'unknown',
          timedOut ? 'FreeCAD 转换超时。' : 'FreeCAD 转换失败。',
          true,
          message,
        ),
      }
    } finally {
      await rm(scriptPath, { force: true }).catch(() => undefined)
    }
  }

  private async pruneCacheIfNeeded(diagnostics: CadDiagnostic[]): Promise<void> {
    const settings = this.getSettings()
    const limitBytes = Math.max(settings.cadCacheLimitMb, 128) * 1024 * 1024
    const cacheRoot = this.getCacheRoot()
    const entries = await readCacheEntries(cacheRoot)
    const totalBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0)
    if (totalBytes <= limitBytes) return

    let bytesAfterPrune = totalBytes
    const removableEntries = entries.sort((a, b) => a.mtimeMs - b.mtimeMs)
    for (const entry of removableEntries) {
      if (bytesAfterPrune <= limitBytes) break
      await rm(entry.path, { recursive: true, force: true })
      bytesAfterPrune -= entry.bytes
    }

    diagnostics.push({
      level: 'info',
      message: 'CAD 转换缓存已按上限清理。',
      detail: `${Math.round(totalBytes / 1024 / 1024)} MB -> ${Math.max(0, Math.round(bytesAfterPrune / 1024 / 1024))} MB`,
    })
  }

  private getMetadataPath(sourceHash: string): string {
    return join(this.getCacheRoot(), sourceHash, 'metadata.json')
  }
}

async function normalizeCadMetadata({
  metadataPath,
  inputPath,
  previewPath,
  previewFormat,
  sourceHash,
  diagnostics,
}: {
  metadataPath: string
  inputPath: string
  previewPath: string
  previewFormat: CadPreviewFormat
  sourceHash: string
  diagnostics: CadDiagnostic[]
}): Promise<CadModelMetadata> {
  const raw = (await readCadMetadata(metadataPath)) ?? null
  const metadata: CadModelMetadata = {
    inputPath,
    sourceHash,
    previewPath,
    previewFormat,
    bounds: raw?.bounds,
    unit: raw?.unit ?? 'unknown',
    unitConfidence: raw?.unitConfidence ?? 'unknown',
    generatedAt: new Date().toISOString(),
    generator: raw?.generator ?? 'FreeCAD',
    diagnostics: raw?.diagnostics ?? [],
  }
  if (!metadata.bounds) {
    diagnostics.push({
      level: 'warning',
      message: 'CAD 转换完成，但未提取到结构件包围盒。',
      detail: metadataPath,
    })
  }
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf-8')
  return metadata
}

async function readCadMetadata(metadataPath: string): Promise<CadModelMetadata | undefined> {
  try {
    const raw = JSON.parse(await readFile(metadataPath, 'utf-8')) as Partial<CadModelMetadata>
    if (!raw || typeof raw !== 'object') return undefined
    if (!raw.inputPath || !raw.generatedAt || !raw.generator) return undefined
    return {
      inputPath: raw.inputPath,
      sourceHash: raw.sourceHash,
      previewPath: raw.previewPath,
      previewFormat: raw.previewFormat,
      bounds: normalizeBounds(raw.bounds),
      unit: raw.unit ?? 'unknown',
      unitConfidence: raw.unitConfidence ?? 'unknown',
      generatedAt: raw.generatedAt,
      generator: raw.generator,
      diagnostics: Array.isArray(raw.diagnostics) ? raw.diagnostics : [],
    }
  } catch {
    return undefined
  }
}

function normalizeBounds(bounds: unknown): CadModelBounds | undefined {
  if (!bounds || typeof bounds !== 'object') return undefined
  const candidate = bounds as Partial<CadModelBounds>
  const min = normalizeVector(candidate.min)
  const max = normalizeVector(candidate.max)
  const size = normalizeVector(candidate.size)
  if (!min || !max || !size) return undefined
  return { min, max, size }
}

function normalizeVector(vector: unknown): { x: number; y: number; z: number } | undefined {
  if (!vector || typeof vector !== 'object') return undefined
  const candidate = vector as { x?: unknown; y?: unknown; z?: unknown }
  const x = Number(candidate.x)
  const y = Number(candidate.y)
  const z = Number(candidate.z)
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return undefined
  return { x, y, z }
}

async function calculateDirectoryStats(
  directoryPath: string,
): Promise<{ entryCount: number; bytes: number }> {
  const entries = await readCacheEntries(directoryPath)
  return {
    entryCount: entries.length,
    bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
  }
}

async function readCacheEntries(
  directoryPath: string,
): Promise<Array<{ path: string; bytes: number; mtimeMs: number }>> {
  const children = await readdir(directoryPath, { withFileTypes: true }).catch(() => [])
  const entries: Array<{ path: string; bytes: number; mtimeMs: number }> = []

  for (const child of children) {
    const childPath = join(directoryPath, child.name)
    const childStat = await stat(childPath).catch(() => null)
    if (!childStat) continue
    if (child.isDirectory()) {
      entries.push({
        path: childPath,
        bytes: await directorySize(childPath),
        mtimeMs: childStat.mtimeMs,
      })
    } else {
      entries.push({
        path: childPath,
        bytes: childStat.size,
        mtimeMs: childStat.mtimeMs,
      })
    }
  }

  return entries
}

async function directorySize(directoryPath: string): Promise<number> {
  const children = await readdir(directoryPath, { withFileTypes: true }).catch(() => [])
  let bytes = 0
  for (const child of children) {
    const childPath = join(directoryPath, child.name)
    if (child.isDirectory()) {
      bytes += await directorySize(childPath)
    } else {
      const childStat = await stat(childPath).catch(() => null)
      bytes += childStat?.size ?? 0
    }
  }
  return bytes
}
