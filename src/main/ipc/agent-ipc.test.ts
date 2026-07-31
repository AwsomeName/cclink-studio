import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentRoleSummary } from '../../shared/agent-role'

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
        label: '默认助手',
        description: '均衡处理一般任务',
        icon: 'assistant',
        instructions: ['均衡处理任务'],
      },
    ])

    expect(mockIpcMain.handlers.get('agent:listRoles')?.({ sender: 'trusted' })).toEqual([
      {
        roleId: 'default-assistant',
        version: 1,
        label: '默认助手',
        description: '均衡处理一般任务',
        icon: 'assistant',
        instructions: ['均衡处理任务'],
      },
    ])

    await expect(
      mockIpcMain.handlers.get('agent:sendMessage')?.({ sender: 'trusted' }, 'conversation-1', {
        message: '评估',
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
        configuration: {
          schemaVersion: 1,
          roleRef: { roleId: 'critical-challenger', version: 1 },
          revision: 2,
          updatedAt: 1,
        },
      }),
    )
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
    listRoles: vi.fn<() => AgentRoleSummary[]>(() => []),
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
