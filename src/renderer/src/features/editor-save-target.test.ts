import { describe, expect, it } from 'vitest'
import { resolveMountedEditorSaveTarget } from './editor-save-target'

describe('resolveMountedEditorSaveTarget', () => {
  it('accepts an explicitly matching mounted document', () => {
    expect(resolveMountedEditorSaveTarget('/project/b.md', '/project/b.md')).toEqual({
      ok: true,
      filePath: '/project/b.md',
    })
  })

  it('keeps compatibility with a request that omits the mounted path', () => {
    expect(resolveMountedEditorSaveTarget(undefined, '/project/a.md')).toEqual({
      ok: true,
      filePath: '/project/a.md',
    })
  })

  it('rejects a different target instead of reusing the active buffer', () => {
    expect(resolveMountedEditorSaveTarget('/project/b.md', '/project/a.md')).toEqual({
      ok: false,
      error: '目标文件未在当前编辑器会话中打开，无法保存',
    })
  })

  it('rejects a request when neither side has a file path', () => {
    expect(resolveMountedEditorSaveTarget(undefined, null)).toEqual({
      ok: false,
      error: '无文件路径',
    })
  })
})
