import type { WorkspaceStateDiagnostics } from '@shared/ipc/workspace-state'

export function summarizeDiagnosticList(values: string[], empty = '无'): string {
  return values.length > 0 ? values.join(', ') : empty
}

export function formatWorkspaceDiagnosticsMarkdown(diagnostics: WorkspaceStateDiagnostics): string {
  const lines = [
    '# CCLink Studio 工作台诊断',
    '',
    '## 状态文件',
    `- userData：${diagnostics.userDataPath}`,
    `- workspace-state：${diagnostics.stateFilePath}`,
    `- backup：${diagnostics.backupFilePath}`,
    `- workspaceCount：${diagnostics.workspaceCount}`,
    `- fileVersion：${diagnostics.fileVersion}`,
    '',
    '## userData',
  ]
  if (!diagnostics.userData) {
    lines.push('- 无 userData 诊断记录')
  } else {
    lines.push(`- fixedUserDataPath：${diagnostics.userData.fixedUserDataPath}`)
  }

  lines.push('', '## 会话恢复轨迹')
  if (!diagnostics.recoveryTrace) {
    lines.push('- 当前运行时没有提供恢复轨迹')
    return lines.join('\n').trimEnd()
  }
  lines.push(
    `- 文件：${diagnostics.recoveryTrace.filePath}`,
    `- 固定文档：${diagnostics.recoveryTrace.documentFilePath ?? '当前运行时未提供'}`,
    `- 固定文档状态：${diagnostics.recoveryTrace.documentStatus ?? '未知'}`,
    `- 当前保留：${diagnostics.recoveryTrace.retainedEntries}`,
    `- 已丢弃旧记录：${diagnostics.recoveryTrace.droppedCount}`,
  )
  const recentEntries = diagnostics.recoveryTrace.entries.slice(-100)
  if (recentEntries.length === 0) {
    lines.push('- 暂无恢复轨迹')
  } else {
    for (const entry of recentEntries) {
      const summary = entry.summary
        ? `会话=${entry.summary.storedConversationCount}/${entry.summary.orderedConversationCount} 消息=${entry.summary.messageCount} 字符=${entry.summary.textCharacterCount} session=${entry.summary.sessionBackedConversationCount} active=${entry.summary.activeConversationPresent}`
        : '无会话摘要'
      const previous = entry.previousSummary
        ? ` previous=会话${entry.previousSummary.storedConversationCount}/${entry.previousSummary.orderedConversationCount},消息${entry.previousSummary.messageCount},字符${entry.previousSummary.textCharacterCount}`
        : ''
      lines.push(
        `- ${entry.timestamp} · v${entry.appVersion} · ${entry.event}/${entry.outcome} · workspace=${entry.workspaceRef ?? 'global'} owner=${entry.ownerRef ?? 'none'} source=${entry.source ?? 'none'} primary=${entry.primaryStatus ?? 'n/a'} backup=${entry.backupStatus ?? 'n/a'} · ${summary}${previous}`,
      )
    }
  }
  return lines.join('\n').trimEnd()
}
