import { describe, expect, it } from 'vitest'
import { formatWorkspaceDiagnosticsMarkdown } from './workspace-diagnostics'

describe('workspace diagnostics formatter', () => {
  it('formats userData diagnostics as pasteable markdown', () => {
    const markdown = formatWorkspaceDiagnosticsMarkdown({
      userDataPath: '/fixed/CCLink Studio',
      stateFilePath: '/fixed/CCLink Studio/workspace-state.json',
      backupFilePath: '/fixed/CCLink Studio/workspace-state.json.bak',
      workspaceCount: 3,
      fileVersion: 1,
      userData: {
        fixedUserDataPath: '/fixed/CCLink Studio',
      },
    })

    expect(markdown).toContain('# CCLink Studio 工作台诊断')
    expect(markdown).toContain('- workspaceCount：3')
    expect(markdown).toContain('- fixedUserDataPath：/fixed/CCLink Studio')
  })

  it('includes redacted cross-restart conversation recovery traces', () => {
    const markdown = formatWorkspaceDiagnosticsMarkdown({
      userDataPath: '/fixed/CCLink Studio',
      stateFilePath: '/fixed/CCLink Studio/workspace-state.json',
      backupFilePath: '/fixed/CCLink Studio/workspace-state.json.bak',
      workspaceCount: 1,
      fileVersion: 2,
      userData: null,
      recoveryTrace: {
        filePath: '/fixed/CCLink Studio/workspace-recovery-diagnostics.json',
        documentFilePath: '/fixed/Documents/CCLink Studio/Diagnostics/conversation-recovery-log.md',
        documentStatus: 'ok',
        retainedEntries: 2,
        droppedCount: 3,
        entries: [
          {
            timestamp: '2026-08-08T08:00:00.000Z',
            appVersion: '0.1.21',
            event: 'snapshot-selected',
            outcome: 'restored',
            workspaceRef: '9fd0f5110d7a',
            ownerRef: '67f504efdaab',
            source: 'project-backup',
            summary: {
              orderedConversationCount: 5,
              storedConversationCount: 5,
              archivedConversationCount: 1,
              sessionBackedConversationCount: 4,
              messageCount: 27,
              userMessageCount: 10,
              assistantMessageCount: 17,
              systemMessageCount: 0,
              streamingMessageCount: 0,
              textCharacterCount: 4096,
              serializedCharacterCount: 8192,
              activeConversationPresent: true,
            },
            previousSummary: null,
            primaryStatus: 'invalid',
            backupStatus: 'ok',
          },
        ],
      },
    })

    expect(markdown).toContain('## 会话恢复轨迹')
    expect(markdown).toContain(
      '- 固定文档：/fixed/Documents/CCLink Studio/Diagnostics/conversation-recovery-log.md',
    )
    expect(markdown).toContain('- 固定文档状态：ok')
    expect(markdown).toContain('snapshot-selected/restored')
    expect(markdown).toContain('source=project-backup')
    expect(markdown).toContain('primary=invalid backup=ok')
    expect(markdown).toContain('workspace=9fd0f5110d7a owner=67f504efdaab')
    expect(markdown).toContain('会话=5/5 消息=27 字符=4096 session=4 active=true')
    expect(markdown).not.toContain('private prompt')
    expect(markdown).not.toContain('private-session')
  })
})
