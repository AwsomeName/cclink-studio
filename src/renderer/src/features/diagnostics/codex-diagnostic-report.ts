import {
  CODEX_DIAGNOSTIC_LABELS,
  CODEX_DIAGNOSTIC_STAGE_LABELS,
  type CodexRuntimeDiagnostic,
} from '@shared/codex-runtime'
import { sanitizeDiagnosticText } from '@shared/diagnostics'

export function formatCodexDiagnostic(
  status: CodexRuntimeDiagnostic,
  mode: 'probe' | 'run' = 'probe',
): string {
  return sanitizeDiagnosticText(
    [
      `- 结论：${CODEX_DIAGNOSTIC_LABELS[status.state]}（${status.state}）`,
      `- 检查时间：${status.checkedAt}`,
      `- 阶段 / 错误码：${CODEX_DIAGNOSTIC_STAGE_LABELS[status.stage]}（${status.stage}） / ${status.code}`,
      `- 说明：${status.message}`,
      `- 可执行文件：${status.executable ?? '未找到'}`,
      `- 系统 / 架构：${status.platform} / ${status.arch}`,
      `- 本地认证：${status.auth}；仅检查 ChatGPT 文件登录，不读取钥匙串`,
      `- 退出码 / 信号：${status.exitCode ?? '-'} / ${status.signal ?? '-'}`,
      '- 原生 Codex 与旧版 Codex ACP 的 API Key 独立；本项不表示当前会话已经选择原生 Codex。',
      mode === 'probe'
        ? '- 检查范围：临时目录中的全局安装、握手、登录和配置；不发送模型请求，不验证额度或工作空间配置。'
        : '- 检查范围：当前会话最近一次实际运行；与下方独立的全局安装探测结果分别记录。',
      '- 搜索位置（Studio 进程 PATH 和桌面安装目录）：',
      ...status.searchedPaths.map((path) => `  - ${path}`),
    ].join('\n'),
    20_000,
  )
}

export async function collectCodexDiagnostic(): Promise<string> {
  return formatCodexDiagnostic(await window.cclinkStudio.diagnostics.probeCodex())
}
