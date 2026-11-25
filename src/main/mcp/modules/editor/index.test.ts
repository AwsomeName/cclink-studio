import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { EditorToolModule, type EditorFileAccess } from './index'

function createFixture(
  session: { open: boolean; dirty: boolean; conflict: boolean } | null = {
    open: false,
    dirty: false,
    conflict: false,
  },
) {
  // The renderer answers session-state requests; `null` models a renderer that never answers.
  const holder: { module?: EditorToolModule } = {}
  const send = vi.fn((channel: string, request: { id: string }) => {
    if (channel === 'editor:sessionStateRequest' && session) {
      queueMicrotask(() => holder.module?.resolveOperation(request.id, session))
    }
  })
  const mainWindow = {
    isDestroyed: () => false,
    webContents: { send },
  } as unknown as BrowserWindow
  const withAccess = vi.fn((_context: unknown, operation: () => unknown) =>
    operation(),
  ) as unknown as NonNullable<EditorFileAccess['withAccess']>
  const fileAccess: EditorFileAccess = {
    readFile: vi.fn().mockResolvedValue({ content: 'project text', encoding: 'utf-8' }),
    readDir: vi.fn().mockResolvedValue([
      { name: 'docs', path: '/project/docs', type: 'directory' },
      { name: 'package.json', path: '/project/package.json', type: 'file', extension: '.json' },
    ]),
    readTextDocument: vi.fn(async (path: string) => ({
      path,
      content: '# Report\n',
      size: 9,
      modifiedAt: 1,
      hash: 'disk-hash',
    })),
    saveTextDocument: vi.fn(async (input: { filePath: string; content: string }) => ({
      status: 'saved' as const,
      snapshot: {
        path: input.filePath,
        content: input.content,
        size: input.content.length,
        modifiedAt: 2,
        hash: 'new-hash',
      },
    })),
    withAccess,
  }
  const module = new EditorToolModule(mainWindow, fileAccess)
  holder.module = module
  return { module, fileAccess, send }
}

describe('EditorToolModule file access', () => {
  it('把 Run 启动时固定的工作空间传给统一 FileService owner', async () => {
    const { module, fileAccess } = createFixture()
    const trustedWorkspace = {
      kind: 'local' as const,
      rootPath: '/project-a',
      workspaceKey: '/project-a',
    }

    await module.execute('editor_read', { filePath: '/project-a/README.md' }, { trustedWorkspace })

    expect(fileAccess.withAccess).toHaveBeenCalledWith({ trustedWorkspace }, expect.any(Function))
  })

  it('指定 filePath 时直接读取磁盘，不依赖已挂载的编辑器组件', async () => {
    const { module, fileAccess, send } = createFixture()

    await expect(
      module.execute('editor_read', { filePath: '/project/package.json' }),
    ).resolves.toEqual({ content: 'project text' })
    expect(fileAccess.readFile).toHaveBeenCalledWith('/project/package.json')
    expect(send).not.toHaveBeenCalled()
  })

  it('磁盘读取失败时立即返回原始错误', async () => {
    const { module, fileAccess, send } = createFixture()
    vi.mocked(fileAccess.readFile).mockRejectedValueOnce(new Error('ENOENT: file not found'))

    await expect(
      module.execute('editor_read', { filePath: '/project/missing.md' }),
    ).rejects.toThrow('ENOENT: file not found')
    expect(send).not.toHaveBeenCalled()
  })

  it('错误路径参数立即报错，不退回当前编辑器等待超时', async () => {
    const { module, fileAccess, send } = createFixture()

    await expect(module.execute('editor_read', { path: '/project/marker.md' })).rejects.toThrow(
      '不是 path',
    )
    for (const filePath of [null, 123, '', ' ']) {
      await expect(module.execute('editor_read', { filePath })).rejects.toThrow('非空文件路径')
    }
    expect(fileAccess.readFile).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('可以先列出目录，再选择真实存在的项目文件', async () => {
    const { module, fileAccess } = createFixture()

    await expect(
      module.execute('editor_list', { dirPath: '/project', showHiddenFiles: true }),
    ).resolves.toEqual({
      dirPath: '/project',
      entries: [
        { name: 'docs', path: '/project/docs', type: 'directory' },
        {
          name: 'package.json',
          path: '/project/package.json',
          type: 'file',
          extension: '.json',
        },
      ],
    })
    expect(fileAccess.readDir).toHaveBeenCalledWith('/project', { showHiddenFiles: true })
  })

  it('读取二进制文件时给出明确错误', async () => {
    const { module, fileAccess } = createFixture()
    vi.mocked(fileAccess.readFile).mockResolvedValueOnce({ content: 'AA==', encoding: 'base64' })

    await expect(
      module.execute('editor_read', { filePath: '/project/archive.zip' }),
    ).rejects.toThrow('不支持把二进制文件作为文本读取')
  })

  it('写入经受管保存落盘，并携带读取时的磁盘版本', async () => {
    const { module, fileAccess, send } = createFixture()

    await expect(
      module.execute('editor_write', {
        filePath: '/project/docs/report.md',
        content: '# New',
      }),
    ).resolves.toEqual({
      success: true,
      persisted: true,
      verified: true,
      filePath: '/project/docs/report.md',
      bytes: 5,
    })

    expect(fileAccess.saveTextDocument).toHaveBeenCalledWith({
      filePath: '/project/docs/report.md',
      content: '# New',
      expectedHash: 'disk-hash',
    })
    expect(send).toHaveBeenCalledWith('editor:sessionStateRequest', {
      id: expect.any(String),
      filePath: '/project/docs/report.md',
    })
  })

  it('追加基于磁盘内容合并', async () => {
    const { module, fileAccess } = createFixture()

    await module.execute('editor_append', {
      filePath: '/project/docs/report.md',
      content: 'Second section',
    })

    expect(fileAccess.saveTextDocument).toHaveBeenCalledWith({
      filePath: '/project/docs/report.md',
      content: '# Report\n\nSecond section',
      expectedHash: 'disk-hash',
    })
  })

  it('新文件没有磁盘版本时直接创建', async () => {
    const { module, fileAccess } = createFixture()
    vi.mocked(fileAccess.readFile).mockRejectedValueOnce(
      Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' }),
    )

    await module.execute('editor_write', { filePath: '/project/new.md', content: '# New' })

    expect(fileAccess.saveTextDocument).toHaveBeenCalledWith({
      filePath: '/project/new.md',
      content: '# New',
      expectedHash: undefined,
    })
  })

  it('用户在编辑器里有未保存修改时拒绝写入，不碰磁盘', async () => {
    for (const session of [
      { open: true, dirty: true, conflict: false },
      { open: true, dirty: false, conflict: true },
    ]) {
      const { module, fileAccess } = createFixture(session)
      await expect(
        module.execute('editor_write', { filePath: '/project/a.md', content: '# Agent' }),
      ).rejects.toThrow('EDITOR_SESSION_DIRTY')
      expect(fileAccess.saveTextDocument).not.toHaveBeenCalled()
    }
  })

  it('打开但没有未保存修改时正常写入，交给编辑器实时重载', async () => {
    const { module, fileAccess } = createFixture({ open: true, dirty: false, conflict: false })
    await module.execute('editor_write', { filePath: '/project/a.md', content: '# Agent' })
    expect(fileAccess.saveTextDocument).toHaveBeenCalledOnce()
  })

  it('读取后磁盘被他人改动时报告冲突而不是覆盖', async () => {
    const { module, fileAccess } = createFixture()
    vi.mocked(fileAccess.saveTextDocument).mockResolvedValueOnce({
      status: 'conflict',
      current: null,
    })

    await expect(
      module.execute('editor_write', { filePath: '/project/a.md', content: '# Agent' }),
    ).rejects.toThrow('EDITOR_DISK_CHANGED')
  })

  it('渲染进程无应答时不写入', async () => {
    vi.useFakeTimers()
    try {
      const { module, fileAccess } = createFixture(null)
      const pending = module.execute('editor_write', { filePath: '/project/a.md', content: 'x' })
      const assertion = expect(pending).rejects.toThrow('EDITOR_SESSION_UNKNOWN')
      await vi.advanceTimersByTimeAsync(5_000)
      await assertion
      expect(fileAccess.saveTextDocument).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('拒绝修改二进制文件', async () => {
    const { module, fileAccess } = createFixture()
    vi.mocked(fileAccess.readFile).mockResolvedValueOnce({ content: 'AA==', encoding: 'base64' })

    await expect(
      module.execute('editor_append', { filePath: '/project/a.bin', content: 'x' }),
    ).rejects.toThrow('不支持修改二进制文件')
    expect(fileAccess.saveTextDocument).not.toHaveBeenCalled()
  })

  it('拒绝缺失或只有空白的隐式 editor 写入路径', async () => {
    const { module, send } = createFixture()

    await expect(module.execute('editor_write', { content: '# Draft' })).rejects.toThrow(
      '必须提供明确的文件路径',
    )
    await expect(
      module.execute('editor_insert', { content: '# Draft', position: 'end', filePath: ' ' }),
    ).rejects.toThrow('必须提供明确的文件路径')
    await expect(module.execute('editor_save', { filePath: ' ' })).rejects.toThrow(
      '必须提供明确的文件路径',
    )
    expect(send).not.toHaveBeenCalled()
  })
})
