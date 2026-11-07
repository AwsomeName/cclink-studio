import { describe, it, expect, beforeEach } from 'vitest'
import { normalizeWorkspaceLayout, UI_DEFAULTS, useUIStore } from './ui-store'

beforeEach(() => {
  // 重置到默认状态
  useUIStore.setState({
    ...UI_DEFAULTS,
    agentDrawerOpen: false,
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
  it('opening conversations expands the default single-column width so both columns can fit', () => {
    useUIStore.getState().showAgentSessions()
    expect(useUIStore.getState()).toMatchObject({
      agentPanelMode: 'right',
      agentContentMode: 'split',
      agentPanelWidth: 700,
      agentListWidth: 220,
    })
  })

  it('opening conversations preserves an existing usable two-column width', () => {
    useUIStore.setState({ agentPanelWidth: 620, agentListWidth: 240 })
    useUIStore.getState().showAgentSessions()
    expect(useUIStore.getState().agentPanelWidth).toBe(620)
  })

  it.each(['list', 'split'] as const)(
    'opening chat from %s repairs a legacy narrow two-column target',
    (agentContentMode) => {
      useUIStore.setState({ agentContentMode, agentPanelWidth: 350, agentDrawerOpen: true })
      useUIStore.getState().showAgentChat()
      expect(useUIStore.getState()).toMatchObject({
        agentContentMode: 'split',
        agentPanelWidth: 700,
        agentDrawerOpen: false,
      })
    },
  )

  it('opening chat alone does not expand its single-column width', () => {
    useUIStore.getState().showAgentChat()
    expect(useUIStore.getState()).toMatchObject({ agentContentMode: 'chat', agentPanelWidth: 350 })
  })

  it('收放内部列和整个面板都不改写展开宽度', () => {
    const ui = useUIStore.getState()
    ui.setAgentPanelWidth(700)
    ui.setAgentListWidth(240)
    ui.setAgentContentMode('split')
    ui.setAgentContentMode('list')
    ui.toggleAgentPanel()
    ui.toggleAgentPanel()
    expect(useUIStore.getState()).toMatchObject({
      agentPanelWidth: 700,
      agentListWidth: 240,
      agentContentMode: 'list',
    })
    ui.showAgentChat()
    expect(useUIStore.getState()).toMatchObject({
      agentPanelWidth: 700,
      agentListWidth: 240,
      agentContentMode: 'split',
      agentDrawerOpen: false,
    })
    ui.setAgentContentMode('chat')
    ui.showAgentChat()
    expect(useUIStore.getState().agentContentMode).toBe('chat')
  })

  it('工作空间恢复只恢复偏好，临时抽屉不跨工作空间泄漏', () => {
    const saved = normalizeWorkspaceLayout({
      agentPanelMode: 'right',
      agentPanelWidth: 700,
      agentListWidth: 250,
      agentContentMode: 'split',
    })
    useUIStore.getState().showAgentSessions()
    useUIStore.getState().hydrateFromWorkspaceState(saved)
    expect(useUIStore.getState()).toMatchObject({ ...saved, agentDrawerOpen: false })
    useUIStore.getState().hydrateFromWorkspaceState({})
    expect(useUIStore.getState()).toMatchObject({
      agentContentMode: 'chat',
      agentListWidth: 220,
      agentPanelWidth: 350,
    })
  })

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

    it('会话入口打开右侧列表并保持左侧文件树', () => {
      useUIStore.getState().hideSidebar()
      useUIStore.getState().setActivePanel('sessions')
      expect(useUIStore.getState()).toMatchObject({
        activePanel: 'files',
        sidebarVisible: false,
        agentPanelMode: 'right',
        agentContentMode: 'split',
        agentDrawerOpen: true,
      })
    })

    it('网站与账号是可见 Activity 面板', () => {
      const { setActivePanel } = useUIStore.getState()
      setActivePanel('operations')
      expect(useUIStore.getState().activePanel).toBe('operations')
      expect(useUIStore.getState().sidebarVisible).toBe(true)
    })

    it('事务是可见 Activity 面板', () => {
      useUIStore.getState().setActivePanel('affairs')
      expect(useUIStore.getState().activePanel).toBe('affairs')
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

    it('视频创作是独立可见 Activity 面板', () => {
      const { setActivePanel } = useUIStore.getState()
      setActivePanel('video-creation')
      expect(useUIStore.getState().activePanel).toBe('video-creation')
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

  describe('showPanel', () => {
    it('keeps company accounts selectable and restorable instead of falling back to files', () => {
      useUIStore.getState().setActivePanel('company-accounts')
      expect(useUIStore.getState().activePanel).toBe('company-accounts')
      useUIStore.getState().showPanel('company-accounts')
      expect(useUIStore.getState()).toMatchObject({
        activePanel: 'company-accounts',
        sidebarVisible: true,
      })
      expect(normalizeWorkspaceLayout({ activePanel: 'company-accounts' }).activePanel).toBe(
        'company-accounts',
      )
    })
    it('重复展示同一面板不会反向折叠侧栏', () => {
      useUIStore.getState().showPanel('files')
      useUIStore.getState().showPanel('files')

      expect(useUIStore.getState().activePanel).toBe('files')
      expect(useUIStore.getState().sidebarVisible).toBe(true)
    })

    it('会切换并展开目标面板', () => {
      useUIStore.setState({ activePanel: 'browser', sidebarVisible: false })
      useUIStore.getState().showPanel('files')

      expect(useUIStore.getState().activePanel).toBe('files')
      expect(useUIStore.getState().sidebarVisible).toBe(true)
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

    it('隐藏后按当前入口指定的布局恢复，不被旧布局记忆覆盖', () => {
      useUIStore.getState().setAgentPanelMode('center')
      useUIStore.getState().toggleAgentPanel()
      useUIStore.getState().toggleAgentPanel('right')
      expect(useUIStore.getState().agentPanelVisible).toBe(true)
      expect(useUIStore.getState().agentPanelMode).toBe('right')
      expect(useUIStore.getState().agentPanelLastVisibleMode).toBe('right')
    })

    it('隐藏状态可以由明确入口打开居中落地页', () => {
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

    it('用户调整过右侧面板后，empty 上下文不能覆盖用户布局', () => {
      useUIStore.setState({
        agentPanelMode: 'right',
        agentPanelLastVisibleMode: 'right',
        agentPanelModeSource: 'user',
        agentPanelVisible: true,
      })

      useUIStore.getState().applySystemWorkContext('empty')

      expect(useUIStore.getState().agentPanelMode).toBe('right')
      expect(useUIStore.getState().agentPanelModeSource).toBe('user')
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
    it.each([undefined, null, [], 'invalid'])('缺失或非法整体布局完整恢复默认值：%s', (value) => {
      useUIStore.setState({
        sidebarVisible: false,
        sidebarWidth: 450,
        agentPanelMode: 'hidden',
        agentPanelModeSource: 'user',
      })
      useUIStore.getState().hydrateFromWorkspaceState(value)
      expect(useUIStore.getState()).toMatchObject(UI_DEFAULTS)
    })

    it.each([NaN, Infinity, -Infinity, '320', 0, 501])('非法目标宽度逐字段回退：%s', (width) => {
      expect(
        normalizeWorkspaceLayout({
          sidebarWidth: width,
          agentPanelWidth: 600,
          sidebarVisible: false,
        }),
      ).toMatchObject({ sidebarWidth: 250, agentPanelWidth: 600, sidebarVisible: false })
    })

    it('非法 mode/source 回默认，合法 mode 决定兼容可见性', () => {
      expect(
        normalizeWorkspaceLayout({
          agentPanelMode: 'invalid',
          agentPanelModeSource: 'invalid',
          agentPanelVisible: false,
        }),
      ).toMatchObject({
        agentPanelMode: 'center',
        agentPanelModeSource: 'system',
        agentPanelVisible: true,
      })
      expect(
        normalizeWorkspaceLayout({
          agentPanelMode: 'hidden',
          agentPanelVisible: true,
          agentPanelModeSource: 'user',
        }),
      ).toMatchObject({
        agentPanelMode: 'hidden',
        agentPanelVisible: false,
        agentPanelModeSource: 'user',
      })
    })

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
      expect(state.agentPanelVisible).toBe(true)
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

    it('隐藏快照不覆盖当前入口指定的右侧布局', () => {
      useUIStore.getState().hydrateFromWorkspaceState({
        agentPanelMode: 'hidden',
        agentPanelVisible: false,
        agentPanelLastVisibleMode: 'right',
        agentPanelModeSource: 'user',
      })

      useUIStore.getState().toggleAgentPanel('right')

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

    it('分别恢复视频创作与旧硬件生产 Activity', () => {
      useUIStore.getState().hydrateFromWorkspaceState({ activePanel: 'video-creation' })
      expect(useUIStore.getState().activePanel).toBe('video-creation')

      useUIStore.getState().hydrateFromWorkspaceState({ activePanel: 'production' })
      expect(useUIStore.getState().activePanel).toBe('production')
    })
  })
})
