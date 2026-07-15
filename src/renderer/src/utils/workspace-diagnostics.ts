import type { WorkspaceStateDiagnostics } from '@shared/ipc/workspace-state'

export function summarizeDiagnosticList(values: string[], empty = '无'): string {
  return values.length > 0 ? values.join(', ') : empty
}

export function formatWorkspaceDiagnosticsMarkdown(
  diagnostics: WorkspaceStateDiagnostics,
): string {
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
    '## userData 迁移',
  ]
  if (!diagnostics.migration) {
    lines.push('- 无迁移诊断记录')
    return lines.join('\n')
  }
  lines.push(
    `- fixedUserDataPath：${diagnostics.migration.fixedUserDataPath}`,
    `- legacyUserDataPath：${diagnostics.migration.legacyUserDataPath}`,
    '',
  )
  for (const candidate of diagnostics.migration.candidates) {
    lines.push(
      `### ${candidate.path}`,
      `- migrated：${summarizeDiagnosticList(candidate.migrated)}`,
      `- merged：${summarizeDiagnosticList(candidate.merged)}`,
      `- skippedExisting：${summarizeDiagnosticList(candidate.skippedExisting)}`,
      `- errors：${summarizeDiagnosticList(candidate.errors)}`,
      '',
    )
  }
  return lines.join('\n').trimEnd()
}
