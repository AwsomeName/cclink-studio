import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentRoleSummary } from '../../shared/agent-role'
import type { AgentSkillSummary } from '../../shared/agent-skill'

const mockIpcMain = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
    mockIpcMain.handlers.set(channel, handler)
  }),
}))

vi.mock('electron', () => ({ ipcMain: mockIpcMain }))

import { registerAgentIpc } from './agent-ipc'

describe('registerAgentIpc', () => {
  beforeEach(() => {
    mockIpcMain.handlers.clear()
  })

  it('rejects an untrusted sender before reaching the Agent bridge', () => {
    const deps = createDeps()
    registerAgentIpc(deps as never)

    expect(() =>
      mockIpcMain.handlers.get('agent:sendMessage')?.({ sender: 'other' }, 'hello'),
    ).toThrow('untrusted')
    expect(deps.agentBridge.sendMessage).not.toHaveBeenCalled()
  })

  it('rejects oversized messages before reaching the Agent bridge', async () => {
    const deps = createDeps()
    registerAgentIpc(deps as never)

    await expect(
      mockIpcMain.handlers.get('agent:sendMessage')?.(
        { sender: 'trusted' },
        'x'.repeat(1024 * 1024 + 1),
      ),
    ).rejects.toThrow()
    expect(deps.agentBridge.sendMessage).not.toHaveBeenCalled()
  })

  it('normalizes a valid bounded message before forwarding it', async () => {
    const deps = createDeps()
    registerAgentIpc(deps as never)

    await expect(
      mockIpcMain.handlers.get('agent:sendMessage')?.({ sender: 'trusted' }, 'conversation-1', {
        message: '  hello  ',
        workspaceRef: { kind: 'local', path: '/tmp/project' },
      }),
    ).resolves.toEqual({ success: true })
    expect(deps.agentBridge.sendMessage).toHaveBeenCalledWith(
      'hello',
      'conversation-1',
      expect.objectContaining({ workspaceRef: { kind: 'local', path: '/tmp/project' } }),
    )
  })

  it('accepts a bounded remote workspace ref but does not pass it to the local Agent', async () => {
    const deps = createDeps()
    registerAgentIpc(deps as never)

    await expect(
      mockIpcMain.handlers.get('agent:sendMessage')?.({ sender: 'trusted' }, 'conversation-1', {
        message: '总结项目',
        workspaceRef: {
          kind: 'remote',
          transport: 'cclink',
          endpointId: 'agent-1',
          workspaceId: 'workspace-1',
          path: '/srv/project',
          label: 'project',
        },
      }),
    ).resolves.toEqual({
      success: false,
      error: '远程工作区不能交给本地 Agent IPC 执行；请从 CCLink 远程会话面板发送。',
    })
    expect(deps.agentBridge.sendMessage).not.toHaveBeenCalled()
  })

  it('does not compact a remote conversation through the local Agent', async () => {
    const deps = createDeps()
    registerAgentIpc(deps as never)

    await expect(
      mockIpcMain.handlers.get('agent:compactConversation')?.(
        { sender: 'trusted' },
        'conversation-1',
        {
          sessionId: 'session-1',
          configuration: {
            schemaVersion: 1,
            roleRef: { roleId: 'default-assistant', version: 1 },
            revision: 1,
            updatedAt: 1,
          },
          workspaceRef: {
            kind: 'remote',
            transport: 'cclink',
            endpointId: 'agent-1',
            workspaceId: 'workspace-1',
            path: '/srv/project',
          },
        },
      ),
    ).resolves.toEqual({
      success: false,
      error: '远程会话不属于本地 Agent IPC，不能使用本地 Agent 压缩。',
    })
    expect(deps.agentBridge.compactConversation).not.toHaveBeenCalled()
  })

  it('preserves validated image attachments when forwarding to the Agent bridge', async () => {
    const deps = createDeps()
    registerAgentIpc(deps as never)
    const image = {
      id: 'image-1',
      name: 'screen.png',
      mediaType: 'image/png',
      data: 'AQID',
      size: 3,
    }

    await expect(
      mockIpcMain.handlers.get('agent:sendMessage')?.({ sender: 'trusted' }, 'conversation-1', {
        message: '分析这张截图',
        images: [image],
      }),
    ).resolves.toEqual({ success: true })
    expect(deps.agentBridge.sendMessage).toHaveBeenCalledWith(
      '分析这张截图',
      'conversation-1',
      expect.objectContaining({ images: [image] }),
    )
  })

  it('lists safe role summaries and forwards a validated conversation configuration', async () => {
    const deps = createDeps()
    registerAgentIpc(deps as never)
    deps.agentBridge.listRoles.mockReturnValue([
      {
        roleId: 'default-assistant',
        version: 1,
        source: 'builtin',
        archived: false,
        isLatest: true,
        createdAt: 0,
        label: '默认助手',
        description: '均衡处理一般任务',
        icon: 'assistant',
        goals: ['完成用户任务'],
        suitableFor: [],
        unsuitableFor: [],
        instructions: ['均衡处理任务'],
        boundaries: [],
        examples: [],
        contentHash: '0'.repeat(64),
        recommendedSkillRefs: [],
      },
    ])

    expect(mockIpcMain.handlers.get('agent:listRoles')?.({ sender: 'trusted' })).toEqual([
      {
        roleId: 'default-assistant',
        version: 1,
        source: 'builtin',
        archived: false,
        isLatest: true,
        createdAt: 0,
        label: '默认助手',
        description: '均衡处理一般任务',
        icon: 'assistant',
        goals: ['完成用户任务'],
        suitableFor: [],
        unsuitableFor: [],
        instructions: ['均衡处理任务'],
        boundaries: [],
        examples: [],
        contentHash: '0'.repeat(64),
        recommendedSkillRefs: [],
      },
    ])

    await expect(
      mockIpcMain.handlers.get('agent:sendMessage')?.({ sender: 'trusted' }, 'conversation-1', {
        message: '评估',
        skills: [{ skillId: 'grill-me', version: 1 }],
        configuration: {
          schemaVersion: 1,
          roleRef: { roleId: 'critical-challenger', version: 1 },
          revision: 2,
          updatedAt: 1,
        },
      }),
    ).resolves.toEqual({ success: true })
    expect(deps.agentBridge.sendMessage).toHaveBeenCalledWith(
      '评估',
      'conversation-1',
      expect.objectContaining({
        skills: [{ skillId: 'grill-me', version: 1 }],
        configuration: {
          schemaVersion: 1,
          roleRef: { roleId: 'critical-challenger', version: 1 },
          revision: 2,
          updatedAt: 1,
        },
      }),
    )
  })

  it('lists built-in roles while the Agent backend is unavailable', () => {
    const deps = createDeps()
    registerAgentIpc({ ...deps, getAgentBridge: () => null } as never)

    const roles = mockIpcMain.handlers.get('agent:listRoles')?.({ sender: 'trusted' })

    expect(roles).toHaveLength(7)
    expect(roles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ roleId: 'default-assistant', label: '默认助手' }),
        expect.objectContaining({ roleId: 'technical-architect', label: '技术架构师' }),
      ]),
    )
  })

  it('lists Skills from the Agent registry and falls back while the backend is unavailable', () => {
    const deps = createDeps()
    deps.agentBridge.listSkills.mockReturnValue([
      {
        skillId: 'grill-me',
        version: 1,
        name: 'grill-me',
        label: '方案拷问',
        description: '检查假设和失败路径',
        source: 'builtin',
        available: true,
        contentHash: 'a'.repeat(64),
      },
    ])
    registerAgentIpc(deps as never)

    expect(mockIpcMain.handlers.get('agent:listSkills')?.({ sender: 'trusted' })).toEqual([
      expect.objectContaining({ skillId: 'grill-me', available: true }),
    ])

    mockIpcMain.handlers.clear()
    registerAgentIpc({ ...deps, getAgentBridge: () => null } as never)
    expect(mockIpcMain.handlers.get('agent:listSkills')?.({ sender: 'trusted' })).toEqual([
      expect.objectContaining({ skillId: 'grill-me', source: 'builtin' }),
    ])
  })

  it('blocks archiving the role used as the new-conversation default', () => {
    const deps = createDeps()
    const setArchived = vi.fn()
    registerAgentIpc({
      ...deps,
      getAgentRoleRegistry: () => ({ setArchived }),
      getDefaultAgentRoleRef: () => ({ roleId: 'local-default', version: 2 }),
    } as never)

    expect(
      mockIpcMain.handlers.get('agent:setRoleArchived')?.(
        { sender: 'trusted' },
        'local-default',
        true,
      ),
    ).toEqual({
      success: false,
      error: '该角色是新会话默认角色；请先设置其他默认角色，再归档。',
    })
    expect(setArchived).not.toHaveBeenCalled()
  })

  it('allows archiving a local role that is not the new-conversation default', () => {
    const deps = createDeps()
    const archivedRole = { roleId: 'another-local-role', version: 1, archived: true }
    const setArchived = vi.fn(() => ({ success: true, role: archivedRole }))
    registerAgentIpc({
      ...deps,
      getAgentRoleRegistry: () => ({ setArchived }),
      getDefaultAgentRoleRef: () => ({ roleId: 'local-default', version: 2 }),
    } as never)

    expect(
      mockIpcMain.handlers.get('agent:setRoleArchived')?.(
        { sender: 'trusted' },
        'another-local-role',
        true,
      ),
    ).toEqual({ success: true, role: archivedRole })
    expect(setArchived).toHaveBeenCalledWith('another-local-role', true)
  })

  it('rejects credential-bearing MCP URLs before changing configuration', () => {
    const deps = createDeps()
    registerAgentIpc(deps as never)

    expect(
      mockIpcMain.handlers.get('mcp:addServer')?.(
        { sender: 'trusted' },
        {
          name: 'remote',
          transport: 'http',
          url: 'https://user:secret@example.com/mcp',
          enabled: true,
        },
      ),
    ).toMatchObject({ success: false })
    expect(deps.mcpManager.addServer).not.toHaveBeenCalled()
  })
})

function createDeps() {
  const agentBridge = {
    sendMessage: vi.fn(async () => undefined),
    compactConversation: vi.fn(async () => undefined),
    listRoles: vi.fn<() => AgentRoleSummary[]>(() => []),
    listSkills: vi.fn<() => AgentSkillSummary[]>(() => []),
  }
  const mcpManager = {
    addServer: vi.fn(),
  }
  return {
    trustedRendererGuard: createGuard('trusted'),
    agentBridge,
    mcpManager,
    getAgentBridge: () => agentBridge,
    getMcpClientMgr: () => mcpManager,
    permissionManager: {
      resolveConfirmation: vi.fn(),
      getMode: vi.fn(() => 'auto'),
      setMode: vi.fn(),
    },
  }
}

function createGuard(trustedSender: string) {
  return {
    assert: (event: { sender: string }) => {
      if (event.sender !== trustedSender) throw new Error('untrusted')
    },
    isTrusted: (event: { sender: string }) => event.sender === trustedSender,
  }
}
