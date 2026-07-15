import type { TabType } from '../types'
import { isModelFileExtension as isSharedModelFileExtension } from '@shared/file-types'

export function isModelFileExtension(extension?: string): boolean {
  return isSharedModelFileExtension(extension)
}

export function getTabTypeForFile(extension?: string): TabType {
  return isModelFileExtension(extension) ? 'model' : 'editor'
}

export function getModelFileIcon(extension?: string): string {
  switch ((extension ?? '').toLowerCase()) {
    case '.fbx':
      return '🧊'
    case '.glb':
    case '.gltf':
      return '⬢'
    case '.stl':
      return '△'
    case '.3mf':
      return '▣'
    case '.step':
    case '.stp':
      return '⚙'
    default:
      return '📦'
  }
}
