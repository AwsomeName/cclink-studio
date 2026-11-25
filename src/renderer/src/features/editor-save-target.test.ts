import { describe, expect, it } from 'vitest'
import type { EditorFileState } from '../stores/editor-store'
import {
  EDITOR_SAVE_TARGET_NOT_OPEN,
  editorSessionState,
  resolveEditorSaveTarget,
} from './editor-save-target'

function file(overrides: Partial<EditorFileState> = {}): EditorFileState {
  return {
    savedContent: 'a',
    currentContent: 'a',
    dirty: false,
    loading: false,
    ...overrides,
  }
}

const open = { '/project/a.md': file(), '/project/b.md': file({ dirty: true }) }

describe('resolveEditorSaveTarget', () => {
  it('saves the named document even when it is not the active one', () => {
    expect(resolveEditorSaveTarget('/project/b.md', open, '/project/a.md')).toEqual({
      ok: true,
      filePath: '/project/b.md',
    })
  })

  it('uses the active document when the request names none', () => {
    expect(resolveEditorSaveTarget(undefined, open, '/project/a.md')).toEqual({
      ok: true,
      filePath: '/project/a.md',
    })
  })

  it('fails at once for a document without an editor session', () => {
    expect(resolveEditorSaveTarget('/project/c.md', open, '/project/a.md')).toEqual({
      ok: false,
      error: EDITOR_SAVE_TARGET_NOT_OPEN,
    })
  })

  it('fails when neither side names a file', () => {
    expect(resolveEditorSaveTarget(undefined, open, null)).toEqual({
      ok: false,
      error: '无文件路径',
    })
  })
})

describe('editorSessionState', () => {
  it('reports closed, clean, dirty, saving and conflicted sessions', () => {
    expect(editorSessionState({}, '/x.md')).toEqual({ open: false, dirty: false, conflict: false })
    expect(editorSessionState({ '/x.md': file() }, '/x.md')).toEqual({
      open: true,
      dirty: false,
      conflict: false,
    })
    expect(editorSessionState({ '/x.md': file({ dirty: true }) }, '/x.md').dirty).toBe(true)
    expect(editorSessionState({ '/x.md': file({ saving: true }) }, '/x.md').dirty).toBe(true)
    expect(
      editorSessionState({ '/x.md': file({ externalContent: 'disk' }) }, '/x.md').conflict,
    ).toBe(true)
  })
})
