import { describe, expect, it } from 'vitest'
import { contentPresentation } from './content-presentation'
import type { Tab } from '../types'
const tab = (type: Tab['type'], path?: string): Tab => ({
  id: 't',
  type,
  filePath: path,
  icon: 'x',
  title: 'file',
})
describe('content presentations independent of workspace type', () => {
  it('only offers rich/source for Markdown and no unsupported binary editing', () => {
    expect(contentPresentation(tab('editor', '/a.md'))?.options.map((o) => o.id)).toEqual([
      'markdown',
      'source',
    ])
    expect(contentPresentation(tab('editor', '/a.ts'))?.selected).toBe('source')
    expect(contentPresentation(tab('model', '/a.stl'))?.options.map((o) => o.id)).toEqual(['model'])
    expect(contentPresentation(tab('file-preview', '/a.PcbDoc'))?.label).toBe('电路')
    expect(contentPresentation(tab('hardware-gerber'))?.detail).toContain('只读')
    expect(contentPresentation(tab('remote-file', '/a.md'))).toBeNull()
  })
  it('restores the same Markdown buffer presentation and scopes HTML preview', () => {
    expect(
      contentPresentation({ ...tab('editor', '/a.md'), editorPresentation: 'source' })?.selected,
    ).toBe('source')
    expect(contentPresentation(tab('browser', '/a.html'))?.options).toHaveLength(2)
    expect(contentPresentation(tab('browser'))?.options).toHaveLength(1)
  })
})
