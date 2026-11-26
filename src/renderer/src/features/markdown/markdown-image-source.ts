import { decodeMarkdownPath, splitMarkdownDestinationSuffix } from '@shared/markdown-document'

/** Absolute local path (or unchanged network/data URL) for an image reference in a document. */
export function resolveMarkdownImageSource(source: string, documentPath?: string): string {
  if (!source || /^(?:https?:|data:|blob:)/i.test(source)) return source
  const { path } = splitMarkdownDestinationSuffix(source)
  if (path.startsWith('file://')) return decodeMarkdownPath(path.slice('file://'.length))
  const decodedPath = decodeMarkdownPath(path)
  if (decodedPath.startsWith('/')) return decodedPath
  if (!documentPath) return decodedPath
  const directory = documentPath.slice(0, Math.max(0, documentPath.lastIndexOf('/')))
  const parts = `${directory}/${decodedPath}`.split('/')
  const normalized: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') normalized.pop()
    else normalized.push(part)
  }
  return `/${normalized.join('/')}`
}
