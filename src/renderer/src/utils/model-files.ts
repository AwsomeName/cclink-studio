import type { TabType } from '../types'
import {
  isAltiumFileExtension,
  isAppleIWorkFileExtension,
  isArchiveFileExtension,
  isImageFileExtension,
  isMediaFileExtension,
  isModelFileExtension as isSharedModelFileExtension,
  isOfficeFileExtension,
} from '@shared/file-types'

export function isModelFileExtension(extension?: string): boolean {
  return isSharedModelFileExtension(extension)
}

export function getTabTypeForFile(extension?: string): TabType {
  const normalizedExtension = (extension ?? '').toLowerCase()
  if (
    isAltiumFileExtension(extension) ||
    isImageFileExtension(extension) ||
    normalizedExtension === '.pdf' ||
    isOfficeFileExtension(extension) ||
    isMediaFileExtension(extension) ||
    isArchiveFileExtension(extension) ||
    isAppleIWorkFileExtension(extension)
  ) {
    return 'file-preview'
  }
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
