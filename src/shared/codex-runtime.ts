export type CodexDiagnosticState =
  | 'ready'
  | 'not-found'
  | 'not-logged-in'
  | 'unsupported-auth'
  | 'unsupported-config'
  | 'start-failed'
  | 'run-failed'

export type CodexDiagnosticStage =
  | 'discovery'
  | 'spawn'
  | 'initialize'
  | 'account'
  | 'config'
  | 'thread'
  | 'tools'
  | 'turn'

/** Allowlisted facts only: never include account identity, credentials, prompts or stderr. */
export interface CodexRuntimeDiagnostic {
  checkedAt: string
  state: CodexDiagnosticState
  stage: CodexDiagnosticStage
  code: string
  message: string
  executable: string | null
  searchedPaths: string[]
  platform: string
  arch: string
  auth: 'not-checked' | 'missing' | 'chatgpt' | 'unsupported'
  exitCode: number | null
  signal: string | null
}

export const CODEX_DIAGNOSTIC_LABELS: Record<CodexDiagnosticState, string> = {
  ready: '启动及本地登录检查通过',
  'not-found': '未找到本机 Codex',
  'not-logged-in': '未登录 ChatGPT',
  'unsupported-auth': '登录方式不支持',
  'unsupported-config': '配置不兼容',
  'start-failed': 'Codex 启动失败',
  'run-failed': 'Codex 运行失败',
}

export const CODEX_DIAGNOSTIC_STAGE_LABELS: Record<CodexDiagnosticStage, string> = {
  discovery: '查找程序',
  spawn: '启动进程',
  initialize: '协议握手',
  account: '读取本地登录',
  config: '校验配置',
  thread: '创建或恢复会话',
  tools: 'Studio 工具初始化',
  turn: '模型请求',
}
