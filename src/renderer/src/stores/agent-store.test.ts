import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  buildAgentConversationWorkspaceSnapshot,
  resetAgentWorkspaceActiveConversationMemoryForTests,
  useAgentStore,
} from './agent-store'
import type { ContentBlock } from '../types'
import { localWorkspaceRef } from '../../../shared/workspace-ref'
import { createAgentConversationState } from '../features/agent-conversations/conversation-state'
import { useSettingsStore } from './settings-store'

beforeEach(() => {
  resetAgentWorkspaceActiveConversationMemoryForTests()
  // 重置 store 到初始状态
  const initial = useAgentStore.getInitialState()
  useAgentStore.setState(initial, true)
  useSettingsStore.setState(useSettingsStore.getInitialState(), true)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useAgentStore', () => {
  describe('addUserMessage', () => {
    it('添加一条用户消息', () => {
      const before = useAgentStore.getState().messages.length
      useAgentStore.getState().addUserMessage('你好')

      const msgs = useAgentStore.getState().messages
      expect(msgs.length).toBe(before + 1)
      const last = msgs[msgs.length - 1]
      expect(last.role).toBe('user')
      expect(last.rawText).toBe('你好')
    })
  })

  describe('addSystemMessage', () => {
    it('添加一条系统消息', () => {
      useAgentStore.getState().addSystemMessage('连接错误')

      const msgs = useAgentStore.getState().messages
      const last = msgs[msgs.length - 1]
      expect(last.role).toBe('system')
      expect(last.rawText).toBe('连接错误')
    })
  })

  describe('run lifecycle', () => {
    it('发送后立即进入启动中，不等待首个流事件', () => {
      useAgentStore.getState().addUserMessage('开始执行')
      useAgentStore.getState().beginRun()

      expect(useAgentStore.getState().loading).toBe(true)
      expect(useAgentStore.getState().backendState).toBe('connecting')
      expect(useAgentStore.getState().conversations['agent-default'].runStatus).toBe('starting')
      expect(useAgentStore.getState().conversations['agent-default'].activeRunId).toMatch(/^run-/)
    })

    it('只接受与当前角色和 Skill 引用一致的运行回执', () => {
      const conversationId = useAgentStore.getState().activeConversationId
      useAgentStore.setState((state) => ({
        conversations: {
          ...state.conversations,
          [conversationId]: {
            ...state.conversations[conversationId],
            mountedSkills: [{ skillId: 'grill-me', version: 1 }],
          },
        },
      }))
      const conversation = useAgentStore.getState().conversations[conversationId]
      const receipt = {
        conversationId,
        runId: 'run-1',
        roleRef: conversation.configuration.roleRef,
        configurationRevision: conversation.configuration.revision,
        configurationFingerprint: 'a'.repeat(64),
        runtimeSessionMode: 'new' as const,
        skills: [
          {
            ref: { skillId: 'grill-me', version: 1 },
            contentHash: 'b'.repeat(64),
          },
        ],
      }

      expect(useAgentStore.getState().setRunConfigurationReceipt(receipt)).toBe(true)
      expect(useAgentStore.getState().setRunConfigurationReceipt({ ...receipt, skills: [] })).toBe(
        false,
      )
    })

    it('切回项目时以主进程 busy 状态修正会话运行态', () => {
      useAgentStore.getState().beginRun()
      useAgentStore.getState().reconcileRuntimeStatus({
        connected: true,
        busy: true,
        ready: true,
        sessionId: 'session-1',
      })

      expect(useAgentStore.getState().loading).toBe(true)
      expect(useAgentStore.getState().backendState).toBe('streaming')
      expect(useAgentStore.getState().sessionId).toBe('session-1')
    })
  })

  describe('startStreamingMessage', () => {
    it('创建流式消息并设置状态', () => {
      useAgentStore.getState().startStreamingMessage('msg-1')

      expect(useAgentStore.getState().streamingMessageId).toBe('msg-1')
      expect(useAgentStore.getState().loading).toBe(true)
      expect(useAgentStore.getState().backendState).toBe('streaming')

      const msgs = useAgentStore.getState().messages
      const last = msgs[msgs.length - 1]
      expect(last.id).toBe('msg-1')
      expect(last.role).toBe('assistant')
      expect(last.isStreaming).toBe(true)
      expect(last.content).toEqual([])
    })
  })

  describe('appendStreamDelta', () => {
    it('无 streamingMessageId 时为 no-op', () => {
      const before = useAgentStore.getState().messages
      useAgentStore.getState().appendStreamDelta('text')
      expect(useAgentStore.getState().messages).toBe(before)
    })

    it('追加 text delta 到空内容 → 创建新 text block', () => {
      useAgentStore.getState().startStreamingMessage('msg-1')
      useAgentStore.getState().appendStreamDelta('Hello')

      const msg = useAgentStore.getState().messages.find((m) => m.id === 'msg-1')!
      expect(msg.content).toHaveLength(1)
      expect(msg.content[0]).toEqual({ type: 'text', text: 'Hello' })
      expect(msg.rawText).toBe('Hello')
    })

    it('追加 text delta 到已有 text block → 拼接', () => {
      useAgentStore.getState().startStreamingMessage('msg-1')
      useAgentStore.getState().appendStreamDelta('Hello')
      useAgentStore.getState().appendStreamDelta(' World')

      const msg = useAgentStore.getState().messages.find((m) => m.id === 'msg-1')!
      expect(msg.content).toHaveLength(1)
      expect(msg.content[0]).toEqual({ type: 'text', text: 'Hello World' })
      expect(msg.rawText).toBe('Hello World')
    })

    it('追加 thinking delta 到已有 thinking block → 拼接', () => {
      useAgentStore.getState().startStreamingMessage('msg-1')
      // 先添加一个 thinking block
      const thinkingBlock: ContentBlock = { type: 'thinking', thinking: '' }
      useAgentStore.getState().appendContentBlock(thinkingBlock)
      // 追加 delta
      useAgentStore.getState().appendStreamDelta('hmm...')
      useAgentStore.getState().appendStreamDelta(' let me think')

      const msg = useAgentStore.getState().messages.find((m) => m.id === 'msg-1')!
      const block = msg.content[msg.content.length - 1]
      expect(block.type).toBe('thinking')
      if (block.type === 'thinking') {
        expect(block.thinking).toBe('hmm... let me think')
      }
    })

    it('tool_use delta 累积 JSON 并在完整时解析', () => {
      useAgentStore.getState().startStreamingMessage('msg-1')
      // 添加一个 tool_use block
      const toolBlock: ContentBlock = {
        type: 'tool_use',
        id: 't1',
        name: 'browser_click',
        input: {},
      }
      useAgentStore.getState().appendContentBlock(toolBlock)

      // 累积部分 JSON
      useAgentStore.getState().appendStreamDelta('{"sel')
      let msg = useAgentStore.getState().messages.find((m) => m.id === 'msg-1')!
      let block = msg.content[msg.content.length - 1]
      expect(block.type).toBe('tool_use')
      if (block.type === 'tool_use') {
        expect(block._rawInputJson).toBe('{"sel')
        // JSON 尚未完整，input 保持空
        expect(block.input).toEqual({})
      }
      // rawText 不应包含 tool_use delta
      expect(msg.rawText).toBe('')

      // 补全 JSON
      useAgentStore.getState().appendStreamDelta('ector":".btn"}')
      msg = useAgentStore.getState().messages.find((m) => m.id === 'msg-1')!
      block = msg.content[msg.content.length - 1]
      if (block.type === 'tool_use') {
        expect(block.input).toEqual({ selector: '.btn' })
      }
    })

    it('tool_use 后的 text delta → 继续累积到 tool_use（JSON 解析失败则暂存）', () => {
      useAgentStore.getState().startStreamingMessage('msg-1')
      // 添加 tool_use block
      useAgentStore.getState().appendContentBlock({
        type: 'tool_use',
        id: 't1',
        name: 'browser_click',
        input: { selector: '.btn' },
      })
      // 后续非 JSON delta — 会作为 tool_use 的 _rawInputJson 暂存
      useAgentStore.getState().appendStreamDelta('not-json')

      const msg = useAgentStore.getState().messages.find((m) => m.id === 'msg-1')!
      expect(msg.content).toHaveLength(1)
      const block = msg.content[0]
      expect(block.type).toBe('tool_use')
      if (block.type === 'tool_use') {
        expect(block._rawInputJson).toBe('not-json')
      }
      // tool_use delta 不写入 rawText
      expect(msg.rawText).toBe('')
    })

    it('内容为空（刚 startStreamingMessage）时的 text delta → 创建新 text block', () => {
      useAgentStore.getState().startStreamingMessage('msg-1')
      // 内容为 []，lastBlock 是 undefined → 走 else 分支创建新 text block
      useAgentStore.getState().appendStreamDelta('Hello')

      const msg = useAgentStore.getState().messages.find((m) => m.id === 'msg-1')!
      expect(msg.content).toHaveLength(1)
      expect(msg.content[0]).toEqual({ type: 'text', text: 'Hello' })
      expect(msg.rawText).toBe('Hello')
    })
  })

  describe('appendContentBlock', () => {
    it('追加新内容块到流式消息', () => {
      useAgentStore.getState().startStreamingMessage('msg-1')
      const block: ContentBlock = {
        type: 'tool_use',
        id: 't1',
        name: 'browser_navigate',
        input: { url: 'https://example.com' },
      }
      useAgentStore.getState().appendContentBlock(block)

      const msg = useAgentStore.getState().messages.find((m) => m.id === 'msg-1')!
      expect(msg.content).toHaveLength(1)
      expect(msg.content[0]).toEqual(block)
    })
  })

  describe('finishStreamingMessage', () => {
    it('标记流式结束并恢复状态', () => {
      useAgentStore.getState().startStreamingMessage('msg-1')
      useAgentStore.getState().appendStreamDelta('Hello')

      useAgentStore.getState().finishStreamingMessage()

      expect(useAgentStore.getState().streamingMessageId).toBeNull()
      expect(useAgentStore.getState().loading).toBe(false)
      expect(useAgentStore.getState().backendState).toBe('connected')
      expect(useAgentStore.getState().conversations['agent-default'].runStatus).toBe('completed')

      const msg = useAgentStore.getState().messages.find((m) => m.id === 'msg-1')!
      expect(msg.isStreaming).toBeFalsy()
    })
  })

  describe('cancelStreaming', () => {
    it('取消流式并恢复状态', () => {
      useAgentStore.getState().startStreamingMessage('msg-1')
      useAgentStore.getState().appendStreamDelta('部分内容')

      useAgentStore.getState().cancelStreaming()

      expect(useAgentStore.getState().streamingMessageId).toBeNull()
      expect(useAgentStore.getState().loading).toBe(false)

      // 保留已接收的部分内容
      const msg = useAgentStore.getState().messages.find((m) => m.id === 'msg-1')!
      expect(msg.isStreaming).toBeFalsy()
      expect(msg.rawText).toBe('部分内容')
    })
  })

  describe('clearMessages', () => {
    it('重置为欢迎消息', async () => {
      useAgentStore.getState().addUserMessage('test')
      useAgentStore.getState().setSessionId('sess-1')
      useAgentStore.getState().setLastCost(0.5)

      await useAgentStore.getState().clearMessages()

      const state = useAgentStore.getState()
      expect(state.messages).toHaveLength(1)
      expect(state.messages[0].id).toBe('welcome')
      expect(state.sessionId).toBeNull()
      expect(state.lastCost).toBeNull()
    })
  })

  describe('多会话', () => {
    it('新会话读取全局默认角色，但不改动已有会话', () => {
      const existingId = useAgentStore.getState().activeConversationId
      useSettingsStore.setState((state) => ({
        settings: {
          ...state.settings,
          defaultAgentRoleRef: { roleId: 'product-lead', version: 1 },
        },
      }))

      const nextId = useAgentStore.getState().createConversation()

      expect(useAgentStore.getState().conversations[existingId].configuration.roleRef).toEqual({
        roleId: 'default-assistant',
        version: 1,
      })
      expect(useAgentStore.getState().conversations[nextId].configuration.roleRef).toEqual({
        roleId: 'product-lead',
        version: 1,
      })
    })

    it('新建会话并切换时保留各自消息', () => {
      useAgentStore.getState().addUserMessage('默认会话')
      const firstId = useAgentStore.getState().activeConversationId
      const secondId = useAgentStore.getState().createConversation()

      expect(useAgentStore.getState().activeConversationId).toBe(secondId)
      useAgentStore.getState().addUserMessage('第二个会话')

      useAgentStore.getState().switchConversation(firstId)
      expect(useAgentStore.getState().messages.at(-1)?.rawText).toBe('默认会话')

      useAgentStore.getState().switchConversation(secondId)
      expect(useAgentStore.getState().messages.at(-1)?.rawText).toBe('第二个会话')
    })

    it('新建激活会话时镜像状态指向新会话而不是旧消息', () => {
      useAgentStore.getState().addUserMessage('旧会话内容')
      const id = useAgentStore.getState().createConversation()
      const state = useAgentStore.getState()

      expect(state.activeConversationId).toBe(id)
      expect(state.messages).toBe(state.conversations[id].messages)
      expect(state.messages).toHaveLength(1)
      expect(state.messages[0].id).toBe('welcome')
      expect(state.messages.some((message) => message.rawText === '旧会话内容')).toBe(false)
    })

    it('重命名活跃会话时同步标题和右侧镜像状态', () => {
      const id = useAgentStore.getState().createConversation()

      useAgentStore.getState().renameConversation(id, '知乎登录排查')

      const state = useAgentStore.getState()
      expect(state.conversations[id].title).toBe('知乎登录排查')
      expect(state.activeConversationId).toBe(id)
      expect(state.messages).toBe(state.conversations[id].messages)
    })

    it('新建工作会话时记录 workbench-tab surface 和本地 runtime', () => {
      const id = useAgentStore.getState().createConversation({
        surface: 'workbench-tab',
        runtime: {
          location: 'local',
          transport: 'local',
          backend: 'cclink-studio-agent',
        },
      })

      const conversation = useAgentStore.getState().conversations[id]
      expect(conversation.surface).toBe('workbench-tab')
      expect(conversation.runtime).toEqual({
        location: 'local',
        transport: 'local',
        backend: 'cclink-studio-agent',
      })
    })

    it('新建工作会话可不抢占右侧即时助手活跃会话', () => {
      const activeAssistantId = useAgentStore.getState().activeConversationId
      const id = useAgentStore.getState().createConversation({
        surface: 'workbench-tab',
        runtime: {
          location: 'local',
          transport: 'local',
          backend: 'cclink-studio-agent',
        },
        activate: false,
      })

      const state = useAgentStore.getState()
      expect(state.conversations[id].surface).toBe('workbench-tab')
      expect(state.activeConversationId).toBe(activeAssistantId)
      expect(state.messages).toBe(state.conversations[activeAssistantId].messages)
    })

    it('可将即时助手会话标记为工作会话并绑定工作空间 runtime', () => {
      const id = useAgentStore.getState().createConversation()

      useAgentStore.getState().markAsWorkConversation(id, {
        location: 'local',
        transport: 'local',
        backend: 'cclink-studio-agent',
        workspaceRef: {
          kind: 'local',
          path: '/Users/apple/Desktop/CCLink Studio',
        },
      })

      const conversation = useAgentStore.getState().conversations[id]
      expect(conversation.surface).toBe('workbench-tab')
      expect(conversation.runtime).toEqual({
        location: 'local',
        transport: 'local',
        backend: 'cclink-studio-agent',
        workspaceRef: {
          kind: 'local',
          path: '/Users/apple/Desktop/CCLink Studio',
        },
      })
    })

    it('将当前即时助手转为工作会话后自动新建即时助手承接右侧面板', () => {
      const id = useAgentStore.getState().activeConversationId

      useAgentStore.getState().markAsWorkConversation(id, {
        location: 'local',
        transport: 'local',
        backend: 'cclink-studio-agent',
      })

      const state = useAgentStore.getState()
      expect(state.conversations[id].surface).toBe('workbench-tab')
      expect(state.activeConversationId).not.toBe(id)
      expect(state.conversations[state.activeConversationId].surface).toBe('assistant-panel')
      expect(state.messages).toBe(state.conversations[state.activeConversationId].messages)
    })

    it('流式事件可以写入非活跃会话', () => {
      const firstId = useAgentStore.getState().activeConversationId
      const secondId = useAgentStore.getState().createConversation()
      useAgentStore.getState().switchConversation(firstId)

      useAgentStore.getState().startStreamingMessage('msg-second', secondId)
      useAgentStore.getState().appendStreamDelta('后台回复', secondId)

      expect(useAgentStore.getState().activeConversationId).toBe(firstId)
      expect(useAgentStore.getState().messages.find((m) => m.id === 'msg-second')).toBeUndefined()
      expect(useAgentStore.getState().conversations[secondId].messages.at(-1)?.rawText).toBe(
        '后台回复',
      )
    })

    it('关闭当前会话后切到剩余会话', () => {
      const firstId = useAgentStore.getState().activeConversationId
      const secondId = useAgentStore.getState().createConversation()

      useAgentStore.getState().closeConversation(secondId)

      expect(useAgentStore.getState().activeConversationId).toBe(firstId)
      expect(useAgentStore.getState().conversations[secondId]).toBeUndefined()
    })

    it('归档会话时保留消息并切到其他未归档会话', () => {
      const firstId = useAgentStore.getState().activeConversationId
      const secondId = useAgentStore.getState().createConversation()
      useAgentStore.getState().addUserMessage('需要长期保存的工作现场', secondId)

      useAgentStore.getState().archiveConversation(secondId)

      const state = useAgentStore.getState()
      expect(state.activeConversationId).toBe(firstId)
      expect(state.conversations[secondId].archivedAt).toEqual(expect.any(Number))
      expect(state.conversations[secondId].messages.at(-1)?.rawText).toBe('需要长期保存的工作现场')
    })

    it('归档最后一个可见会话时创建新的即时会话兜底', () => {
      const onlyId = useAgentStore.getState().activeConversationId

      useAgentStore.getState().archiveConversation(onlyId)

      const state = useAgentStore.getState()
      expect(state.conversations[onlyId].archivedAt).toEqual(expect.any(Number))
      expect(state.activeConversationId).not.toBe(onlyId)
      expect(state.conversations[state.activeConversationId].archivedAt).toBeNull()
      expect(state.conversations[state.activeConversationId].surface).toBe('assistant-panel')
    })

    it('归档项目最后一个会话时不会切到其他项目', () => {
      const projectA = useAgentStore.getState().createConversation({
        activate: false,
        runtime: {
          location: 'local',
          transport: 'local',
          backend: 'cclink-studio-agent',
          workspaceRef: localWorkspaceRef('/workspace/a'),
        },
      })
      const projectB = useAgentStore.getState().createConversation({
        runtime: {
          location: 'local',
          transport: 'local',
          backend: 'cclink-studio-agent',
          workspaceRef: localWorkspaceRef('/workspace/b'),
        },
      })

      useAgentStore.getState().archiveConversation(projectB)

      const state = useAgentStore.getState()
      const fallback = state.conversations[state.activeConversationId]
      expect(state.activeConversationId).not.toBe(projectA)
      expect(fallback.runtime.workspaceRef).toEqual(localWorkspaceRef('/workspace/b'))
      expect(fallback.archivedAt).toBeNull()
    })

    it('恢复已归档会话后切为活跃会话', () => {
      const archivedId = useAgentStore.getState().createConversation()
      useAgentStore.getState().archiveConversation(archivedId)

      useAgentStore.getState().restoreArchivedConversation(archivedId)

      const state = useAgentStore.getState()
      expect(state.activeConversationId).toBe(archivedId)
      expect(state.conversations[archivedId].archivedAt).toBeNull()
    })

    it('删除会话时才真正移除历史数据', async () => {
      const id = useAgentStore.getState().createConversation()
      useAgentStore.getState().addUserMessage('删除目标', id)

      await useAgentStore.getState().deleteConversation(id)

      expect(useAgentStore.getState().conversations[id]).toBeUndefined()
      expect(useAgentStore.getState().conversationOrder).not.toContain(id)
    })

    it('删除已归档历史会话时不切走当前活跃会话', async () => {
      const activeId = useAgentStore.getState().activeConversationId
      const archivedId = useAgentStore.getState().createConversation({ activate: false })
      useAgentStore.getState().archiveConversation(archivedId)

      await useAgentStore.getState().deleteConversation(archivedId)

      expect(useAgentStore.getState().activeConversationId).toBe(activeId)
      expect(useAgentStore.getState().conversations[archivedId]).toBeUndefined()
    })

    it('挂载资源时按会话去重并支持移除', () => {
      const id = useAgentStore.getState().createConversation()

      useAgentStore.getState().addMountedResource(
        {
          id: 'file:/Users/apple/project/README.md',
          kind: 'file',
          label: 'README.md',
          detail: '/Users/apple/project/README.md',
          ref: { type: 'file', path: '/Users/apple/project/README.md' },
        },
        id,
      )
      useAgentStore.getState().addMountedResource(
        {
          id: 'file:/Users/apple/project/README.md',
          kind: 'file',
          label: 'README.md',
          detail: '更新后的路径说明',
          ref: { type: 'file', path: '/Users/apple/project/README.md' },
        },
        id,
      )

      expect(useAgentStore.getState().conversations[id].mountedResources).toEqual([
        {
          id: 'file:/Users/apple/project/README.md',
          kind: 'file',
          label: 'README.md',
          detail: '更新后的路径说明',
          ref: { type: 'file', path: '/Users/apple/project/README.md' },
        },
      ])

      useAgentStore.getState().removeMountedResource('file:/Users/apple/project/README.md', id)
      expect(useAgentStore.getState().conversations[id].mountedResources).toEqual([])
    })

    it('发送后只清除临时文件选区，保留普通资源', () => {
      const id = useAgentStore.getState().createConversation()
      const file = {
        id: 'file:/workspace/guide.md',
        kind: 'file' as const,
        label: 'guide.md',
        ref: { type: 'file' as const, path: '/workspace/guide.md' },
      }
      const range = {
        id: 'file-range:guide:8:10',
        kind: 'file-range' as const,
        label: 'guide.md:L8-L10',
        ref: {
          type: 'file-range' as const,
          path: '/workspace/guide.md',
          startLine: 8,
          endLine: 10,
          sourceSnapshot: '原始选区',
        },
      }
      useAgentStore.getState().addMountedResource(file, id)
      useAgentStore.getState().addMountedResource(range, id)

      useAgentStore.getState().clearTransientResources(id)

      expect(useAgentStore.getState().conversations[id].mountedResources).toEqual([file])
    })

    it('挂载 Skill 时按会话去重、持久化并支持移除', async () => {
      const id = useAgentStore.getState().createConversation()

      await useAgentStore.getState().addMountedSkill({ skillId: 'grill-me', version: 1 }, id)
      await useAgentStore.getState().addMountedSkill({ skillId: 'grill-me', version: 1 }, id)

      expect(useAgentStore.getState().conversations[id].mountedSkills).toEqual([
        { skillId: 'grill-me', version: 1 },
      ])

      await useAgentStore.getState().removeMountedSkill({ skillId: 'grill-me', version: 1 }, id)
      expect(useAgentStore.getState().conversations[id].mountedSkills).toEqual([])
    })
  })

  describe('权限管理', () => {
    it('addPendingConfirmation / removePendingConfirmation', () => {
      const req = {
        id: 'conf-1',
        conversationId: 'conv-1',
        toolName: 'browser_click',
        params: { selector: '.btn' },
        riskLevel: 'write' as const,
      }
      useAgentStore.getState().addPendingConfirmation(req)
      expect(useAgentStore.getState().pendingConfirmations).toHaveLength(1)
      expect(useAgentStore.getState().pendingConfirmations[0].conversationId).toBe('conv-1')

      useAgentStore.getState().removePendingConfirmation('conf-1')
      expect(useAgentStore.getState().pendingConfirmations).toHaveLength(0)
    })

    it('clearPendingConfirmations', () => {
      useAgentStore.getState().addPendingConfirmation({
        id: 'conf-1',
        toolName: 'browser_click',
        params: {},
        riskLevel: 'write',
      })
      useAgentStore.getState().clearPendingConfirmations()
      expect(useAgentStore.getState().pendingConfirmations).toHaveLength(0)
    })

    it('setPermissionMode', () => {
      useAgentStore.getState().setPermissionMode('strict')
      expect(useAgentStore.getState().permissionMode).toBe('strict')
    })
  })

  describe('hydrateFromWorkspaceState', () => {
    const sessionCompatibilityFingerprint = 'a'.repeat(64)

    it('把旧版 Skill 展示快照迁移为版本化引用', () => {
      const legacy = createAgentConversationState('legacy-skill')
      useAgentStore.getState().hydrateFromWorkspaceState({
        conversations: {
          'legacy-skill': {
            ...legacy,
            mountedSkills: [
              {
                id: 'grill-me',
                name: 'grill-me',
                label: '方案拷问',
                description: '旧快照描述不再作为事实源',
              },
            ],
          },
        },
        conversationOrder: ['legacy-skill'],
        activeConversationId: 'legacy-skill',
      } as never)

      expect(useAgentStore.getState().conversations['legacy-skill'].mountedSkills).toEqual([
        { skillId: 'grill-me', version: 1 },
      ])
    })

    it('恢复时丢弃预算中止后留下的不可续接 SDK session', () => {
      const now = Date.now()
      useAgentStore.getState().hydrateFromWorkspaceState({
        conversations: {
          failed: {
            id: 'failed',
            title: '预算中止任务',
            messages: [
              {
                id: 'assistant-before-budget',
                role: 'assistant',
                content: [{ type: 'text', text: '正在写文件' }],
                rawText: '正在写文件',
                timestamp: now - 10,
              },
              {
                id: 'budget-error',
                role: 'system',
                content: [{ type: 'text', text: '连接错误: Reached maximum budget ($1)' }],
                rawText: '连接错误: Reached maximum budget ($1)',
                timestamp: now,
              },
            ],
            input: '',
            loading: false,
            backendState: 'error',
            runStatus: 'failed',
            activeRunId: null,
            sessionId: 'session-with-dangling-tools',
            streamingMessageId: null,
            lastCost: 0.35,
            contextUsage: {
              categories: [{ name: 'messages', tokens: 60_000 }],
              totalTokens: 60_000,
              maxTokens: 200_000,
              rawMaxTokens: 200_000,
              percentage: 30,
              model: 'claude-sonnet',
              autoCompactThreshold: 190_000,
              isAutoCompactEnabled: true,
              capturedAt: now,
            },
            scope: { kind: 'all' },
            mountedResources: [],
            mountedSkills: [],
            createdAt: now - 100,
            updatedAt: now,
            archivedAt: null,
          },
        },
        conversationOrder: ['failed'],
        activeConversationId: 'failed',
      })

      const conversation = useAgentStore.getState().conversations.failed
      expect(conversation.sessionId).toBeNull()
      expect(conversation.contextUsage).toBeNull()
      expect(conversation.messages).toHaveLength(2)
    })

    it('保留磁盘中的运行标识，等待主进程核对后再决定是否中断', () => {
      const now = Date.now()
      useAgentStore.getState().hydrateFromWorkspaceState({
        conversations: {
          running: {
            id: 'running',
            title: '运行中的任务',
            messages: [],
            input: '',
            loading: false,
            backendState: 'connected',
            runStatus: 'running',
            activeRunId: 'run-before-restart',
            sessionId: 'session-1',
            sessionCompatibilityFingerprint,
            streamingMessageId: 'message-1',
            lastCost: null,
            scope: { kind: 'all' },
            createdAt: now,
            updatedAt: now,
            archivedAt: null,
          },
        },
        conversationOrder: ['running'],
        activeConversationId: 'running',
      })

      expect(useAgentStore.getState().conversations.running).toMatchObject({
        loading: true,
        backendState: 'connecting',
        runStatus: 'running',
        activeRunId: 'run-before-restart',
        streamingMessageId: 'message-1',
        lastRunTerminalReason: null,
      })
    })

    it('从工作台快照恢复历史会话并镜像活跃会话', () => {
      const now = Date.now()
      useAgentStore.getState().hydrateFromWorkspaceState({
        conversations: {
          a: {
            id: 'a',
            title: '浏览任务',
            messages: [
              {
                id: 'm-a',
                role: 'user',
                content: [{ type: 'text', text: '查资料' }],
                rawText: '查资料',
                timestamp: now,
              },
            ],
            input: '未发送草稿',
            loading: true,
            backendState: 'streaming',
            sessionId: 'sess-a',
            sessionCompatibilityFingerprint,
            streamingMessageId: 'stream-a',
            lastCost: 0.01,
            scope: { kind: 'browser', instanceId: 'browser' },
            createdAt: now,
            updatedAt: now,
          },
          b: {
            id: 'b',
            title: '文档任务',
            messages: [
              {
                id: 'm-b',
                role: 'assistant',
                content: [{ type: 'text', text: '已整理' }],
                rawText: '已整理',
                timestamp: now,
                isStreaming: true,
              },
            ],
            input: '',
            loading: false,
            backendState: 'connected',
            sessionId: 'sess-b',
            sessionCompatibilityFingerprint,
            streamingMessageId: null,
            lastCost: 0.02,
            scope: { kind: 'editor' },
            createdAt: now,
            updatedAt: now,
          },
        },
        conversationOrder: ['a', 'b'],
        activeConversationId: 'b',
      })

      const state = useAgentStore.getState()
      expect(state.conversationOrder).toEqual(['a', 'b'])
      expect(state.activeConversationId).toBe('b')
      expect(state.messages.at(-1)?.rawText).toBe('已整理')
      expect(state.sessionId).toBe('sess-b')
      expect(state.scope).toEqual({ kind: 'editor' })
      expect(state.conversations.a.loading).toBe(true)
      expect(state.conversations.a.backendState).toBe('connecting')
      expect(state.conversations.a.streamingMessageId).toBe('stream-a')
      expect(state.conversations.a.input).toBe('')
      expect(state.conversations.b.messages[0].isStreaming).toBe(false)
    })

    it('旧快照缺少运行时指纹时保留消息但丢弃 SDK session', () => {
      const now = Date.now()
      useAgentStore.getState().hydrateFromWorkspaceState({
        conversations: {
          legacy: {
            ...createAgentConversationState('legacy'),
            sessionId: 'legacy-session',
            messages: [
              {
                id: 'legacy-message',
                role: 'assistant',
                content: [{ type: 'text', text: '本地历史仍然保留' }],
                rawText: '本地历史仍然保留',
                timestamp: now,
              },
            ],
          },
        },
        conversationOrder: ['legacy'],
        activeConversationId: 'legacy',
      })

      const conversation = useAgentStore.getState().conversations.legacy
      expect(conversation.sessionId).toBeNull()
      expect(conversation.sessionCompatibilityFingerprint).toBeNull()
      expect(conversation.messages[0].rawText).toBe('本地历史仍然保留')
    })

    it('快照 activeConversationId 无效时回退到第一个可用会话', () => {
      const now = Date.now()
      useAgentStore.getState().hydrateFromWorkspaceState({
        conversations: {
          a: {
            id: 'a',
            title: '会话 A',
            messages: [],
            input: '',
            loading: false,
            backendState: 'connected',
            sessionId: null,
            streamingMessageId: null,
            lastCost: null,
            scope: { kind: 'all' },
            createdAt: now,
            updatedAt: now,
          },
        },
        conversationOrder: ['a'],
        activeConversationId: 'missing',
      })

      expect(useAgentStore.getState().activeConversationId).toBe('a')
    })

    it('快照 activeConversationId 指向归档会话时回退到未归档会话', () => {
      const now = Date.now()
      useAgentStore.getState().hydrateFromWorkspaceState({
        conversations: {
          archived: {
            id: 'archived',
            title: '已归档工作',
            messages: [],
            input: '',
            loading: false,
            backendState: 'connected',
            sessionId: null,
            streamingMessageId: null,
            lastCost: null,
            scope: { kind: 'all' },
            createdAt: now,
            updatedAt: now,
            archivedAt: now,
          },
          active: {
            id: 'active',
            title: '可继续工作',
            messages: [],
            input: '',
            loading: false,
            backendState: 'connected',
            sessionId: null,
            streamingMessageId: null,
            lastCost: null,
            scope: { kind: 'all' },
            createdAt: now,
            updatedAt: now,
            archivedAt: null,
          },
        },
        conversationOrder: ['archived', 'active'],
        activeConversationId: 'archived',
      })

      expect(useAgentStore.getState().activeConversationId).toBe('active')
      expect(useAgentStore.getState().conversations.archived.archivedAt).toBe(now)
    })

    it('恢复快照时按创建时间规范会话顺序', () => {
      const now = Date.now()
      useAgentStore.getState().hydrateFromWorkspaceState({
        conversations: {
          newer: {
            id: 'newer',
            title: '后创建',
            messages: [],
            input: '',
            loading: false,
            backendState: 'connected',
            sessionId: null,
            streamingMessageId: null,
            lastCost: null,
            scope: { kind: 'all' },
            createdAt: now,
            updatedAt: now,
          },
          older: {
            id: 'older',
            title: '先创建',
            messages: [],
            input: '',
            loading: false,
            backendState: 'connected',
            sessionId: null,
            streamingMessageId: null,
            lastCost: null,
            scope: { kind: 'all' },
            createdAt: now - 60_000,
            updatedAt: now,
          },
        },
        conversationOrder: ['newer', 'older'],
        activeConversationId: 'newer',
      })

      expect(useAgentStore.getState().conversationOrder).toEqual(['older', 'newer'])
    })
  })

  describe('workspace persistence', () => {
    it('Skill 挂载立即持久化并使旧 Runtime Session 失效', async () => {
      const setSection = vi.fn().mockResolvedValue({ success: true })
      vi.stubGlobal('window', { cclinkStudio: { workspaceState: { setSection } } })
      const conversationId = useAgentStore.getState().activeConversationId
      useAgentStore
        .getState()
        .setSessionId('session-before-skill-change', conversationId, 'a'.repeat(64))

      await expect(
        useAgentStore
          .getState()
          .addMountedSkill({ skillId: 'grill-me', version: 1 }, conversationId),
      ).resolves.toBe(true)

      expect(useAgentStore.getState().conversations[conversationId]).toMatchObject({
        mountedSkills: [{ skillId: 'grill-me', version: 1 }],
        sessionId: null,
        sessionCompatibilityFingerprint: null,
      })
      expect(setSection).toHaveBeenCalledWith(
        null,
        'agentConversations',
        expect.objectContaining({
          conversations: expect.objectContaining({
            [conversationId]: expect.objectContaining({
              mountedSkills: [{ skillId: 'grill-me', version: 1 }],
            }),
          }),
        }),
        null,
      )
    })

    it('Skill 配置持久化失败时回滚引用和 Runtime Session', async () => {
      const setSection = vi.fn().mockRejectedValue(new Error('disk full'))
      vi.stubGlobal('window', { cclinkStudio: { workspaceState: { setSection } } })
      const conversationId = useAgentStore.getState().activeConversationId
      useAgentStore
        .getState()
        .setSessionId('session-before-skill-change', conversationId, 'a'.repeat(64))

      await expect(
        useAgentStore
          .getState()
          .addMountedSkill({ skillId: 'grill-me', version: 1 }, conversationId),
      ).resolves.toBe(false)

      expect(useAgentStore.getState().conversations[conversationId]).toMatchObject({
        mountedSkills: [],
        sessionId: 'session-before-skill-change',
        sessionCompatibilityFingerprint: 'a'.repeat(64),
      })
    })

    it('角色切换保留同一会话和历史、清空内部 session，并持久化配置事件', async () => {
      const setSection = vi.fn().mockResolvedValue({ success: true })
      vi.stubGlobal('window', { cclinkStudio: { workspaceState: { setSection } } })
      const conversationId = useAgentStore.getState().activeConversationId
      useAgentStore.getState().addUserMessage('保留这条历史', conversationId)
      useAgentStore
        .getState()
        .setSessionId('session-before-role-change', conversationId, 'a'.repeat(64))

      await expect(
        useAgentStore
          .getState()
          .applyRoleToConversation({ roleId: 'critical-challenger', version: 1 }, conversationId),
      ).resolves.toBe(true)

      const conversation = useAgentStore.getState().conversations[conversationId]
      expect(useAgentStore.getState().activeConversationId).toBe(conversationId)
      expect(conversation.messages.some((message) => message.rawText === '保留这条历史')).toBe(true)
      expect(conversation.configuration).toMatchObject({
        roleRef: { roleId: 'critical-challenger', version: 1 },
        revision: 2,
      })
      expect(conversation.configurationEvents).toHaveLength(1)
      expect(conversation.sessionId).toBeNull()
      expect(conversation.sessionCompatibilityFingerprint).toBeNull()
      expect(setSection).toHaveBeenCalledWith(
        null,
        'agentConversations',
        expect.objectContaining({
          conversations: expect.objectContaining({
            [conversationId]: expect.objectContaining({
              configuration: expect.objectContaining({ revision: 2 }),
              configurationEvents: [expect.objectContaining({ configurationRevision: 2 })],
            }),
          }),
        }),
        null,
      )
    })

    it('角色配置持久化失败时回滚到原配置和 session', async () => {
      const setSection = vi.fn().mockRejectedValue(new Error('disk full'))
      vi.stubGlobal('window', { cclinkStudio: { workspaceState: { setSection } } })
      const conversationId = useAgentStore.getState().activeConversationId
      useAgentStore
        .getState()
        .setSessionId('session-before-role-change', conversationId, 'a'.repeat(64))

      await expect(
        useAgentStore
          .getState()
          .applyRoleToConversation({ roleId: 'fact-checker', version: 1 }, conversationId),
      ).resolves.toBe(false)

      expect(useAgentStore.getState().conversations[conversationId]).toMatchObject({
        configuration: {
          roleRef: { roleId: 'default-assistant', version: 1 },
          revision: 1,
        },
        configurationEvents: [],
        sessionId: 'session-before-role-change',
        sessionCompatibilityFingerprint: 'a'.repeat(64),
      })
    })

    it('未绑定会话不会写入本地项目快照', () => {
      const projectConversationId = useAgentStore.getState().createConversation({
        runtime: {
          location: 'local',
          transport: 'local',
          backend: 'cclink-studio-agent',
          workspaceRef: localWorkspaceRef('/workspace/a'),
        },
      })

      const snapshot = buildAgentConversationWorkspaceSnapshot(
        useAgentStore.getState(),
        '/workspace/a',
      )

      expect(snapshot.conversationOrder).toEqual([projectConversationId])
      expect(snapshot.conversations['agent-default']).toBeUndefined()
    })

    it('项目快照不会静默裁掉超过 20 个的旧会话', () => {
      const workspacePath = '/workspace/many-conversations'
      const ids = Array.from({ length: 25 }, () =>
        useAgentStore.getState().createConversation({
          activate: false,
          runtime: {
            location: 'local',
            transport: 'local',
            backend: 'cclink-studio-agent',
            workspaceRef: localWorkspaceRef(workspacePath),
          },
        }),
      )

      const snapshot = buildAgentConversationWorkspaceSnapshot(
        useAgentStore.getState(),
        workspacePath,
      )

      expect(snapshot.conversationOrder).toEqual(ids)
      expect(Object.keys(snapshot.conversations)).toHaveLength(25)
    })

    it('待发送图片正文不会写入项目会话快照', () => {
      const workspacePath = '/workspace/a'
      const conversationId = useAgentStore.getState().createConversation({
        runtime: {
          location: 'local',
          transport: 'local',
          backend: 'cclink-studio-agent',
          workspaceRef: localWorkspaceRef(workspacePath),
        },
      })
      useAgentStore.getState().addPendingImages(
        [
          {
            id: 'image-1',
            name: 'screen.png',
            mediaType: 'image/png',
            data: 'base64-secret-image-data',
            size: 12,
          },
        ],
        conversationId,
      )

      const snapshot = buildAgentConversationWorkspaceSnapshot(
        useAgentStore.getState(),
        workspacePath,
      )

      expect(snapshot.conversations[conversationId]?.pendingImages).toEqual([])
      expect(JSON.stringify(snapshot)).not.toContain('base64-secret-image-data')
    })

    it('后台会话更新不会覆盖该项目最后激活的会话', () => {
      const workspaceA = '/workspace/a'
      const workspaceB = '/workspace/b'
      const state = useAgentStore.getState()
      const activeA = state.createConversation({
        activate: true,
        runtime: {
          location: 'local',
          transport: 'local',
          backend: 'cclink-studio-agent',
          workspaceRef: localWorkspaceRef(workspaceA),
        },
      })
      const otherA = state.createConversation({
        activate: false,
        runtime: {
          location: 'local',
          transport: 'local',
          backend: 'cclink-studio-agent',
          workspaceRef: localWorkspaceRef(workspaceA),
        },
      })

      let snapshot = buildAgentConversationWorkspaceSnapshot(useAgentStore.getState(), workspaceA)
      expect(snapshot.activeConversationId).toBe(activeA)

      const activeB = useAgentStore.getState().createConversation({
        activate: true,
        runtime: {
          location: 'local',
          transport: 'local',
          backend: 'cclink-studio-agent',
          workspaceRef: localWorkspaceRef(workspaceB),
        },
      })
      expect(useAgentStore.getState().activeConversationId).toBe(activeB)

      useAgentStore.getState().addSystemMessage('后台完成', otherA)
      snapshot = buildAgentConversationWorkspaceSnapshot(useAgentStore.getState(), workspaceA)

      expect(snapshot.activeConversationId).toBe(activeA)
    })

    it('不会把启动时的空白种子会话写回并覆盖已有历史', () => {
      const setSection = vi.fn().mockResolvedValue({ success: true })
      vi.stubGlobal('window', { cclinkStudio: { workspaceState: { setSection } } })

      useAgentStore.getState().setBackendState('connected')

      expect(setSection).not.toHaveBeenCalled()
    })

    it('会在用户产生真实消息后持久化会话历史', () => {
      const setSection = vi.fn().mockResolvedValue({ success: true })
      vi.stubGlobal('window', { cclinkStudio: { workspaceState: { setSection } } })

      useAgentStore.getState().addUserMessage('继续处理这件事')

      expect(setSection).toHaveBeenCalledWith(
        null,
        'agentConversations',
        expect.objectContaining({
          activeConversationId: 'agent-default',
          conversationOrder: ['agent-default'],
        }),
        null,
      )
      const payload = setSection.mock.calls[0][2]
      expect(payload.conversations['agent-default'].messages.at(-1)?.rawText).toBe('继续处理这件事')
    })

    it('归档操作会等待归档快照确认写入', async () => {
      const completions: Array<(value: { success: boolean }) => void> = []
      const setSection = vi.fn(
        () =>
          new Promise<{ success: boolean }>((resolve) => {
            completions.push(resolve)
          }),
      )
      vi.stubGlobal('window', { cclinkStudio: { workspaceState: { setSection } } })

      const conversationId = useAgentStore.getState().activeConversationId
      let settled = false
      const archive = useAgentStore
        .getState()
        .archiveConversation(conversationId)
        .then(() => {
          settled = true
        })

      expect(useAgentStore.getState().conversations[conversationId].archivedAt).not.toBeNull()
      expect(setSection).toHaveBeenCalledTimes(1)
      expect(settled).toBe(false)

      completions[0]({ success: true })
      await vi.waitFor(() => expect(setSection).toHaveBeenCalledTimes(2))
      expect(settled).toBe(false)

      completions[1]({ success: true })
      await archive
      expect(settled).toBe(true)
    })
  })
})
