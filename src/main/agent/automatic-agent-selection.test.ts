import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackendConfig } from '../agent-core/backends/types'
import { probeCodexRuntime } from './codex-runtime-diagnostics'
import { selectAutomaticTaskAgent } from './automatic-agent-selection'

vi.mock('./codex-runtime-diagnostics', () => ({ probeCodexRuntime: vi.fn() }))
const probe = vi.mocked(probeCodexRuntime)
const claudeConfig: BackendConfig = {
  type: 'local-claude-code',
  claudeCode: {
    apiKey: 'private-key',
    claudeCodePath: process.execPath,
  },
}
const unavailable = {
  state: 'not-logged-in',
  code: 'CODEX_AUTH_REQUIRED',
  message: 'Codex 未登录',
} as const
beforeEach(() => probe.mockResolvedValue(unavailable as never))
afterEach(() => vi.clearAllMocks())

describe('automatic task Agent selection', () => {
  it('prefers Codex and probes the target workspace without sending a model turn', async () => {
    probe.mockResolvedValue({ state: 'ready', code: 'CODEX_READY' } as never)
    const result = await selectAutomaticTaskAgent({
      workspacePath: '/workspace/task',
      claudeConfig,
      signal: new AbortController().signal,
    })
    expect(result.binding).toEqual({ kind: 'codex' })
    expect(probe).toHaveBeenCalledWith(expect.any(AbortSignal), '/workspace/task')
  })
  it('selects configured Claude when Codex is unavailable', async () => {
    expect(
      await selectAutomaticTaskAgent({ claudeConfig, signal: new AbortController().signal }),
    ).toEqual({
      binding: { kind: 'claude-code' },
      reason: 'CODEX_UNAVAILABLE:CODEX_AUTH_REQUIRED',
    })
  })
  it.each([
    { ...claudeConfig, claudeCode: { ...claudeConfig.claudeCode, apiKey: '' } },
    {
      ...claudeConfig,
      claudeCode: { ...claudeConfig.claudeCode, runtimeError: 'private-runtime-error' },
    },
    {
      ...claudeConfig,
      claudeCode: { ...claudeConfig.claudeCode, claudeCodePath: '/missing/studio/claude' },
    },
    { type: 'cclink-agent', cclinkAgent: { baseUrl: 'private-endpoint', token: 'private-token' } },
  ] as BackendConfig[])(
    'rejects unavailable/unsupported fallback without exposing credentials',
    async (config) => {
      const error = await selectAutomaticTaskAgent({
        claudeConfig: config,
        signal: new AbortController().signal,
      }).catch((error: Error) => error)
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toContain('Codex 未登录')
      expect((error as Error).message).toContain('Claude Code')
      expect((error as Error).message).not.toMatch(/private-/)
    },
  )
  it('does not choose a fallback after cancellation', async () => {
    const controller = new AbortController()
    probe.mockImplementationOnce(async () => {
      controller.abort(new Error('cancelled'))
      return unavailable as never
    })
    await expect(
      selectAutomaticTaskAgent({ claudeConfig, signal: controller.signal }),
    ).rejects.toThrow('cancelled')
  })
})
