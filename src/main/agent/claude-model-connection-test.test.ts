import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Options, Query } from '@anthropic-ai/claude-agent-sdk'
import type { ResolvedClaudeRuntime } from '../../shared/claude-runtime'
import { testClaudeModelConnection } from './claude-model-connection-test'

const runtime: ResolvedClaudeRuntime = {
  source: 'bundled',
  executablePath: '/app/agent-runtime/claude',
  claudeCodeVersion: '2.1.211',
  sdkVersion: '0.3.211',
  fingerprint: 'a'.repeat(64),
  integrity: 'manifest-sha256',
  probedAt: 1,
}

afterEach(() => {
  delete process.env.ANTHROPIC_AUTH_TOKEN
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN
})

describe('testClaudeModelConnection', () => {
  it('runs one isolated tool-free turn with the selected runtime, endpoint, key and model', async () => {
    process.env.ANTHROPIC_AUTH_TOKEN = 'must-not-leak'
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'must-not-leak'
    const sdkQuery = fakeQuery([
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'CCLINK_CONNECTION_OK',
        total_cost_usd: 0.0012,
      },
    ])
    const createQuery = vi.fn((_request: unknown) => sdkQuery)
    const now = vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(350)

    const result = await testClaudeModelConnection(
      {
        runtime,
        apiFormat: 'anthropic',
        apiBaseUrl: 'https://example.com/anthropic',
        apiKey: 'test-key',
        modelName: 'claude-test',
      },
      { createQuery: createQuery as never, now },
    )

    expect(result).toEqual({
      success: true,
      message: '连接成功，API Key 和模型均可用。',
      model: 'claude-test',
      durationMs: 250,
      totalCostUsd: 0.0012,
    })
    const request = createQuery.mock.calls[0]?.[0] as { options?: Options } | undefined
    expect(request?.options).toMatchObject({
      pathToClaudeCodeExecutable: '/app/agent-runtime/claude',
      tools: [],
      allowedTools: [],
      maxTurns: 1,
      maxBudgetUsd: 0.05,
      model: 'claude-test',
    })
    expect(request?.options?.env).toMatchObject({
      ANTHROPIC_API_KEY: 'test-key',
      ANTHROPIC_BASE_URL: 'https://example.com/anthropic',
    })
    expect(request?.options?.env?.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(request?.options?.env?.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
    expect(sdkQuery.close).toHaveBeenCalledOnce()
  })

  it('classifies and redacts an authentication failure', async () => {
    const sdkQuery = fakeQuery([
      { type: 'assistant', error: 'authentication_failed' },
      {
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        result: 'Invalid API key secret-value',
      },
    ])

    const result = await testClaudeModelConnection(
      {
        runtime,
        apiFormat: 'anthropic',
        apiBaseUrl: '',
        apiKey: 'secret-value',
        modelName: 'claude-test',
      },
      { createQuery: (() => sdkQuery) as never, now: () => 100 },
    )

    expect(result).toMatchObject({
      success: false,
      code: 'AUTHENTICATION_FAILED',
    })
    expect(result.message).toContain('[REDACTED]')
    expect(result.message).not.toContain('secret-value')
  })

  it('rejects OpenAI-compatible format before launching the runtime', async () => {
    const createQuery = vi.fn()

    const result = await testClaudeModelConnection(
      {
        runtime,
        apiFormat: 'openai',
        apiBaseUrl: 'https://example.com/v1',
        apiKey: 'test-key',
        modelName: 'gpt-test',
      },
      { createQuery: createQuery as never, now: () => 100 },
    )

    expect(result).toMatchObject({
      success: false,
      code: 'API_FORMAT_UNSUPPORTED',
    })
    expect(createQuery).not.toHaveBeenCalled()
  })
})

function fakeQuery(events: unknown[]): Query & { close: ReturnType<typeof vi.fn> } {
  const iterator = (async function* () {
    for (const event of events) yield event
  })()
  return Object.assign(iterator, { close: vi.fn() }) as unknown as Query & {
    close: ReturnType<typeof vi.fn>
  }
}
