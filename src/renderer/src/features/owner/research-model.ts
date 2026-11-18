import { z } from 'zod'
import { publicRepoPattern } from '@shared/ipc/owner-research'
const phrase = z.string().trim().min(1).max(1200)
export const planSchema = z.object({
  scope: phrase,
  output: phrase,
  repos: z
    .array(z.string().regex(publicRepoPattern))
    .min(1)
    .max(4)
    .refine((rs) => new Set(rs.map((r) => r.toLowerCase())).size === rs.length),
})
export const sourceSchema = z.object({
  repo: z.string().regex(publicRepoPattern),
  text: z.string().min(1).max(9000),
  url: z.string().url(),
  sha: z.string().regex(/^[a-f0-9]{40}$/i),
  at: z.number(),
})
export const reportSchema = z.object({
  conclusion: phrase,
  items: z
    .array(
      z.object({ repo: z.string(), finding: phrase, quote: z.string().trim().min(6).max(320) }),
    )
    .min(1)
    .max(4),
})
export const researchSchema = z.object({
  plan: planSchema.nullable(),
  phase: z.enum(['draft', 'planning', 'ready', 'reading', 'writing', 'checking', 'done', 'error']),
  log: z.array(z.string()).max(60),
  chat: z.array(z.object({ who: z.enum(['你', 'Owner']), text: z.string().max(6000) })).max(100),
  docs: z.array(sourceSchema).max(4),
  report: reportSchema.nullable(),
})
export type Research = z.infer<typeof researchSchema>
export const freshResearch = (): Research => ({
  plan: null,
  phase: 'draft',
  chat: [],
  log: [],
  docs: [],
  report: null,
})
export function checkReport(r: Research, raw: unknown) {
  const report = reportSchema.parse(raw)
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
  if (!r.plan || r.docs.length !== r.plan.repos.length || report.items.length !== r.docs.length)
    throw Error('没有覆盖确认范围内的所有仓库')
  for (const repo of r.plan.repos) {
    const source = r.docs.find((d) => d.repo === repo),
      item = report.items.find((x) => x.repo === repo)
    if (!item || !source || !norm(source.text).includes(norm(item.quote)))
      throw Error(repo + '：未找到与 README 匹配的引文')
  }
  return report
}
export function researchStatus(r: Research): [string, string] {
  switch (r.phase) {
    case 'draft':
      return ['待交办', '在右侧告诉 Owner 想调研什么']
    case 'planning':
      return ['进行中', 'Owner 正在整理范围和交付物']
    case 'ready':
      return ['等我确认', '确认调研约定，或在右侧继续调整']
    case 'reading':
      return ['进行中', '读取公开 README：' + r.docs.length + '/' + r.plan?.repos.length]
    case 'writing':
      return ['进行中', '执行会话 A 正在比较项目、撰写调研结果']
    case 'checking':
      return ['进行中', 'Owner 正在对照来源核对回执']
    case 'done':
      return ['已交付', '调研简报和逐项出处已就绪']
    case 'error':
      return ['需要处理', '上一步没有完成，已保留现有资料']
  }
}
