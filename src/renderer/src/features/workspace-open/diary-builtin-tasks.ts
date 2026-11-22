import type {
  ScheduledTaskDefinition,
  ScheduledTaskSnapshot,
} from '@shared/scheduled-task/scheduled-task-types'

/** The two built-in tasks are ordinary shared task definitions recognized by their output shape. */
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
  return definition.schedule.kind === 'weekly' && /周计划$/.test(definition.outputPolicy.directory)
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

export const weeklyReviewInstruction = (directory: string): string =>
  `读取 ${directory} 中最近 7 天的日记与上一份周计划，写本周复盘与下周计划。` +
  '依次写三个二级章节：「本周进展」「遗留问题」「下周计划（下周一日期，格式 YYYY-MM-DD）」。' +
  '遗留问题用表格，列为 问题 | 原因 | 下一步；原因未知写“待核实”。不要写其他二级章节，400 字以内。'

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
  const weekly = listed.tasks.find((task) => isWeeklyReviewTask(task.definition))
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
  await apply(
    weekly,
    () =>
      api.save({
        workspacePath,
        title: '每周复盘',
        instruction: weeklyReviewInstruction(directory),
        schedule: {
          kind: 'weekly',
          time: choice.weekly.time,
          weekdays: [choice.weekly.weekday],
          timezone,
        },
        resources,
        outputPolicy: {
          directory: `${directory}/{year}/周计划`,
          fileNameTemplate: '{date}-周复盘.md',
          mode: 'create-only',
        },
        definitionSource: 'shared',
        enable: choice.weekly.enable,
      }),
    choice.weekly.enable,
  )
}
