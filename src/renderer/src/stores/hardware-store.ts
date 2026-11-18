import { create } from 'zustand'
import type {
  FpcShapeContext,
  HardwareProjectSummary,
  HardwareReportMarkdownResult,
  ProductionPackageReport,
} from '@shared/ipc/hardware'

interface HardwareState {
  workspacePath: string | null
  summary: HardwareProjectSummary | null
  report: ProductionPackageReport | null
  fpcShapeContext: FpcShapeContext | null
  lastReportFilePath: string | null
  loading: boolean
  inspecting: boolean
  preparingFpcShapeContext: boolean
  savingReport: boolean
  error: string | null
  scanWorkspace: (workspacePath: string) => Promise<void>
  inspectProductionPackage: (workspacePath: string) => Promise<void>
  prepareFpcShapeContext: (workspacePath: string) => Promise<FpcShapeContext | null>
  writeProductionReportMarkdown: (
    workspacePath: string,
  ) => Promise<HardwareReportMarkdownResult | null>
  clear: () => void
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

let requestGeneration = 0

export const useHardwareStore = create<HardwareState>((set) => ({
  workspacePath: null,
  summary: null,
  report: null,
  fpcShapeContext: null,
  lastReportFilePath: null,
  loading: false,
  inspecting: false,
  preparingFpcShapeContext: false,
  savingReport: false,
  error: null,

  scanWorkspace: async (workspacePath) => {
    const generation = ++requestGeneration
    set({ workspacePath, loading: true, error: null })
    try {
      const summary = await window.cclinkStudio.hardware.scanWorkspace(workspacePath)
      if (generation !== requestGeneration) return
      set({
        summary,
        loading: false,
        report: null,
        fpcShapeContext: null,
        lastReportFilePath: null,
      })
    } catch (error) {
      if (generation !== requestGeneration) return
      set({ error: describeError(error), loading: false })
    }
  },

  inspectProductionPackage: async (workspacePath) => {
    const generation = ++requestGeneration
    set({ workspacePath, inspecting: true, error: null })
    try {
      const report = await window.cclinkStudio.hardware.inspectProductionPackage(workspacePath)
      if (generation !== requestGeneration) return
      set({
        report,
        summary: { ...reportToSummaryFallback(workspacePath, report) },
        inspecting: false,
      })
    } catch (error) {
      if (generation !== requestGeneration) return
      set({ error: describeError(error), inspecting: false })
    }
  },

  prepareFpcShapeContext: async (workspacePath) => {
    const generation = ++requestGeneration
    set({ workspacePath, preparingFpcShapeContext: true, error: null })
    try {
      const fpcShapeContext =
        await window.cclinkStudio.hardware.prepareFpcShapeContext(workspacePath)
      if (generation !== requestGeneration) return null
      set({ fpcShapeContext, preparingFpcShapeContext: false })
      return fpcShapeContext
    } catch (error) {
      if (generation !== requestGeneration) return null
      set({ error: describeError(error), preparingFpcShapeContext: false })
      return null
    }
  },

  writeProductionReportMarkdown: async (workspacePath) => {
    const generation = ++requestGeneration
    set({ workspacePath, savingReport: true, error: null })
    try {
      const result = await window.cclinkStudio.hardware.writeProductionReportMarkdown(workspacePath)
      if (generation !== requestGeneration) return null
      set({
        report: result.report,
        summary: { ...reportToSummaryFallback(workspacePath, result.report) },
        fpcShapeContext: null,
        lastReportFilePath: result.filePath,
        savingReport: false,
      })
      return result
    } catch (error) {
      if (generation !== requestGeneration) return null
      set({ error: describeError(error), savingReport: false })
      return null
    }
  },

  clear: () => {
    requestGeneration++
    set({
      workspacePath: null,
      summary: null,
      report: null,
      fpcShapeContext: null,
      lastReportFilePath: null,
      loading: false,
      inspecting: false,
      preparingFpcShapeContext: false,
      savingReport: false,
      error: null,
    })
  },
}))

function reportToSummaryFallback(
  workspacePath: string,
  report: ProductionPackageReport,
): HardwareProjectSummary {
  const existing = useHardwareStore.getState().summary
  if (existing?.workspacePath === workspacePath) {
    return {
      ...existing,
      artifacts: report.artifacts,
      structuralArtifacts: report.structuralArtifacts,
      risks: report.risks,
    }
  }
  return {
    workspacePath,
    projectName: workspacePath.split('/').filter(Boolean).pop() ?? workspacePath,
    artifacts: report.artifacts,
    structuralArtifacts: report.structuralArtifacts,
    counts: report.artifacts.reduce(
      (acc, artifact) => ({ ...acc, [artifact.type]: (acc[artifact.type] ?? 0) + 1 }),
      {
        schematic: 0,
        'pcb-source': 0,
        'gerber-package': 0,
        bom: 0,
        centroid: 0,
        drill: 0,
        'assembly-drawing': 0,
        enclosure: 0,
        firmware: 0,
        datasheet: 0,
        unknown: 0,
      } as HardwareProjectSummary['counts'],
    ),
    hasHardwareSignals: report.artifacts.length > 0,
    sourceEditable: report.artifacts.some((artifact) => artifact.type === 'pcb-source'),
    primaryGerberPackage: report.artifacts.find((artifact) => artifact.type === 'gerber-package'),
    primaryBom: report.artifacts.find((artifact) => artifact.type === 'bom'),
    primaryCentroid: report.artifacts.find((artifact) => artifact.type === 'centroid'),
    risks: report.risks,
  }
}
