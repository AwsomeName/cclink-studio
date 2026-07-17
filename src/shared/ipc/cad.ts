import type { CadBackend } from '../settings-constants'

export type CadPreviewFormat = 'stl' | 'obj' | 'glb'

export type CadModelPreviewMode = 'native-mesh' | 'cad-conversion' | 'unsupported'

export type CadModelUnit = 'mm' | 'model-units' | 'unknown'

export type CadModelUnitConfidence = 'cad-backend' | 'mesh-derived' | 'unknown'

export type CadErrorCode =
  | 'backend-not-configured'
  | 'backend-not-found'
  | 'backend-not-implemented'
  | 'backend-version-unsupported'
  | 'conversion-timeout'
  | 'conversion-empty-output'
  | 'source-file-invalid'
  | 'reverse-conversion-unsupported'
  | 'unsupported-format'
  | 'unknown'

export interface CadConversionError {
  code: CadErrorCode
  message: string
  detail?: string
  retryable: boolean
}

export interface CadDiagnostic {
  level: 'info' | 'warning' | 'error'
  message: string
  detail?: string
}

export interface CadBackendStatus {
  kind: CadBackend
  available: boolean
  version?: string
  path?: string
  source: 'disabled' | 'configured' | 'known-path' | 'shell-path' | 'managed' | 'not-found'
  error?: CadConversionError
}

export interface CadConvertRequest {
  inputPath: string
  targetFormat?: CadPreviewFormat
  force?: boolean
}

export interface CadVector3 {
  x: number
  y: number
  z: number
}

export interface CadModelBounds {
  min: CadVector3
  max: CadVector3
  size: CadVector3
}

export interface CadModelMetadata {
  inputPath: string
  sourceHash?: string
  previewPath?: string
  previewFormat?: CadPreviewFormat
  bounds?: CadModelBounds
  unit: CadModelUnit
  unitConfidence: CadModelUnitConfidence
  generatedAt: string
  generator: string
  diagnostics: CadDiagnostic[]
}

export interface CadConvertResult {
  success: boolean
  previewPath?: string
  format?: CadPreviewFormat
  sourceHash?: string
  cached?: boolean
  metadata?: CadModelMetadata
  diagnostics: CadDiagnostic[]
  error?: CadConversionError
}

export interface CadModelSupport {
  inputPath: string
  extension: string
  mode: CadModelPreviewMode
  canPreview: boolean
  requiresBackend: boolean
  preferredFormat?: CadPreviewFormat
  backend?: CadBackendStatus
  message: string
}

export interface CadCacheStatus {
  enabled: boolean
  limitMb: number
  cachePath: string
  entryCount: number
  bytes: number
}

export interface CadInspectModelResult {
  support: CadModelSupport
  sourceHash?: string
  cacheHit: boolean
  metadata?: CadModelMetadata
  diagnostics: CadDiagnostic[]
}

export interface CadApiContract {
  getBackendStatus(): Promise<CadBackendStatus>
  getModelSupport(inputPath: string): Promise<CadModelSupport>
  inspectModel(inputPath: string): Promise<CadInspectModelResult>
  getCacheStatus(): Promise<CadCacheStatus>
  clearCache(): Promise<CadCacheStatus>
  convertModel(request: CadConvertRequest): Promise<CadConvertResult>
}
