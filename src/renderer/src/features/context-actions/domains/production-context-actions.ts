import { useToastStore } from '../../../components/common/Toast'
import type { Command } from '../../../stores/command-store'
import { useEditorStore } from '../../../stores/editor-store'
import { useFsStore } from '../../../stores/fs-store'
import { useHardwareStore } from '../../../stores/hardware-store'
import type { CommandContext } from '../context-target'
import type { MenuContribution } from '../menu-contribution-registry'

function productionTarget(context?: CommandContext) {
  return context?.target?.kind === 'production' ? context.target : null
}

function resolveProduction(context?: CommandContext) {
  const target = productionTarget(context)
  if (!target || useFsStore.getState().workspacePath !== target.workspacePath) return null
  return target
}

function hasSignals(workspacePath: string): boolean {
  const summary = useHardwareStore.getState().summary
  return Boolean(summary?.workspacePath === workspacePath && summary.hasHardwareSignals)
}

function isBusy(): boolean {
  const state = useHardwareStore.getState()
  return state.loading || state.inspecting || state.savingReport
}

function productionStatus(workspacePath: string): string {
  const state = useHardwareStore.getState()
  if (state.error) return `失败：${state.error}`
  const summary = state.summary
  if (!summary || summary.workspacePath !== workspacePath) return '尚未扫描'
  return [
    `Gerber ${summary.counts['gerber-package']}`,
    `BOM ${summary.counts.bom}`,
    `坐标 ${summary.counts.centroid}`,
    `风险 ${state.report?.risks.length ?? summary.risks.length}`,
    state.report ? `结论 ${state.report.conclusion}` : '尚未检查',
  ].join(' · ')
}

export function createProductionContextCommands(): Command[] {
  return [
    {
      id: 'production.scan',
      label: '扫描生产文件',
      category: '生产',
      contextOnly: true,
      risk: 'read',
      enabled: (context) => ({
        enabled: Boolean(resolveProduction(context) && !isBusy()),
        reason: '生产扫描正在运行',
      }),
      action: async (context) => {
        const target = resolveProduction(context)
        if (!target) throw new Error('生产目标已失效')
        await useHardwareStore.getState().scanWorkspace(target.workspacePath)
      },
    },
    {
      id: 'production.inspect',
      label: '检查生产包',
      category: '生产',
      contextOnly: true,
      risk: 'read',
      enabled: (context) => {
        const target = resolveProduction(context)
        return {
          enabled: Boolean(target && !isBusy() && hasSignals(target.workspacePath)),
          reason:
            target && !hasSignals(target.workspacePath) ? '未发现生产文件' : '生产检查正在运行',
        }
      },
      action: async (context) => {
        const target = resolveProduction(context)
        if (!target || !hasSignals(target.workspacePath)) throw new Error('未发现生产文件')
        await useHardwareStore.getState().inspectProductionPackage(target.workspacePath)
      },
    },
    {
      id: 'production.writeReport',
      label: '生成本地检查报告',
      category: '生产',
      contextOnly: true,
      risk: 'local-write',
      enabled: (context) => {
        const target = resolveProduction(context)
        return {
          enabled: Boolean(target && !isBusy() && hasSignals(target.workspacePath)),
          reason:
            target && !hasSignals(target.workspacePath) ? '未发现生产文件' : '生产检查正在运行',
        }
      },
      action: async (context) => {
        const target = resolveProduction(context)
        if (!target || !hasSignals(target.workspacePath)) throw new Error('未发现生产文件')
        const result = await useHardwareStore
          .getState()
          .writeProductionReportMarkdown(target.workspacePath)
        if (!result) throw new Error('检查报告生成失败')
        await useFsStore
          .getState()
          .refreshDir(target.workspacePath)
          .catch(() => undefined)
        await useEditorStore.getState().openFile(result.filePath)
      },
    },
    {
      id: 'production.copyStatus',
      label: '复制生产状态',
      category: '生产',
      contextOnly: true,
      risk: 'read',
      action: async (context) => {
        const target = resolveProduction(context)
        if (!target) throw new Error('生产目标已失效')
        await navigator.clipboard.writeText(productionStatus(target.workspacePath))
        useToastStore.getState().show('生产状态已复制', 'success')
      },
    },
  ]
}

export const productionMenuContributions: MenuContribution[] = [
  {
    id: 'production.scan',
    targetKinds: ['production'],
    group: '10.inspect',
    order: 10,
    commandId: 'production.scan',
  },
  {
    id: 'production.inspect',
    targetKinds: ['production'],
    group: '10.inspect',
    order: 20,
    commandId: 'production.inspect',
  },
  {
    id: 'production.report',
    targetKinds: ['production'],
    group: '20.prepare',
    order: 10,
    commandId: 'production.writeReport',
  },
  {
    id: 'production.copy-status',
    targetKinds: ['production'],
    group: '30.diagnostics',
    order: 10,
    commandId: 'production.copyStatus',
  },
]
