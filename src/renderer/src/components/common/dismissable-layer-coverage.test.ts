import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const dismissableSurfaceFiles = [
  '../command-palette/CommandPalette.tsx',
  '../project-strip/ProjectStrip.tsx',
  '../status-bar/GitOperationDialog.tsx',
  '../status-bar/GitStatusBarItem.tsx',
  '../status-bar/StatusBar.tsx',
  '../topbar/ConversationQuickSwitcher.tsx',
  '../update/UpdatePanel.tsx',
  '../workbench/BrowserToolbar.tsx',
  '../workbench/MarkdownEditor.tsx',
  '../workbench/TabBar.tsx',
  '../../features/context-actions/ContextMenuHost.tsx',
] as const

describe('dismissable UI layer coverage', () => {
  it.each(dismissableSurfaceFiles)('%s registers unified Escape dismissal', (relativePath) => {
    const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')

    expect(source).toContain('useEscapeDismiss')
  })

  it('routes every shared floating surface through the same Escape stack', () => {
    const source = readFileSync(new URL('./FloatingSurface.tsx', import.meta.url), 'utf8')

    expect(source).toContain('useEscapeDismiss(open, onRequestClose)')
  })
})
