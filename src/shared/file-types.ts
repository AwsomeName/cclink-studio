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

export function isAltiumFileExtension(extension?: string): boolean {
  return ['.schdoc', '.pcbdoc', '.prjpcb'].includes((extension ?? '').toLowerCase())
}

export const BINARY_FILE_EXTENSIONS = [
  '.schdoc',
  '.pcbdoc',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.bmp',
  '.svg',
  '.gif',
  '.ico',
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.odt',
  '.ods',
  '.odp',
  '.pages',
  '.numbers',
  '.key',
  '.mp4',
  '.mov',
  '.webm',
  '.m4v',
  '.mp3',
  '.wav',
  '.m4a',
  '.aac',
  '.flac',
  '.ogg',
  '.opus',
  '.zip',
  '.tar',
  '.gz',
  '.tgz',
  '.7z',
  '.rar',
  '.exe',
  '.dmg',
  '.pkg',
  '.app',
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

export const IMAGE_FILE_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.bmp',
  '.svg',
  '.gif',
  '.ico',
] as const

const IMAGE_FILE_EXTENSION_SET = new Set<string>(IMAGE_FILE_EXTENSIONS)

export const WORD_FILE_EXTENSIONS = ['.doc', '.docx'] as const

const WORD_FILE_EXTENSION_SET = new Set<string>(WORD_FILE_EXTENSIONS)

export const OFFICE_FILE_EXTENSIONS = [
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.odt',
  '.ods',
  '.odp',
] as const

const OFFICE_FILE_EXTENSION_SET = new Set<string>(OFFICE_FILE_EXTENSIONS)

export const VIDEO_FILE_EXTENSIONS = ['.mp4', '.mov', '.webm', '.m4v'] as const

const VIDEO_FILE_EXTENSION_SET = new Set<string>(VIDEO_FILE_EXTENSIONS)

export const AUDIO_FILE_EXTENSIONS = [
  '.mp3',
  '.wav',
  '.m4a',
  '.aac',
  '.flac',
  '.ogg',
  '.opus',
] as const

const AUDIO_FILE_EXTENSION_SET = new Set<string>(AUDIO_FILE_EXTENSIONS)

export const NATIVE_MEDIA_PREVIEW_FILE_EXTENSIONS = [
  ...VIDEO_FILE_EXTENSIONS,
  '.mp3',
  '.wav',
  '.m4a',
  '.aac',
  '.ogg',
  '.opus',
] as const

const NATIVE_MEDIA_PREVIEW_FILE_EXTENSION_SET = new Set<string>(
  NATIVE_MEDIA_PREVIEW_FILE_EXTENSIONS,
)

export const ARCHIVE_FILE_EXTENSIONS = ['.zip', '.tar', '.gz', '.tgz', '.7z', '.rar'] as const

const ARCHIVE_FILE_EXTENSION_SET = new Set<string>(ARCHIVE_FILE_EXTENSIONS)

export const APPLE_IWORK_FILE_EXTENSIONS = ['.pages', '.numbers', '.key'] as const

const APPLE_IWORK_FILE_EXTENSION_SET = new Set<string>(APPLE_IWORK_FILE_EXTENSIONS)

export function isModelFileExtension(extension?: string): boolean {
  return MODEL_FILE_EXTENSION_SET.has((extension ?? '').toLowerCase())
}

export function isBinaryFileExtension(extension?: string): boolean {
  return BINARY_FILE_EXTENSION_SET.has((extension ?? '').toLowerCase())
}

export function isImageFileExtension(extension?: string): boolean {
  return IMAGE_FILE_EXTENSION_SET.has((extension ?? '').toLowerCase())
}

export function isWordFileExtension(extension?: string): boolean {
  return WORD_FILE_EXTENSION_SET.has((extension ?? '').toLowerCase())
}

export function isOfficeFileExtension(extension?: string): boolean {
  return OFFICE_FILE_EXTENSION_SET.has((extension ?? '').toLowerCase())
}

export function isVideoFileExtension(extension?: string): boolean {
  return VIDEO_FILE_EXTENSION_SET.has((extension ?? '').toLowerCase())
}

export function isAudioFileExtension(extension?: string): boolean {
  return AUDIO_FILE_EXTENSION_SET.has((extension ?? '').toLowerCase())
}

export function isMediaFileExtension(extension?: string): boolean {
  return isVideoFileExtension(extension) || isAudioFileExtension(extension)
}

export function isNativeMediaPreviewFileExtension(extension?: string): boolean {
  return NATIVE_MEDIA_PREVIEW_FILE_EXTENSION_SET.has((extension ?? '').toLowerCase())
}

export function isArchiveFileExtension(extension?: string): boolean {
  return ARCHIVE_FILE_EXTENSION_SET.has((extension ?? '').toLowerCase())
}

export function isAppleIWorkFileExtension(extension?: string): boolean {
  return APPLE_IWORK_FILE_EXTENSION_SET.has((extension ?? '').toLowerCase())
}

export function imageMimeTypeForExtension(extension?: string): string | null {
  switch ((extension ?? '').toLowerCase()) {
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    case '.bmp':
      return 'image/bmp'
    case '.svg':
      return 'image/svg+xml'
    case '.gif':
      return 'image/gif'
    case '.ico':
      return 'image/x-icon'
    default:
      return null
  }
}

export function mediaMimeTypeForExtension(extension?: string): string | null {
  switch ((extension ?? '').toLowerCase()) {
    case '.mp4':
    case '.m4v':
      return 'video/mp4'
    case '.mov':
      return 'video/quicktime'
    case '.webm':
      return 'video/webm'
    case '.mp3':
      return 'audio/mpeg'
    case '.wav':
      return 'audio/wav'
    case '.m4a':
      return 'audio/mp4'
    case '.aac':
      return 'audio/aac'
    case '.flac':
      return 'audio/flac'
    case '.ogg':
      return 'audio/ogg'
    case '.opus':
      return 'audio/opus'
    default:
      return null
  }
}
