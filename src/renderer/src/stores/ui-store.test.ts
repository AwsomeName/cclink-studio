import { describe, it, expect, beforeEach } from 'vitest'
import { useUIStore } from './ui-store'

beforeEach(() => {
  // 重置到默认状态
  useUIStore.setState({
    activePanel: 'files',
    sidebarVisible: true,
    agentPanelVisible: true,
    sidebarWidth: 250,
    agentPanelWidth: 350,
    agentPanelMode: 'center',
    agentPanelModeSource: 'system',
  })
})

describe('useUIStore', () => {
  describe('setActivePanel', () => {
    it('点击同一面板 → 折叠侧栏', () => {
      const { setActivePanel } = useUIStore.getState()
      expect(useUIStore.getState().sidebarVisible).toBe(true)

      setActivePanel('files') // 初始 activePanel 是 'files'
      expect(useUIStore.getState().sidebarVisible).toBe(false)
      expect(useUIStore.getState().activePanel).toBe('files')
    })

    it('再次点击同一面板 → 展开侧栏', () => {
      const { setActivePanel } = useUIStore.getState()
      setActivePanel('files') // 折叠
      setActivePanel('files') // 再点 → 展开
      expect(useUIStore.getState().sidebarVisible).toBe(true)
    })

    it('点击不同面板 → 展开侧栏并切换', () => {
      const { setActivePanel } = useUIStore.getState()
      setActivePanel('operations')
      expect(useUIStore.getState().activePanel).toBe('operations')
      expect(useUIStore.getState().sidebarVisible).toBe(true)
    })

    it('侧栏折叠时点击不同面板 → 展开侧栏', () => {
      const { setActivePanel } = useUIStore.getState()
      setActivePanel('files') // 折叠
      expect(useUIStore.getState().sidebarVisible).toBe(false)

      setActivePanel('browser') // 切换面板 → 展开
      expect(useUIStore.getState().sidebarVisible).toBe(true)
      expect(useUIStore.getState().activePanel).toBe('browser')
    })
  })

  describe('toggleSidebar', () => {
    it('切换侧栏可见性', () => {
      expect(useUIStore.getState().sidebarVisible).toBe(true)
      useUIStore.getState().toggleSidebar()
      expect(useUIStore.getState().sidebarVisible).toBe(false)
      useUIStore.getState().toggleSidebar()
      expect(useUIStore.getState().sidebarVisible).toBe(true)
    })
  })

  describe('toggleAgentPanel', () => {
    it('切换 Agent 面板可见性', () => {
      expect(useUIStore.getState().agentPanelVisible).toBe(true)
      useUIStore.getState().toggleAgentPanel()
      expect(useUIStore.getState().agentPanelVisible).toBe(false)
      expect(useUIStore.getState().agentPanelMode).toBe('hidden')
      expect(useUIStore.getState().agentPanelModeSource).toBe('user')
    })

    it('隐藏后再次切换回右侧面板', () => {
      useUIStore.getState().toggleAgentPanel()
      useUIStore.getState().toggleAgentPanel()
      expect(useUIStore.getState().agentPanelVisible).toBe(true)
      expect(useUIStore.getState().agentPanelMode).toBe('right')
    })
  })

  describe('宽度设置', () => {
    it('setSidebarWidth 设置侧栏宽度', () => {
      useUIStore.getState().setSidebarWidth(300)
      expect(useUIStore.getState().sidebarWidth).toBe(300)
    })

    it('setAgentPanelWidth 设置 Agent 面板宽度', () => {
      useUIStore.getState().setAgentPanelWidth(400)
      expect(useUIStore.getState().agentPanelWidth).toBe(400)
      expect(useUIStore.getState().agentPanelModeSource).toBe('user')
    })
  })

  describe('Agent 面板双形态布局', () => {
    it('system 模式下 empty 上下文切到居中', () => {
      useUIStore.setState({
        agentPanelMode: 'right',
        agentPanelModeSource: 'system',
        agentPanelVisible: true,
      })
      useUIStore.getState().applySystemWorkContext('empty')
      expect(useUIStore.getState().agentPanelMode).toBe('center')
      expect(useUIStore.getState().agentPanelVisible).toBe(true)
    })

    it('system 模式下工作上下文切到右侧', () => {
      useUIStore.setState({
        agentPanelMode: 'center',
        agentPanelModeSource: 'system',
        agentPanelVisible: true,
      })
      useUIStore.getState().applySystemWorkContext('browser')
      expect(useUIStore.getState().agentPanelMode).toBe('right')
      expect(useUIStore.getState().agentPanelVisible).toBe(true)
    })

    it('user 模式下不响应自动切换', () => {
      useUIStore.setState({
        agentPanelMode: 'hidden',
        agentPanelModeSource: 'user',
        agentPanelVisible: false,
      })
      useUIStore.getState().applySystemWorkContext('browser')
      expect(useUIStore.getState().agentPanelMode).toBe('hidden')
      expect(useUIStore.getState().agentPanelVisible).toBe(false)
    })

    it('empty 上下文强制进入中央 Codex 模式，即使之前是 user 布局', () => {
      useUIStore.setState({
        agentPanelMode: 'hidden',
        agentPanelModeSource: 'user',
        agentPanelVisible: false,
      })
      useUIStore.getState().applySystemWorkContext('empty')
      expect(useUIStore.getState().agentPanelMode).toBe('center')
      expect(useUIStore.getState().agentPanelModeSource).toBe('system')
      expect(useUIStore.getState().agentPanelVisible).toBe(true)
    })

    it('resetAgentLayout 恢复系统自动布局', () => {
      useUIStore.setState({
        agentPanelMode: 'hidden',
        agentPanelModeSource: 'user',
        agentPanelVisible: false,
        agentPanelWidth: 420,
      })
      useUIStore.getState().resetAgentLayout()
      expect(useUIStore.getState().agentPanelMode).toBe('center')
      expect(useUIStore.getState().agentPanelModeSource).toBe('system')
      expect(useUIStore.getState().agentPanelVisible).toBe(true)
      expect(useUIStore.getState().agentPanelWidth).toBe(350)
    })
  })

  describe('hydrateFromWorkspaceState', () => {
    it('从工作台快照恢复布局状态，并把旧 Activity 入口迁移回工作空间', () => {
      useUIStore.getState().hydrateFromWorkspaceState({
        activePanel: 'android',
        sidebarVisible: false,
        agentPanelVisible: false,
        sidebarWidth: 320,
        agentPanelWidth: 420,
        agentPanelMode: 'right',
        agentPanelModeSource: 'user',
      })

      const state = useUIStore.getState()
      expect(state.activePanel).toBe('files')
      expect(state.sidebarVisible).toBe(false)
      expect(state.agentPanelVisible).toBe(false)
      expect(state.sidebarWidth).toBe(320)
      expect(state.agentPanelWidth).toBe(420)
      expect(state.agentPanelMode).toBe('right')
      expect(state.agentPanelModeSource).toBe('user')
    })

    it('非法面板回退到默认 files，避免恢复到不存在的 Activity', () => {
      useUIStore.getState().hydrateFromWorkspaceState({ activePanel: 'missing' })
      expect(useUIStore.getState().activePanel).toBe('files')
    })
  })
})
