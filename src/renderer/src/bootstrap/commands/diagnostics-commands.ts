import { useToastStore } from '../../components/common/Toast'
import {
  formatContextActionDiagnosticsMarkdown,
  useContextActionDiagnosticsStore,
} from '../../features/context-actions/context-action-diagnostics'
import type { Command } from '../../stores/command-store'
import { formatWorkspaceDiagnosticsMarkdown } from '../../utils/workspace-diagnostics'
import { collectFrameworkDiagnosticReport } from '../../features/diagnostics/framework-diagnostic-report'
import { copyTextToClipboard } from '../../utils/clipboard'

async function copyWorkspaceDiagnostics(): Promise<void> {
  const showToast = useToastStore.getState().show
  try {
    const diagnostics = await window.cclinkStudio.workspaceState.diagnostics()
    const contextActionDiagnostics = useContextActionDiagnosticsStore.getState().events
    const text = `${formatWorkspaceDiagnosticsMarkdown(diagnostics)}${formatContextActionDiagnosticsMarkdown(contextActionDiagnostics)}`
    await navigator.clipboard.writeText(text)
    showToast(`工作台状态诊断已复制 · ${diagnostics.workspaceCount} 个工作空间`, 'success')
  } catch (error) {
    showToast(
      `复制工作台状态诊断失败: ${error instanceof Error ? error.message : String(error)}`,
      'error',
    )
  }
}

async function copyFrameworkDiagnostics(): Promise<void> {
  const showToast = useToastStore.getState().show
  try {
    const report = await collectFrameworkDiagnosticReport()
    await copyTextToClipboard(report)
    showToast('框架诊断日志已复制', 'success')
  } catch (error) {
    showToast(
      `复制框架诊断日志失败: ${error instanceof Error ? error.message : String(error)}`,
      'error',
    )
  }
}

export function createDiagnosticsCommands(): Command[] {
  return [
    {
      id: 'diagnostics.copyWorkspaceState',
      label: '开发者：复制工作台状态诊断',
      category: '开发者',
      action: () => {
        void copyWorkspaceDiagnostics()
      },
    },
    {
      id: 'diagnostics.copyFrameworkLogs',
      label: '开发者：复制框架诊断日志',
      category: '开发者',
      action: () => {
        void copyFrameworkDiagnostics()
      },
    },
  ]
}
