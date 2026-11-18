import { researchSchema, researchStatus } from './research-model'
import { z } from 'zod'

export const material = z.object({
  name: z.string().trim().min(1).max(120),
  text: z.string().max(4000),
})
export const receipt = z.object({ index: z.number().int(), quote: z.string().min(1).max(500) })
export const affair = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(120),
  goal: z.string().trim().min(1).max(1500),
  sources: z.array(material).max(6),
  research: researchSchema.optional(),
  confirmed: z.boolean(),
  updated: z.number(),
  attempt: z.string().nullable(),
  run: z.string().nullable(),
  issue: z.string(),
  result: z.array(receipt).nullable(),
  method: z.enum(['agent', 'local']).nullable(),
})
export type Affair = z.infer<typeof affair>
export function verify(a: Affair, data: unknown) {
  const parsed = z.array(receipt).safeParse(data)
  if (!parsed.success || parsed.data.length !== a.sources.length)
    throw Error('未交齐每份材料的摘录。')
  return a.sources.map((s, index) => {
    const hit = parsed.data.find((r) => r.index === index + 1)
    if (!hit || !hit.quote.trim() || !s.text.includes(hit.quote))
      throw Error('「' + s.name + '」的引文与原文不符，未交付。')
    return hit
  })
}
export function next(a: Affair) {
  if (a.research) return researchStatus(a.research)
  if (!a.confirmed) return ['等我确认', '确认目标、资料清单与交付标准']
  const missing = a.sources.filter((s) => !s.text.trim())
  if (missing.length) return ['等我提供资料', '缺：' + missing.map((s) => s.name).join('、')]
  if (a.result) return ['已交付', a.sources.length + ' 条引文已核对，可查看简报']
  if (a.issue) return ['需要处理', a.issue]
  if (a.attempt) return ['核对执行状态', '按本次委托核对会话 A 的回执']
  return ['待整理', '材料齐全，可以开始整理']
}
export function brief(a: Affair) {
  return a.result
    ? [
        '# ' + a.title,
        a.goal,
        ...a.result.map((r) => '## ' + a.sources[r.index - 1].name + '\n\n' + r.quote),
      ].join('\n\n')
    : ''
}
