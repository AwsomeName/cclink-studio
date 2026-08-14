import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockIpcMain = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
    mockIpcMain.handlers.set(channel, handler)
  }),
}))

vi.mock('electron', () => ({ ipcMain: mockIpcMain }))

import { registerMediaProjectIpc } from './media-project-ipc'

describe('registerMediaProjectIpc', () => {
  beforeEach(() => {
    mockIpcMain.handlers.clear()
    mockIpcMain.handle.mockClear()
  })

  it('rejects an untrusted sender before reading project data', () => {
    const service = createService()
    registerMediaProjectIpc(service as never, createGuard('trusted') as never)

    expect(() =>
      mockIpcMain.handlers.get('mediaProjects:list')?.(
        { sender: 'other' },
        '/Users/example/workspace',
      ),
    ).toThrow('untrusted')
    expect(service.list).not.toHaveBeenCalled()
  })

  it('maps malformed creation input without calling the service', async () => {
    const service = createService()
    registerMediaProjectIpc(service as never, createGuard('trusted') as never)

    await expect(
      mockIpcMain.handlers.get('mediaProjects:create')?.(
        { sender: 'trusted' },
        {
          workspacePath: '/Users/example/workspace',
          sourcePath: '/Users/example/workspace/brief.md',
          platform: 'unknown',
          aspectRatio: '4:3',
          targetDurationSeconds: 999,
        },
      ),
    ).resolves.toMatchObject({
      success: false,
      error: { code: 'MEDIA_PROJECT_INVALID' },
    })
    expect(service.create).not.toHaveBeenCalled()
  })

  it('forwards a bounded valid creation command', async () => {
    const service = createService()
    registerMediaProjectIpc(service as never, createGuard('trusted') as never)
    const input = {
      workspacePath: '/Users/example/workspace',
      sourcePath: '/Users/example/workspace/brief.md',
      platform: 'douyin',
      aspectRatio: '9:16',
      targetDurationSeconds: 30,
    }

    await mockIpcMain.handlers.get('mediaProjects:create')?.({ sender: 'trusted' }, input)

    expect(service.create).toHaveBeenCalledWith(input)
  })

  it('forwards a validated project to the isolated proposal service', async () => {
    const service = createService()
    const proposalService = { propose: vi.fn(async () => ({ success: true })) }
    registerMediaProjectIpc(
      service as never,
      createGuard('trusted') as never,
      undefined,
      proposalService as never,
    )
    const project = {
      schemaVersion: 1,
      id: '11111111-1111-4111-8111-111111111111',
      workspaceRef: { kind: 'local', path: '/Users/example/workspace' },
      revision: 1,
      title: '测试',
      source: { path: '/Users/example/workspace/brief.md', snapshot: '# 测试' },
      brief: {
        platform: 'douyin',
        aspectRatio: '9:16',
        targetDurationSeconds: 12,
        brand: { primaryColor: '#5B8CFF', callToAction: '' },
      },
      scenes: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          order: 0,
          durationSeconds: 12,
          narration: '',
          subtitle: '',
          visualDescription: '',
          searchTerms: [],
          generationPrompt: '',
          materialKind: 'unassigned',
        },
      ],
      createdAt: 1,
      updatedAt: 1,
    }

    await mockIpcMain.handlers.get('mediaProjects:proposeStoryboard')?.(
      { sender: 'trusted' },
      { workspacePath: '/Users/example/workspace', project },
    )

    expect(proposalService.propose).toHaveBeenCalledWith(
      expect.objectContaining({
        ...project,
        assets: [],
        scenes: [expect.objectContaining({ ...project.scenes[0], assetId: null })],
      }),
    )
  })
})

function createService() {
  return {
    list: vi.fn(async () => ({ success: true, projects: [] })),
    get: vi.fn(async () => ({ success: true })),
    create: vi.fn(async () => ({ success: true })),
    save: vi.fn(async () => ({ success: true })),
    importAsset: vi.fn(async () => ({ success: true })),
    onChanged: vi.fn(() => () => undefined),
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
