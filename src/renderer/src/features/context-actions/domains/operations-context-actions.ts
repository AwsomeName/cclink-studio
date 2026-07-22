import { useToastStore } from '../../../components/common/Toast'
import type { Command } from '../../../stores/command-store'
import type { CommandContext } from '../context-target'
import { getOperationsContextSurface } from '../operations-context-surface'
import type { MenuContribution } from '../menu-contribution-registry'

function operationsTarget(context?: CommandContext) {
  return context?.target?.kind === 'operations-platform' ? context.target : null
}

function resolveOperations(context?: CommandContext) {
  const target = operationsTarget(context)
  const surface = target ? getOperationsContextSurface(target.workspaceKey) : null
  if (!target || !surface || !surface.hasPlatform(target.platformId)) return null
  return { target, surface }
}

async function copyText(value: string, label: string): Promise<void> {
  await navigator.clipboard.writeText(value)
  useToastStore.getState().show(`${label}已复制`, 'success')
}

export function createOperationsContextCommands(): Command[] {
  return [
    {
      id: 'operations.preparePlatformSession',
      label: '准备运营会话',
      category: '运营',
      contextOnly: true,
      risk: 'local-write',
      enabled: (context) => ({
        enabled: Boolean(resolveOperations(context)),
        reason: '运营平台已失效',
      }),
      action: (context) => {
        const resolved = resolveOperations(context)
        if (!resolved) throw new Error('运营平台已失效')
        resolved.surface.preparePlatformSession(resolved.target.platformId)
      },
    },
    {
      id: 'operations.openConfig',
      label: '打开运营配置',
      category: '运营',
      contextOnly: true,
      enabled: (context) => ({
        enabled: Boolean(resolveOperations(context)),
        reason: '运营配置不可用',
      }),
      action: async (context) => {
        const resolved = resolveOperations(context)
        if (!resolved) throw new Error('运营配置不可用')
        await resolved.surface.openConfig()
      },
    },
    {
      id: 'operations.copyStatus',
      label: '复制登录状态',
      category: '运营',
      contextOnly: true,
      risk: 'read',
      enabled: (context) => {
        const resolved = resolveOperations(context)
        return {
          enabled: Boolean(resolved?.surface.getPlatformStatus(resolved.target.platformId)),
          reason: '平台状态尚未加载',
        }
      },
      action: (context) => {
        const resolved = resolveOperations(context)
        const status = resolved?.surface.getPlatformStatus(resolved.target.platformId)
        if (!resolved || !status) throw new Error('平台状态尚未加载')
        return copyText(`${resolved.target.platformName}：${status}`, '平台状态')
      },
    },
  ]
}

export const operationsMenuContributions: MenuContribution[] = [
  {
    id: 'operations.prepare-session',
    targetKinds: ['operations-platform'],
    group: '10.primary',
    order: 10,
    commandId: 'operations.preparePlatformSession',
  },
  {
    id: 'operations.open-config',
    targetKinds: ['operations-platform'],
    group: '20.config',
    order: 10,
    commandId: 'operations.openConfig',
  },
  {
    id: 'operations.copy-status',
    targetKinds: ['operations-platform'],
    group: '30.diagnostics',
    order: 10,
    commandId: 'operations.copyStatus',
  },
]
