import { APP_VERSION } from '../../app-metadata'
import {
  hashMarkdownSnapshot,
  inspectMarkdownRoundTrip,
  scanMarkdownBlocks,
  type MarkdownDiagnostic,
} from './markdown-codec'

interface MarkdownDiagnosticReportInput {
  filePath?: string
  stage: 'preflight' | 'hydrate' | 'roundtrip' | 'reload'
  trigger: 'open' | 'reload'
  source: string
  serialized?: string
  diagnostics: MarkdownDiagnostic[]
  versionHash?: string
  modifiedAt?: number
  dirty: boolean
  reloadGeneration: number
  editorJson?: unknown
  error?: unknown
}

const MAX_EDITOR_NODES = 240
const MAX_EDITOR_CHILDREN_PER_NODE = 80

export function createMarkdownDiagnosticReport(input: MarkdownDiagnosticReportInput): string {
  const sourceSummary = summarizeMarkdown(input.source)
  const serializedSummary =
    input.serialized === undefined ? null : summarizeMarkdown(input.serialized)
  const roundTrip =
    input.serialized === undefined ? null : inspectMarkdownRoundTrip(input.source, input.serialized)

  const report = {
    reportType: 'cclink-markdown-render-diagnostic',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    platform: diagnosticPlatform(),
    file: redactHomePath(input.filePath),
    stage: input.stage,
    trigger: input.trigger,
    reloadGeneration: input.reloadGeneration,
    diskSnapshot: {
      versionHash: input.versionHash ?? null,
      modifiedAt: input.modifiedAt ? new Date(input.modifiedAt).toISOString() : null,
      dirty: input.dirty,
    },
    diagnostics: input.diagnostics,
    source: sourceSummary,
    serialized: serializedSummary,
    roundTrip,
    editorDocument: summarizeEditorDocument(input.editorJson),
    error: formatError(input.error),
    privacy:
      '路径中的用户主目录已替换为 ~。结构差异中的 preview 最多包含 240 个字符，可能包含文档片段。',
  }

  return [
    '# CCLink Studio Markdown 诊断日志',
    '',
    '请将下面完整 JSON 发给开发者。不要只截取错误标题。',
    '',
    '```json',
    JSON.stringify(report, null, 2),
    '```',
  ].join('\n')
}

function summarizeMarkdown(source: string): Record<string, unknown> {
  const normalized = source.replace(/\r\n?/g, '\n')
  const blocks = scanMarkdownBlocks(normalized)
  const blockKinds: Record<string, number> = {}
  for (const block of blocks) {
    blockKinds[block.kind] = (blockKinds[block.kind] ?? 0) + 1
  }
  return {
    characters: normalized.length,
    utf8Bytes: new TextEncoder().encode(normalized).byteLength,
    lines: normalized.split('\n').length,
    hash: hashMarkdownSnapshot(normalized),
    blockKinds,
  }
}

function summarizeEditorDocument(value: unknown): unknown {
  if (!value || typeof value !== 'object') return null
  return summarizeEditorNode(value as Record<string, unknown>, { remaining: MAX_EDITOR_NODES })
}

function summarizeEditorNode(
  node: Record<string, unknown>,
  budget: { remaining: number },
): Record<string, unknown> {
  budget.remaining -= 1
  const type = typeof node.type === 'string' ? node.type : 'unknown'
  const content = Array.isArray(node.content)
    ? node.content.filter((child): child is Record<string, unknown> =>
        Boolean(child && typeof child === 'object'),
      )
    : []
  const result: Record<string, unknown> = { type }
  const attributes = summarizeEditorAttributes(type, node.attrs)
  if (attributes) result.attrs = attributes
  if (typeof node.text === 'string') {
    result.textLength = node.text.length
    result.textHash = hashMarkdownSnapshot(node.text)
    if (isCodeNode(type)) result.preview = diagnosticPreview(node.text)
  }
  if (content.length > 0) {
    const summarizedChildren: Array<Record<string, unknown>> = []
    const childLimit = Math.min(content.length, MAX_EDITOR_CHILDREN_PER_NODE)
    for (let index = 0; index < childLimit && budget.remaining > 0; index += 1) {
      summarizedChildren.push(summarizeEditorNode(content[index], budget))
    }
    if (summarizedChildren.length > 0) result.content = summarizedChildren
    if (summarizedChildren.length < content.length) {
      result.omittedChildren = content.length - summarizedChildren.length
    }
  }
  return result
}

function summarizeEditorAttributes(type: string, value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null
  const attrs = value as Record<string, unknown>
  const allowlist =
    type === 'heading'
      ? ['level']
      : type === 'codeBlock'
        ? ['language']
        : type === 'taskItem'
          ? ['checked']
          : type === 'tableCell' || type === 'tableHeader'
            ? ['colspan', 'rowspan']
            : []
  if (allowlist.length === 0) return null
  return Object.fromEntries(
    allowlist.filter((key) => attrs[key] !== undefined).map((key) => [key, attrs[key]]),
  )
}

function isCodeNode(type: string): boolean {
  return type === 'codeBlock' || type === 'code'
}

function diagnosticPreview(value: string): string {
  const normalized = value.replace(/\u0000/g, '\\0')
  return normalized.length <= 240 ? normalized : `${normalized.slice(0, 240)}…`
}

function redactHomePath(filePath?: string): string | null {
  if (!filePath) return null
  return filePath.replace(/^\/Users\/[^/]+(?=\/|$)/, '~')
}

function diagnosticPlatform(): string {
  if (typeof navigator === 'undefined') return 'unknown'
  return navigator.userAgent || navigator.platform || 'unknown'
}

function formatError(error: unknown): Record<string, string> | null {
  if (!error) return null
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack ? { stack: error.stack.slice(0, 2_000) } : {}),
    }
  }
  return { name: 'UnknownError', message: String(error) }
}
