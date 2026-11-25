import { z } from 'zod'

export const defaultDiaryDirectory = '个人计划'
export const defaultDiaryTimezone = 'Asia/Shanghai'

export const diaryRelativePathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.includes('\\') &&
      !value.includes('\0') &&
      value.split('/').every((part) => Boolean(part) && part !== '..' && part !== '.'),
    '请选择来源内的相对目录',
  )
export const personalDiarySourceSchema = z
  .object({
    version: z.literal(1),
    workspacePath: z.string().min(1).max(4096),
    projectId: z.string().min(1),
    directory: diaryRelativePathSchema,
    timezone: z
      .string()
      .default(defaultDiaryTimezone)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: value })
          return true
        } catch {
          return false
        }
      }, '时区无效'),
    taskIds: z.array(z.string().min(1)).max(20),
  })
  .strict()
export type PersonalDiarySource = z.infer<typeof personalDiarySourceSchema>
export const personalDiarySourceSection = 'personalDiarySource'

export interface DiaryDocument {
  path: string
  content: string
  created: boolean
  truncated: boolean
}
export type DiaryDocumentInput = ({ action: 'read'; path: string } | { action: 'prepare' }) & {
  workspacePath?: string
}
export const diaryDocumentInputSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('read'),
      path: diaryRelativePathSchema,
      workspacePath: z.string().min(1).max(4096).optional(),
    })
    .strict(),
  z
    .object({ action: z.literal('prepare'), workspacePath: z.string().min(1).max(4096).optional() })
    .strict(),
])
export function diaryDateParts(
  timezone: string,
  now = new Date(),
): { year: string; month: string; day: string; weekday: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const get = (key: string): string => parts.find((p) => p.type === key)!.value
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    weekday: new Intl.DateTimeFormat('zh-CN', { timeZone: timezone, weekday: 'short' }).format(now),
  }
}

/** Paths relative to the configured diary directory, always using repository separators. */
export function diaryDayLocation(date: ReturnType<typeof diaryDateParts>) {
  const folder = date.year + '/' + date.month
  const prefix = date.month + date.day
  return {
    folder,
    filename: prefix + '_' + date.weekday + '.md',
    matchesName: (name: string) => name.startsWith(prefix) && /^\d{4}[_-]周.*\.md$/.test(name),
  }
}

/**
 * The blank template 今天 creates when AI cannot draft right away. A file still exactly equal to
 * it holds nothing the user wrote, so the daily draft may fill it instead of skipping the day.
 */
export function blankDiaryTemplate(date: ReturnType<typeof diaryDateParts>): string {
  return `# ${date.year}-${date.month}-${date.day} ${date.weekday}\n\n今日体重：\n昨日睡眠：\n昨日花销：\nAI 剩余额度：\n昨日办公地点：\n昨日运动：\n昨日收入：\n昨日身体情况：\n\n## 昨日总结\n\n\n## 今日待做\n\n\n## 强调事项\n\n\n## 今日打卡\n\n按时间、事项、详细记录填写；尚未填写的事实保持空白。\n`
}
