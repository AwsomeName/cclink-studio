import type { CodexDiagnosticStage, CodexDiagnosticState } from '../../../shared/codex-runtime'

export class CodexRuntimeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly state: CodexDiagnosticState,
    readonly stage: CodexDiagnosticStage,
  ) {
    super(message)
  }
}

/** Keep useful transport facts without exporting raw RPC messages or credential-bearing URLs. */
export function codexRpcError(
  code: unknown,
  message: unknown,
  stage: CodexDiagnosticStage,
): CodexRuntimeError {
  const detail = typeof message === 'string' ? message : ''
  const http = detail.match(
    /(?:HTTP(?:\s+status)?|status(?:\s+code)?)\s*[:=]?\s*([45]\d\d)\b/i,
  )?.[1]
  const mcp = /mcp|cclink_studio/i.test(detail)
  const state = ['thread', 'tools', 'turn'].includes(stage) ? 'run-failed' : 'start-failed'
  return new CodexRuntimeError(
    http
      ? `CODEX_${mcp ? 'MCP_' : ''}HTTP_${http}`
      : `CODEX_RPC_${Number.isSafeInteger(code) ? code : 'FAILED'}`,
    http
      ? `${mcp ? 'Studio MCP 工具连接' : 'Codex 服务请求'}失败（HTTP ${http}）。${mcp ? '请检查本机代理是否排除 localhost 和 127.0.0.1。' : '请检查登录状态、网络和服务配置。'}`
      : 'Codex 拒绝协议请求，请结合失败阶段检查本机版本和配置。',
    state,
    stage,
  )
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function assertNativeChatgptConfiguration(
  account: Record<string, unknown>,
  config: Record<string, unknown>,
): void {
  if (!account.account) {
    throw new CodexRuntimeError(
      'CODEX_AUTH_REQUIRED',
      '本机 Codex 尚未登录 ChatGPT 账号（需要文件凭证）。请先在本机 Codex 完成登录；Studio 不读取钥匙串或回退到 API Key。',
      'not-logged-in',
      'account',
    )
  }
  if (record(account.account).type !== 'chatgpt' || account.requiresOpenaiAuth !== true) {
    throw new CodexRuntimeError(
      'CODEX_AUTH_UNSUPPORTED',
      '本机 Codex 使用的不是受支持的 ChatGPT 文件登录；Studio 不回退到 API Key 或其他认证方式。',
      'unsupported-auth',
      'account',
    )
  }
  let officialEndpoint = true
  if (config.chatgpt_base_url) {
    try {
      officialEndpoint = new URL(String(config.chatgpt_base_url)).origin === 'https://chatgpt.com'
    } catch {
      officialEndpoint = false
    }
  }
  if (
    (config.model_provider && config.model_provider !== 'openai') ||
    Object.keys(record(record(config.model_providers).openai)).length > 0 ||
    !officialEndpoint
  ) {
    throw new CodexRuntimeError(
      'CODEX_CONFIG_UNSUPPORTED',
      '默认 Codex 仅使用官方 ChatGPT 账号服务；检测到自定义提供商或认证端点，已停止运行，未修改本机配置。',
      'unsupported-config',
      'config',
    )
  }
}
