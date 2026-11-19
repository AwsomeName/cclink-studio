import { z } from 'zod'
import { publicRepoPattern } from '../ipc/owner-research'
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
  path: z.string().max(360).optional(),
  startLine: z.number().int().positive().optional(),
  text: z.string().min(1).max(9000),
  url: z.string().url(),
  sha: z.string().regex(/^[a-f0-9]{40}$/i),
  at: z.number(),
})
export const reportSchema = z.object({
  conclusion: z.string().trim().min(1).max(6000),
  items: z
    .array(
      z.object({
        repo: z.string(),
        url: z.string().url().optional(),
        line: z.number().int().positive().optional(),
        finding: phrase,
        quote: z.string().trim().min(6).max(320),
      }),
    )
    .min(1)
    .max(16),
})
export const researchSchema = z.object({
  plan: planSchema.nullable(),
  phase: z.enum(['draft', 'planning', 'ready', 'reading', 'writing', 'checking', 'done', 'error']),
  log: z.array(z.string()).max(60),
  chat: z
    .array(
      z.object({
        who: z.enum(['你', 'Owner']),
        text: z.string().max(6000),
        questionId: z.string().uuid().optional(),
        answer: z.string().max(4500).optional(),
        answerError: z.string().max(600).optional(),
      }),
    )
    .max(100),
  docs: z.array(sourceSchema).max(24),
  decisions: z
    .array(z.object({ kind: z.enum(['read', 'more', 'deliver']), reason: phrase }))
    .max(60)
    .optional(),
  report: reportSchema.nullable(),
})
export type Research = z.infer<typeof researchSchema>
export function checkReport(r: Research, raw: unknown) {
  const report = reportSchema.parse(raw)
  if (!r.plan || !r.plan.repos.every((repo) => report.items.some((item) => item.repo === repo)))
    throw Error('没有覆盖本次研究的所有项目')
  for (const item of report.items) {
    // Line numbers come from the immutable snapshot and matching quote, never from the reply.
    delete item.line
    const url = item.url?.replace(/#L\d+(?:-L\d+)?$/, '')
    const sources = r.docs.filter((d) => d.repo === item.repo && (!url || d.url === url))
    const words = item.quote.split(/\s+/).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    const pattern = new RegExp(words.join('\\s+'))
    const matches = sources.filter((d) => pattern.test(d.text))
    const urls = new Set(matches.map((d) => d.url))
    if (
      !r.plan.repos.includes(item.repo) ||
      urls.size !== 1 ||
      (!url && new Set(sources.map((d) => d.url)).size !== 1)
    )
      throw Error(item.repo + '：引文与标明的来源不匹配')
    item.url = matches[0].url
    const lines = new Set<number>()
    for (const doc of matches) {
      if (!doc.startLine) continue
      for (const match of doc.text.matchAll(new RegExp(pattern, 'g'))) {
        lines.add(doc.startLine + doc.text.slice(0, match.index).split('\n').length - 1)
        if (lines.size > 1)
          throw Error(
            item.repo + '：引文在该文件多处出现，请补足前后原文以定位到具体行：' + item.quote,
          )
      }
    }
    item.line = lines.values().next().value
  }
  return report
}
export function researchStatus(r: Research, active: boolean): [string, string] {
  if (!active && ['planning', 'reading', 'writing', 'checking'].includes(r.phase))
    return ['待恢复', '上次操作中断，打开事务后可继续']
  switch (r.phase) {
    case 'draft':
      return ['待交办', '在右侧告诉 Owner 想调研什么']
    case 'planning':
      return ['进行中', 'Owner 正在整理范围和交付物']
    case 'ready':
      return ['等我确认', '确认调研约定，或在右侧继续调整']
    case 'reading':
      return ['进行中', r.decisions?.at(-1)?.reason ?? '正在获取项目资料']
    case 'writing':
      return ['进行中', '执行会话 A 正在比较项目、撰写调研结果']
    case 'checking':
      return ['进行中', 'Owner 正在逐项判断证据是否足以交付']
    case 'done':
      return ['已交付', '调研简报和逐项出处已就绪']
    case 'error':
      return ['需要处理', '上一步没有完成，已保留现有资料']
  }
}
