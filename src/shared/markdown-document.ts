export const CCLINK_MARKDOWN_DOCUMENT_FORMAT = 'cclink-markdown-document'
export const CCLINK_MARKDOWN_DOCUMENT_VERSION = 1

export interface CclinkMarkdownDocumentMetadata {
  version: number
  resources: string
}

export interface MarkdownDestination {
  value: string
  start: number
  end: number
  image: boolean
}

const METADATA_LINE =
  /^\uFEFF?<!--\s*cclink-document:\s*(\{[^\r\n]*\})\s*-->\s*(?:\r?\n(?:\r?\n)?)?/
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})/

export function isMarkdownDocumentPath(filePath: string): boolean {
  return /\.(?:md|markdown)$/i.test(filePath)
}

export function markdownDocumentBaseName(filePath: string): string {
  const fileName = filePath.replace(/\\/g, '/').split('/').pop() ?? 'document.md'
  return fileName.replace(/\.(?:md|markdown)$/i, '') || 'document'
}

export function markdownAssetDirectoryName(filePath: string): string {
  return `${markdownDocumentBaseName(filePath)}.assets`
}

export function markdownResourceManifestReference(filePath: string): string {
  return `${markdownAssetDirectoryName(filePath)}/manifest.json`
}

export function parseCclinkMarkdownMetadata(source: string): {
  metadata: CclinkMarkdownDocumentMetadata
  raw: string
} | null {
  const match = METADATA_LINE.exec(source)
  if (!match) return null
  try {
    const value = JSON.parse(match[1]) as Partial<CclinkMarkdownDocumentMetadata>
    if (
      value.version !== CCLINK_MARKDOWN_DOCUMENT_VERSION ||
      typeof value.resources !== 'string' ||
      !isSafeRelativeResourceReference(value.resources)
    ) {
      return null
    }
    return {
      metadata: { version: value.version, resources: value.resources },
      raw: match[0],
    }
  } catch {
    return null
  }
}

export function stripCclinkMarkdownMetadata(source: string): string {
  const parsed = parseCclinkMarkdownMetadata(source)
  return parsed ? source.slice(parsed.raw.length) : source
}

export function cclinkMarkdownMetadataLineOffset(source: string): number {
  const parsed = parseCclinkMarkdownMetadata(source)
  return parsed ? (parsed.raw.match(/\n/g)?.length ?? 0) : 0
}

export function withCclinkMarkdownMetadata(source: string, documentPath: string): string {
  const body = stripCclinkMarkdownMetadata(source).replace(/^\s*\n/, '')
  const metadata: CclinkMarkdownDocumentMetadata = {
    version: CCLINK_MARKDOWN_DOCUMENT_VERSION,
    resources: markdownResourceManifestReference(documentPath),
  }
  return `<!-- cclink-document: ${JSON.stringify(metadata)} -->\n\n${body}`
}

export function collectMarkdownDestinations(source: string): MarkdownDestination[] {
  const masked = maskMarkdownCode(stripCclinkMarkdownMetadata(source))
  const bodyOffset = source.length - stripCclinkMarkdownMetadata(source).length
  const destinations: MarkdownDestination[] = []
  const inline = /(!?\[[^\]\n]*]\(\s*)(?:<([^>\n]+)>|([^\s)\n]+))/g
  const definitions = /(^|\n)( {0,3}\[[^\]\n]+]:\s*)(?:<([^>\n]+)>|([^\s\n]+))/g

  for (const match of masked.matchAll(inline)) {
    const value = match[2] ?? match[3] ?? ''
    const wrapped = match[2] !== undefined
    const localStart = (match.index ?? 0) + match[1].length + (wrapped ? 1 : 0)
    destinations.push({
      value: source.slice(bodyOffset + localStart, bodyOffset + localStart + value.length),
      start: bodyOffset + localStart,
      end: bodyOffset + localStart + value.length,
      image: match[1].startsWith('!'),
    })
  }

  for (const match of masked.matchAll(definitions)) {
    const value = match[3] ?? match[4] ?? ''
    const wrapped = match[3] !== undefined
    const localStart = (match.index ?? 0) + match[1].length + match[2].length + (wrapped ? 1 : 0)
    destinations.push({
      value: source.slice(bodyOffset + localStart, bodyOffset + localStart + value.length),
      start: bodyOffset + localStart,
      end: bodyOffset + localStart + value.length,
      image: false,
    })
  }

  return destinations.sort((left, right) => left.start - right.start)
}

export function rewriteMarkdownDestinations(
  source: string,
  rewrite: (destination: string) => string,
): string {
  const replacements = collectMarkdownDestinations(source)
    .map((destination) => ({ ...destination, next: rewrite(destination.value) }))
    .filter((destination) => destination.next !== destination.value)
    .sort((left, right) => right.start - left.start)
  let result = source
  for (const replacement of replacements) {
    result = `${result.slice(0, replacement.start)}${replacement.next}${result.slice(replacement.end)}`
  }
  return result
}

export function isExternalMarkdownDestination(destination: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(destination)
}

export function splitMarkdownDestinationSuffix(destination: string): {
  path: string
  suffix: string
} {
  const match = /^([^?#]*)([?#].*)?$/.exec(destination)
  return { path: match?.[1] ?? destination, suffix: match?.[2] ?? '' }
}

function isSafeRelativeResourceReference(reference: string): boolean {
  const normalized = reference.replace(/\\/g, '/')
  return (
    normalized.length > 0 &&
    !normalized.startsWith('/') &&
    !normalized.split('/').includes('..') &&
    normalized.endsWith('/manifest.json')
  )
}

function maskMarkdownCode(source: string): string {
  const lines = source.split('\n')
  let fence: { marker: string; length: number } | null = null
  const maskedLines = lines.map((line) => {
    const fenceMatch = FENCE_LINE.exec(line)
    if (fence) {
      const closing = new RegExp(`^ {0,3}${escapeRegExp(fence.marker)}{${fence.length},}\\s*$`)
      if (closing.test(line)) fence = null
      return ' '.repeat(line.length)
    }
    if (fenceMatch) {
      fence = { marker: fenceMatch[1][0], length: fenceMatch[1].length }
      return ' '.repeat(line.length)
    }
    return maskInlineCode(line)
  })
  return maskedLines.join('\n')
}

function maskInlineCode(line: string): string {
  return line.replace(/(`+)(.*?)\1/g, (match) => ' '.repeat(match.length))
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
