import { describe, it, expect, beforeEach } from 'vitest'
import { useTabStore } from './tab-store'
import { useBrowserStore } from './browser-store'
import { useEditorStore } from './editor-store'
import type { BrowserTabState } from './browser-store'

const browserTab = (overrides: Partial<BrowserTabState> = {}): BrowserTabState => ({
  url: 'https://www.baidu.com',
  urlInput: 'https://www.baidu.com',
  viewMode: 'desktop',
  zoomMode: 'fit',
  zoomFactor: 1,
  ready: true,
  history: ['https://www.baidu.com'],
  historyIndex: 0,
  ...overrides,
})

beforeEach(() => {
  useTabStore.setState({
    tabs: [{ id: 'browser', type: 'browser', title: '浏览器', icon: '🌐' }],
    activeTabId: 'browser',
  })
  useBrowserStore.setState({
    tabs: { browser: browserTab() },
  })
  useEditorStore.setState({ files: {}, pendingUpdates: [] })
})

describe('useTabStore', () => {
  it('远程文件或目录重命名后同步已打开 Tab，删除后关闭关联 Tab', () => {
    useTabStore.setState({
      tabs: [
        { id: 'browser', type: 'browser', title: '浏览器', icon: '🌐' },
        {
          id: 'remote-file-1',
          type: 'remote-file',
          title: 'README.md',
          icon: '📄',
          remoteFile: {
            serverId: 'agent-1',
            workspaceId: 'workspace-1',
            workspacePath: 'C:\\project',
            path: 'C:\\project\\docs\\README.md',
          },
        },
      ],
      activeTabId: 'remote-file-1',
    })

    useTabStore
      .getState()
      .rebaseRemoteFilePaths('agent-1', 'workspace-1', 'C:\\project\\docs', 'C:\\project\\guide')
    expect(useTabStore.getState().tabs[1].remoteFile?.path).toBe('C:\\project\\guide\\README.md')

    useTabStore.getState().closeRemoteFilePaths('agent-1', 'workspace-1', 'C:\\project\\guide')
    expect(useTabStore.getState().tabs.map((tab) => tab.id)).toEqual(['browser'])
    expect(useTabStore.getState().activeTabId).toBe('browser')
  })

  it('目录移动后同步所有关联 Tab 路径', () => {
    useTabStore.setState({
      tabs: [
        {
          id: 'note',
          type: 'editor',
          title: 'note.md',
          icon: '📝',
          filePath: '/project/docs/note.md',
        },
        {
          id: 'other',
          type: 'editor',
          title: 'other.md',
          icon: '📝',
          filePath: '/project/other.md',
        },
      ],
      activeTabId: 'note',
    })

    useTabStore.getState().rebaseFilePaths('/project/docs', '/project/archive/docs')

    expect(useTabStore.getState().tabs).toEqual([
      expect.objectContaining({ filePath: '/project/archive/docs/note.md' }),
      expect.objectContaining({ filePath: '/project/other.md' }),
    ])
  })

  describe('openTab', () => {
    it('添加新 Tab 并自动激活', () => {
      useTabStore.getState().openTab({ type: 'editor', title: 'README.md', icon: '📄' })

      const state = useTabStore.getState()
      expect(state.tabs).toHaveLength(2)
      expect(state.tabs[1].type).toBe('editor')
      expect(state.activeTabId).toBe(state.tabs[1].id)
    })

    it('相同 filePath 的 Tab 不重复创建，而是激活已有的', () => {
      useTabStore.getState().openTab({
        type: 'editor',
        title: 'README.md',
        icon: '📄',
        filePath: '/Users/test/README.md',
      })
      const firstId = useTabStore.getState().activeTabId

      useTabStore.getState().openTab({
        type: 'editor',
        title: 'README.md',
        icon: '📄',
        filePath: '/Users/test/README.md',
      })

      const state = useTabStore.getState()
      expect(state.tabs).toHaveLength(2) // browser + 1 editor
      expect(state.activeTabId).toBe(firstId)
    })

    it('HTML 允许浏览器和文本两种打开方式并存', () => {
      useTabStore.getState().openTab({
        type: 'browser',
        title: 'index.html',
        icon: '🌐',
        filePath: '/project/index.html',
        initialUrl: 'file:///project/index.html',
      })
      const browserId = useTabStore.getState().activeTabId

      useTabStore.getState().openTab({
        type: 'editor',
        title: 'index.html',
        icon: '</>',
        filePath: '/project/index.html',
      })
      const editorId = useTabStore.getState().activeTabId

      useTabStore.getState().openTab({
        type: 'browser',
        title: 'index.html',
        icon: '🌐',
        filePath: '/project/index.html',
        initialUrl: 'file:///project/index.html',
      })

      const htmlTabs = useTabStore
        .getState()
        .tabs.filter((tab) => tab.filePath === '/project/index.html')
      expect(htmlTabs).toHaveLength(2)
      expect(editorId).not.toBe(browserId)
      expect(useTabStore.getState().activeTabId).toBe(browserId)
    })

    it('browser Tab 不去重（无 forceNew 也能开多个）', () => {
      const len0 = useTabStore.getState().tabs.length
      useTabStore.getState().openTab({ type: 'browser', title: '浏览器', icon: '🌐' })
      useTabStore.getState().openTab({ type: 'browser', title: '浏览器', icon: '🌐' })
      expect(useTabStore.getState().tabs.length).toBe(len0 + 2)
    })

    it('两个未命名编辑器可共存', () => {
      useTabStore.getState().openTab({ type: 'editor', title: '未命名.md', icon: '📄' })
      useTabStore.getState().openTab({ type: 'editor', title: '未命名.md', icon: '📄' })
      expect(useTabStore.getState().tabs.filter((t) => t.type === 'editor')).toHaveLength(2)
    })

    it('同一工作空间的宣发视频工程只打开一个 Tab', () => {
      const draft = {
        type: 'media-production' as const,
        title: '产品发布',
        icon: '🎬',
        workspaceRef: { kind: 'local' as const, path: '/project' },
        mediaProject: { projectId: '12345678-1234-1234-1234-123456789abc' },
      }
      useTabStore.getState().openTab(draft)
      const firstId = useTabStore.getState().activeTabId
      useTabStore.getState().openTab(draft)

      const tabs = useTabStore.getState().tabs.filter((tab) => tab.type === 'media-production')
      expect(tabs).toHaveLength(1)
      expect(useTabStore.getState().activeTabId).toBe(firstId)
    })

    it('settings Tab 保持单例，并更新目标设置分组', () => {
      useTabStore.getState().openTab({
        type: 'settings',
        title: '设置',
        icon: '⚙️',
        settingsSection: 'sync',
      })
      const firstSettingsId = useTabStore.getState().activeTabId

      useTabStore.getState().openTab({
        type: 'settings',
        title: '远程连接',
        icon: '⚙️',
        settingsSection: 'remote-connections',
      })

      const state = useTabStore.getState()
      const settingsTabs = state.tabs.filter((tab) => tab.type === 'settings')
      expect(settingsTabs).toHaveLength(1)
      expect(state.activeTabId).toBe(firstSettingsId)
      expect(settingsTabs[0].title).toBe('远程连接')
      expect(settingsTabs[0].settingsSection).toBe('remote-connections')
    })

    it('不同角色复用同一个全局配置 Tab，并只切换查看目标', () => {
      const firstDraft = {
        type: 'agent-role' as const,
        title: '角色配置',
        icon: '◇',
        agentRole: { roleId: 'fact-checker', version: 1 },
      }

      useTabStore.getState().openTab(firstDraft)
      const firstId = useTabStore.getState().activeTabId
      useTabStore.getState().openTab({
        type: 'agent-role',
        title: '角色配置',
        icon: '◇',
        agentRole: { roleId: 'public-governance', version: 1 },
        forceNew: true,
      })

      const roleTabs = useTabStore.getState().tabs.filter((tab) => tab.type === 'agent-role')
      expect(roleTabs).toHaveLength(1)
      expect(roleTabs[0].id).toBe(firstId)
      expect(roleTabs[0].title).toBe('角色配置')
      expect(roleTabs[0].agentRole).toEqual({ roleId: 'public-governance', version: 1 })
      expect(roleTabs[0].workspaceRef).toBeUndefined()
      expect(useTabStore.getState().activeTabId).toBe(firstId)
    })

    it('底层 openTab 不能覆盖带未保存草稿的角色配置目标', () => {
      useTabStore.getState().openTab({
        type: 'agent-role',
        title: '角色配置',
        icon: '◇',
        agentRole: { roleId: 'local-role', version: 1 },
      })
      const roleTabId = useTabStore.getState().activeTabId!
      useTabStore.getState().updateTabDirty(roleTabId, true)

      useTabStore.getState().openTab({
        type: 'agent-role',
        title: '角色配置',
        icon: '◇',
        agentRole: { roleId: 'public-governance', version: 1 },
      })

      expect(useTabStore.getState().tabs.find((tab) => tab.id === roleTabId)).toMatchObject({
        dirty: true,
        agentRole: { roleId: 'local-role', version: 1 },
      })
      expect(useTabStore.getState().activeTabId).toBe(roleTabId)
    })

    it('切换角色时收敛运行中遗留的重复配置 Tab', () => {
      useTabStore.setState({
        tabs: [
          { id: 'browser', type: 'browser', title: '浏览器', icon: '🌐' },
          {
            id: 'role-a',
            type: 'agent-role',
            title: '事实核查员',
            icon: '✓',
            agentRole: { roleId: 'fact-checker', version: 1 },
          },
          {
            id: 'role-b',
            type: 'agent-role',
            title: '反方挑战者',
            icon: '◇',
            agentRole: { roleId: 'critical-challenger', version: 1 },
          },
        ],
        activeTabId: 'role-b',
      })

      useTabStore.getState().openTab({
        type: 'agent-role',
        title: '角色配置',
        icon: '◇',
        agentRole: { roleId: 'product-owner', version: 1 },
      })

      const state = useTabStore.getState()
      const roleTabs = state.tabs.filter((tab) => tab.type === 'agent-role')
      expect(roleTabs).toHaveLength(1)
      expect(roleTabs[0]).toEqual(
        expect.objectContaining({
          id: 'role-b',
          title: '角色配置',
          agentRole: { roleId: 'product-owner', version: 1 },
        }),
      )
      expect(state.activeTabId).toBe('role-b')
    })

    it('forceNew 绕过 filePath 去重', () => {
      useTabStore.getState().openTab({ type: 'editor', title: 'A', icon: '📄', filePath: '/x.md' })
      const len1 = useTabStore.getState().tabs.length
      useTabStore
        .getState()
        .openTab({ type: 'editor', title: 'A', icon: '📄', filePath: '/x.md', forceNew: true })
      expect(useTabStore.getState().tabs.length).toBe(len1 + 1)
    })

    it('相同 filePath 可从文本 Tab 切换为 Gerber 预览 Tab', () => {
      useTabStore.getState().openTab({
        type: 'editor',
        title: 'board.GKO',
        icon: '📄',
        filePath: '/project/board.GKO',
      })
      const firstId = useTabStore.getState().activeTabId

      useTabStore.getState().openTab({
        type: 'hardware-gerber',
        title: 'board.GKO',
        icon: '🧩',
        filePath: '/project/board.GKO',
        hardwareGerber: {
          workspacePath: '/project',
          packagePath: '/project/board.GKO',
          entry: 'board.GKO',
        },
      })

      const state = useTabStore.getState()
      expect(state.tabs).toHaveLength(2)
      expect(state.activeTabId).toBe(firstId)
      const tab = state.tabs.find((item) => item.id === firstId)!
      expect(tab.type).toBe('hardware-gerber')
      expect(tab.hardwareGerber).toEqual({
        workspacePath: '/project',
        packagePath: '/project/board.GKO',
        entry: 'board.GKO',
      })
    })

    it('本地工作会话 Tab 按 local runtime 和会话 ID 去重', () => {
      const conversation = {
        surface: 'workbench-tab' as const,
        runtime: {
          location: 'local' as const,
          transport: 'local' as const,
          backend: 'cclink-studio-agent' as const,
        },
        sessionId: 'agent-work-1',
      }

      useTabStore.getState().openTab({
        type: 'conversation',
        title: '工作会话',
        icon: '🤖',
        conversation,
      })
      const firstId = useTabStore.getState().activeTabId
      useTabStore.getState().openTab({
        type: 'conversation',
        title: '工作会话',
        icon: '🤖',
        conversation,
      })

      expect(useTabStore.getState().tabs).toHaveLength(2)
      expect(useTabStore.getState().activeTabId).toBe(firstId)
    })

    it('数据源查询按 source、collection、Saved Query 区分去重', () => {
      useTabStore.getState().openTab({
        type: 'data-source-query',
        title: '查询 articles-*',
        icon: '🗄️',
        dataSourceQuery: { sourceId: 'source-1', collection: 'articles-*' },
      })
      const adHocId = useTabStore.getState().activeTabId

      useTabStore.getState().openTab({
        type: 'data-source-query',
        title: '查询 articles-*',
        icon: '🗄️',
        dataSourceQuery: { sourceId: 'source-1', collection: 'articles-*' },
      })
      useTabStore.getState().openTab({
        type: 'data-source-query',
        title: '最近文章',
        icon: '🗄️',
        dataSourceQuery: {
          sourceId: 'source-1',
          collection: 'articles-*',
          savedQueryId: 'saved-1',
        },
      })
      useTabStore.getState().openTab({
        type: 'data-source-query',
        title: '热门文章',
        icon: '🗄️',
        dataSourceQuery: {
          sourceId: 'source-1',
          collection: 'articles-*',
          savedQueryId: 'saved-2',
        },
      })

      const dataSourceTabs = useTabStore
        .getState()
        .tabs.filter((tab) => tab.type === 'data-source-query')
      expect(dataSourceTabs).toHaveLength(3)
      expect(dataSourceTabs[0].id).toBe(adHocId)
    })

    it('网站账号资源详情按 accountId 去重', () => {
      useTabStore.getState().openTab({
        type: 'web-resource',
        title: 'App Store Connect · Release',
        icon: '🌐',
        webResource: { accountId: 'account-1' },
      })
      const firstId = useTabStore.getState().activeTabId

      useTabStore.getState().openTab({
        type: 'web-resource',
        title: 'App Store Connect · Release',
        icon: '🌐',
        webResource: { accountId: 'account-1' },
      })
      useTabStore.getState().openTab({
        type: 'web-resource',
        title: '阿里云 · 备案账号',
        icon: '🌐',
        webResource: { accountId: 'account-2' },
      })

      const resourceTabs = useTabStore.getState().tabs.filter((tab) => tab.type === 'web-resource')
      expect(resourceTabs).toHaveLength(2)
      expect(resourceTabs[0].id).toBe(firstId)
      expect(resourceTabs[0].webResource).toEqual({ accountId: 'account-1' })
    })

    it('网站账号浏览器 Tab 在各工作空间按全局 accountId 聚焦复用', () => {
      const workspaceRef = { kind: 'local' as const, path: '/tmp/project-a' }
      useTabStore.getState().openTab({
        type: 'browser',
        title: 'App Store Connect · Example Ltd.',
        icon: '🌐',
        initialUrl: 'https://appstoreconnect.apple.com/apps',
        browserProfile: 'profile-a',
        webResourceRef: { accountId: 'account-1' },
        workspaceRef,
      })
      const firstId = useTabStore.getState().activeTabId

      useTabStore.getState().openTab({
        type: 'browser',
        title: 'Changed display title',
        icon: '🌐',
        initialUrl: 'https://appstoreconnect.apple.com/apps/changed',
        browserProfile: 'profile-a',
        webResourceRef: { accountId: 'account-1' },
        workspaceRef,
      })
      expect(useTabStore.getState().activeTabId).toBe(firstId)

      useTabStore.getState().openTab({
        type: 'browser',
        title: 'Same account id in another project',
        icon: '🌐',
        initialUrl: 'https://appstoreconnect.apple.com/apps',
        browserProfile: 'profile-b',
        webResourceRef: { accountId: 'account-1' },
        workspaceRef: { kind: 'local', path: '/tmp/project-b' },
      })

      const resourceBrowserTabs = useTabStore
        .getState()
        .tabs.filter((tab) => tab.type === 'browser' && tab.webResourceRef)
      expect(resourceBrowserTabs).toHaveLength(2)
    })

    it('网站账号草稿在原 Browser Tab 原地绑定正式资源', () => {
      useTabStore.getState().openTab({
        type: 'browser',
        title: '未保存的网站账号',
        icon: '🌐',
        browserProfile: 'web-draft-profile',
        webResourceDraftRef: { draftId: 'draft-1' },
        workspaceRef: { kind: 'local', path: '/tmp/project-a' },
        forceNew: true,
      })
      const tabId = useTabStore.getState().activeTabId!

      useTabStore.getState().bindWebResourceDraft(tabId, {
        title: 'App Store Connect',
        initialUrl: 'https://appstoreconnect.apple.com/apps',
        browserProfile: 'web-draft-profile',
        webResourceRef: { accountId: 'account-1' },
      })

      expect(useTabStore.getState().tabs.find((tab) => tab.id === tabId)).toMatchObject({
        title: 'App Store Connect',
        initialUrl: 'https://appstoreconnect.apple.com/apps',
        browserProfile: 'web-draft-profile',
        webResourceRef: { accountId: 'account-1' },
      })
      expect(
        useTabStore.getState().tabs.find((tab) => tab.id === tabId)?.webResourceDraftRef,
      ).toBeUndefined()
    })

    it('同一登录环境的来源页和 popup 一起转为正式账号', () => {
      useTabStore.setState({
        tabs: [
          {
            id: 'source',
            type: 'browser',
            title: '博客园',
            icon: '🌐',
            browserProfile: 'web-draft-cnblogs',
            webResourceDraftRef: { draftId: 'draft-cnblogs' },
          },
          {
            id: 'popup',
            type: 'browser',
            title: '博客园登录',
            icon: '🌐',
            browserProfile: 'web-draft-cnblogs',
            webResourceDraftRef: { draftId: 'draft-cnblogs' },
          },
        ],
        activeTabId: 'popup',
      })

      useTabStore.getState().bindWebResourceDraft('popup', {
        title: '博客园',
        initialUrl: 'https://www.cnblogs.com/',
        browserProfile: 'web-draft-cnblogs',
        webResourceRef: { accountId: 'account-cnblogs' },
      })

      expect(useTabStore.getState().tabs).toEqual([
        expect.objectContaining({
          id: 'source',
          webResourceRef: { accountId: 'account-cnblogs' },
          webResourceDraftRef: undefined,
        }),
        expect.objectContaining({
          id: 'popup',
          webResourceRef: { accountId: 'account-cnblogs' },
          webResourceDraftRef: undefined,
        }),
      ])
    })

    it('普通 Browser Tab 可以原地接入主进程创建的账号草稿', () => {
      useTabStore.getState().openTab({
        type: 'browser',
        title: '普通网页',
        icon: '🌐',
        browserProfile: 'ordinary-profile',
        workspaceRef: { kind: 'local', path: '/tmp/project-a' },
        forceNew: true,
      })
      const tabId = useTabStore.getState().activeTabId!

      expect(
        useTabStore.getState().attachWebResourceDraft(tabId, {
          draftId: 'draft-ordinary',
          browserProfile: 'ordinary-profile',
        }),
      ).toBe(true)
      expect(useTabStore.getState().tabs.find((tab) => tab.id === tabId)).toMatchObject({
        browserProfile: 'ordinary-profile',
        webResourceDraftRef: { draftId: 'draft-ordinary' },
      })
      expect(
        useTabStore.getState().attachWebResourceDraft(tabId, {
          draftId: 'draft-other',
          browserProfile: 'other-profile',
        }),
      ).toBe(false)
    })

    it('网页事务 Tab 按 affairId 去重', () => {
      useTabStore.getState().openTab({
        type: 'web-affair',
        title: 'App 上架',
        icon: '📋',
        webAffair: { affairId: 'affair-1' },
      })
      const firstId = useTabStore.getState().activeTabId
      useTabStore.getState().openTab({
        type: 'web-affair',
        title: 'App 上架',
        icon: '📋',
        webAffair: { affairId: 'affair-1' },
      })
      useTabStore.getState().openTab({
        type: 'web-affair',
        title: '工商年报',
        icon: '📋',
        webAffair: { affairId: 'affair-2' },
      })

      const affairTabs = useTabStore.getState().tabs.filter((tab) => tab.type === 'web-affair')
      expect(affairTabs).toHaveLength(2)
      expect(affairTabs[0].id).toBe(firstId)
      expect(affairTabs[0].webAffair).toEqual({ affairId: 'affair-1' })
    })

    it('同一工作空间只保留一个新事务草稿，并可原地绑定持久事务', () => {
      const workspaceRef = { kind: 'local' as const, path: '/tmp/project-a' }
      useTabStore.getState().openTab({
        type: 'web-affair',
        title: '新建事务',
        icon: '📋',
        workspaceRef,
        webAffair: { affairId: null, draftKey: 'draft-1' },
      })
      const draftTabId = useTabStore.getState().activeTabId!

      useTabStore.getState().openTab({
        type: 'web-affair',
        title: '新建事务',
        icon: '📋',
        workspaceRef,
        webAffair: { affairId: null, draftKey: 'draft-2' },
      })

      expect(useTabStore.getState().tabs.filter((tab) => tab.type === 'web-affair')).toHaveLength(1)
      expect(useTabStore.getState().activeTabId).toBe(draftTabId)

      useTabStore
        .getState()
        .updateTabWebAffair(draftTabId, { affairId: 'affair-created', draftKey: 'affair-created' })
      useTabStore.getState().updateTabTitle(draftTabId, 'Apple 版本审核')

      expect(useTabStore.getState().tabs.find((tab) => tab.id === draftTabId)).toEqual(
        expect.objectContaining({
          title: 'Apple 版本审核',
          webAffair: { affairId: 'affair-created', draftKey: 'affair-created' },
        }),
      )
    })
  })

  describe('closeTab', () => {
    it('关闭当前活跃 Tab → 切换到最后一个剩余 Tab', () => {
      useTabStore.getState().openTab({ type: 'editor', title: '文件', icon: '📄' })
      const editorId = useTabStore.getState().activeTabId

      useTabStore.getState().closeTab(editorId!)
      expect(useTabStore.getState().activeTabId).toBe('browser')
      expect(useTabStore.getState().tabs).toHaveLength(1)
    })

    it('关闭非活跃 Tab → 活跃 Tab 不变', () => {
      useTabStore.getState().openTab({ type: 'editor', title: '文件', icon: '📄' })
      useTabStore.getState().activateTab('browser')

      const editorTab = useTabStore.getState().tabs.find((t) => t.type === 'editor')!
      useTabStore.getState().closeTab(editorTab.id)

      expect(useTabStore.getState().activeTabId).toBe('browser')
      expect(useTabStore.getState().tabs).toHaveLength(1)
    })

    it('关闭最后一个 Tab → 进入空工作台', () => {
      useTabStore.getState().closeTab('browser')
      expect(useTabStore.getState().tabs).toHaveLength(0)
      expect(useTabStore.getState().activeTabId).toBeNull()
    })
  })

  describe('activateTab', () => {
    it('切换活跃 Tab', () => {
      useTabStore.getState().openTab({ type: 'settings', title: '设置', icon: '⚙️' })
      const settingsTab = useTabStore.getState().tabs.find((t) => t.type === 'settings')!

      useTabStore.getState().activateTab('browser')
      expect(useTabStore.getState().activeTabId).toBe('browser')

      useTabStore.getState().activateTab(settingsTab.id)
      expect(useTabStore.getState().activeTabId).toBe(settingsTab.id)
    })
  })

  describe('updateTabTitle', () => {
    it('更新 Tab 标题', () => {
      useTabStore.getState().openTab({ type: 'editor', title: 'untitled', icon: '📄' })
      const editorTab = useTabStore.getState().tabs.find((t) => t.type === 'editor')!

      useTabStore.getState().updateTabTitle(editorTab.id, '新标题')
      expect(useTabStore.getState().tabs.find((t) => t.id === editorTab.id)!.title).toBe('新标题')
    })
  })

  describe('updateTabFilePath', () => {
    it('Save-As 后回填文件路径', () => {
      useTabStore.getState().openTab({ type: 'editor', title: '未命名.md', icon: '📄' })
      const editorTab = useTabStore.getState().tabs.find((t) => t.type === 'editor')!

      useTabStore.getState().updateTabFilePath(editorTab.id, '/docs/saved.md')
      expect(useTabStore.getState().tabs.find((t) => t.id === editorTab.id)!.filePath).toBe(
        '/docs/saved.md',
      )
    })
  })

  describe('reorderTabs', () => {
    it('把末尾 Tab 移到开头', () => {
      useTabStore.getState().openTab({ type: 'editor', title: 'A', icon: '📄', forceNew: true })
      useTabStore.getState().openTab({ type: 'editor', title: 'B', icon: '📄', forceNew: true })
      const tabs = useTabStore.getState().tabs
      const lastId = tabs[tabs.length - 1].id
      const firstId = tabs[0].id

      useTabStore.getState().reorderTabs(lastId, firstId)
      expect(useTabStore.getState().tabs[0].id).toBe(lastId)
    })

    it('fromId === toId → 无变化', () => {
      useTabStore.getState().openTab({ type: 'editor', title: 'A', icon: '📄', forceNew: true })
      const before = useTabStore.getState().tabs.map((t) => t.id)
      const id = before[0]

      useTabStore.getState().reorderTabs(id, id)
      expect(useTabStore.getState().tabs.map((t) => t.id)).toEqual(before)
    })

    it('非法 id → 无变化', () => {
      const before = useTabStore.getState().tabs.map((t) => t.id)
      useTabStore.getState().reorderTabs('nope', 'browser')
      expect(useTabStore.getState().tabs.map((t) => t.id)).toEqual(before)
    })
  })

  describe('duplicateTab', () => {
    it('浏览器 → 克隆当前 URL 为新 Tab', () => {
      useBrowserStore.setState({
        tabs: {
          browser: browserTab({
            url: 'https://github.com',
            urlInput: 'https://github.com',
            history: ['https://github.com'],
          }),
        },
      })
      const before = useTabStore.getState().tabs.length

      useTabStore.getState().duplicateTab('browser')
      const tabs = useTabStore.getState().tabs
      expect(tabs).toHaveLength(before + 1)

      const clone = tabs[tabs.length - 1]
      expect(clone.type).toBe('browser')
      expect(clone.initialUrl).toBe('https://github.com')
    })

    it('编辑器 → 克隆当前内容为未命名副本', () => {
      useTabStore.getState().openTab({ type: 'editor', title: '笔记.md', icon: '📄' })
      const editorTab = useTabStore.getState().tabs.find((t) => t.type === 'editor')!
      useEditorStore.setState({
        files: {
          [`virtual:${editorTab.id}`]: {
            savedContent: '',
            currentContent: '# 标题',
            dirty: true,
            loading: false,
          },
        },
      })
      const before = useTabStore.getState().tabs.length

      useTabStore.getState().duplicateTab(editorTab.id)
      const tabs = useTabStore.getState().tabs
      expect(tabs).toHaveLength(before + 1)

      const clone = tabs[tabs.length - 1]
      expect(clone.title).toBe('副本: 笔记.md')
      expect(clone.initialContent).toBe('# 标题')
      expect(clone.filePath).toBeUndefined()
    })

    it('settings/preview/android → 无操作', () => {
      useTabStore.getState().openTab({ type: 'settings', title: '设置', icon: '⚙️' })
      const settingsTab = useTabStore.getState().tabs.find((t) => t.type === 'settings')!
      const before = useTabStore.getState().tabs.length

      useTabStore.getState().duplicateTab(settingsTab.id)
      expect(useTabStore.getState().tabs.length).toBe(before)
    })
  })

  describe('hydrateFromWorkspaceState', () => {
    it('从工作台快照恢复 Tab 顺序和活跃 Tab', () => {
      useTabStore.getState().hydrateFromWorkspaceState({
        tabs: [
          { id: 'browser', type: 'browser', title: '浏览器', icon: '🌐' },
          { id: 'doc-1', type: 'editor', title: '计划.md', icon: '📄', filePath: '/docs/plan.md' },
          {
            id: 'conversation-1',
            type: 'conversation',
            title: '工作会话',
            icon: '🤖',
            conversation: {
              surface: 'workbench-tab',
              runtime: {
                location: 'local',
                transport: 'local',
                backend: 'cclink-studio-agent',
              },
              sessionId: 'session-1',
            },
          },
        ],
        activeTabId: 'doc-1',
      })

      const state = useTabStore.getState()
      expect(state.tabs.map((tab) => tab.id)).toEqual(['browser', 'doc-1', 'conversation-1'])
      expect(state.activeTabId).toBe('doc-1')
      expect(state.tabs[1].filePath).toBe('/docs/plan.md')
      expect(state.tabs[2].conversation).toEqual({
        surface: 'workbench-tab',
        runtime: {
          location: 'local',
          transport: 'local',
          backend: 'cclink-studio-agent',
        },
        sessionId: 'session-1',
      })
    })

    it('Terminal Tab 快照保留权限、审计和关闭语义', () => {
      useTabStore.getState().hydrateFromWorkspaceState({
        tabs: [
          {
            id: 'terminal-1',
            type: 'terminal',
            title: 'Terminal',
            icon: '⌨️',
            terminal: {
              runtime: {
                location: 'local',
                transport: 'local',
                backend: 'local-shell',
                workspaceRef: {
                  path: '/workspace',
                  kind: 'local',
                },
                cwd: '/workspace',
              },
              permissionPolicy: {
                mode: 'ask-risky-command',
                requireConfirmationFor: ['write', 'destructive', 'privileged'],
              },
              status: 'idle',
              closePolicy: 'terminate-process',
              auditLogId: 'audit-1',
            },
          },
        ],
        activeTabId: 'terminal-1',
      })

      const terminal = useTabStore.getState().tabs[0].terminal
      expect(useTabStore.getState().activeTabId).toBe('terminal-1')
      expect(terminal?.runtime.location).toBe('local')
      expect(terminal?.permissionPolicy.mode).toBe('ask-risky-command')
      expect(terminal?.closePolicy).toBe('terminate-process')
    })

    it('快照 activeTabId 无效时回退到第一个 Tab', () => {
      useTabStore.getState().hydrateFromWorkspaceState({
        tabs: [
          { id: 'browser', type: 'browser', title: '浏览器', icon: '🌐' },
          { id: 'doc-1', type: 'editor', title: '计划.md', icon: '📄' },
        ],
        activeTabId: 'missing',
      })

      expect(useTabStore.getState().activeTabId).toBe('browser')
    })

    it('空 Tab 快照恢复为空工作台，用于中间 Codex 会话模式', () => {
      useTabStore.getState().hydrateFromWorkspaceState({
        tabs: [],
        activeTabId: null,
      })

      expect(useTabStore.getState().tabs).toEqual([])
      expect(useTabStore.getState().activeTabId).toBeNull()
    })
  })
})
