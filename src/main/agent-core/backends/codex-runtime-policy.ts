import type { CodexDiagnosticStage, CodexDiagnosticState } from '../../../shared/codex-runtime'
import { codexPermissionMismatches } from './codex-permission-diagnostics'

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
  method?: string,
): CodexRuntimeError {
  const detail = typeof message === 'string' ? message : ''
  const state = ['thread', 'tools', 'turn'].includes(stage) ? 'run-failed' : 'start-failed'
  // Classify known native errors without copying IDs, paths, prompts or provider payloads.
  // A missing rollout is not proof of deletion: a different CODEX_HOME has the same result.
  if (method === 'thread/resume') {
    const reason = /^no rollout found for (?:thread|conversation) id\b/i.test(detail)
      ? {
          code: 'CODEX_THREAD_NOT_FOUND',
          message:
            '本机 Codex 找不到此会话的原生记录。请在原电脑、原 Codex 数据目录恢复该记录后重试；Studio 已保留原会话，未自动新建替代会话。',
        }
      : /^session\s+\S+\s+is archived\./i.test(detail)
        ? {
            code: 'CODEX_THREAD_ARCHIVED',
            message: '此 Codex 会话已归档。请在 Codex 中取消归档后重试；Studio 已保留原会话。',
          }
        : /^invalid thread id:/i.test(detail)
          ? {
              code: 'CODEX_THREAD_ID_INVALID',
              message:
                '此会话保存的 Codex 标识无效。请检查会话恢复记录；Studio 未删除历史或更换会话。',
            }
          : null
    if (reason)
      return new CodexRuntimeError(
        reason.code,
        `恢复已有会话（thread/resume）失败：${reason.message}`,
        state,
        stage,
      )
  }
  const http = detail.match(
    /(?:HTTP(?:\s+status)?|status(?:\s+code)?)\s*[:=]?\s*([45]\d\d)\b/i,
  )?.[1]
  const mcp = /mcp|cclink_studio/i.test(detail)
  const operation =
    method === 'thread/resume'
      ? '恢复已有会话（thread/resume）'
      : method === 'thread/start'
        ? '创建会话（thread/start）'
        : '协议'
  return new CodexRuntimeError(
    http
      ? `CODEX_${mcp ? 'MCP_' : ''}HTTP_${http}`
      : `CODEX_RPC_${Number.isSafeInteger(code) ? code : 'FAILED'}`,
    http
      ? `${mcp ? 'Studio MCP 工具连接' : 'Codex 服务请求'}失败（HTTP ${http}）。${mcp ? '请检查本机代理是否排除 localhost 和 127.0.0.1。' : '请检查登录状态、网络和服务配置。'}`
      : `Codex 拒绝${operation}请求（RPC ${Number.isSafeInteger(code) ? code : 'FAILED'}），请结合失败阶段检查本机版本和配置。`,
    state,
    stage,
  )
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/** Compare the effective native policy before any model turn; export only fixed labels. */
export function assertCodexPermissionBoundary(
  response: Record<string, unknown>,
  nativeToolsAllowed: boolean,
): void {
  const sandbox = record(response.sandbox)
  const expectedSandbox = nativeToolsAllowed ? 'workspaceWrite' : 'readOnly'
  const enumLabel = (value: unknown, allowed: string[]) =>
    value === undefined
      ? 'missing'
      : typeof value === 'string' && allowed.includes(value)
        ? value
        : 'other'
  const failures: string[] = []
  const mismatches = codexPermissionMismatches(response, nativeToolsAllowed)
  if (mismatches.includes('approvalPolicy'))
    failures.push(
      `approvalPolicy: expected=untrusted, actual=${enumLabel(response.approvalPolicy, ['untrusted', 'on-failure', 'on-request', 'never'])}`,
    )
  if (mismatches.includes('approvalsReviewer'))
    failures.push(
      `approvalsReviewer: expected=user, actual=${enumLabel(response.approvalsReviewer, ['user', 'guardian'])}`,
    )
  if (mismatches.includes('sandbox.type'))
    failures.push(
      `sandbox.type: expected=${expectedSandbox}, actual=${enumLabel(sandbox.type, ['workspaceWrite', 'readOnly', 'dangerFullAccess', 'externalSandbox'])}`,
    )
  if (mismatches.includes('sandbox.networkAccess'))
    failures.push(
      `sandbox.networkAccess: expected=false, actual=${sandbox.networkAccess === true ? 'true' : sandbox.networkAccess === undefined ? 'missing' : 'other'}`,
    )
  if (mismatches.includes('sandbox.writableRoots'))
    failures.push('sandbox.writableRoots: expected=empty, actual=non-empty')
  if (failures.length)
    throw new CodexRuntimeError(
      'CODEX_PERMISSION_BOUNDARY_MISMATCH',
      `本机 Codex 返回的权限与 Studio 要求不一致，已在发送模型请求前停止。${failures.join('；')}。原会话已保留。`,
      'run-failed',
      'thread',
    )
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
