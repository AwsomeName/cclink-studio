import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  AgentPanelView,
  isAgentComposerCandidateSelectionKey,
  resolveAgentComposerKeyDecision,
  type AgentPanelViewModel,
} from './agent-panel-view'

beforeAll(() => {
  vi.stubGlobal('React', React)
})

afterAll(() => {
  vi.unstubAllGlobals()
})

describe('AgentPanelView product contract', () => {
  it('never submits an IME candidate confirmation and preserves Shift+Enter', () => {
    const base = {
      key: 'Enter',
      shiftKey: false,
      isComposing: false,
      keyCode: 13,
      handledBeforeSubmit: false,
      canSubmit: true,
    }
    expect(resolveAgentComposerKeyDecision({ ...base, isComposing: true })).toBe(
      'ignore-composition',
    )
    expect(resolveAgentComposerKeyDecision({ ...base, keyCode: 229 })).toBe('ignore-composition')
    expect(resolveAgentComposerKeyDecision(base)).toBe('submit')
    expect(resolveAgentComposerKeyDecision({ ...base, shiftKey: true })).toBe('none')
    expect(isAgentComposerCandidateSelectionKey({ key: 'Enter', shiftKey: true })).toBe(false)
  })

  it.each(['idle', 'messages', 'running', 'error', 'permission'] as const)(
    'renders identical landmarks and action order for equivalent %s models',
    (scenario) => {
      const local = renderToStaticMarkup(<AgentPanelView model={model('local', scenario)} />)
      const remote = renderToStaticMarkup(<AgentPanelView model={model('remote', scenario)} />)
    const landmarks = (html: string): string[] =>
      [...html.matchAll(/data-agent-landmark="([^"]+)"/gu)].map((match) => match[1])
    const actions = (html: string): string[] =>
      [...html.matchAll(/data-agent-action="([^"]+)"/gu)].map((match) => match[1])

      expect(landmarks(local)).toEqual([
        'header',
        'context',
        'notice-permission',
        'timeline',
        'composer',
        'action-bar',
      ])
      expect(landmarks(remote)).toEqual(landmarks(local))
      expect(actions(remote)).toEqual([
        'diagnostics',
        'addContext',
        'role',
        'permissionMode',
        'contextUsage',
        'runtime',
        scenario === 'running' ? 'stop' : 'send',
      ])
      expect(actions(local)).toEqual(actions(remote))
      expect(local.match(/<textarea/gu)).toHaveLength(1)
      expect(remote.match(/<textarea/gu)).toHaveLength(1)
    },
  )
})

function model(
  runtime: 'local' | 'remote',
  scenario: 'idle' | 'messages' | 'running' | 'error' | 'permission',
): AgentPanelViewModel {
  const disabled = { state: 'disabled' as const, reason: '测试中不可用' }
  const remoteActionBar = {
    kind: 'remote' as const,
    runtimeLabel: runtime === 'local' ? '本地 Runtime' : '远程 Runtime',
    capabilities: {
      addContext: disabled,
      role: disabled,
      permissionMode: disabled,
      contextUsage: disabled,
      runtime: disabled,
    },
  }
  return {
    runtime,
    variant: 'side',
    header: {
      title: 'Agent',
      runtimeLabel: runtime,
      status: { tone: 'ready', label: '已就绪', detail: '已就绪' },
      diagnostics: { state: 'enabled', label: '诊断', onInvoke: () => undefined },
    },
    contextChips: [{ id: 'workspace', kind: 'workspace', label: '/workspace', detail: runtime }],
    notices:
      scenario === 'error'
        ? [{ id: 'error', tone: 'error', title: 'Agent 离线', detail: '连接失败' }]
        : [],
    permissions:
      scenario === 'permission'
        ? [
            {
              id: 'permission',
              title: '请求执行操作',
              rows: [{ label: '操作', value: '写入文件' }],
              actions: [
                {
                  id: 'approve',
                  label: '允许',
                  tone: 'approve',
                  onInvoke: () => undefined,
                },
              ],
            },
          ]
        : [],
    timeline:
      scenario === 'messages' || scenario === 'running'
        ? [
            {
              kind: 'message',
              id: 'message',
              conversationId: 'conversation',
              workspaceKey: 'workspace',
              message: {
                id: 'message',
                role: 'assistant',
                content: [{ type: 'text', text: '消息' }],
                rawText: '消息',
                timestamp: 1,
                isStreaming: scenario === 'running',
              },
            },
          ]
        : [],
    empty: { title: '开始工作', description: '描述' },
    composer: {
      value: '',
      placeholder: '输入消息',
      canSubmit: false,
      submitting: scenario === 'running',
      stopCapability:
        scenario === 'running'
          ? { state: 'disabled', reason: '当前 Runtime 不支持停止' }
          : { state: 'hidden' },
      onChange: () => undefined,
      onSubmit: () => undefined,
      actionBar: remoteActionBar,
    },
  }
}
