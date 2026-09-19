import { describe, expect, it } from 'vitest'
import { shallow } from 'zustand/shallow'
import type { EditorFileState } from '../../stores/editor-store'
import { selectEditorFileStatus } from './use-editor-file-status'

const file: EditorFileState = {
  currentContent: 'draft',
  savedContent: '',
  dirty: true,
  loading: false,
  diagnostics: [],
}

describe('Agent editor status subscription', () => {
  it('does not invalidate the conversation UI when only document text or diagnostics change', () => {
    const before = selectEditorFileStatus({ files: { '/notes.md': file } })
    const after = selectEditorFileStatus({
      files: {
        '/notes.md': {
          ...file,
          currentContent: 'draft with more typing',
          diagnostics: [
            {
              code: 'unsupported-math',
              severity: 'warning',
              message: 'math',
            },
          ],
        },
      },
    })
    expect(shallow(before, after)).toBe(true)
  })

  it('updates suggestions and chips when a file is saved, opened, closed or moved', () => {
    const before = selectEditorFileStatus({ files: { '/notes.md': file } })
    const changes: Array<Record<string, EditorFileState>> = [
      { '/notes.md': { ...file, dirty: false } },
      { '/notes.md': file, 'virtual:new': file },
      {},
      { '/renamed.md': file },
    ]
    for (const files of changes) {
      expect(shallow(before, selectEditorFileStatus({ files }))).toBe(false)
    }
  })
})
