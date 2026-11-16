import {
  CODEX_DIAGNOSTIC_LABELS,
  CODEX_DIAGNOSTIC_STAGE_LABELS,
  type CodexRuntimeDiagnostic,
} from './codex-runtime'
import { sanitizeDiagnosticText } from './diagnostics'

export function formatCodexDiagnostic(
  status: CodexRuntimeDiagnostic,
  mode: 'probe' | 'run' = 'probe',
): string {
  return sanitizeDiagnosticText(
    [
      `- 结论：${status.code === 'CODEX_RUN_SUCCEEDED' ? '本次 Codex 执行成功' : CODEX_DIAGNOSTIC_LABELS[status.state]}（${status.state}）`,
      `- 检查时间：${status.checkedAt}`,
      `- 阶段 / 错误码：${CODEX_DIAGNOSTIC_STAGE_LABELS[status.stage]}（${status.stage}） / ${status.code}`,
      `- 说明：${status.message}`,
      `- 可执行文件：${status.executable ?? '未找到'}`,
      `- Codex 版本：${status.runtimeVersion ?? '未取得（握手未完成或版本字段不受支持）'}`,
      `- 自定义 CODEX_HOME：${status.customCodexHome === undefined ? '未检查' : status.customCodexHome ? '是' : '否'}`,
      `- 最近请求 / 检查点：${status.requestMethod ?? '-'} / ${status.validationStep ?? '-'}`,
      `- 已发送模型请求：${status.modelRequestSent === undefined ? '未记录' : status.modelRequestSent ? '是' : '否'}`,
      ...(status.nativeTools ? [`- 原生工具判定：${JSON.stringify(status.nativeTools)}`] : []),
      ...(status.thread
        ? [
            `- 会话操作：${status.thread.method}`,
            `- 请求权限：${JSON.stringify(status.thread.requested)}`,
            `- 返回权限：${status.thread.returned ? JSON.stringify(status.thread.returned) : '尚未收到成功响应'}`,
            `- 权限不匹配项：${status.thread.returned ? status.thread.mismatches.join(', ') || '无' : '尚未校验'}`,
            `- 恢复标识一致：${status.thread.sameSession === null ? '不适用或尚未返回' : status.thread.sameSession ? '是' : '否'}`,
            '- 目录只记录数量及与请求工作区的匹配数；missing/null/other 表示字段缺失或类型不符，不输出实际目录或原始配置。',
          ]
        : []),
      ...(status.tools ? [`- 工具隔离事实：${JSON.stringify(status.tools)}`] : []),
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
