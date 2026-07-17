export type MarkdownBlockKind =
  | 'frontmatter'
  | 'mermaid'
  | 'fence'
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'blockquote'
  | 'table'
  | 'html'
  | 'horizontal-rule'

export interface MarkdownSourceBlock {
  kind: MarkdownBlockKind
  startLine: number
  endLine: number
  raw: string
  language?: string
}

export interface MarkdownDiagnostic {
  code:
    | 'unsupported-frontmatter'
    | 'unsupported-html'
    | 'unsupported-mdx'
    | 'unsupported-math'
    | 'unsupported-footnote'
    | 'unsupported-directive'
    | 'catastrophic-roundtrip'
    | 'structural-roundtrip-mismatch'
    | 'source-map-mismatch'
  severity: 'info' | 'warning' | 'error'
  message: string
  startLine?: number
  endLine?: number
}

export interface MarkdownAnalysis {
  blocks: MarkdownSourceBlock[]
  diagnostics: MarkdownDiagnostic[]
  safeToEdit: boolean
  safeToSave: boolean
}

export interface MarkdownSourceRange {
  startLine: number
  endLine: number
  startColumn: number
  endColumn: number
  selectedText: string
  sourceSnapshot: string
}

const FRONTMATTER_DELIMITER = /^---\s*$/
const FENCE_START = /^ {0,3}(`{3,}|~{3,})\s*([^`]*)$/
const HEADING = /^ {0,3}#{1,6}\s+/
const HORIZONTAL_RULE = /^ {0,3}((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/
const LIST_ITEM = /^(\s*)([-+*]|\d+[.)])\s+/
const TABLE_DELIMITER = /^\s*\|?(\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/
const BLOCKQUOTE = /^ {0,3}>/
const BLOCK_HTML = /^\s*<(?:!--|\/?[A-Za-z][A-Za-z0-9:-]*(?:\s|>|\/))/
const AUTOLINK_START = /^\s*<[A-Za-z][A-Za-z0-9+.-]{1,31}:[^ <>\n]*>/
const RAW_HTML = /(?<!\\)(?:<!--[\s\S]*?-->|<\/?[A-Za-z][A-Za-z0-9:-]*(?:\s[^<>]*?)?\s*\/?>)/m
const MDX_IMPORT_EXPORT = /^\s*(?:import|export)\s+.+(?:from\s+)?['"][^'"]+['"]/m
const MDX_COMPONENT = /^\s*<[A-Z][A-Za-z0-9.]*(?:\s|\/?>)/m
const MATH_BLOCK = /^\s*\$\$\s*$/m
const FOOTNOTE = /^\s*\[\^[^\]]+\]:/m
const DIRECTIVE = /^\s*:::{1,}\s*[A-Za-z]/m

export function normalizeMarkdownSource(source: string): string {
  return source.replace(/\r\n?/g, '\n')
}

export function scanMarkdownBlocks(source: string): MarkdownSourceBlock[] {
  const normalized = normalizeMarkdownSource(source)
  const lines = normalized.split('\n')
  const blocks: MarkdownSourceBlock[] = []
  let index = 0

  if (FRONTMATTER_DELIMITER.test(lines[0] ?? '')) {
    const end = findLine(lines, 1, (line) => FRONTMATTER_DELIMITER.test(line))
    if (end >= 1) {
      blocks.push(makeBlock('frontmatter', lines, 0, end))
      index = end + 1
    }
  }

  while (index < lines.length) {
    if (isBlank(lines[index])) {
      index += 1
      continue
    }

    const fence = FENCE_START.exec(lines[index])
    if (fence) {
      const marker = fence[1]
      const language = fence[2].trim().split(/\s+/)[0]?.toLowerCase() || undefined
      const closing = new RegExp(`^ {0,3}${escapeRegExp(marker[0])}{${marker.length},}\\s*$`)
      const end = findLine(lines, index + 1, (line) => closing.test(line))
      const last = end >= 0 ? end : lines.length - 1
      blocks.push(
        makeBlock(language === 'mermaid' ? 'mermaid' : 'fence', lines, index, last, language),
      )
      index = last + 1
      continue
    }

    if (HEADING.test(lines[index])) {
      blocks.push(makeBlock('heading', lines, index, index))
      index += 1
      continue
    }

    if (HORIZONTAL_RULE.test(lines[index])) {
      blocks.push(makeBlock('horizontal-rule', lines, index, index))
      index += 1
      continue
    }

    if (BLOCKQUOTE.test(lines[index])) {
      const end = consumeWhile(lines, index + 1, (line) => isBlank(line) || BLOCKQUOTE.test(line))
      const trimmedEnd = trimTrailingBlankLines(lines, index + 1, end)
      blocks.push(makeBlock('blockquote', lines, index, trimmedEnd - 1))
      index = trimmedEnd
      continue
    }

    if (LIST_ITEM.test(lines[index])) {
      const end = consumeList(lines, index)
      blocks.push(makeBlock('list', lines, index, end - 1))
      index = end
      continue
    }

    if (
      lines[index].includes('|') &&
      index + 1 < lines.length &&
      TABLE_DELIMITER.test(lines[index + 1])
    ) {
      const end = consumeWhile(lines, index + 2, (line) => !isBlank(line) && line.includes('|'))
      blocks.push(makeBlock('table', lines, index, end - 1))
      index = end
      continue
    }

    if (isBlockHtml(lines[index])) {
      const end = consumeWhile(lines, index + 1, (line) => !isBlank(line))
      blocks.push(makeBlock('html', lines, index, end - 1))
      index = end
      continue
    }

    const end = consumeWhile(lines, index + 1, (line, lineIndex) => {
      if (isBlank(line)) return false
      return !startsNewBlock(lines, lineIndex)
    })
    blocks.push(makeBlock('paragraph', lines, index, end - 1))
    index = end
  }

  return blocks
}

export function analyzeMarkdown(source: string, serialized?: string): MarkdownAnalysis {
  const normalized = normalizeMarkdownSource(source)
  const blocks = scanMarkdownBlocks(normalized)
  const diagnostics: MarkdownDiagnostic[] = []
  const proseSource = maskInlineCode(maskFencedBlocks(normalized, blocks))

  const frontmatter = blocks.find((block) => block.kind === 'frontmatter')
  if (frontmatter) {
    diagnostics.push({
      code: 'unsupported-frontmatter',
      severity: 'error',
      message: '当前版本不支持编辑包含 Frontmatter 的 Markdown 文件。',
      startLine: frontmatter.startLine,
      endLine: frontmatter.endLine,
    })
  }
  const htmlMatch = RAW_HTML.exec(proseSource)
  if (htmlMatch) {
    const htmlLine = proseSource.slice(0, htmlMatch.index).split('\n').length
    diagnostics.push({
      code: 'unsupported-html',
      severity: 'error',
      message: '当前版本不支持编辑包含原始 HTML 的 Markdown 文件。',
      startLine: htmlLine,
      endLine: htmlLine + htmlMatch[0].split('\n').length - 1,
    })
  }
  if (MDX_IMPORT_EXPORT.test(proseSource) || MDX_COMPONENT.test(proseSource)) {
    diagnostics.push({
      code: 'unsupported-mdx',
      severity: 'error',
      message: '当前版本不支持编辑 MDX/JSX 文件。',
    })
  }
  if (MATH_BLOCK.test(proseSource) || /(^|[^\\])\$[^$\n]+\$/m.test(proseSource)) {
    diagnostics.push({
      code: 'unsupported-math',
      severity: 'error',
      message: '当前版本不支持编辑包含数学公式的 Markdown 文件。',
    })
  }
  if (FOOTNOTE.test(proseSource)) {
    diagnostics.push({
      code: 'unsupported-footnote',
      severity: 'error',
      message: '当前版本不支持编辑包含脚注的 Markdown 文件。',
    })
  }
  if (DIRECTIVE.test(proseSource)) {
    diagnostics.push({
      code: 'unsupported-directive',
      severity: 'error',
      message: '当前版本不支持编辑包含 directive 的 Markdown 文件。',
    })
  }

  if (serialized !== undefined) {
    const normalizedSerialized = normalizeMarkdownSource(serialized)
    if (isCatastrophicRoundTrip(normalized, normalizedSerialized)) {
      diagnostics.push({
        code: 'catastrophic-roundtrip',
        severity: 'error',
        message: 'Markdown 解析结果异常缩减，已阻止保存并保留原始缓冲区。',
      })
    } else if (!hasEquivalentCriticalStructure(normalized, normalizedSerialized)) {
      diagnostics.push({
        code: 'structural-roundtrip-mismatch',
        severity: 'error',
        message: 'Markdown 解析前后的关键结构不一致，已阻止保存并保留原始缓冲区。',
      })
    }
  }

  const safeToEdit = !diagnostics.some((item) => item.severity === 'error')
  return { blocks, diagnostics, safeToEdit, safeToSave: safeToEdit }
}

function maskFencedBlocks(source: string, blocks: MarkdownSourceBlock[]): string {
  const lines = source.split('\n')
  for (const block of blocks) {
    if (block.kind !== 'fence' && block.kind !== 'mermaid') continue
    for (let line = block.startLine - 1; line < block.endLine; line += 1) lines[line] = ''
  }
  return lines.join('\n')
}

function maskInlineCode(source: string): string {
  return source.replace(/(`+)([\s\S]*?)\1/g, (match) => match.replace(/[^\n]/g, ' '))
}

function isCatastrophicRoundTrip(before: string, after: string): boolean {
  const beforeTrimmed = before.trim()
  const afterTrimmed = after.trim()
  if (beforeTrimmed.length < 128) return false
  if (afterTrimmed.length >= beforeTrimmed.length * 0.25) return false
  const beforeBlocks = scanMarkdownBlocks(beforeTrimmed)
  const afterBlocks = scanMarkdownBlocks(afterTrimmed)
  return beforeBlocks.length >= 3 && afterBlocks.length <= Math.max(1, beforeBlocks.length * 0.2)
}

function hasEquivalentCriticalStructure(before: string, after: string): boolean {
  return (
    JSON.stringify(criticalStructureSignature(before)) ===
    JSON.stringify(criticalStructureSignature(after))
  )
}

function criticalStructureSignature(source: string): Record<string, unknown> {
  const blocks = scanMarkdownBlocks(source)
  const prose = maskInlineCode(maskFencedBlocks(source, blocks))
  const lines = source.split('\n')
  return {
    headings: blocks
      .filter((block) => block.kind === 'heading')
      .map((block) => /^ {0,3}(#{1,6})/.exec(block.raw)?.[1].length ?? 0),
    fences: blocks
      .filter((block) => block.kind === 'fence' || block.kind === 'mermaid')
      .map((block) => block.language ?? ''),
    tableRows: blocks
      .filter((block) => block.kind === 'table')
      .map((block) => block.raw.split('\n').filter((line) => !isBlank(line)).length),
    blockquotes: blocks.filter((block) => block.kind === 'blockquote').length,
    horizontalRules: blocks.filter((block) => block.kind === 'horizontal-rule').length,
    unorderedItems: lines.filter((line) => /^\s*[-+*]\s+/.test(line)).length,
    orderedItems: lines.filter((line) => /^\s*\d+[.)]\s+/.test(line)).length,
    taskItems: lines
      .map((line) => /^\s*[-+*]\s+\[([ xX])\]\s+/.exec(line)?.[1])
      .filter((value): value is string => value !== undefined)
      .map((value) => value.toLowerCase()),
    images: extractMarkdownDestinations(prose, true),
    links: extractMarkdownDestinations(prose, false),
  }
}

function extractMarkdownDestinations(source: string, images: boolean): string[] {
  const expression = /(!?)\[[^\]]*]\(\s*(?:<([^>]+)>|([^\s)]+))/g
  const destinations: string[] = []
  for (const match of source.matchAll(expression)) {
    if ((match[1] === '!') !== images) continue
    destinations.push(match[2] ?? match[3] ?? '')
  }
  return destinations
}

export function mapTopLevelSelectionToSource(
  markdown: string,
  startIndex: number,
  endIndex: number,
  selectedText: string,
  expectedBlockCount?: number,
): { range: MarkdownSourceRange | null; diagnostics: MarkdownDiagnostic[] } {
  const normalized = normalizeMarkdownSource(markdown)
  const blocks = scanMarkdownBlocks(normalized)
  const diagnostics: MarkdownDiagnostic[] = []
  if (
    typeof expectedBlockCount === 'number' &&
    expectedBlockCount > 0 &&
    blocks.length !== expectedBlockCount
  ) {
    diagnostics.push({
      code: 'source-map-mismatch',
      severity: 'warning',
      message: `Markdown 源码块数量 ${blocks.length} 与编辑器顶层节点 ${expectedBlockCount} 不一致，选区采用邻近块映射。`,
    })
  }
  if (blocks.length === 0) return { range: null, diagnostics }

  const safeStart = clamp(startIndex, 0, blocks.length - 1)
  const safeEnd = clamp(Math.max(startIndex, endIndex), safeStart, blocks.length - 1)
  const startBlock = blocks[safeStart]
  const endBlock = blocks[safeEnd]
  const lines = normalized.split('\n')
  return {
    range: {
      startLine: startBlock.startLine,
      endLine: endBlock.endLine,
      startColumn: 1,
      endColumn: (lines[endBlock.endLine - 1]?.length ?? 0) + 1,
      selectedText,
      sourceSnapshot: lines.slice(startBlock.startLine - 1, endBlock.endLine).join('\n'),
    },
    diagnostics,
  }
}

export function sourceRangeFromOffsets(
  source: string,
  anchor: number,
  head: number,
): MarkdownSourceRange | null {
  const normalized = normalizeMarkdownSource(source)
  const startOffset = clamp(Math.min(anchor, head), 0, normalized.length)
  const endOffset = clamp(Math.max(anchor, head), 0, normalized.length)
  if (startOffset === endOffset) return null

  const start = offsetToLineColumn(normalized, startOffset)
  const end = offsetToLineColumn(normalized, endOffset)
  const lines = normalized.split('\n')
  return {
    startLine: start.line,
    endLine: end.line,
    startColumn: start.column,
    endColumn: end.column,
    selectedText: normalized.slice(startOffset, endOffset),
    sourceSnapshot: lines.slice(start.line - 1, end.line).join('\n'),
  }
}

export function hashMarkdownSnapshot(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function makeBlock(
  kind: MarkdownBlockKind,
  lines: string[],
  startIndex: number,
  endIndex: number,
  language?: string,
): MarkdownSourceBlock {
  return {
    kind,
    startLine: startIndex + 1,
    endLine: endIndex + 1,
    raw: lines.slice(startIndex, endIndex + 1).join('\n'),
    ...(language ? { language } : {}),
  }
}

function startsNewBlock(lines: string[], index: number): boolean {
  const line = lines[index] ?? ''
  if (
    FENCE_START.test(line) ||
    HEADING.test(line) ||
    HORIZONTAL_RULE.test(line) ||
    BLOCKQUOTE.test(line) ||
    LIST_ITEM.test(line) ||
    isBlockHtml(line)
  ) {
    return true
  }
  return Boolean(
    line.includes('|') && index + 1 < lines.length && TABLE_DELIMITER.test(lines[index + 1]),
  )
}

function isBlockHtml(line: string): boolean {
  return !AUTOLINK_START.test(line) && BLOCK_HTML.test(line)
}

function consumeList(lines: string[], start: number): number {
  let index = start + 1
  while (index < lines.length) {
    const line = lines[index]
    if (LIST_ITEM.test(line) || isBlank(line) || /^\s{2,}\S/.test(line)) {
      index += 1
      continue
    }
    break
  }
  while (index > start + 1 && isBlank(lines[index - 1])) index -= 1
  return index
}

function trimTrailingBlankLines(lines: string[], minimum: number, end: number): number {
  let index = end
  while (index > minimum && isBlank(lines[index - 1])) index -= 1
  return index
}

function consumeWhile(
  lines: string[],
  start: number,
  predicate: (line: string, index: number) => boolean,
): number {
  let index = start
  while (index < lines.length && predicate(lines[index], index)) index += 1
  return index
}

function findLine(lines: string[], start: number, predicate: (line: string) => boolean): number {
  for (let index = start; index < lines.length; index += 1) {
    if (predicate(lines[index])) return index
  }
  return -1
}

function offsetToLineColumn(source: string, offset: number): { line: number; column: number } {
  const before = source.slice(0, offset)
  const line = before.split('\n').length
  const lastBreak = before.lastIndexOf('\n')
  return { line, column: offset - lastBreak }
}

function isBlank(line: string): boolean {
  return line.trim() === ''
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
