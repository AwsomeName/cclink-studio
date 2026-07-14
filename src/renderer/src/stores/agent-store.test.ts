import { describe, it, expect, beforeEach } from 'vitest'
import { useAgentStore } from './agent-store'
import type { ContentBlock } from '../types'

beforeEach(() => {
  // 重置 store 到初始状态
  const initial = useAgentStore.getInitialState()
  useAgentStore.setState(initial, true)
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

    it('新建工作会话时记录 workbench-tab surface 和本地 runtime', () => {
      const id = useAgentStore.getState().createConversation({
        surface: 'workbench-tab',
        runtime: {
          location: 'local',
          transport: 'local',
          backend: 'deepink-agent',
        },
      })

      const conversation = useAgentStore.getState().conversations[id]
      expect(conversation.surface).toBe('workbench-tab')
      expect(conversation.runtime).toEqual({
        location: 'local',
        transport: 'local',
        backend: 'deepink-agent',
      })
    })

    it('新建工作会话可不抢占右侧即时助手活跃会话', () => {
      const activeAssistantId = useAgentStore.getState().activeConversationId
      const id = useAgentStore.getState().createConversation({
        surface: 'workbench-tab',
        runtime: {
          location: 'local',
          transport: 'local',
          backend: 'deepink-agent',
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
        backend: 'deepink-agent',
        workspaceRef: {
          kind: 'local',
          path: '/Users/apple/Desktop/DeepInk',
        },
      })

      const conversation = useAgentStore.getState().conversations[id]
      expect(conversation.surface).toBe('workbench-tab')
      expect(conversation.runtime).toEqual({
        location: 'local',
        transport: 'local',
        backend: 'deepink-agent',
        workspaceRef: {
          kind: 'local',
          path: '/Users/apple/Desktop/DeepInk',
        },
      })
    })

    it('将当前即时助手转为工作会话后自动新建即时助手承接右侧面板', () => {
      const id = useAgentStore.getState().activeConversationId

      useAgentStore.getState().markAsWorkConversation(id, {
        location: 'local',
        transport: 'local',
        backend: 'deepink-agent',
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
        toolName: 'browser_click',
        params: { selector: '.btn' },
        riskLevel: 'write' as const,
      }
      useAgentStore.getState().addPendingConfirmation(req)
      expect(useAgentStore.getState().pendingConfirmations).toHaveLength(1)

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
  })
})
