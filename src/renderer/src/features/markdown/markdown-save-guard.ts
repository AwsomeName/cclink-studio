import type { Editor } from '@tiptap/core'
import {
  analyzeMarkdown,
  normalizeMarkdownEditorOutput,
  type MarkdownAnalysis,
  type MarkdownDiagnostic,
} from './markdown-codec'
import { parseMarkdownEditorDocument } from './markdown-editor-document'

export interface MarkdownSaveInspection extends MarkdownAnalysis {
  markdown: string
  reparsedMarkdown?: string
}

export function inspectMarkdownEditorBeforeSave(
  editor: Editor,
  referenceSource?: string,
): MarkdownSaveInspection {
  const markdown = normalizeMarkdownEditorOutput(editor.getMarkdown(), referenceSource)
  const initial = analyzeMarkdown(markdown)
  if (!initial.safeToSave) return { ...initial, markdown }

  if (!editor.markdown) {
    return parserFailure(markdown, 'Markdown 解析器未初始化')
  }

  try {
    const reparsedDocument = parseMarkdownEditorDocument(editor, markdown)
    const reparsedMarkdown = normalizeMarkdownEditorOutput(
      editor.markdown.serialize(reparsedDocument),
      markdown,
    )
    return {
      ...analyzeMarkdown(markdown, reparsedMarkdown),
      markdown,
      reparsedMarkdown,
    }
  } catch (error) {
    return parserFailure(markdown, error instanceof Error ? error.message : String(error))
  }
}

function parserFailure(markdown: string, reason: string): MarkdownSaveInspection {
  const diagnostic: MarkdownDiagnostic = {
    code: 'parser-runtime-error',
    severity: 'error',
    message: `保存前复查 Markdown 失败：${reason}`,
  }
  return {
    markdown,
    blocks: [],
    diagnostics: [diagnostic],
    safeToEdit: false,
    safeToSave: false,
  }
}
