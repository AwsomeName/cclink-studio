import { z } from 'zod'

/** Read-only material the user lets Owner see for one decision. `web` is off by default. */
export const companyDecisionScopeKeys = ['accounts', 'sales', 'business', 'web'] as const
export const companyDecisionScopeSchema = z.enum(companyDecisionScopeKeys)
export type CompanyDecisionScope = z.infer<typeof companyDecisionScopeSchema>
export const companyDecisionScopeLabels: Record<CompanyDecisionScope, string> = {
  accounts: '账目汇总',
  sales: '推广与客户记录',
  business: '业务项目',
  web: '网上公开资料',
}

const short = (max: number) => z.string().trim().min(1).max(max)
const id = z.string().trim().min(1).max(40)

// Owner replies are model output: unknown keys are dropped (not rejected), limits leave
// room for plain-language answers, and optional fields accept null.
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value ?? '')
export const companyDecisionQuestionSchema = z.object({
  id,
  text: short(400),
  why: optionalText(400),
  choices: z.array(short(120)).min(2).max(5),
})
export const companyDecisionOptionSchema = z.object({
  id,
  title: short(120),
  audience: short(400),
  price: short(160),
  pros: short(600),
  cons: short(600),
})
export const companyDecisionEvidenceSchema = z.object({
  text: short(600),
  source: z.enum(['accounts', 'sales', 'business', 'web', 'note']),
  url: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((value) => value || undefined)
    .optional(),
  kind: z.enum(['fact', 'estimate', 'unverified']),
})
export const companyDecisionNumberSchema = z.object({
  label: short(80),
  value: short(160),
  kind: z.enum(['fact', 'estimate']),
})
export const companyDecisionDraftSchema = z.object({
  summary: short(600),
  recommendedOptionId: id,
  options: z.array(companyDecisionOptionSchema).min(2).max(5),
  evidence: z.array(companyDecisionEvidenceSchema).min(1).max(20),
  numbers: z
    .array(companyDecisionNumberSchema)
    .max(10)
    .nullish()
    .transform((value) => value ?? []),
  rethinkWhen: z.array(short(300)).min(1).max(8),
})
/** The only shapes an Owner reply may take; the ticket ties it to one dispatch. */
export const companyDecisionReplySchema = z.union([
  z.object({ ticket: short(80), questions: z.array(companyDecisionQuestionSchema).min(1).max(3) }),
  z.object({ ticket: short(80), draft: companyDecisionDraftSchema }),
])
/** First reason a reply failed validation, naming the field, for the card and diagnostics. */
export function companyDecisionReplyProblem(value: unknown): string | null {
  const parsed = companyDecisionReplySchema.safeParse(value)
  if (parsed.success) return null
  const record = value as { draft?: unknown; questions?: unknown } | null
  // A union reports both branches; prefer the branch the reply was attempting.
  const branch =
    record && typeof record === 'object' && 'draft' in record
      ? z.object({ draft: companyDecisionDraftSchema })
      : z.object({ questions: z.array(companyDecisionQuestionSchema).min(1).max(3) })
  const issue = branch.safeParse(value).error?.issues[0] ?? parsed.error.issues[0]
  if (!issue) return '回复格式不对'
  return (issue.path.join('.') || '回复') + '：' + issue.message
}
export const companyDecisionAnswerSchema = z
  .object({ questionId: id, question: short(300), answer: short(300) })
  .strict()

export type CompanyDecisionQuestion = z.infer<typeof companyDecisionQuestionSchema>
export type CompanyDecisionOption = z.infer<typeof companyDecisionOptionSchema>
export type CompanyDecisionEvidence = z.infer<typeof companyDecisionEvidenceSchema>
export type CompanyDecisionDraft = z.infer<typeof companyDecisionDraftSchema>
export type CompanyDecisionReply = z.infer<typeof companyDecisionReplySchema>
export type CompanyDecisionAnswer = z.infer<typeof companyDecisionAnswerSchema>
export type CompanyDecisionStatus = 'thinking' | 'clarify' | 'decide' | 'adopted' | 'deferred'

/** Max clarify rounds before Owner must give a draft. */
export const COMPANY_DECISION_MAX_ROUNDS = 2

/**
 * A business decision the user asked Owner to think through. The company domain owns this
 * record; run state stays with the Agent service and is only referenced by `runId`.
 */
export interface CompanyDecision {
  id: string
  version: number
  question: string
  context: string
  scopes: CompanyDecisionScope[]
  status: CompanyDecisionStatus
  conversationId: string
  /** Ticket of the dispatch in flight; null when no Owner run is expected. */
  attempt: string | null
  runId: string | null
  rounds: number
  questions: CompanyDecisionQuestion[]
  answers: CompanyDecisionAnswer[]
  draft: CompanyDecisionDraft | null
  issue: string
  chosenOptionId: string | null
  decisionText: string
  decidedAt: string | null
  createdAt: string
  updatedAt: string
}

export const companyDecisionConversationId = (decisionId: string) =>
  'company-decision-' + decisionId

const uuid = z.string().uuid()
const ticket = short(80)
export const companyDecisionCreateFieldsSchema = z
  .object({
    decisionId: uuid,
    question: short(300),
    context: z.string().trim().max(2000),
    scopes: z.array(companyDecisionScopeSchema).max(4),
  })
  .strict()
export const companyDecisionActionSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('dispatch'),
      expectedVersion: z.number().int().positive(),
      attempt: ticket,
    })
    .strict(),
  z.object({ action: z.literal('run'), attempt: ticket, runId: short(200) }).strict(),
  z.object({ action: z.literal('fail'), attempt: ticket, issue: short(1000) }).strict(),
  z
    .object({ action: z.literal('result'), attempt: ticket, reply: companyDecisionReplySchema })
    .strict(),
  z
    .object({
      action: z.literal('answer'),
      expectedVersion: z.number().int().positive(),
      answers: z.array(companyDecisionAnswerSchema).min(1).max(3),
    })
    .strict(),
  z
    .object({
      action: z.literal('adopt'),
      expectedVersion: z.number().int().positive(),
      optionId: id,
      text: short(1000),
    })
    .strict(),
  z.object({ action: z.literal('defer'), expectedVersion: z.number().int().positive() }).strict(),
  z.object({ action: z.literal('reopen'), expectedVersion: z.number().int().positive() }).strict(),
])
export const companyDecisionUpdateFieldsSchema = z
  .object({ decisionId: uuid, change: companyDecisionActionSchema })
  .strict()
export type CompanyDecisionAction = z.infer<typeof companyDecisionActionSchema>

/**
 * Rules a reply must meet beyond its shape. Returns a user-facing reason, or null when valid.
 */
export function companyDecisionReplyIssue(
  decision: Pick<CompanyDecision, 'scopes' | 'rounds'>,
  reply: CompanyDecisionReply,
): string | null {
  if ('questions' in reply) {
    return decision.rounds >= COMPANY_DECISION_MAX_ROUNDS
      ? 'Owner 已追问两轮，仍未给出建议；请点“重新思考”或补充情况后再试'
      : null
  }
  const draft = reply.draft
  const ids = new Set(draft.options.map((item) => item.id))
  if (ids.size !== draft.options.length) return 'Owner 给出的方案编号重复，未采用'
  if (!ids.has(draft.recommendedOptionId)) return 'Owner 推荐的方案不在可选方案中，未采用'
  for (const item of draft.evidence) {
    if (item.source === 'note') continue
    if (!decision.scopes.includes(item.source))
      return `依据引用了未授权的资料范围（${companyDecisionScopeLabels[item.source]}），未采用`
    if (item.source === 'web' && !/^https?:\/\/[^\s]+$/i.test(item.url ?? ''))
      return '网上资料依据缺少可打开的链接，未采用'
  }
  if (!draft.evidence.some((item) => item.kind !== 'unverified'))
    return 'Owner 的依据全部未核实，未采用'
  return null
}
