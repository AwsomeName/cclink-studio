import { z } from 'zod'

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
      .default('Asia/Shanghai')
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
export type DiaryDocumentInput = { action: 'read'; path: string } | { action: 'prepare' }
export const diaryDocumentInputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('read'), path: diaryRelativePathSchema }).strict(),
  z.object({ action: z.literal('prepare') }).strict(),
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
