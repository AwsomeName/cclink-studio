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
    agentPanelLastVisibleMode: 'center',
    agentPanelModeSource: 'system',
  })
})

describe('useUIStore', () => {
  describe('setActivePanel', () => {
    it('点击同一面板 → 折叠侧栏', () => {
      const { setActivePanel } = useUIStore.getState()
      expect(useUIStore.getState().sidebarVisible).toBe(true)

      setActivePanel('files')
      expect(useUIStore.getState().sidebarVisible).toBe(false)
      expect(useUIStore.getState().activePanel).toBe('files')
    })

    it('再次点击同一面板 → 展开侧栏', () => {
      const { setActivePanel } = useUIStore.getState()
      setActivePanel('files') // 折叠
      setActivePanel('files') // 再点 → 展开
      expect(useUIStore.getState().sidebarVisible).toBe(true)
    })

    it('停用的项目入口会转到文件侧栏', () => {
      useUIStore.getState().setActivePanel('projects')
      expect(useUIStore.getState().activePanel).toBe('files')
    })

    it('停用的会话入口会转到文件侧栏', () => {
      useUIStore.getState().setActivePanel('sessions')
      expect(useUIStore.getState().activePanel).toBe('files')
    })

    it('点击不同面板 → 展开侧栏并切换', () => {
      const { setActivePanel } = useUIStore.getState()
      setActivePanel('operations')
      expect(useUIStore.getState().activePanel).toBe('operations')
      expect(useUIStore.getState().sidebarVisible).toBe(true)
    })

    it('Terminal 是可见 Activity 面板', () => {
      const { setActivePanel } = useUIStore.getState()
      setActivePanel('terminal')
      expect(useUIStore.getState().activePanel).toBe('terminal')
      expect(useUIStore.getState().sidebarVisible).toBe(true)
    })

    it('生产是可见 Activity 面板', () => {
      const { setActivePanel } = useUIStore.getState()
      setActivePanel('production')
      expect(useUIStore.getState().activePanel).toBe('production')
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

    it('隐藏后恢复收起前的整个 Agent 面板布局', () => {
      useUIStore.getState().setAgentPanelMode('right')
      useUIStore.getState().toggleAgentPanel()
      useUIStore.getState().toggleAgentPanel('center')
      expect(useUIStore.getState().agentPanelVisible).toBe(true)
      expect(useUIStore.getState().agentPanelMode).toBe('right')
    })

    it('旧隐藏状态没有布局记忆时按当前上下文恢复', () => {
      useUIStore.setState({
        agentPanelMode: 'hidden',
        agentPanelLastVisibleMode: null,
        agentPanelVisible: false,
      })
      useUIStore.getState().toggleAgentPanel('center')
      expect(useUIStore.getState().agentPanelMode).toBe('center')
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
        agentPanelLastVisibleMode: 'right',
        agentPanelModeSource: 'system',
        agentPanelVisible: true,
      })
      useUIStore.getState().applySystemWorkContext('empty')
      expect(useUIStore.getState().agentPanelMode).toBe('center')
      expect(useUIStore.getState().agentPanelVisible).toBe(true)
    })

    it('用户调整过右侧面板后，关闭最后一个 Tab 仍回到居中', () => {
      useUIStore.setState({
        agentPanelMode: 'right',
        agentPanelLastVisibleMode: 'right',
        agentPanelModeSource: 'user',
        agentPanelVisible: true,
      })

      useUIStore.getState().applySystemWorkContext('empty')

      expect(useUIStore.getState().agentPanelMode).toBe('center')
      expect(useUIStore.getState().agentPanelModeSource).toBe('system')
      expect(useUIStore.getState().agentPanelVisible).toBe(true)
    })

    it('system 模式下工作上下文切到右侧', () => {
      useUIStore.setState({
        agentPanelMode: 'center',
        agentPanelLastVisibleMode: 'center',
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
        agentPanelLastVisibleMode: 'right',
        agentPanelModeSource: 'user',
        agentPanelVisible: false,
      })
      useUIStore.getState().applySystemWorkContext('browser')
      expect(useUIStore.getState().agentPanelMode).toBe('hidden')
      expect(useUIStore.getState().agentPanelVisible).toBe(false)
    })

    it('用户手动隐藏后，empty 上下文不会重新打开 Agent 面板', () => {
      useUIStore.setState({
        agentPanelMode: 'hidden',
        agentPanelLastVisibleMode: 'center',
        agentPanelModeSource: 'user',
        agentPanelVisible: false,
      })
      useUIStore.getState().applySystemWorkContext('empty')
      expect(useUIStore.getState().agentPanelMode).toBe('hidden')
      expect(useUIStore.getState().agentPanelModeSource).toBe('user')
      expect(useUIStore.getState().agentPanelVisible).toBe(false)
    })

    it('resetAgentLayout 恢复系统自动布局', () => {
      useUIStore.setState({
        agentPanelMode: 'hidden',
        agentPanelLastVisibleMode: 'right',
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
    it('从工作台快照恢复布局状态，并把旧 Activity 入口迁移到文件', () => {
      useUIStore.getState().hydrateFromWorkspaceState({
        activePanel: 'android',
        sidebarVisible: false,
        agentPanelVisible: false,
        sidebarWidth: 320,
        agentPanelWidth: 420,
        agentPanelMode: 'right',
        agentPanelLastVisibleMode: 'right',
        agentPanelModeSource: 'user',
      })

      const state = useUIStore.getState()
      expect(state.activePanel).toBe('files')
      expect(state.sidebarVisible).toBe(false)
      expect(state.agentPanelVisible).toBe(false)
      expect(state.sidebarWidth).toBe(320)
      expect(state.agentPanelWidth).toBe(420)
      expect(state.agentPanelMode).toBe('right')
      expect(state.agentPanelLastVisibleMode).toBe('right')
      expect(state.agentPanelModeSource).toBe('user')
    })

    it('非法面板回退到默认 files，避免恢复到不存在的 Activity', () => {
      useUIStore.getState().hydrateFromWorkspaceState({ activePanel: 'missing' })
      expect(useUIStore.getState().activePanel).toBe('files')
    })

    it('旧项目面板快照迁移到文件侧栏', () => {
      useUIStore.getState().hydrateFromWorkspaceState({ activePanel: 'projects' })
      expect(useUIStore.getState().activePanel).toBe('files')
    })

    it('隐藏快照保留收起前的右侧布局', () => {
      useUIStore.getState().hydrateFromWorkspaceState({
        agentPanelMode: 'hidden',
        agentPanelVisible: false,
        agentPanelLastVisibleMode: 'right',
        agentPanelModeSource: 'user',
      })

      useUIStore.getState().toggleAgentPanel('center')

      expect(useUIStore.getState().agentPanelMode).toBe('right')
      expect(useUIStore.getState().agentPanelVisible).toBe(true)
    })

    it('从工作台快照恢复 Terminal Activity', () => {
      useUIStore.getState().hydrateFromWorkspaceState({ activePanel: 'terminal' })
      expect(useUIStore.getState().activePanel).toBe('terminal')
    })

    it('从工作台快照恢复生产 Activity', () => {
      useUIStore.getState().hydrateFromWorkspaceState({ activePanel: 'production' })
      expect(useUIStore.getState().activePanel).toBe('production')
    })
  })
})
