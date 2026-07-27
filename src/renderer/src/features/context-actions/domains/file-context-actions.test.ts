import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useFsStore } from '../../../stores/fs-store'
import { createFileContextCommands, fileMenuContributions } from './file-context-actions'

const fileTarget = {
  kind: 'file' as const,
  workspaceKey: '/workspace',
  path: '/workspace/note.md',
  name: 'note.md',
  fileType: 'file' as const,
  extension: '.md',
}

describe('file context rename', () => {
  beforeEach(() => {
    useFsStore.setState({
      workspacePath: '/workspace',
      tree: [
        {
          name: 'note.md',
          path: '/workspace/note.md',
          type: 'file',
          extension: '.md',
        },
      ],
      operationError: null,
      clipboardEntry: null,
    })
  })

  it('edits the file name inside the context menu and executes the filesystem rename', async () => {
    const contribution = fileMenuContributions.find((item) => item.id === 'file.rename')!
    const confirmRename = vi.fn().mockResolvedValue(true)
    useFsStore.setState({ confirmRename })

    expect(
      contribution.inlineInput?.initialValue({ source: 'context-menu', target: fileTarget }),
    ).toBe('note.md')

    const command = createFileContextCommands().find((item) => item.id === 'fileTree.rename')!
    await command.action({
      source: 'context-menu',
      target: fileTarget,
      inputValue: 'renamed.md',
    })

    expect(confirmRename).toHaveBeenCalledWith('/workspace/note.md', 'renamed.md')
  })

  it('surfaces the filesystem failure instead of silently closing the menu', async () => {
    const confirmRename = vi.fn().mockResolvedValue(false)
    useFsStore.setState({
      confirmRename,
      operationError: '重命名失败: 目标文件已存在',
    })
    const command = createFileContextCommands().find((item) => item.id === 'fileTree.rename')!

    await expect(
      command.action({
        source: 'context-menu',
        target: fileTarget,
        inputValue: 'existing.md',
      }),
    ).rejects.toThrow('重命名失败: 目标文件已存在')
  })
})

describe('file context clipboard', () => {
  it('uses the same copy command for the menu and keyboard shortcut', async () => {
    const copyEntryToClipboard = vi.fn()
    useFsStore.setState({ copyEntryToClipboard })
    const command = createFileContextCommands().find((item) => item.id === 'fileTree.copyEntry')!
    const contribution = fileMenuContributions.find((item) => item.id === 'file.copy-entry')!

    expect(command.shortcut).toBe('⌘C')
    expect(contribution.commandId).toBe(command.id)
    await command.action({ source: 'shortcut', target: fileTarget })

    expect(copyEntryToClipboard).toHaveBeenCalledWith({
      workspacePath: '/workspace',
      path: '/workspace/note.md',
      name: 'note.md',
      fileType: 'file',
    })
  })

  it('pastes through the filesystem store and reports an unavailable clipboard', async () => {
    const command = createFileContextCommands().find((item) => item.id === 'fileTree.pasteEntry')!
    expect(command.enabled?.({ source: 'context-menu', target: fileTarget })).toEqual({
      enabled: false,
      reason: '尚未复制文件或文件夹',
    })

    const pasteClipboardEntry = vi.fn().mockResolvedValue({
      sourcePath: '/workspace/source.md',
      destinationPath: '/workspace/source 副本.md',
    })
    useFsStore.setState({
      clipboardEntry: {
        workspacePath: '/workspace',
        path: '/workspace/source.md',
        name: 'source.md',
        fileType: 'file',
      },
      pasteClipboardEntry,
    })

    expect(command.enabled?.({ source: 'context-menu', target: fileTarget })).toBe(true)
    await command.action({ source: 'shortcut', target: fileTarget })
    expect(pasteClipboardEntry).toHaveBeenCalledWith('/workspace/note.md', 'file')
  })
})
