/** Read-only projections. Source bytes and parser objects never cross into the renderer. */
export interface AltiumRenderOptions {
  altiumLayer?: string
  altiumShowHidden?: boolean
}

export interface AltiumDrawingPreview {
  kind: 'altium-drawing'
  documentKind: 'schematic' | 'pcb'
  fileName: string
  path: string
  content: string
  layers: string[]
  selectedLayer: string | null
  showHidden: boolean
  counts: Array<{ label: string; value: number }>
  warnings: string[]
}

export interface AltiumProjectPreview {
  kind: 'altium-project'
  fileName: string
  path: string
  documents: Array<{
    name: string
    path?: string
    status: 'ready' | 'unavailable' | 'unsupported'
    reason?: string
  }>
}

export type AltiumPreview = AltiumDrawingPreview | AltiumProjectPreview

export const ALTIUM_MAX_FILE_BYTES = 32 * 1024 * 1024
