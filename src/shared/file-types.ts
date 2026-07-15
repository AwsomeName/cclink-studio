export const MODEL_FILE_EXTENSIONS = [
  '.fbx',
  '.glb',
  '.gltf',
  '.stl',
  '.3mf',
  '.step',
  '.stp',
] as const

const MODEL_FILE_EXTENSION_SET = new Set<string>(MODEL_FILE_EXTENSIONS)

export const BINARY_FILE_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.pdf',
  '.zip',
  '.exe',
  '.dmg',
  '.fbx',
  '.glb',
  '.gltf',
  '.obj',
  '.mtl',
  '.stl',
  '.3mf',
  '.step',
  '.stp',
] as const

const BINARY_FILE_EXTENSION_SET = new Set<string>(BINARY_FILE_EXTENSIONS)

export function isModelFileExtension(extension?: string): boolean {
  return MODEL_FILE_EXTENSION_SET.has((extension ?? '').toLowerCase())
}

export function isBinaryFileExtension(extension?: string): boolean {
  return BINARY_FILE_EXTENSION_SET.has((extension ?? '').toLowerCase())
}
