import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  buildAgentConversationWorkspaceSnapshot,
  resetAgentWorkspaceActiveConversationMemoryForTests,
  useAgentStore,
} from './agent-store'
import type { ContentBlock } from '../types'
import { localWorkspaceRef } from '../../../shared/workspace-ref'

beforeEach(() => {
  resetAgentWorkspaceActiveConversationMemoryForTests()
  // 重置 store 到初始状态
  const initial = useAgentStore.getInitialState()
  useAgentStore.setState(initial, true)
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
    it('重置为欢迎消息', () => {
      useAgentStore.getState().addUserMessage('test')
      useAgentStore.getState().setSessionId('sess-1')
      useAgentStore.getState().setLastCost(0.5)

      useAgentStore.getState().clearMessages()

      const state = useAgentStore.getState()
      expect(state.messages).toHaveLength(1)
      expect(state.messages[0].id).toBe('welcome')
      expect(state.sessionId).toBeNull()
      expect(state.lastCost).toBeNull()
    })
  })

  describe('多会话', () => {
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

    it('删除会话时才真正移除历史数据', () => {
      const id = useAgentStore.getState().createConversation()
      useAgentStore.getState().addUserMessage('删除目标', id)

      useAgentStore.getState().deleteConversation(id)

      expect(useAgentStore.getState().conversations[id]).toBeUndefined()
      expect(useAgentStore.getState().conversationOrder).not.toContain(id)
    })

    it('删除已归档历史会话时不切走当前活跃会话', () => {
      const activeId = useAgentStore.getState().activeConversationId
      const archivedId = useAgentStore.getState().createConversation({ activate: false })
      useAgentStore.getState().archiveConversation(archivedId)

      useAgentStore.getState().deleteConversation(archivedId)

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

    it('挂载 Skill 时按会话去重并支持移除', () => {
      const id = useAgentStore.getState().createConversation()

      useAgentStore.getState().addMountedSkill(
        {
          id: 'grill-me',
          name: 'grill-me',
          label: 'grill-me',
          description: '拷问方案',
          source: 'user',
        },
        id,
      )
      useAgentStore.getState().addMountedSkill(
        {
          id: 'grill-me',
          name: 'grill-me',
          label: 'grill-me',
          description: '更新后的拷问方案',
          source: 'user',
        },
        id,
      )

      expect(useAgentStore.getState().conversations[id].mountedSkills).toEqual([
        {
          id: 'grill-me',
          name: 'grill-me',
          label: 'grill-me',
          description: '更新后的拷问方案',
          source: 'user',
        },
      ])

      useAgentStore.getState().removeMountedSkill('grill-me', id)
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
    it('把磁盘中的运行中快照恢复为明确的中断状态', () => {
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
        loading: false,
        runStatus: 'interrupted',
        activeRunId: null,
        lastRunTerminalReason: 'runtime-unavailable',
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
      expect(state.conversations.a.loading).toBe(false)
      expect(state.conversations.a.backendState).toBe('disconnected')
      expect(state.conversations.a.streamingMessageId).toBeNull()
      expect(state.conversations.a.input).toBe('')
      expect(state.conversations.b.messages[0].isStreaming).toBe(false)
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
