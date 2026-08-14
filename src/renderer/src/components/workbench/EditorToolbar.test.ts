import { describe, expect, it } from 'vitest'
import { resolveEditorSaveControl } from './EditorToolbar'

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
})
