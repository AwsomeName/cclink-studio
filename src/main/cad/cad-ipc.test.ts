import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockIpcMain = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
    mockIpcMain.handlers.set(channel, handler)
  }),
}))

vi.mock('electron', () => ({ ipcMain: mockIpcMain }))

import { FileService } from '../fs/file-service'
import { registerCadIpc } from './cad-ipc'

let tempDir = ''

beforeEach(async () => {
  mockIpcMain.handlers.clear()
  tempDir = await mkdtemp(join(tmpdir(), 'cclink-studio-cad-ipc-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('CAD IPC file authorization', () => {
  it('rejects convertModel outside the active workspace before conversion', async () => {
    const workspaceRoot = join(tempDir, 'workspace')
    const outsidePath = join(tempDir, 'outside.step')
    await mkdir(workspaceRoot)
    await writeFile(outsidePath, 'ISO-10303-21;', 'utf-8')
    const fileService = new FileService({ getActiveWorkspace: () => workspaceRoot })
    const cad = { convertModel: vi.fn() }
    registerCadIpc(cad as never, fileService, createGuard() as never)

    await expect(
      mockIpcMain.handlers.get('cad:convertModel')?.(createEvent(), {
        inputPath: outsidePath,
        targetFormat: 'stl',
      }),
    ).rejects.toThrow('OUTSIDE_WORKSPACE')
    expect(cad.convertModel).not.toHaveBeenCalled()
  })

  it('converts an authorized source and returns an opaque preview reference', async () => {
    const workspaceRoot = join(tempDir, 'workspace')
    const sourcePath = join(workspaceRoot, 'part.step')
    await mkdir(workspaceRoot)
    await writeFile(sourcePath, 'ISO-10303-21;', 'utf-8')
    const fileService = new FileService({ getActiveWorkspace: () => workspaceRoot })
    const convertModel = vi.fn().mockResolvedValue({
      success: true,
      previewPath: join(tempDir, 'cad-cache', 'hash', 'preview.stl'),
      format: 'stl',
      sourceHash: 'hash',
      diagnostics: [],
    })
    const createPreviewGrant = vi.fn().mockReturnValue({
      success: true,
      previewRef: 'opaque-ref',
      format: 'stl',
      sourceHash: 'hash',
      diagnostics: [],
    })
    registerCadIpc(
      { convertModel, createPreviewGrant } as never,
      fileService,
      createGuard() as never,
    )

    await expect(
      mockIpcMain.handlers.get('cad:convertModel')?.(createEvent(), {
        inputPath: sourcePath,
        targetFormat: 'stl',
      }),
    ).resolves.toMatchObject({ previewRef: 'opaque-ref' })
    expect(convertModel).toHaveBeenCalledWith({
      inputPath: await realpath(sourcePath),
      targetFormat: 'stl',
    })
    expect(createPreviewGrant).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
      expect.objectContaining({
        rendererId: 7,
        workspaceRoot: await realpath(workspaceRoot),
        requestedSourcePath: sourcePath,
        canonicalSourcePath: await realpath(sourcePath),
      }),
    )
  })
})

function createEvent() {
  return {
    sender: {
      id: 7,
      once: vi.fn(),
    },
  }
}

function createGuard() {
  return {
    assert: vi.fn(),
    isTrusted: vi.fn(() => true),
  }
}
