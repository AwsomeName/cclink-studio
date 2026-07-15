import { describe, expect, it } from 'vitest'
import { formatWorkspaceDiagnosticsMarkdown } from './workspace-diagnostics'

describe('workspace diagnostics formatter', () => {
  it('formats userData migration candidates as pasteable markdown', () => {
    const markdown = formatWorkspaceDiagnosticsMarkdown({
      userDataPath: '/fixed/DeepInk',
      stateFilePath: '/fixed/DeepInk/workspace-state.json',
      backupFilePath: '/fixed/DeepInk/workspace-state.json.bak',
      workspaceCount: 3,
      fileVersion: 1,
      migration: {
        fixedUserDataPath: '/fixed/DeepInk',
        legacyUserDataPath: '/legacy/Electron',
        candidates: [
          {
            path: '/legacy/Electron',
            migrated: ['settings.json'],
            merged: ['workspace-state.json'],
            skippedExisting: ['auth.json'],
            missing: ['browser-history.json'],
            errors: ['sync-store.json: EACCES'],
          },
        ],
      },
    })

    expect(markdown).toContain('# CCLink Studio 工作台诊断')
    expect(markdown).toContain('- workspaceCount：3')
    expect(markdown).toContain('### /legacy/Electron')
    expect(markdown).toContain('- migrated：settings.json')
    expect(markdown).toContain('- merged：workspace-state.json')
    expect(markdown).toContain('- skippedExisting：auth.json')
    expect(markdown).toContain('- errors：sync-store.json: EACCES')
  })
})
