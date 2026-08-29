import type { CadModelMetadata, CadModelPreviewMode } from './cad'
import { defineIpcCall } from './contract'

export type HardwareArtifactType =
  | 'schematic'
  | 'pcb-source'
  | 'gerber-package'
  | 'bom'
  | 'centroid'
  | 'drill'
  | 'assembly-drawing'
  | 'enclosure'
  | 'firmware'
  | 'datasheet'
  | 'unknown'

export interface HardwareArtifact {
  id: string
  type: HardwareArtifactType
  path: string
  displayName: string
  version?: string
  confidence: number
  metadata: Record<string, unknown>
}

export interface HardwareStructuralArtifact {
  artifactId: string
  path: string
  displayName: string
  extension: string
  previewMode: CadModelPreviewMode
  canPreview: boolean
  requiresBackend: boolean
  message: string
  sourceHash?: string
  cacheHit: boolean
  metadata?: CadModelMetadata
}

export type FpcShapeContextReadiness =
  | 'ready-for-review'
  | 'needs-outline-selection'
  | 'needs-structure-alignment'
  | 'needs-cad-backend'
  | 'blocked'

export interface FpcShapeOutlineCandidateSummary {
  id: string
  role: GerberOutlineRole
  bounds: GerberGeometryBounds
  closed: boolean
  areaMm2: number
  perimeterMm: number
  confidence: number
  reasons: string[]
}

export interface FpcShapeOutlineContext {
  packagePath: string
  entry: string
  unit: 'mm' | 'inch'
  bounds: GerberGeometryBounds | null
  outlineCandidates: FpcShapeOutlineCandidateSummary[]
  warnings: string[]
  truncated: boolean
}

export interface FpcShapeContext {
  workspacePath: string
  createdAt: string
  readiness: FpcShapeContextReadiness
  gerberPackage?: HardwareArtifact
  outline?: FpcShapeOutlineContext
  structuralArtifacts: HardwareStructuralArtifact[]
  risks: HardwareRisk[]
  questions: string[]
  nextActions: string[]
}

export interface HardwareProjectSummary {
  workspacePath: string
  projectName: string
  artifacts: HardwareArtifact[]
  structuralArtifacts: HardwareStructuralArtifact[]
  counts: Record<HardwareArtifactType, number>
  hasHardwareSignals: boolean
  sourceEditable: boolean
  primaryGerberPackage?: HardwareArtifact
  primaryBom?: HardwareArtifact
  primaryCentroid?: HardwareArtifact
  risks: HardwareRisk[]
}

export type HardwareReportConclusion = 'ready' | 'quote-only' | 'blocked'
export type HardwareRiskLevel = 'info' | 'warning' | 'blocking'

export interface HardwareRisk {
  level: HardwareRiskLevel
  title: string
  detail: string
  artifactIds: string[]
  nextAction: string
}

export interface HardwareTablePreview {
  filePath: string
  headers: string[]
  rows: Record<string, string>[]
  referenceDesignators: string[]
  unsupported?: boolean
  warning?: string
}

export type GerberLayerKind =
  | 'outline'
  | 'copper'
  | 'solder-mask'
  | 'silkscreen'
  | 'drill'
  | 'mechanical'
  | 'unknown'

export interface GerberLayerCandidate {
  entry: string
  kind: GerberLayerKind
  confidence: number
  reasons: string[]
  gerberLike: boolean
  byteSize: number
}

export interface GerberPackageInspection {
  filePath: string
  entries: string[]
  layers: GerberLayerCandidate[]
  layerHints: {
    copper: string[]
    solderMask: string[]
    silkscreen: string[]
    drill: string[]
    outline: string[]
    other: string[]
  }
}

export interface GerberLayerPreview {
  packagePath: string
  entry: string
  content: string
  byteSize: number
  truncated: boolean
}

export interface GerberGeometryPoint {
  x: number
  y: number
}

export interface GerberGeometryBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
  width: number
  height: number
}

export interface GerberGeometrySegment {
  id: string
  kind: 'line' | 'arc'
  start: GerberGeometryPoint
  end: GerberGeometryPoint
  points: GerberGeometryPoint[]
  source: string
}

export type GerberOutlineRole = 'outer' | 'hole' | 'slot' | 'auxiliary' | 'unknown'

export interface GerberOutlineCandidate {
  id: string
  role: GerberOutlineRole
  parentId?: string
  segmentIds: string[]
  points: GerberGeometryPoint[]
  bounds: GerberGeometryBounds
  closed: boolean
  areaMm2: number
  perimeterMm: number
  confidence: number
  reasons: string[]
}

export interface GerberLayerGeometry {
  packagePath: string
  entry: string
  unit: 'mm' | 'inch'
  bounds: GerberGeometryBounds | null
  segments: GerberGeometrySegment[]
  outlineCandidates: GerberOutlineCandidate[]
  warnings: string[]
  truncated: boolean
}

export interface ProductionPackageReport {
  id: string
  workspacePath: string
  createdAt: string
  conclusion: HardwareReportConclusion
  risks: HardwareRisk[]
  artifacts: HardwareArtifact[]
  structuralArtifacts: HardwareStructuralArtifact[]
  bom?: HardwareTablePreview
  centroid?: HardwareTablePreview
  gerber?: GerberPackageInspection
  suggestedJlcParams: Record<string, unknown>
}

export interface HardwareReportMarkdownResult {
  filePath: string
  report: ProductionPackageReport
}

export interface HardwareApiContract {
  scanWorkspace: (workspacePath: string) => Promise<HardwareProjectSummary>
  inspectProductionPackage: (workspacePath: string) => Promise<ProductionPackageReport>
  prepareFpcShapeContext: (workspacePath: string) => Promise<FpcShapeContext>
  readGerberLayerPreview: (
    workspacePath: string,
    packagePath: string,
    entry: string,
  ) => Promise<GerberLayerPreview>
  readGerberLayerGeometry: (
    workspacePath: string,
    packagePath: string,
    entry: string,
  ) => Promise<GerberLayerGeometry>
  writeProductionReportMarkdown: (workspacePath: string) => Promise<HardwareReportMarkdownResult>
}

export const hardwareIpc = {
  scanWorkspace: defineIpcCall<[workspacePath: string], HardwareProjectSummary>(
    'hardware:scanWorkspace',
  ),
  inspectProductionPackage: defineIpcCall<[workspacePath: string], ProductionPackageReport>(
    'hardware:inspectProductionPackage',
  ),
  prepareFpcShapeContext: defineIpcCall<[workspacePath: string], FpcShapeContext>(
    'hardware:prepareFpcShapeContext',
  ),
  readGerberLayerPreview: defineIpcCall<
    [workspacePath: string, packagePath: string, entry: string],
    GerberLayerPreview
  >('hardware:readGerberLayerPreview'),
  readGerberLayerGeometry: defineIpcCall<
    [workspacePath: string, packagePath: string, entry: string],
    GerberLayerGeometry
  >('hardware:readGerberLayerGeometry'),
  writeProductionReportMarkdown: defineIpcCall<
    [workspacePath: string],
    HardwareReportMarkdownResult
  >('hardware:writeProductionReportMarkdown'),
} as const
