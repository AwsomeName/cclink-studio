import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorToolbar, resolveEditorSaveControl } from './EditorToolbar'

afterEach(() => vi.unstubAllGlobals())

describe('resolveEditorSaveControl', () => {
  it('shows a quiet status instead of a disabled button after saving', () => {
    expect(resolveEditorSaveControl('/workspace/notes.md', false)).toEqual({
      kind: 'status',
      label: '已保存',
      title: '所有更改均已保存',
    })
  })

  it('shows a save action when an existing document has changes', () => {
    expect(resolveEditorSaveControl('/workspace/notes.md', true)).toEqual({
      kind: 'action',
      label: '保存',
      title: '保存',
    })
  })

  it('keeps Save As available for a document without a file path', () => {
    expect(resolveEditorSaveControl(undefined, false)).toEqual({
      kind: 'action',
      label: '另存为',
      title: '另存为',
    })
  })

  it('renders the diagnostic count as the only clickable diagnostic control', () => {
    vi.stubGlobal('React', { createElement })
    const markup = renderToStaticMarkup(
      createElement(EditorToolbar, {
        editor: null,
        filePath: '/workspace/notes.md',
        dirty: false,
        diagnosticsCount: 1,
        onCopyDiagnostics: vi.fn(),
        onSave: vi.fn(),
        onInsertLink: vi.fn(),
        onInsertImage: vi.fn(),
        onInsertTable: vi.fn(),
        onEditImage: vi.fn(),
      }),
    )

    expect(markup).toContain('<button type="button" class="toolbar-diagnostics"')
    expect(markup).toContain('title="点击复制完整诊断日志"')
    expect(markup).toContain('1 项提示</button>')
    expect(markup).not.toContain('兼容性提示')
  })
})
