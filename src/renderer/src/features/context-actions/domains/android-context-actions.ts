import { useToastStore } from '../../../components/common/Toast'
import type { Command } from '../../../stores/command-store'
import { useTabStore } from '../../../stores/tab-store'
import type { CommandContext } from '../context-target'
import { getAndroidContextSurface } from '../android-context-surface'
import type { MenuContribution } from '../menu-contribution-registry'

function androidTarget(context?: CommandContext) {
  return context?.target?.kind === 'android' ? context.target : null
}

function resolveAndroid(context?: CommandContext) {
  const target = androidTarget(context)
  const tab = target ? useTabStore.getState().tabs.find((item) => item.id === target.tabId) : null
  const surface = target ? getAndroidContextSurface(target.tabId) : null
  if (!target || !tab || tab.type !== 'android' || !surface) return null
  return { target, surface }
}

export function createAndroidContextCommands(): Command[] {
  return [
    {
      id: 'android.connectDisplay',
      label: '连接设备画面',
      category: 'Android',
      contextOnly: true,
      enabled: (context) => {
        const target = androidTarget(context)
        const resolved = resolveAndroid(context)
        return {
          enabled: Boolean(resolved && target?.available && !target.connected),
          reason: target?.connected
            ? '设备画面已连接'
            : target?.unavailableReason || 'Android 能力不可用',
        }
      },
      action: async (context) => {
        const resolved = resolveAndroid(context)
        if (!resolved?.target.available)
          throw new Error(resolved?.target.unavailableReason || 'Android 能力不可用')
        await resolved.surface.connect()
      },
    },
    {
      id: 'android.disconnectDisplay',
      label: '断开设备画面',
      category: 'Android',
      contextOnly: true,
      enabled: (context) => ({
        enabled: Boolean(resolveAndroid(context)?.target.connected),
        reason: '设备画面未连接',
      }),
      action: async (context) => {
        const resolved = resolveAndroid(context)
        if (!resolved?.target.connected) throw new Error('设备画面未连接')
        await resolved.surface.disconnect()
      },
    },
    {
      id: 'android.copyStatus',
      label: '复制设备状态',
      category: 'Android',
      contextOnly: true,
      risk: 'read',
      action: async (context) => {
        const target = androidTarget(context)
        if (!target) throw new Error('Android 目标已失效')
        const status = target.connected
          ? 'Android 真机画面已连接'
          : target.available
            ? 'Android 真机已连接，画面未连接'
            : target.unavailableReason || 'Android 能力不可用'
        await navigator.clipboard.writeText(status)
        useToastStore.getState().show('设备状态已复制', 'success')
      },
    },
    {
      id: 'android.openCapabilitySettings',
      label: '打开设备能力设置',
      category: 'Android',
      contextOnly: true,
      action: () =>
        useTabStore.getState().openTab({
          type: 'settings',
          title: 'Agent 能力',
          icon: '⚙️',
          settingsSection: 'agent-capabilities',
        }),
    },
  ]
}

export const androidMenuContributions: MenuContribution[] = [
  {
    id: 'android.connect',
    targetKinds: ['android'],
    group: '10.connection',
    order: 10,
    commandId: 'android.connectDisplay',
  },
  {
    id: 'android.disconnect',
    targetKinds: ['android'],
    group: '10.connection',
    order: 20,
    commandId: 'android.disconnectDisplay',
  },
  {
    id: 'android.copy-status',
    targetKinds: ['android'],
    group: '20.diagnostics',
    order: 10,
    commandId: 'android.copyStatus',
  },
  {
    id: 'android.open-settings',
    targetKinds: ['android'],
    group: '20.diagnostics',
    order: 20,
    commandId: 'android.openCapabilitySettings',
  },
]
