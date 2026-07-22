import { tmpdir } from 'os'
import { query, type Query, type SDKAssistantMessageError } from '@anthropic-ai/claude-agent-sdk'
import type { ResolvedClaudeRuntime } from '../../shared/claude-runtime'
import type {
  ApiFormat,
  ClaudeModelConnectionErrorCode,
  ClaudeModelConnectionTestResult,
} from '../../shared/ipc/settings'

const CONNECTION_TEST_MARKER = 'CCLINK_CONNECTION_OK'
const DEFAULT_TIMEOUT_MS = 45_000
const CONNECTION_TEST_BUDGET_USD = 0.05

export interface ClaudeModelConnectionTestInput {
  runtime: ResolvedClaudeRuntime
  apiFormat: ApiFormat
  apiBaseUrl: string
  apiKey: string
  modelName: string
  timeoutMs?: number
}

export interface ClaudeModelConnectionTestDependencies {
  createQuery: typeof query
  now: () => number
}

const DEFAULT_DEPENDENCIES: ClaudeModelConnectionTestDependencies = {
  createQuery: query,
  now: Date.now,
}

/**
 * Runs an isolated, tool-free SDK turn against the configured provider.
 * It never resumes, mutates, or borrows credentials from an Agent conversation.
 */
export async function testClaudeModelConnection(
  input: ClaudeModelConnectionTestInput,
  dependencies: ClaudeModelConnectionTestDependencies = DEFAULT_DEPENDENCIES,
): Promise<ClaudeModelConnectionTestResult> {
  const startedAt = dependencies.now()
  const apiKey = input.apiKey.trim()
  const modelName = input.modelName.trim()

  if (!apiKey) {
    return failed('AUTH_REQUIRED', '请先保存 API Key，再测试连接。', startedAt, dependencies)
  }
  if (input.apiFormat !== 'anthropic') {
    return failed(
      'API_FORMAT_UNSUPPORTED',
      '内置 Claude Code 当前只支持 Anthropic 兼容 API，不能直接测试 OpenAI Compatible 接口。',
      startedAt,
      dependencies,
    )
  }
  if (!modelName) {
    return failed('MODEL_REQUIRED', '请先填写要测试的模型名称。', startedAt, dependencies)
  }

  const abortController = new AbortController()
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    abortController.abort()
  }, normalizeTimeout(input.timeoutMs))
  let sdkQuery: Query | null = null
  let assistantError: SDKAssistantMessageError | undefined

  try {
    sdkQuery = dependencies.createQuery({
      prompt: `Reply with exactly ${CONNECTION_TEST_MARKER}. Do not use tools.`,
      options: {
        abortController,
        cwd: tmpdir(),
        pathToClaudeCodeExecutable: input.runtime.executablePath,
        env: buildConnectionTestEnvironment(apiKey, input.apiBaseUrl),
        tools: [],
        allowedTools: [],
        maxTurns: 1,
        maxBudgetUsd: CONNECTION_TEST_BUDGET_USD,
        model: modelName,
      },
    })

    for await (const event of sdkQuery) {
      if (event.type === 'assistant' && event.error) assistantError = event.error
      if (event.type !== 'result') continue

      if (event.is_error) {
        const detail = extractResultError(event)
        return connectionFailure(detail, assistantError, apiKey, timedOut, startedAt, dependencies)
      }

      return {
        success: true,
        message: '连接成功，API Key 和模型均可用。',
        model: modelName,
        durationMs: elapsed(startedAt, dependencies),
        ...(typeof event.total_cost_usd === 'number' ? { totalCostUsd: event.total_cost_usd } : {}),
      }
    }

    return connectionFailure(
      'Claude Agent SDK 响应流结束，但没有返回结果。',
      assistantError,
      apiKey,
      timedOut,
      startedAt,
      dependencies,
    )
  } catch (error) {
    return connectionFailure(
      error instanceof Error ? error.message : String(error),
      assistantError,
      apiKey,
      timedOut,
      startedAt,
      dependencies,
    )
  } finally {
    clearTimeout(timeout)
    sdkQuery?.close()
  }
}

function buildConnectionTestEnvironment(
  apiKey: string,
  apiBaseUrl: string,
): Record<string, string | undefined> {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (
      key === 'ANTHROPIC_API_KEY' ||
      key === 'ANTHROPIC_AUTH_TOKEN' ||
      key === 'ANTHROPIC_BASE_URL' ||
      key === 'CLAUDE_CODE_OAUTH_TOKEN' ||
      key === 'CLAUDE_CODE_USE_BEDROCK' ||
      key === 'CLAUDE_CODE_USE_VERTEX' ||
      key === 'CLAUDE_CODE_USE_FOUNDRY' ||
      key.startsWith('ANTHROPIC_DEFAULT_') ||
      key.startsWith('ANTHROPIC_MODEL') ||
      key.startsWith('ANTHROPIC_SMALL_FAST_MODEL') ||
      /^CLAUDE_CODE_.*MODEL$/.test(key)
    ) {
      delete env[key]
    }
  }

  return {
    ...env,
    ANTHROPIC_API_KEY: apiKey,
    ...(apiBaseUrl.trim() ? { ANTHROPIC_BASE_URL: apiBaseUrl.trim() } : {}),
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    CLAUDE_AGENT_SDK_CLIENT_APP: 'cclink-studio/0.1.1-connection-test',
  }
}

function connectionFailure(
  rawMessage: string,
  assistantError: SDKAssistantMessageError | undefined,
  apiKey: string,
  timedOut: boolean,
  startedAt: number,
  dependencies: ClaudeModelConnectionTestDependencies,
): ClaudeModelConnectionTestResult {
  if (timedOut) {
    return failed(
      'REQUEST_TIMEOUT',
      '连接测试超时。请检查 API 地址、网络和代理设置。',
      startedAt,
      dependencies,
    )
  }

  const detail = redactSecret(rawMessage, apiKey)
  const code = classifyConnectionFailure(detail, assistantError)
  return failed(code, failureMessage(code, detail), startedAt, dependencies)
}

function classifyConnectionFailure(
  message: string,
  assistantError?: SDKAssistantMessageError,
): ClaudeModelConnectionErrorCode {
  if (
    assistantError === 'authentication_failed' ||
    assistantError === 'oauth_org_not_allowed' ||
    assistantError === 'billing_error'
  ) {
    return 'AUTHENTICATION_FAILED'
  }
  if (assistantError === 'model_not_found') return 'MODEL_NOT_FOUND'
  if (assistantError === 'rate_limit') return 'RATE_LIMITED'
  if (assistantError === 'overloaded' || assistantError === 'server_error') {
    return 'PROVIDER_UNAVAILABLE'
  }

  if (
    /authentication|unauthorized|invalid (?:api|x-api) key|api error:\s*401|http\s*401/i.test(
      message,
    )
  ) {
    return 'AUTHENTICATION_FAILED'
  }
  if (
    /model[_ -]?not[_ -]?found|unknown model|model .* (?:does not exist|not found)/i.test(message)
  ) {
    return 'MODEL_NOT_FOUND'
  }
  if (/rate[_ -]?limit|too many requests|api error:\s*429|http\s*429/i.test(message)) {
    return 'RATE_LIMITED'
  }
  if (/empty or malformed response|proxy or gateway|bad gateway|gateway timeout/i.test(message)) {
    return 'PROXY_GATEWAY_ERROR'
  }
  if (
    /econnreset|econnrefused|etimedout|enotfound|network error|socket hang up|fetch failed/i.test(
      message,
    )
  ) {
    return 'NETWORK_UNAVAILABLE'
  }
  if (/overloaded|service unavailable|api error:\s*5\d\d|http\s*5\d\d/i.test(message)) {
    return 'PROVIDER_UNAVAILABLE'
  }
  return 'REQUEST_FAILED'
}

function failureMessage(code: ClaudeModelConnectionErrorCode, detail: string): string {
  const message =
    code === 'AUTHENTICATION_FAILED'
      ? '认证失败。请检查 API Key、API 地址以及该 Key 的模型权限。'
      : code === 'MODEL_NOT_FOUND'
        ? '模型不可用。请检查模型名称以及当前账号是否有权访问。'
        : code === 'RATE_LIMITED'
          ? '服务触发限流。请稍后重试或检查供应商配额。'
          : code === 'PROXY_GATEWAY_ERROR'
            ? '代理或网关返回异常响应。请检查 API 地址和代理绕过规则。'
            : code === 'NETWORK_UNAVAILABLE'
              ? '无法连接模型服务。请检查网络、DNS 和代理设置。'
              : code === 'PROVIDER_UNAVAILABLE'
                ? '模型服务当前不可用或过载，请稍后重试。'
                : '模型连接测试失败。'
  const normalizedDetail = detail.trim().slice(0, 1000)
  return normalizedDetail ? `${message}\n${normalizedDetail}` : message
}

function extractResultError(event: { result?: unknown; errors?: unknown }): string {
  if (typeof event.result === 'string' && event.result.trim()) return event.result
  if (Array.isArray(event.errors)) {
    const errors = event.errors.filter((item): item is string => typeof item === 'string')
    if (errors.length > 0) return errors.join('\n')
  }
  return 'Claude Agent SDK 返回错误结果。'
}

function redactSecret(message: string, secret: string): string {
  return secret ? message.split(secret).join('[REDACTED]') : message
}

function failed(
  code: ClaudeModelConnectionErrorCode,
  message: string,
  startedAt: number,
  dependencies: ClaudeModelConnectionTestDependencies,
): ClaudeModelConnectionTestResult {
  return {
    success: false,
    code,
    message,
    durationMs: elapsed(startedAt, dependencies),
  }
}

function elapsed(startedAt: number, dependencies: ClaudeModelConnectionTestDependencies): number {
  return Math.max(0, dependencies.now() - startedAt)
}

function normalizeTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined || !Number.isFinite(timeoutMs)) return DEFAULT_TIMEOUT_MS
  return Math.min(120_000, Math.max(1_000, Math.trunc(timeoutMs)))
}
