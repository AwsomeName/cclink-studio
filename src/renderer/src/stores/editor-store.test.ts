import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FsSaveTextDocumentResult, FsTextDocumentSnapshot } from '@shared/ipc/fs'
import { useEditorStore } from './editor-store'
import { registerEditorSaveGuard } from '../features/editor-save-guard'

beforeEach(() => {
  useEditorStore.setState({ files: {}, pendingUpdates: [] })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useEditorStore', () => {
  describe('saveFile', () => {
    it('runs the mounted editor guard before any disk write', async () => {
      const saveTextDocument = vi.fn()
      vi.stubGlobal('window', { cclinkStudio: { fs: { saveTextDocument } } })
      useEditorStore.setState({
        files: {
          '/project/notes.md': {
            savedContent: '# Old',
            currentContent: '# Unsafe draft',
            dirty: true,
            loading: false,
          },
        },
        pendingUpdates: [],
      })
      const guard = vi.fn(() => {
        throw new Error('保存前复查失败')
      })
      const unregister = registerEditorSaveGuard('/project/notes.md', guard)

      try {
        await expect(useEditorStore.getState().saveFile('/project/notes.md')).rejects.toThrow(
          '保存前复查失败',
        )
      } finally {
        unregister()
      }

      expect(guard).toHaveBeenCalledOnce()
      expect(saveTextDocument).not.toHaveBeenCalled()
      expect(useEditorStore.getState().files['/project/notes.md'].dirty).toBe(true)
    })

    it('keeps the exact editor buffer as the saved baseline when disk metadata is added', async () => {
      const saveTextDocument = vi.fn().mockResolvedValue({
        status: 'saved',
        snapshot: {
          path: '/project/notes.md',
          content:
            '<!-- cclink-document: {"version":1,"resources":"notes.assets/manifest.json"} -->\n\n# Draft',
          size: 100,
          modifiedAt: 2,
          hash: 'next-hash',
        },
      })
      vi.stubGlobal('window', { cclinkStudio: { fs: { saveTextDocument } } })
      useEditorStore.setState({
        files: {
          '/project/notes.md': {
            savedContent: '# Old',
            currentContent: '# Draft',
            dirty: true,
            loading: false,
          },
        },
        pendingUpdates: [],
      })

      await useEditorStore.getState().saveFile('/project/notes.md')

      const file = useEditorStore.getState().files['/project/notes.md']
      expect(file.savedContent).toBe('# Draft')
      expect(file.currentContent).toBe('# Draft')
      expect(file.dirty).toBe(false)
      expect(file.versionHash).toBe('next-hash')
      expect(file.sourceLineOffset).toBe(2)
    })

    it('does not discard edits made while an earlier save is in flight', async () => {
      let resolveSave!: (result: FsSaveTextDocumentResult) => void
      const saveTextDocument = vi.fn(
        () =>
          new Promise((resolve) => {
            resolveSave = resolve
          }),
      )
      vi.stubGlobal('window', { cclinkStudio: { fs: { saveTextDocument } } })
      useEditorStore.setState({
        files: {
          '/project/notes.md': {
            savedContent: '# Old',
            currentContent: '# First draft',
            dirty: true,
            loading: false,
          },
        },
        pendingUpdates: [],
      })

      const saving = useEditorStore.getState().saveFile('/project/notes.md')
      useEditorStore.getState().updateContent('/project/notes.md', '# Newer draft')
      resolveSave({
        status: 'saved',
        snapshot: {
          path: '/project/notes.md',
          content: '# First draft',
          size: 13,
          modifiedAt: 2,
          hash: 'next-hash',
        },
      })
      await saving

      const file = useEditorStore.getState().files['/project/notes.md']
      expect(file.savedContent).toBe('# First draft')
      expect(file.currentContent).toBe('# Newer draft')
      expect(file.dirty).toBe(true)
    })

    it('serializes saves for one file and lets the queued save capture the latest revision', async () => {
      let resolveFirst!: (result: FsSaveTextDocumentResult) => void
      let resolveSecond!: (result: FsSaveTextDocumentResult) => void
      const saveTextDocument = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<FsSaveTextDocumentResult>((resolve) => {
              resolveFirst = resolve
            }),
        )
        .mockImplementationOnce(
          () =>
            new Promise<FsSaveTextDocumentResult>((resolve) => {
              resolveSecond = resolve
            }),
        )
      vi.stubGlobal('window', { cclinkStudio: { fs: { saveTextDocument } } })
      useEditorStore.setState({
        files: {
          '/project/notes.md': {
            savedContent: '# Old',
            currentContent: '# First draft',
            dirty: true,
            loading: false,
            versionHash: 'base-hash',
          },
        },
        pendingUpdates: [],
      })

      const firstSave = useEditorStore.getState().saveFile('/project/notes.md')
      await vi.waitFor(() => expect(saveTextDocument).toHaveBeenCalledOnce())
      useEditorStore.getState().updateContent('/project/notes.md', '# Newer draft')
      const secondSave = useEditorStore.getState().saveFile('/project/notes.md')

      expect(saveTextDocument).toHaveBeenCalledOnce()
      resolveFirst({
        status: 'saved',
        snapshot: {
          path: '/project/notes.md',
          content: '# First draft',
          size: 13,
          modifiedAt: 2,
          hash: 'first-hash',
        },
      })
      await expect(firstSave).resolves.toBe('saved')
      await vi.waitFor(() => expect(saveTextDocument).toHaveBeenCalledTimes(2))
      expect(saveTextDocument).toHaveBeenLastCalledWith({
        filePath: '/project/notes.md',
        content: '# Newer draft',
        expectedHash: 'first-hash',
      })

      resolveSecond({
        status: 'saved',
        snapshot: {
          path: '/project/notes.md',
          content: '# Newer draft',
          size: 13,
          modifiedAt: 3,
          hash: 'second-hash',
        },
      })
      await expect(secondSave).resolves.toBe('saved')

      expect(useEditorStore.getState().files['/project/notes.md']).toMatchObject({
        savedContent: '# Newer draft',
        currentContent: '# Newer draft',
        dirty: false,
        versionHash: 'second-hash',
      })
    })

    it('does not let an old save response overwrite a reopened file session', async () => {
      let resolveSave!: (result: FsSaveTextDocumentResult) => void
      const saveTextDocument = vi.fn(
        () =>
          new Promise<FsSaveTextDocumentResult>((resolve) => {
            resolveSave = resolve
          }),
      )
      const readTextDocument = vi.fn().mockResolvedValue({
        path: '/project/notes.md',
        content: '# Reopened from disk',
        size: 20,
        modifiedAt: 3,
        hash: 'reopened-hash',
      })
      vi.stubGlobal('window', {
        cclinkStudio: { fs: { saveTextDocument, readTextDocument } },
      })
      useEditorStore.setState({
        files: {
          '/project/notes.md': {
            savedContent: '# Old',
            currentContent: '# Saving draft',
            dirty: true,
            loading: false,
            versionHash: 'base-hash',
          },
        },
        pendingUpdates: [],
      })

      const saving = useEditorStore.getState().saveFile('/project/notes.md')
      await vi.waitFor(() => expect(saveTextDocument).toHaveBeenCalledOnce())
      const oldSessionId = useEditorStore.getState().files['/project/notes.md'].sessionId
      useEditorStore.getState().closeFile('/project/notes.md')
      await useEditorStore.getState().openFile('/project/notes.md')
      const reopenedSessionId = useEditorStore.getState().files['/project/notes.md'].sessionId

      expect(reopenedSessionId).not.toBe(oldSessionId)
      resolveSave({
        status: 'saved',
        snapshot: {
          path: '/project/notes.md',
          content: '# Saving draft',
          size: 14,
          modifiedAt: 4,
          hash: 'old-save-hash',
        },
      })
      await saving

      expect(useEditorStore.getState().files['/project/notes.md']).toMatchObject({
        sessionId: reopenedSessionId,
        savedContent: '# Reopened from disk',
        currentContent: '# Reopened from disk',
        dirty: false,
        versionHash: 'reopened-hash',
      })
    })

    it('moves the save queue with a rebased file session', async () => {
      const resolvers: Array<(result: FsSaveTextDocumentResult) => void> = []
      const saveTextDocument = vi.fn(
        () =>
          new Promise<FsSaveTextDocumentResult>((resolve) => {
            resolvers.push(resolve)
          }),
      )
      vi.stubGlobal('window', { cclinkStudio: { fs: { saveTextDocument } } })
      useEditorStore.setState({
        files: {
          '/project/notes.md': {
            savedContent: '# Old',
            currentContent: '# First draft',
            dirty: true,
            loading: false,
            versionHash: 'base-hash',
          },
        },
        pendingUpdates: [],
      })

      const firstSave = useEditorStore.getState().saveFile('/project/notes.md')
      await vi.waitFor(() => expect(saveTextDocument).toHaveBeenCalledOnce())
      useEditorStore.getState().updateContent('/project/notes.md', '# Newer draft')
      const queuedBeforeMove = useEditorStore.getState().saveFile('/project/notes.md')
      useEditorStore.getState().rebaseFilePaths('/project/notes.md', '/project/renamed.md')
      const queuedAfterMove = useEditorStore.getState().saveFile('/project/renamed.md')

      expect(saveTextDocument).toHaveBeenCalledOnce()
      resolvers[0]({
        status: 'saved',
        snapshot: {
          path: '/project/notes.md',
          content: '# First draft',
          size: 13,
          modifiedAt: 2,
          hash: 'first-hash',
        },
      })
      await expect(firstSave).resolves.toBe('moved')
      await vi.waitFor(() => expect(saveTextDocument).toHaveBeenCalledTimes(2))
      expect(saveTextDocument).toHaveBeenLastCalledWith({
        filePath: '/project/renamed.md',
        content: '# Newer draft',
        expectedHash: 'base-hash',
      })

      resolvers[1]({
        status: 'saved',
        snapshot: {
          path: '/project/renamed.md',
          content: '# Newer draft',
          size: 13,
          modifiedAt: 3,
          hash: 'renamed-hash',
        },
      })
      await queuedBeforeMove
      await vi.waitFor(() => expect(saveTextDocument).toHaveBeenCalledTimes(3))
      expect(saveTextDocument).toHaveBeenLastCalledWith({
        filePath: '/project/renamed.md',
        content: '# Newer draft',
        expectedHash: 'renamed-hash',
      })

      resolvers[2]({
        status: 'saved',
        snapshot: {
          path: '/project/renamed.md',
          content: '# Newer draft',
          size: 13,
          modifiedAt: 4,
          hash: 'final-hash',
        },
      })
      await queuedAfterMove

      expect(useEditorStore.getState().files['/project/notes.md']).toBeUndefined()
      expect(useEditorStore.getState().files['/project/renamed.md']).toMatchObject({
        savedContent: '# Newer draft',
        currentContent: '# Newer draft',
        dirty: false,
        versionHash: 'final-hash',
      })
    })
  })

  describe('checkExternalChange', () => {
    it('preserves edits made while the external snapshot is being read', async () => {
      let resolveRead!: (snapshot: FsTextDocumentSnapshot) => void
      const readTextDocument = vi.fn(
        () =>
          new Promise<FsTextDocumentSnapshot>((resolve) => {
            resolveRead = resolve
          }),
      )
      vi.stubGlobal('window', { cclinkStudio: { fs: { readTextDocument } } })
      useEditorStore.setState({
        files: {
          '/project/notes.md': {
            savedContent: '# Base',
            currentContent: '# Base',
            dirty: false,
            loading: false,
            versionHash: 'base-hash',
          },
        },
        pendingUpdates: [],
      })

      const checking = useEditorStore.getState().checkExternalChange('/project/notes.md')
      await vi.waitFor(() => expect(readTextDocument).toHaveBeenCalledOnce())
      useEditorStore.getState().updateContent('/project/notes.md', '# New draft')
      resolveRead({
        path: '/project/notes.md',
        content: '# External',
        size: 10,
        modifiedAt: 2,
        hash: 'external-hash',
      })

      await expect(checking).resolves.toBe('conflict')
      expect(useEditorStore.getState().files['/project/notes.md']).toMatchObject({
        savedContent: '# Base',
        currentContent: '# New draft',
        dirty: true,
        versionHash: 'base-hash',
        externalContent: '# External',
        externalHash: 'external-hash',
      })
    })

    it('ignores an external snapshot from a closed file session', async () => {
      let resolveOldRead!: (snapshot: FsTextDocumentSnapshot) => void
      const readTextDocument = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<FsTextDocumentSnapshot>((resolve) => {
              resolveOldRead = resolve
            }),
        )
        .mockResolvedValueOnce({
          path: '/project/notes.md',
          content: '# Reopened',
          size: 10,
          modifiedAt: 3,
          hash: 'reopened-hash',
        })
      vi.stubGlobal('window', { cclinkStudio: { fs: { readTextDocument } } })
      useEditorStore.setState({
        files: {
          '/project/notes.md': {
            savedContent: '# Base',
            currentContent: '# Base',
            dirty: false,
            loading: false,
            versionHash: 'base-hash',
          },
        },
        pendingUpdates: [],
      })

      const checking = useEditorStore.getState().checkExternalChange('/project/notes.md')
      await vi.waitFor(() => expect(readTextDocument).toHaveBeenCalledOnce())
      const oldSessionId = useEditorStore.getState().files['/project/notes.md'].sessionId
      useEditorStore.getState().closeFile('/project/notes.md')
      await useEditorStore.getState().openFile('/project/notes.md')
      useEditorStore.getState().updateContent('/project/notes.md', '# Reopened draft')
      const reopenedSessionId = useEditorStore.getState().files['/project/notes.md'].sessionId

      expect(reopenedSessionId).not.toBe(oldSessionId)
      resolveOldRead({
        path: '/project/notes.md',
        content: '# External from old session',
        size: 27,
        modifiedAt: 4,
        hash: 'external-hash',
      })

      await expect(checking).resolves.toBe('same')
      expect(useEditorStore.getState().files['/project/notes.md']).toMatchObject({
        sessionId: reopenedSessionId,
        savedContent: '# Reopened',
        currentContent: '# Reopened draft',
        dirty: true,
        versionHash: 'reopened-hash',
      })
    })
  })

  describe('initVirtualFile', () => {
    it('初始化虚拟文件并根据种子内容标记 dirty', () => {
      useEditorStore.getState().initVirtualFile('virtual:note', '# 草稿')

      const file = useEditorStore.getState().files['virtual:note']
      expect(file.currentContent).toBe('# 草稿')
      expect(file.savedContent).toBe('')
      expect(file.dirty).toBe(true)
      expect(file.loading).toBe(false)
    })

    it('已存在虚拟文件时不覆盖当前内容', () => {
      useEditorStore.getState().initVirtualFile('virtual:note', 'A')
      useEditorStore.getState().initVirtualFile('virtual:note', 'B')

      expect(useEditorStore.getState().files['virtual:note'].currentContent).toBe('A')
    })
  })

  describe('hydrateFromWorkspaceState', () => {
    it('从工作台快照恢复编辑器草稿并清除 loading', () => {
      useEditorStore.getState().hydrateFromWorkspaceState({
        files: {
          'virtual:note': {
            savedContent: '',
            currentContent: '# 未命名',
            dirty: true,
            loading: true,
          },
          '/docs/plan.md': {
            savedContent: 'old',
            currentContent: 'new',
            dirty: true,
            loading: true,
          },
        },
      })

      const files = useEditorStore.getState().files
      expect(files['virtual:note']).toMatchObject({
        savedContent: '',
        currentContent: '# 未命名',
        dirty: true,
        loading: false,
        diagnostics: [],
      })
      expect(files['/docs/plan.md']).toMatchObject({
        savedContent: 'old',
        currentContent: 'new',
        dirty: true,
        loading: false,
        diagnostics: [],
      })
      expect(files['virtual:note'].sessionId).toBeTypeOf('number')
      expect(files['/docs/plan.md'].sessionId).toBeTypeOf('number')
      expect(files['virtual:note'].sessionId).not.toBe(files['/docs/plan.md'].sessionId)
    })

    it('空文件快照会清空当前编辑器状态', () => {
      useEditorStore.setState({
        files: {
          'virtual:note': {
            savedContent: '',
            currentContent: 'keep',
            dirty: true,
            loading: false,
          },
        },
        pendingUpdates: [],
      })

      useEditorStore.getState().hydrateFromWorkspaceState({ files: {} })

      expect(useEditorStore.getState().files).toEqual({})
    })

    it('非法快照不覆盖当前编辑器状态', () => {
      useEditorStore.setState({
        files: {
          'virtual:note': {
            savedContent: '',
            currentContent: 'keep',
            dirty: true,
            loading: false,
          },
        },
        pendingUpdates: [],
      })

      useEditorStore.getState().hydrateFromWorkspaceState({ broken: true })

      expect(useEditorStore.getState().files['virtual:note'].currentContent).toBe('keep')
    })

    it('恢复草稿时移除选区映射提示并合并重复的文档诊断', () => {
      const compatibilityWarning = {
        code: 'unsupported-math' as const,
        severity: 'warning' as const,
        message: '数学公式按原文保留。',
      }
      useEditorStore.getState().hydrateFromWorkspaceState({
        files: {
          '/docs/plan.md': {
            savedContent: 'old',
            currentContent: 'new',
            dirty: true,
            diagnostics: [
              compatibilityWarning,
              compatibilityWarning,
              {
                code: 'source-map-mismatch',
                severity: 'warning',
                message: '选区采用邻近块映射。',
              },
            ],
          },
        },
      })

      expect(useEditorStore.getState().files['/docs/plan.md'].diagnostics).toEqual([
        compatibilityWarning,
      ])
    })
  })

  describe('setDiagnostics', () => {
    it('不保存选区映射提示且相同诊断不会重复更新状态', () => {
      useEditorStore.getState().initVirtualFile('virtual:note', '# 草稿')
      const compatibilityWarning = {
        code: 'unsupported-math' as const,
        severity: 'warning' as const,
        message: '数学公式按原文保留。',
      }

      useEditorStore.getState().setDiagnostics('virtual:note', [
        compatibilityWarning,
        compatibilityWarning,
        {
          code: 'source-map-mismatch',
          severity: 'warning',
          message: '选区采用邻近块映射。',
        },
      ])
      const firstFileState = useEditorStore.getState().files['virtual:note']

      expect(firstFileState.diagnostics).toEqual([compatibilityWarning])

      useEditorStore
        .getState()
        .setDiagnostics('virtual:note', [compatibilityWarning, compatibilityWarning])

      expect(useEditorStore.getState().files['virtual:note']).toBe(firstFileState)
    })
  })

  describe('pendingUpdates', () => {
    it('按文件消费 Agent 更新', () => {
      useEditorStore.getState().applyAgentUpdate({
        id: 'u1',
        type: 'write',
        filePath: '/a.md',
        content: 'A',
        timestamp: 1,
      })
      useEditorStore.getState().applyAgentUpdate({
        id: 'u2',
        type: 'write',
        filePath: '/b.md',
        content: 'B',
        timestamp: 2,
      })

      const updates = useEditorStore.getState().consumePendingUpdates('/a.md')

      expect(updates.map((update) => update.id)).toEqual(['u1'])
      expect(useEditorStore.getState().pendingUpdates.map((update) => update.id)).toEqual(['u2'])
    })

    it('目录移动后同步编辑缓冲和待处理更新路径', () => {
      useEditorStore.setState({
        files: {
          '/project/docs/note.md': {
            savedContent: 'old',
            currentContent: 'draft',
            dirty: true,
            loading: false,
          },
        },
        pendingUpdates: [
          {
            id: 'u1',
            type: 'write',
            filePath: '/project/docs/note.md',
            content: 'next',
            timestamp: 1,
          },
        ],
      })

      useEditorStore.getState().rebaseFilePaths('/project/docs', '/project/archive/docs')

      expect(useEditorStore.getState().files['/project/docs/note.md']).toBeUndefined()
      expect(useEditorStore.getState().files['/project/archive/docs/note.md']?.currentContent).toBe(
        'draft',
      )
      expect(useEditorStore.getState().pendingUpdates[0].filePath).toBe(
        '/project/archive/docs/note.md',
      )
    })

    it('Markdown 资源组重命名后保留 dirty 草稿并重写资源引用', () => {
      useEditorStore.setState({
        files: {
          '/project/notes.md': {
            savedContent: '![old](notes.assets/old.png)\n',
            currentContent: '![old](notes.assets/old.png)\n\n![new](notes.assets/new.png)\n\n草稿',
            dirty: true,
            loading: false,
          },
        },
        pendingUpdates: [],
      })

      useEditorStore.getState().relocateMarkdownFile('/project/notes.md', '/project/plan.md', {
        path: '/project/plan.md',
        content:
          '<!-- cclink-document: {"version":1,"resources":"plan.assets/manifest.json"} -->\n\n![old](plan.assets/old.png)\n',
        size: 1,
        modifiedAt: 2,
        hash: 'next-hash',
      })

      const file = useEditorStore.getState().files['/project/plan.md']
      expect(useEditorStore.getState().files['/project/notes.md']).toBeUndefined()
      expect(file.savedContent).toBe('![old](plan.assets/old.png)\n')
      expect(file.currentContent).toContain('![new](plan.assets/new.png)')
      expect(file.currentContent).toContain('草稿')
      expect(file.dirty).toBe(true)
      expect(file.versionHash).toBe('next-hash')
      expect(file.sourceLineOffset).toBe(2)
    })

    it('Markdown 中文资源组重命名后重写 dirty 草稿中的编码引用', () => {
      useEditorStore.setState({
        files: {
          '/project/旧文档.md': {
            savedContent: '![old](%E6%97%A7%E6%96%87%E6%A1%A3.assets/%E6%97%A7%E5%9B%BE.png)\n',
            currentContent:
              '![old](%E6%97%A7%E6%96%87%E6%A1%A3.assets/%E6%97%A7%E5%9B%BE.png)\n\n![new](%E6%97%A7%E6%96%87%E6%A1%A3.assets/%E6%96%B0%E5%9B%BE.png)\n',
            dirty: true,
            loading: false,
          },
        },
        pendingUpdates: [],
      })

      useEditorStore.getState().relocateMarkdownFile('/project/旧文档.md', '/project/新文档.md', {
        path: '/project/新文档.md',
        content:
          '<!-- cclink-document: {"version":1,"resources":"新文档.assets/manifest.json"} -->\n\n![old](%E6%96%B0%E6%96%87%E6%A1%A3.assets/%E6%97%A7%E5%9B%BE.png)\n',
        size: 1,
        modifiedAt: 2,
        hash: 'next-hash',
      })

      const file = useEditorStore.getState().files['/project/新文档.md']
      expect(file.currentContent).toContain(
        '![old](%E6%96%B0%E6%96%87%E6%A1%A3.assets/%E6%97%A7%E5%9B%BE.png)',
      )
      expect(file.currentContent).toContain(
        '![new](%E6%96%B0%E6%96%87%E6%A1%A3.assets/%E6%96%B0%E5%9B%BE.png)',
      )
      expect(file.dirty).toBe(true)
    })
  })
})
