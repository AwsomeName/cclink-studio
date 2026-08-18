import { describe, expect, it } from 'vitest'
import { shouldClearFileTreeSelectionOnBlur } from './file-tree-selection'

describe('file tree selection focus', () => {
  it('keeps the selection while focus moves to the file tree toolbar', () => {
    const toolbarButton = {} as EventTarget

    expect(
      shouldClearFileTreeSelectionOnBlur(toolbarButton, (target) => target === toolbarButton),
    ).toBe(false)
  })

  it('clears the selection when focus leaves the file tree area', () => {
    const workbench = {} as EventTarget

    expect(shouldClearFileTreeSelectionOnBlur(workbench, () => false)).toBe(true)
    expect(shouldClearFileTreeSelectionOnBlur(null, () => true)).toBe(true)
  })
})
