import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { describe, expect, it, vi } from 'vitest'
import {
  isMarkdownHydrationPending,
  setMarkdownEditorEditable,
  shouldApplyMarkdownDocumentUpdate,
} from './markdown-editor-hydration'

describe('isMarkdownHydrationPending', () => {
  const base = {
    hasEditor: true,
    hydratedVersion: 'notes.md:old',
    expectedVersion: 'notes.md:new',
    loadedFileKey: 'notes.md',
    fileKey: 'notes.md',
  }

  it('keeps an already mounted file visible while its saved version is reconciled', () => {
    expect(isMarkdownHydrationPending(base)).toBe(false)
  })

  it('waits for initial editor creation', () => {
    expect(isMarkdownHydrationPending({ ...base, hasEditor: false })).toBe(true)
  })

  it('waits when opening a different file', () => {
    expect(isMarkdownHydrationPending({ ...base, fileKey: 'other.md' })).toBe(true)
  })

  it('waits after an explicit reload clears the loaded file marker', () => {
    expect(isMarkdownHydrationPending({ ...base, loadedFileKey: undefined })).toBe(true)
  })

  it('does not wait when the expected version is already hydrated', () => {
    expect(isMarkdownHydrationPending({ ...base, hydratedVersion: base.expectedVersion })).toBe(
      false,
    )
  })

  it('switches editable state without emitting a document update', () => {
    const onUpdate = vi.fn()
    const editor = new Editor({
      element: null,
      extensions: [StarterKit],
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'unchanged' }] }],
      },
      onUpdate,
    })

    setMarkdownEditorEditable(editor, false)
    setMarkdownEditorEditable(editor, true)

    expect(onUpdate).not.toHaveBeenCalled()
    expect(editor.getText()).toBe('unchanged')

    editor.commands.setContent({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'genuinely changed' }] }],
    })

    expect(onUpdate).toHaveBeenCalledOnce()
    expect(onUpdate.mock.calls[0][0].transaction.docChanged).toBe(true)
    expect(editor.getText()).toBe('genuinely changed')
    editor.destroy()
  })

  it('only applies real document changes outside hydration', () => {
    expect(shouldApplyMarkdownDocumentUpdate(false, true)).toBe(true)
    expect(shouldApplyMarkdownDocumentUpdate(false, false)).toBe(false)
    expect(shouldApplyMarkdownDocumentUpdate(true, true)).toBe(false)
  })
})
