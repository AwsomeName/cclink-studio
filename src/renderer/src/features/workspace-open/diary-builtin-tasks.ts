import type {
  ScheduledTaskDefinition,
  ScheduledTaskSnapshot,
} from '@shared/scheduled-task/scheduled-task-types'

/** Built-in tasks use ordinary shared definitions. */
export function isDailyDraftTask(definition: ScheduledTaskDefinition): boolean {
  return (
    definition.schedule.kind === 'daily' &&
    ['{monthDay}_{weekday}.md', '{monthDay}-{weekday}.md'].includes(
      definition.outputPolicy.fileNameTemplate,
    ) &&
    /\{year\}\/\{month\}$/.test(definition.outputPolicy.directory)
  )
}

export function isWeeklyReviewTask(definition: ScheduledTaskDefinition): boolean {
  return (
    definition.schedule.kind === 'weekly' &&
    (/周计划$/.test(definition.outputPolicy.directory) ||
      definition.outputPolicy.directory === planOutputs.weekly[1])
  )
}

/** Prefer a device-enabled definition so the home page reflects what will actually run. */
export function findDailyDraft(tasks: ScheduledTaskSnapshot[]): ScheduledTaskSnapshot | undefined {
  const daily = tasks.filter((task) => isDailyDraftTask(task.definition))
  return daily.find((task) => task.activation.enabled) ?? daily[0]
}

export const dailyDraftInstruction = (directory: string): string =>
  `读取 ${directory} 中昨天的日记、本周计划和「模板/日记模板.md」（如有），为今天起草日记。` +
  '顶部一级标题为“YYYY-MM-DD 周X”，然后依次写四个二级章节：「昨日总结」「今日待做」「强调事项」「今日打卡」。' +
  '昨日总结只依据昨天日记；今日待做用 - [ ] 任务清单，结合本周计划和昨天未完成事项；' +
  '今日打卡用表格，列为 时间 | 事项 | 详细记录，暂无内容时只保留表头。未知事实写“待核实”，不要编造。'

export interface BuiltInTaskChoice {
  daily: { enable: boolean; time: string }
  weekly: { enable: boolean; time: string; weekday: number }
}

export const defaultBuiltInChoice: BuiltInTaskChoice = {
  daily: { enable: true, time: '01:00' },
  weekly: { enable: true, time: '21:00', weekday: 0 },
}

/**
 * Creates missing built-in tasks as shared definitions and applies the device choice. Existing
 * definitions (e.g. brought by Git) are reused, never duplicated or rewritten.
 */
export async function ensureBuiltInDiaryTasks(
  workspacePath: string,
  directory: string,
  timezone: string,
  choice: BuiltInTaskChoice,
): Promise<void> {
  const api = window.cclinkStudio.scheduledTasks
  const listed = await api.list(workspacePath)
  if (!listed.success) throw Error(listed.error?.message || '任务读取失败')
  const resources = [
    { kind: 'workspace' as const },
    { kind: 'directory' as const, path: directory },
  ]
  const daily = findDailyDraft(listed.tasks)
  const apply = async (
    existing: ScheduledTaskSnapshot | undefined,
    create: () => Promise<{ success: boolean; error?: { message: string } }>,
    enable: boolean,
  ): Promise<void> => {
    if (!existing) {
      const created = await create()
      if (!created.success) throw Error(created.error?.message || '内置任务创建失败')
      return
    }
    if (enable && !existing.activation.enabled) {
      const enabled = await api.setEnabled({
        workspacePath,
        taskId: existing.definition.id,
        enabled: true,
      })
      if (!enabled.success) throw Error(enabled.error?.message || '任务启用失败')
    }
  }
  await apply(
    daily,
    () =>
      api.save({
        workspacePath,
        title: '每日起草',
        instruction: dailyDraftInstruction(directory),
        schedule: { kind: 'daily', time: choice.daily.time, timezone },
        resources,
        outputPolicy: {
          directory: `${directory}/{year}/{month}`,
          fileNameTemplate: '{monthDay}_{weekday}.md',
          mode: 'create-only',
        },
        definitionSource: 'shared',
        enable: choice.daily.enable,
      }),
    choice.daily.enable,
  )
  for (const kind of ['weekly', 'monthly', 'yearly'] as const) {
    await ensurePlanTask(workspacePath, directory, timezone, kind, choice.weekly)
  }
}

export type PlanTaskKind = 'weekly' | 'monthly' | 'yearly'
export const planOutputs = {
  weekly: ['周度计划', '{planRoot}/周/{nextWeekYear}', '{nextWeekYear}-W{nextWeek}.md'],
  monthly: ['月度计划', '{planRoot}/月/{nextMonthYear}', '{nextMonth}.md'],
  yearly: ['年度计划', '{planRoot}/年', '{nextYear}.md'],
} as const

export async function ensurePlanTask(
  workspacePath: string,
  directory: string,
  timezone: string,
  kind: PlanTaskKind,
  weekly = defaultBuiltInChoice.weekly,
): Promise<void> {
  const api = window.cclinkStudio.scheduledTasks
  const listed = await api.list(workspacePath)
  if (!listed.success) throw Error(listed.error?.message || '读取计划任务失败')
  const [title, output, fileNameTemplate] = planOutputs[kind]
  const existing = listed.tasks.find(
    (task) =>
      task.definition.outputPolicy.directory === output &&
      task.definition.outputPolicy.fileNameTemplate === fileNameTemplate,
  )
  if (existing) {
    if (kind === 'weekly' && weekly.enable && !existing.activation.enabled) {
      const enabled = await api.setEnabled({
        workspacePath,
        taskId: existing.definition.id,
        enabled: true,
      })
      if (!enabled.success) throw Error(enabled.error?.message || '周度计划启用失败')
    }
    return
  }
  const result = await api.save({
    workspacePath,
    title,
    instruction: `根据上一期计划、待办完成情况和 ${directory} 内该期日记，生成下一期${title}。依次写上期回顾、本期目标、待办与备注，待办使用 Markdown 任务清单。未知事实写待核实。`,
    schedule:
      kind === 'weekly'
        ? { kind, time: weekly.time, timezone, weekdays: [weekly.weekday] }
        : { kind, time: '21:00', timezone },
    resources: [{ kind: 'workspace' }],
    outputPolicy: { directory: output, fileNameTemplate, mode: 'create-only' },
    definitionSource: 'shared',
    enable: kind === 'weekly' && weekly.enable,
  })
  if (!result.success) throw Error(result.error?.message || '创建计划任务失败')
}
