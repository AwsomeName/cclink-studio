import { stripCclinkMarkdownMetadata } from '@shared/markdown-document'
import MarkdownIt from 'markdown-it'

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
    | 'parser-runtime-error'
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

export type MarkdownCriticalStructureName =
  | 'headings'
  | 'codeBlocks'
  | 'tableRows'
  | 'tableAlignments'
  | 'blockquotes'
  | 'horizontalRules'
  | 'unorderedItems'
  | 'orderedItems'
  | 'orderedStarts'
  | 'taskItems'
  | 'images'
  | 'links'
  | 'mathExpressions'
  | 'textContent'

export interface MarkdownRoundTripDifference {
  key: MarkdownCriticalStructureName
  label: string
  before: unknown
  after: unknown
}

export interface MarkdownRoundTripInspection {
  catastrophic: boolean
  equivalent: boolean
  differences: MarkdownRoundTripDifference[]
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
const FOOTNOTE = /^\s*\[\^[^\]]+\]:/m
const DIRECTIVE = /^\s*:::{1,}\s*[A-Za-z]/m
const markdownStructureParser = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
})

export function normalizeMarkdownSource(source: string): string {
  return source.replace(/\r\n?/g, '\n')
}

export function scanMarkdownBlocks(source: string): MarkdownSourceBlock[] {
  const normalized = normalizeMarkdownSource(stripCclinkMarkdownMetadata(source))
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
  const normalized = normalizeMarkdownSource(stripCclinkMarkdownMetadata(source))
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
  if (extractMathExpressions(proseSource).length > 0) {
    diagnostics.push({
      code: 'unsupported-math',
      severity: 'warning',
      message: '数学公式暂按普通文本显示；保存前会检查公式内容是否完整保留。',
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
    const normalizedSerialized = normalizeMarkdownSource(stripCclinkMarkdownMetadata(serialized))
    if (isCatastrophicRoundTrip(normalized, normalizedSerialized)) {
      diagnostics.push({
        code: 'catastrophic-roundtrip',
        severity: 'error',
        message: 'Markdown 解析结果异常缩减，已阻止保存并保留原始缓冲区。',
      })
    } else if (!hasEquivalentCriticalStructure(normalized, normalizedSerialized)) {
      const mismatch = describeCriticalStructureMismatch(normalized, normalizedSerialized)
      diagnostics.push({
        code: 'structural-roundtrip-mismatch',
        severity: 'error',
        message: `Markdown 解析前后的关键结构不一致（${mismatch}），已阻止保存并保留原始缓冲区。`,
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
    for (let line = block.startLine - 1; line < block.endLine; line += 1) {
      lines[line] = ' '.repeat(lines[line]?.length ?? 0)
    }
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
  return inspectMarkdownRoundTrip(before, after).equivalent
}

interface MarkdownCriticalStructureSignature {
  headings: number[]
  codeBlocks: Array<{ language: string; content: string }>
  tableRows: number[]
  tableAlignments: string[][]
  blockquotes: number
  horizontalRules: number
  unorderedItems: number
  orderedItems: number
  orderedStarts: number[]
  taskItems: string[]
  images: Array<{ source: string; alt: string; title: string }>
  links: Array<{ destination: string; title: string }>
  mathExpressions: Array<{ display: boolean; content: string }>
  textContent: string[]
}

function criticalStructureSignature(source: string): MarkdownCriticalStructureSignature {
  const normalized = normalizeMarkdownSource(stripCclinkMarkdownMetadata(source))
  const tokens = markdownStructureParser.parse(normalized, {})
  const lines = normalized.split('\n')
  const headings: number[] = []
  const codeBlocks: Array<{ language: string; content: string }> = []
  const tableRows: number[] = []
  const tableAlignments: string[][] = []
  const listStack: Array<'ordered' | 'unordered'> = []
  const listItemTaskStack: boolean[] = []
  const orderedStarts: number[] = []
  const images: Array<{ source: string; alt: string; title: string }> = []
  const links: Array<{ destination: string; title: string }> = []
  const textContent: string[] = []
  let activeTableRows: number | null = null
  let activeTableAlignments: string[] | null = null
  let blockquotes = 0
  let horizontalRules = 0
  let unorderedItems = 0
  let orderedItems = 0

  for (const token of tokens) {
    if (token.type === 'list_item_open') {
      const lineIndex = token.map?.[0]
      listItemTaskStack.push(
        lineIndex === undefined
          ? false
          : markdownTaskItemState(lines[lineIndex] ?? '') !== undefined,
      )
    } else if (token.type === 'list_item_close') {
      listItemTaskStack.pop()
    }

    if (token.type === 'heading_open') headings.push(Number(token.tag.slice(1)))
    else if (token.type === 'fence' || token.type === 'code_block') {
      codeBlocks.push({
        language:
          token.type === 'fence'
            ? normalizeCodeBlockLanguage(token.info.trim().split(/\s+/)[0] ?? '')
            : '',
        content: normalizeCodeBlockContent(token.content),
      })
    } else if (token.type === 'table_open') {
      activeTableRows = 0
      activeTableAlignments = []
    } else if (token.type === 'th_open' && activeTableAlignments !== null) {
      activeTableAlignments.push(markdownTableAlignment(token.attrGet('style') ?? ''))
    } else if (token.type === 'tr_open' && activeTableRows !== null) activeTableRows += 1
    else if (token.type === 'table_close' && activeTableRows !== null) {
      tableRows.push(activeTableRows)
      tableAlignments.push(activeTableAlignments ?? [])
      activeTableRows = null
      activeTableAlignments = null
    } else if (token.type === 'blockquote_open') blockquotes += 1
    else if (token.type === 'hr') horizontalRules += 1
    else if (token.type === 'bullet_list_open') listStack.push('unordered')
    else if (token.type === 'ordered_list_open') {
      listStack.push('ordered')
      orderedStarts.push(Number(token.attrGet('start') ?? 1))
    } else if (token.type === 'bullet_list_close' || token.type === 'ordered_list_close') {
      listStack.pop()
    } else if (token.type === 'list_item_open') {
      if (listStack.at(-1) === 'ordered') orderedItems += 1
      else if (listStack.at(-1) === 'unordered') unorderedItems += 1
    }

    if (token.type === 'inline') {
      const inlineText = markdownInlineText(token.children ?? [])
      const visibleText = listItemTaskStack.at(-1)
        ? stripTaskMarkerFromInlineText(inlineText)
        : inlineText
      // Markdown authors and rich-text editors commonly use NBSP-only paragraphs
      // as visual spacers. Tiptap may merge or drop those paragraphs depending on
      // their neighbours, just as it does ordinary blank lines. They must not make
      // an otherwise lossless document read-only, while whitespace inside real
      // content remains part of the critical signature.
      if (visibleText.trim().length > 0) textContent.push(visibleText)
    }

    for (const child of token.children ?? []) {
      if (child.type === 'image') {
        images.push({
          source: normalizeMarkdownDestination(child.attrGet('src') ?? ''),
          alt: child.content ?? '',
          title: child.attrGet('title') ?? '',
        })
      } else if (child.type === 'link_open') {
        links.push({
          destination: normalizeMarkdownDestination(child.attrGet('href') ?? ''),
          title: child.attrGet('title') ?? '',
        })
      }
    }
  }

  return {
    headings,
    codeBlocks,
    tableRows,
    tableAlignments,
    blockquotes,
    horizontalRules,
    unorderedItems,
    orderedItems,
    orderedStarts,
    taskItems: lines
      .map(markdownTaskItemState)
      .filter((value): value is string => value !== undefined),
    images,
    links,
    mathExpressions: extractMathExpressions(
      maskInlineCode(maskFencedBlocks(normalized, scanMarkdownBlocks(normalized))),
    ),
    textContent,
  }
}

function markdownTableAlignment(style: string): string {
  return /text-align\s*:\s*(left|center|right)/i.exec(style)?.[1]?.toLowerCase() ?? ''
}

function markdownInlineText(tokens: Array<{ type: string; content: string }>): string {
  return tokens
    .map((token) => {
      if (token.type === 'text' || token.type === 'code_inline' || token.type === 'image') {
        return token.content
      }
      if (token.type === 'hardbreak') return '\n'
      if (token.type === 'softbreak') return ' '
      return ''
    })
    .join('')
}

function stripTaskMarkerFromInlineText(value: string): string {
  return value.replace(/^\[[ xX]\](?:\s+|$)/, '')
}

function markdownTaskItemState(line: string): string | undefined {
  return /^((?:(?: {0,3}>)[ \t]?)*)([ \t]*)[-+*]\s+\[([ xX])\](?:\s+|$)/
    .exec(line)?.[3]
    ?.toLowerCase()
}

function normalizeCodeBlockLanguage(value: string): string {
  const language = value.trim().toLowerCase()
  return ['plain', 'plaintext', 'text', 'txt'].includes(language) ? '' : language
}

function normalizeCodeBlockContent(value: string): string {
  return normalizeMarkdownSource(value).replace(/\n$/, '')
}

function normalizeMarkdownDestination(value: string): string {
  try {
    return decodeURI(value)
  } catch {
    return value
  }
}

function describeCriticalStructureMismatch(before: string, after: string): string {
  return (
    inspectMarkdownRoundTrip(before, after)
      .differences.map((difference) => difference.label)
      .join('、') || '未知结构'
  )
}

export function inspectMarkdownRoundTrip(
  before: string,
  after: string,
): MarkdownRoundTripInspection {
  const beforeSignature = criticalStructureSignature(before)
  const afterSignature = criticalStructureSignature(after)
  const labels: Record<MarkdownCriticalStructureName, string> = {
    headings: '标题',
    codeBlocks: '代码块',
    tableRows: '表格',
    tableAlignments: '表格对齐',
    blockquotes: '引用',
    horizontalRules: '分隔线',
    unorderedItems: '无序列表',
    orderedItems: '有序列表',
    orderedStarts: '有序列表起始序号',
    taskItems: '任务列表',
    images: '图片',
    links: '链接',
    mathExpressions: '数学公式',
    textContent: '正文内容',
  }
  const keys = Object.keys(labels) as MarkdownCriticalStructureName[]
  const differences = keys
    .filter((key) => JSON.stringify(beforeSignature[key]) !== JSON.stringify(afterSignature[key]))
    .map((key) => ({
      key,
      label: labels[key],
      before: key === 'codeBlocks' ? diagnosticCodeBlocks(before) : beforeSignature[key],
      after: key === 'codeBlocks' ? diagnosticCodeBlocks(after) : afterSignature[key],
    }))
  return {
    catastrophic: isCatastrophicRoundTrip(before, after),
    equivalent: differences.length === 0,
    differences,
  }
}

function extractMathExpressions(source: string): Array<{ display: boolean; content: string }> {
  return scanMathExpressions(source).map(({ display, content }) => ({
    display,
    content: normalizeMathExpressionContent(content, display),
  }))
}

interface MarkdownMathExpression {
  start: number
  end: number
  contentStart: number
  contentEnd: number
  display: boolean
  content: string
}

function scanMathExpressions(source: string): MarkdownMathExpression[] {
  const expressions: MarkdownMathExpression[] = []
  let index = 0
  while (index < source.length) {
    if (source[index] !== '$' || isEscapedAt(source, index)) {
      index += 1
      continue
    }

    const display = source[index + 1] === '$'
    const delimiterLength = display ? 2 : 1
    const contentStart = index + delimiterLength
    const closing = findMathClosingDelimiter(source, contentStart, delimiterLength)
    if (closing < 0) {
      index += delimiterLength
      continue
    }

    const rawContent = source.slice(contentStart, closing)
    const closesCurrencyRange =
      !display && /^\d/.test(rawContent) && /\d/.test(source[closing + delimiterLength] ?? '')
    const validInline =
      display ||
      (rawContent.length > 0 &&
        !/^\s/.test(rawContent) &&
        !/\s$/.test(rawContent) &&
        !rawContent.includes('\n') &&
        !closesCurrencyRange)
    if (validInline && rawContent.trim()) {
      expressions.push({
        start: index,
        end: closing + delimiterLength,
        contentStart,
        contentEnd: closing,
        display,
        content: rawContent,
      })
      index = closing + delimiterLength
      continue
    }
    index += delimiterLength
  }
  return expressions
}

function normalizeMathExpressionContent(content: string, display: boolean): string {
  const unescaped = decodeMarkdownHtmlEntities(content).replace(
    /\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g,
    '$1',
  )
  return display ? normalizeMarkdownSource(unescaped).trim().replace(/\s+/g, ' ') : unescaped
}

const MATH_MARKDOWN_PUNCTUATION = new Set([...`!"#%&'()*+,-./:;<=>?@[]^_\`{|}~`])

export function prepareMarkdownEditorInput(source: string): string {
  const normalized = normalizeEmptyTaskListItems(
    expandSameLineListHeadings(
      normalizeMarkdownTaskListIndentation(normalizeMarkdownSource(source)),
    ),
  )
  const masked = maskInlineCode(maskFencedBlocks(normalized, scanMarkdownBlocks(normalized)))
  const expressions = scanMathExpressions(masked)
  if (expressions.length === 0) return normalized

  let prepared = ''
  let cursor = 0
  for (const expression of expressions) {
    prepared += normalized.slice(cursor, expression.contentStart)
    const content = normalized.slice(expression.contentStart, expression.contentEnd)
    for (let index = 0; index < content.length; index += 1) {
      const character = content[index]
      if (MATH_MARKDOWN_PUNCTUATION.has(character) && !isEscapedAt(content, index)) {
        prepared += '\\'
      }
      prepared += character
    }
    prepared += normalized.slice(expression.contentEnd, expression.end)
    cursor = expression.end
  }
  prepared += normalized.slice(cursor)
  return prepared
}

/**
 * Tiptap's task-list tokenizer treats the literal number of leading spaces as
 * the nesting level. CommonMark is more permissive: sibling items may use a
 * range of valid indentation widths and still belong to the same list. Feed
 * Tiptap one canonical indentation without changing the source buffer so that
 * valid nested task items are not flattened into escaped paragraph text.
 */
function normalizeMarkdownTaskListIndentation(source: string): string {
  const singleSpaceNormalized = promoteOneSpaceNestedTaskItems(source)
  const lines = singleSpaceNormalized.split('\n')
  const listContexts: Array<'ordered' | 'unordered'> = []
  const tokens = markdownStructureParser.parse(singleSpaceNormalized, {})

  for (const token of tokens) {
    if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
      listContexts.push(token.type === 'ordered_list_open' ? 'ordered' : 'unordered')
      continue
    }
    if (token.type === 'bullet_list_close' || token.type === 'ordered_list_close') {
      listContexts.pop()
      continue
    }
    if (token.type !== 'list_item_open') continue

    const lineIndex = token.map?.[0]
    if (lineIndex === undefined) continue

    const line = lines[lineIndex] ?? ''
    const match = /^((?:(?: {0,3}>)[ \t]?)*)([ \t]*)([-+*]|\d+[.)])([ \t]+)(.*)$/.exec(line)
    if (!match) continue

    const ordered = token.markup === '.' || token.markup === ')'
    const sourceMarker = match[3]
    const marker = ordered ? sourceMarker.replace(/\)$/, '.') : '-'
    const taskItem = !ordered && /^\[[ xX]\](?:\s+|$)/.test(match[5])
    if (taskItem) {
      // Tiptap's task tokenizer uses two literal spaces per logical list level.
      // Its ordered-list tokenizer removes two spaces rather than the marker's
      // full content indent, so CommonMark's three/four-space children otherwise
      // become one-space pseudo-children and collapse during serialization.
      const tiptapIndent = Math.max(0, listContexts.length - 1) * 2
      lines[lineIndex] = `${match[1]}${' '.repeat(tiptapIndent)}${marker} ${match[5]}`
    }
  }

  return lines.join('\n')
}

/**
 * A task marker indented by one space after a top-level bullet item is a common
 * hand-written attempt at nesting. Tiptap instead treats it as paragraph text
 * inside the preceding task and drops the bullet on serialization. Promote
 * only that evidenced compatibility case to the canonical two-space nesting;
 * leave standalone indented markers, ordered-list children, code blocks, and
 * already-valid indentation to the regular Markdown parser.
 */
function promoteOneSpaceNestedTaskItems(source: string): string {
  const lines = source.split('\n')
  const codeLines = markdownCodeLineIndexes(source)
  let activeQuotePrefix: string | null = null
  let hasTopLevelBulletParent = false

  return lines
    .map((line, index) => {
      if (codeLines.has(index)) {
        activeQuotePrefix = null
        hasTopLevelBulletParent = false
        return line
      }

      const match = /^((?:(?: {0,3}>)[ \t]?)*)( *)([-+*])([ \t]+)(.*)$/.exec(line)
      if (match) {
        const [, quotePrefix, indent, marker, separator, content] = match
        if (indent.length === 0) {
          activeQuotePrefix = quotePrefix
          hasTopLevelBulletParent = true
          return line
        }
        if (
          indent === ' ' &&
          hasTopLevelBulletParent &&
          quotePrefix === activeQuotePrefix &&
          /^\[[ xX]\](?:\s+|$)/.test(content)
        ) {
          return `${quotePrefix}  ${marker}${separator}${content}`
        }
        return line
      }

      if (isBlank(line)) return line
      activeQuotePrefix = null
      hasTopLevelBulletParent = false
      return line
    })
    .join('\n')
}

function markdownCodeLineIndexes(source: string): Set<number> {
  const codeLines = new Set<number>()
  for (const token of markdownStructureParser.parse(source, {})) {
    if ((token.type !== 'fence' && token.type !== 'code_block') || !token.map) continue
    for (let line = token.map[0]; line < token.map[1]; line += 1) {
      codeLines.add(line)
    }
  }
  return codeLines
}

function normalizeEmptyTaskListItems(source: string): string {
  const lines = source.split('\n')
  const codeLines = markdownCodeLineIndexes(source)

  return lines
    .map((line, index) => {
      if (codeLines.has(index)) return line
      return /^(\s*[-+*]\s+\[[ xX]\])$/.test(line) ? `${line} ` : line
    })
    .join('\n')
}

function expandSameLineListHeadings(source: string): string {
  const lines = source.split('\n')
  let activeFence: { marker: string; length: number } | null = null

  return lines
    .map((line) => {
      if (activeFence) {
        const closing = new RegExp(
          `^ {0,3}${escapeRegExp(activeFence.marker)}{${activeFence.length},}\\s*$`,
        )
        if (closing.test(line)) activeFence = null
        return line
      }

      const fence = FENCE_START.exec(line)
      if (fence) {
        activeFence = { marker: fence[1][0], length: fence[1].length }
        return line
      }

      const match = /^(\s*)([-+*]|\d+[.)])(\s+)(#{1,6})(\s+)(.*)$/.exec(line)
      if (!match) return line
      const [, indent, marker, separator, heading, headingSeparator, content] = match
      const continuationIndent = indent + ' '.repeat(marker.length + separator.length)
      return `${indent}${marker}\n${continuationIndent}${heading}${headingSeparator}${content}`
    })
    .join('\n')
}

export function normalizeMarkdownEditorOutput(source: string, referenceSource?: string): string {
  const normalized = normalizeMarkdownSource(source)
  const masked = maskInlineCode(maskFencedBlocks(normalized, scanMarkdownBlocks(normalized)))
  const expressions = scanMathExpressions(masked)
  const normalizedReference =
    referenceSource === undefined ? null : normalizeMarkdownSource(referenceSource)
  const referenceExpressions =
    normalizedReference === null
      ? []
      : scanMathExpressions(
          maskInlineCode(
            maskFencedBlocks(normalizedReference, scanMarkdownBlocks(normalizedReference)),
          ),
        )

  let restored = ''
  let cursor = 0
  for (let index = 0; index < expressions.length; index += 1) {
    const expression = expressions[index]
    restored += restorePlainMarkdownDollars(normalized, masked, cursor, expression.start)
    restored += normalized.slice(expression.start, expression.contentStart)
    const content = normalized.slice(expression.contentStart, expression.contentEnd)
    const referenceExpression = referenceExpressions[index]
    const referenceContent =
      normalizedReference && referenceExpression
        ? normalizedReference.slice(
            referenceExpression.contentStart,
            referenceExpression.contentEnd,
          )
        : null
    const canReuseReference =
      referenceContent !== null &&
      hasEquivalentMathExpressionContent(
        content,
        referenceContent,
        expression.display,
        referenceExpression.display,
      )
    const restoredContent = canReuseReference
      ? referenceContent
      : decodeMarkdownHtmlEntities(content).replace(
          /\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g,
          '$1',
        )
    restored += restoredContent
    restored += normalized.slice(expression.contentEnd, expression.end)
    cursor = expression.end
  }
  restored += restorePlainMarkdownDollars(normalized, masked, cursor, normalized.length)
  return restored
}

function hasEquivalentMathExpressionContent(
  content: string,
  referenceContent: string,
  display: boolean,
  referenceDisplay: boolean,
): boolean {
  if (display !== referenceDisplay) return false
  const current = normalizeMathExpressionContent(content, display)
  const reference = normalizeMathExpressionContent(referenceContent, referenceDisplay)
  if (current === reference) return true
  if (current.length !== reference.length) return false

  for (let index = 0; index < current.length; index += 1) {
    if (current[index] === reference[index]) continue
    // Tiptap parses TeX subscripts as Markdown emphasis and serializes `_` back as `*`.
    if (current[index] === '*' && reference[index] === '_') continue
    return false
  }
  return true
}

function decodeMarkdownHtmlEntities(value: string): string {
  return value.replace(
    /&(?:amp|lt|gt|quot|#39|#x27|#(\d+)|#x([0-9a-f]+));/gi,
    (entity, decimal: string | undefined, hexadecimal: string | undefined) => {
      const named: Record<string, string> = {
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&#39;': "'",
        '&#x27;': "'",
      }
      const normalized = entity.toLowerCase()
      if (named[normalized]) return named[normalized]
      const codePoint = decimal
        ? Number.parseInt(decimal, 10)
        : hexadecimal
          ? Number.parseInt(hexadecimal, 16)
          : Number.NaN
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity
    },
  )
}

function restorePlainMarkdownDollars(
  source: string,
  masked: string,
  start: number,
  end: number,
): string {
  let restored = ''
  for (let index = start; index < end; index += 1) {
    if (source[index] === '$' && masked[index] === '$' && !isEscapedAt(source, index)) {
      restored += '\\'
    }
    restored += source[index]
  }
  return restored
}

function findMathClosingDelimiter(source: string, start: number, delimiterLength: number): number {
  for (let index = start; index < source.length; index += 1) {
    if (delimiterLength === 1 && source[index] === '\n') return -1
    if (source[index] !== '$' || isEscapedAt(source, index)) continue
    if (delimiterLength === 2) {
      if (source[index + 1] === '$') return index
      continue
    }
    if (source[index + 1] !== '$') return index
  }
  return -1
}

function isEscapedAt(source: string, index: number): boolean {
  let backslashes = 0
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) {
    backslashes += 1
  }
  return backslashes % 2 === 1
}

function diagnosticCodeBlocks(source: string): Array<Record<string, unknown>> {
  return markdownStructureParser
    .parse(source, {})
    .filter((token) => token.type === 'fence' || token.type === 'code_block')
    .map((token, index) => {
      const content = normalizeCodeBlockContent(token.content)
      return {
        index: index + 1,
        kind: token.type,
        startLine: token.map ? token.map[0] + 1 : null,
        endLine: token.map ? token.map[1] : null,
        language:
          token.type === 'fence'
            ? normalizeCodeBlockLanguage(token.info.trim().split(/\s+/)[0] ?? '')
            : '',
        contentLines: content ? content.split('\n').length : 0,
        contentLength: content.length,
        contentHash: hashMarkdownSnapshot(content),
        preview: diagnosticPreview(content),
      }
    })
}

function diagnosticPreview(value: string): string {
  const normalized = value.replace(/\u0000/g, '\\0')
  return normalized.length <= 240 ? normalized : `${normalized.slice(0, 240)}…`
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

export async function hashMarkdownSnapshotSha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
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
