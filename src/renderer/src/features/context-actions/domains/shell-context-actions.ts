import { workspaceRefLabel } from '@shared/workspace-ref'
import { APP_EDITION_LABEL } from '../../../app-metadata'
import { useToastStore } from '../../../components/common/Toast'
import { useAgentStore } from '../../../stores/agent-store'
import { useBrowserStore } from '../../../stores/browser-store'
import type { Command } from '../../../stores/command-store'
import { useFsStore } from '../../../stores/fs-store'
import { useGitBackupStore } from '../../../stores/git-backup-store'
import { useTabStore } from '../../../stores/tab-store'
import { useUIStore } from '../../../stores/ui-store'
import { useUpdateStore } from '../../../stores/update-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import type { ActivityPanel } from '../../../types'
import { recordTerminalLifecycleEvent } from '../../../utils/terminal-lifecycle'
import { buildTerminalTabDraft } from '../../../utils/terminal-tab'
import type { CommandContext, ContextTarget } from '../context-target'
import type { MenuContribution } from '../menu-contribution-registry'

type ActivityTarget = Extract<ContextTarget, { kind: 'activity' }>
type SidebarTarget = Extract<ContextTarget, { kind: 'sidebar' }>
type StatusTarget = Extract<ContextTarget, { kind: 'status-item' }>
type LayoutTarget = Extract<ContextTarget, { kind: 'layout' }>

const ACTIVITY_LABELS: Record<string, string> = {
  sessions: '会话',
  files: '文件',
  browser: '浏览器',
  'data-sources': '数据源',
  terminal: 'Terminal',
  operations: '运营',
  production: '生产',
  settings: '设置',
}

function activityTarget(context?: CommandContext): ActivityTarget | null {
  return context?.target?.kind === 'activity' ? context.target : null
}

function sidebarTarget(context?: CommandContext): SidebarTarget | null {
  return context?.target?.kind === 'sidebar' ? context.target : null
}

function statusTarget(context?: CommandContext): StatusTarget | null {
  return context?.target?.kind === 'status-item' ? context.target : null
}

function layoutTarget(context?: CommandContext): LayoutTarget | null {
  return context?.target?.kind === 'layout' ? context.target : null
}

function activityPanel(id: string): ActivityPanel | null {
  return id in ACTIVITY_LABELS && id !== 'settings' ? (id as ActivityPanel) : null
}

async function copyText(value: string, label: string): Promise<void> {
  await navigator.clipboard.writeText(value)
  useToastStore.getState().show(`${label}已复制`, 'success')
}

function getStatusValue(itemId: string): { value: string; label: string } | null {
  if (itemId === 'agent') {
    return { value: useAgentStore.getState().backendState, label: 'Agent 状态' }
  }
  if (itemId === 'workspace-switch') {
    const path = useFsStore.getState().switchingPath
    return path ? { value: `正在切换到 ${path}`, label: '项目切换状态' } : null
  }
  if (itemId === 'active-tab') {
    const tab = useTabStore.getState().getActiveTab()
    return tab ? { value: `${tab.title} (${tab.type})`, label: 'Tab 状态' } : null
  }
  if (itemId === 'workspace') {
    const ref = useWorkspaceStore.getState().activeWorkspaceRef
    const path = useFsStore.getState().workspacePath
    return { value: path ?? workspaceRefLabel(ref), label: '工作区信息' }
  }
  if (itemId === 'browser-url') {
    const tab = useTabStore.getState().getActiveTab()
    const url = tab ? useBrowserStore.getState().tabs[tab.id]?.url : null
    return url ? { value: url, label: '浏览器 URL' } : null
  }
  if (itemId === 'git-backup') {
    const state = useGitBackupStore.getState()
    const value = state.error
      ? `失败: ${state.error}`
      : state.projectStatus?.lastBackupAt
        ? `已备份: ${state.projectStatus.lastBackupAt}`
        : '尚未备份'
    return { value, label: 'Git 备份状态' }
  }
  if (itemId === 'update') {
    const state = useUpdateStore.getState()
    const release = state.snapshot.availableRelease
    return {
      value: release
        ? `可更新到 ${release.version}`
        : state.snapshot.phase === 'failed'
          ? `失败: ${state.snapshot.error?.userMessage ?? '未知错误'}`
          : state.snapshot.phase === 'readyToInstall'
            ? '更新已下载并校验'
            : '未发现待下载更新',
      label: '更新状态',
    }
  }
  if (itemId === 'edition') return { value: APP_EDITION_LABEL, label: '版本信息' }
  return null
}

function createForSidebar(panelId: string): void {
  const workspaceRef = useWorkspaceStore.getState().activeWorkspaceRef
  if (panelId === 'files') {
    const workspacePath = useFsStore.getState().workspacePath
    if (!workspacePath) throw new Error('当前没有本地工作区')
    useFsStore.getState().startEditing('new-file', workspacePath)
    return
  }
  if (panelId === 'browser') {
    useTabStore.getState().openTab({ type: 'browser', title: '浏览器', icon: '🌐', forceNew: true })
    return
  }
  if (panelId === 'terminal') {
    const draft = buildTerminalTabDraft(workspaceRef)
    useTabStore.getState().openTab(draft)
    void recordTerminalLifecycleEvent(draft.terminal, 'created', 'Terminal Tab 已创建')
    return
  }
  throw new Error('当前侧栏没有可创建对象')
}

export function createShellContextCommands(): Command[] {
  return [
    {
      id: 'activity.open',
      label: '打开面板',
      contextOnly: true,
      category: '工作台',
      contextLabel: (context) => {
        const id = activityTarget(context)?.activityId
        return `打开${id ? (ACTIVITY_LABELS[id] ?? id) : ''}`
      },
      checked: (context) => {
        const panel = activityPanel(activityTarget(context)?.activityId ?? '')
        const ui = useUIStore.getState()
        return Boolean(panel && panel === ui.activePanel && ui.sidebarVisible)
      },
      action: (context) => {
        const id = activityTarget(context)?.activityId
        if (!id) throw new Error('活动入口已失效')
        if (id === 'settings') {
          useTabStore.getState().openTab({ type: 'settings', title: '设置', icon: '⚙️' })
          useUIStore.getState().hideSidebar()
          return
        }
        const panel = activityPanel(id)
        if (!panel) throw new Error('活动入口不可用')
        const ui = useUIStore.getState()
        if (ui.activePanel !== panel || !ui.sidebarVisible) ui.setActivePanel(panel)
      },
    },
    {
      id: 'activity.toggleSidebar',
      label: '显示或隐藏侧栏',
      contextOnly: true,
      category: '布局',
      visible: (context) => activityTarget(context)?.activityId !== 'settings',
      checked: () => useUIStore.getState().sidebarVisible,
      action: () => useUIStore.getState().toggleSidebar(),
    },
    {
      id: 'sidebar.createCurrent',
      label: '新建',
      contextOnly: true,
      category: '侧栏',
      contextLabel: (context) => {
        const panel = sidebarTarget(context)?.panelId
        if (panel === 'files') return '新建文件'
        if (panel === 'browser') return '新建浏览器页'
        if (panel === 'terminal') return '新建 Terminal'
        return '新建'
      },
      visible: (context) =>
        ['files', 'browser', 'terminal'].includes(sidebarTarget(context)?.panelId ?? ''),
      action: (context) => createForSidebar(sidebarTarget(context)?.panelId ?? ''),
    },
    {
      id: 'sidebar.refresh',
      label: '刷新文件树',
      contextOnly: true,
      category: '侧栏',
      visible: (context) => sidebarTarget(context)?.panelId === 'files',
      enabled: () => ({
        enabled: Boolean(useFsStore.getState().workspacePath),
        reason: '当前没有本地工作区',
      }),
      action: async () => {
        const path = useFsStore.getState().workspacePath
        if (!path) throw new Error('当前没有本地工作区')
        await useFsStore.getState().refreshDir(path)
      },
    },
    {
      id: 'sidebar.hide',
      label: '隐藏侧栏',
      contextOnly: true,
      category: '布局',
      action: () => useUIStore.getState().hideSidebar(),
    },
    {
      id: 'sidebar.resetWidth',
      label: '重置侧栏宽度',
      contextOnly: true,
      category: '布局',
      action: () => useUIStore.getState().setSidebarWidth(250),
    },
    {
      id: 'status.copyValue',
      label: '复制状态',
      contextOnly: true,
      category: '状态栏',
      enabled: (context) => ({
        enabled: Boolean(getStatusValue(statusTarget(context)?.itemId ?? '')),
        reason: '当前状态已失效',
      }),
      contextLabel: (context) => {
        const status = getStatusValue(statusTarget(context)?.itemId ?? '')
        return status ? `复制${status.label}` : '复制状态'
      },
      action: (context) => {
        const status = getStatusValue(statusTarget(context)?.itemId ?? '')
        if (!status) throw new Error('当前状态已失效')
        return copyText(status.value, status.label)
      },
    },
    {
      id: 'layout.hideRegion',
      label: '隐藏区域',
      contextOnly: true,
      category: '布局',
      contextLabel: (context) =>
        layoutTarget(context)?.area === 'agent' ? '隐藏 Agent 面板' : '隐藏侧栏',
      action: (context) => {
        const area = layoutTarget(context)?.area
        if (area === 'sidebar') useUIStore.getState().hideSidebar()
        else if (area === 'agent') useUIStore.getState().setAgentPanelMode('hidden', 'user')
        else throw new Error('布局目标已失效')
      },
    },
    {
      id: 'layout.resetSize',
      label: '重置区域宽度',
      contextOnly: true,
      category: '布局',
      contextLabel: (context) =>
        layoutTarget(context)?.area === 'agent' ? '重置 Agent 面板宽度' : '重置侧栏宽度',
      action: (context) => {
        const area = layoutTarget(context)?.area
        if (area === 'sidebar') useUIStore.getState().setSidebarWidth(250)
        else if (area === 'agent') useUIStore.getState().setAgentPanelWidth(350)
        else throw new Error('布局目标已失效')
      },
    },
  ]
}

export const shellMenuContributions: MenuContribution[] = [
  {
    id: 'activity.open',
    targetKinds: ['activity'],
    group: '10-open',
    order: 10,
    commandId: 'activity.open',
    icon: '↗',
  },
  {
    id: 'activity.sidebar',
    targetKinds: ['activity'],
    group: '80-layout',
    order: 10,
    commandId: 'activity.toggleSidebar',
    icon: '▤',
  },
  {
    id: 'sidebar.create',
    targetKinds: ['sidebar'],
    group: '10-create',
    order: 10,
    commandId: 'sidebar.createCurrent',
    icon: '+',
  },
  {
    id: 'sidebar.refresh',
    targetKinds: ['sidebar'],
    group: '20-refresh',
    order: 10,
    commandId: 'sidebar.refresh',
    icon: '↻',
  },
  {
    id: 'sidebar.reset-width',
    targetKinds: ['sidebar'],
    group: '80-layout',
    order: 10,
    commandId: 'sidebar.resetWidth',
    icon: '↔',
  },
  {
    id: 'sidebar.hide',
    targetKinds: ['sidebar'],
    group: '80-layout',
    order: 20,
    commandId: 'sidebar.hide',
    icon: '−',
  },
  {
    id: 'status.copy',
    targetKinds: ['status-item'],
    group: '40-copy',
    order: 10,
    commandId: 'status.copyValue',
    icon: '📋',
  },
  {
    id: 'status.diagnostics',
    targetKinds: ['status-item'],
    group: '80-diagnostics',
    order: 10,
    commandId: 'diagnostics.copyWorkspaceState',
    icon: 'ⓘ',
    when: (context) =>
      ['agent', 'workspace', 'workspace-switch'].includes(statusTarget(context)?.itemId ?? ''),
  },
  {
    id: 'layout.reset-size',
    targetKinds: ['layout'],
    group: '80-layout',
    order: 10,
    commandId: 'layout.resetSize',
    icon: '↔',
  },
  {
    id: 'layout.hide',
    targetKinds: ['layout'],
    group: '80-layout',
    order: 20,
    commandId: 'layout.hideRegion',
    icon: '−',
  },
]
