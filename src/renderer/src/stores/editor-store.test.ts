import { beforeEach, describe, expect, it } from 'vitest'
import { useEditorStore } from './editor-store'

beforeEach(() => {
  useEditorStore.setState({ files: {}, pendingUpdates: [] })
})

describe('useEditorStore', () => {
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
      expect(files['virtual:note']).toEqual({
        savedContent: '',
        currentContent: '# 未命名',
        dirty: true,
        loading: false,
        diagnostics: [],
      })
      expect(files['/docs/plan.md']).toEqual({
        savedContent: 'old',
        currentContent: 'new',
        dirty: true,
        loading: false,
        diagnostics: [],
      })
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
  })
})
