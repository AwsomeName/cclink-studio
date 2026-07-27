import { describe, expect, it } from 'vitest'
import { resolveFileTreeClipboardShortcut } from './file-tree-shortcuts'

const baseInput = {
  key: 'c',
  metaKey: true,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  isComposing: false,
  isTextEditing: false,
}

describe('resolveFileTreeClipboardShortcut', () => {
  it('maps Cmd/Ctrl+C and Cmd/Ctrl+V to resource clipboard commands', () => {
    expect(resolveFileTreeClipboardShortcut(baseInput)).toBe('copy')
    expect(
      resolveFileTreeClipboardShortcut({
        ...baseInput,
        key: 'v',
        metaKey: false,
        ctrlKey: true,
      }),
    ).toBe('paste')
  })

  it('does not intercept text editing, composition, or modified shortcuts', () => {
    expect(resolveFileTreeClipboardShortcut({ ...baseInput, isTextEditing: true })).toBeNull()
    expect(resolveFileTreeClipboardShortcut({ ...baseInput, isComposing: true })).toBeNull()
    expect(resolveFileTreeClipboardShortcut({ ...baseInput, shiftKey: true })).toBeNull()
  })
})
