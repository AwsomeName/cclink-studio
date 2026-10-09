export const CAD_SECTION_INSERT_OPERATION = 'section-insert' as const

export type CadModificationAxis = 'x' | 'y' | 'z'
export type CadModificationDirection = 'positive' | 'negative'
export type CadModificationFixedSide = 'min' | 'max'

export interface CadBoundsVector {
  x: number
  y: number
  z: number
}

export interface CadBounds {
  min: CadBoundsVector
  max: CadBoundsVector
  size: CadBoundsVector
}

export interface CadBopCheckResult {
  ok: boolean
  errorCount: number
  errorTypes: string[]
  parserComplete: boolean
  exceptionType?: string
  unparsedLineCount: number
}

export interface CadFixedRegionEvidence {
  sourceVolume: number
  outputVolume: number
  commonVolume: number
  sourceOnlyVolume: number
  outputOnlyVolume: number
  symmetricDifferenceVolume: number
  sourceSolidCount: number
  outputSolidCount: number
  sourceClosed: boolean
  outputClosed: boolean
  sourceValid: boolean
  outputValid: boolean
}

export interface CadShapeEvidence {
  objectCount: number
  solidCount: number
  faceCount: number
  volume: number
  closed: boolean
  valid: boolean
  basicCheckOk: boolean
  bounds: CadBounds
  bop: CadBopCheckResult
}

export interface CadModificationSnapshot {
  inputPath: string
  sourceHash: string
  operation: typeof CAD_SECTION_INSERT_OPERATION
  axis: CadModificationAxis
  direction: CadModificationDirection
  distanceMm: number
  splitPlane: number
  fixedSide: CadModificationFixedSide
  outputPath: string
  expectedSizeX: number
  expectedSizeY: number
  expectedSizeZ: number
}

export interface CadModificationPlanResult {
  kind: 'cad-modification-plan'
  success: true
  backend: { path: string; version?: string }
  snapshot: CadModificationSnapshot
  source: CadShapeEvidence
  split: {
    lowSolidCount: number
    highSolidCount: number
    interfaceFaceCount: number
    interfaceArea: number
  }
  warning: string
}

export interface CadModificationResult {
  kind: 'cad-modification-result'
  success: true
  operation: typeof CAD_SECTION_INSERT_OPERATION
  inputPath: string
  outputPath: string
  sourceHash: string
  axis: CadModificationAxis
  direction: CadModificationDirection
  distanceMm: number
  splitPlane: number
  fixedSide: CadModificationFixedSide
  source: CadShapeEvidence
  output: CadShapeEvidence & { fileSize: number }
  validation: {
    status: 'passed' | 'passed-with-baseline-warning'
    sourceHashUnchanged: boolean
    targetDimensionErrorMm: number
    fixedSideErrorMm: number
    fixedRegion: CadFixedRegionEvidence
    fixedRegionToleranceMm3: number
    nonTargetDimensionErrorMm: number
    bopPolicy: 'clean' | 'source-baseline-warning'
    warning?: string
  }
}

export interface CadModificationPlanRequest {
  inputPath: string
  operation: typeof CAD_SECTION_INSERT_OPERATION
  axis: CadModificationAxis
  direction: CadModificationDirection
  distanceMm: number
  splitPlane: number
  fixedSide: CadModificationFixedSide
  outputPath: string
}
