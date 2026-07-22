import { DEFAULT_SETTINGS } from '@shared/ipc/settings'
import { useToastStore } from '../../../components/common/Toast'
import type { Command } from '../../../stores/command-store'
import { useSettingsStore } from '../../../stores/settings-store'
import type { CommandContext } from '../context-target'
import type { MenuContribution } from '../menu-contribution-registry'

function settingTarget(context?: CommandContext) {
  return context?.target?.kind === 'setting' ? context.target : null
}

function isSettingKey(key: string): key is keyof typeof DEFAULT_SETTINGS {
  return Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key)
}

export function createSettingsContextCommands(): Command[] {
  return [
    {
      id: 'settings.resetCurrent',
      label: '恢复默认值',
      category: '设置',
      contextOnly: true,
      risk: 'local-write',
      enabled: (context) => {
        const target = settingTarget(context)
        return {
          enabled: Boolean(target?.modified && isSettingKey(target.settingKey)),
          reason: target?.modified ? '设置项已失效' : '当前已是默认值',
        }
      },
      action: async (context) => {
        const target = settingTarget(context)
        if (!target || !isSettingKey(target.settingKey)) throw new Error('设置项已失效')
        const success = await useSettingsStore.getState().resetSetting(target.settingKey)
        if (!success) throw new Error(useSettingsStore.getState().error || '恢复默认值失败')
      },
    },
    {
      id: 'settings.copyKey',
      label: '复制设置键',
      category: '设置',
      contextOnly: true,
      risk: 'read',
      enabled: (context) => ({
        enabled: Boolean(
          settingTarget(context) && isSettingKey(settingTarget(context)!.settingKey),
        ),
        reason: '设置项已失效',
      }),
      action: async (context) => {
        const target = settingTarget(context)
        if (!target || !isSettingKey(target.settingKey)) throw new Error('设置项已失效')
        await navigator.clipboard.writeText(target.settingKey)
        useToastStore.getState().show('设置键已复制', 'success')
      },
    },
  ]
}

export const settingsMenuContributions: MenuContribution[] = [
  {
    id: 'settings.reset-current',
    targetKinds: ['setting'],
    group: '10.edit',
    order: 10,
    commandId: 'settings.resetCurrent',
  },
  {
    id: 'settings.copy-key',
    targetKinds: ['setting'],
    group: '20.copy',
    order: 10,
    commandId: 'settings.copyKey',
  },
]
