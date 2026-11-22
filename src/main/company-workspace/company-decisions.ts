import { z } from 'zod'
import {
  companyDecisionAnswerSchema,
  companyDecisionConversationId,
  companyDecisionDraftSchema,
  companyDecisionQuestionSchema,
  companyDecisionReplyIssue,
  companyDecisionScopeSchema,
  type CompanyDecision,
  type CompanyDecisionAction,
} from '../../shared/company-workspace/company-decision'
import type { CompanyWorkspaceErrorCode } from '../../shared/company-workspace/company-workspace-types'

type Row = Record<string, unknown>
export const MAX_DECISIONS = 500
const MAX_ANSWERS = 6

/** v3 adds business decision records (ADR 0025). */
export const DECISIONS_DDL =
  "CREATE TABLE IF NOT EXISTS decisions(id TEXT PRIMARY KEY,version INTEGER NOT NULL,question TEXT NOT NULL,context TEXT NOT NULL,scopes TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('thinking','clarify','decide','adopted','deferred')),conversation_id TEXT NOT NULL,attempt TEXT,run_id TEXT,rounds INTEGER NOT NULL,questions TEXT NOT NULL,answers TEXT NOT NULL,draft TEXT,issue TEXT NOT NULL,chosen_option_id TEXT,decision_text TEXT NOT NULL,decided_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);"

export function newDecision(
  input: {
    decisionId: string
    question: string
    context: string
    scopes: CompanyDecision['scopes']
  },
  now: string,
): CompanyDecision {
  return {
    id: input.decisionId,
    version: 1,
    question: input.question,
    context: input.context,
    scopes: [...new Set(input.scopes)],
    status: 'thinking',
    conversationId: companyDecisionConversationId(input.decisionId),
    attempt: null,
    runId: null,
    rounds: 0,
    questions: [],
    answers: [],
    draft: null,
    issue: '',
    chosenOptionId: null,
    decisionText: '',
    decidedAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

export type DecisionChange =
  | { ok: true; next: CompanyDecision }
  | { ok: false; code: CompanyWorkspaceErrorCode; message: string }

const fail = (code: CompanyWorkspaceErrorCode, message: string): DecisionChange => ({
  ok: false,
  code,
  message,
})

/**
 * Pure state transition for one decision. Version checks for user actions happen here;
 * Owner run callbacks are guarded by the dispatch ticket instead, so a stale or duplicate
 * receipt can never overwrite a newer dispatch.
 */
export function applyDecisionChange(
  current: CompanyDecision,
  change: CompanyDecisionAction,
  now: string,
): DecisionChange {
  if ('expectedVersion' in change && change.expectedVersion !== current.version)
    return fail('CONFLICT', '决策已变化，请刷新后重试')
  if ('attempt' in change && change.action !== 'dispatch' && change.attempt !== current.attempt)
    return fail('CONFLICT', '这不是当前这次思考的回执，已忽略')
  const base = { ...current, version: current.version + 1, updatedAt: now }
  switch (change.action) {
    case 'dispatch':
      if (current.status === 'adopted') return fail('CONFLICT', '已采纳的决策需先点“改主意”')
      if (current.attempt) return fail('CONFLICT', 'Owner 正在思考，请等这次结束')
      if (current.status === 'clarify') return fail('CONFLICT', '请先回答 Owner 的追问')
      return {
        ok: true,
        next: { ...base, status: 'thinking', attempt: change.attempt, runId: null, issue: '' },
      }
    case 'run':
      return { ok: true, next: { ...base, runId: change.runId } }
    case 'fail':
      return { ok: true, next: { ...base, attempt: null, runId: null, issue: change.issue } }
    case 'result': {
      const issue = companyDecisionReplyIssue(current, change.reply)
      if (issue) return { ok: true, next: { ...base, attempt: null, runId: null, issue } }
      if ('questions' in change.reply)
        return {
          ok: true,
          next: {
            ...base,
            status: 'clarify',
            attempt: null,
            runId: null,
            rounds: current.rounds + 1,
            questions: change.reply.questions,
            issue: '',
          },
        }
      return {
        ok: true,
        next: {
          ...base,
          status: 'decide',
          attempt: null,
          runId: null,
          questions: [],
          draft: change.reply.draft,
          issue: '',
        },
      }
    }
    case 'answer': {
      if (current.status !== 'clarify') return fail('CONFLICT', 'Owner 当前没有在等你回答')
      const asked = new Set(current.questions.map((item) => item.id))
      if (change.answers.some((item) => !asked.has(item.questionId)))
        return fail('INVALID_INPUT', '回答与 Owner 的问题不对应，请刷新后重试')
      const answers = [...current.answers, ...change.answers]
      if (answers.length > MAX_ANSWERS) return fail('CONFLICT', '追问回答已达上限，请重新提问')
      return {
        ok: true,
        next: { ...base, status: 'thinking', questions: [], answers, attempt: null, issue: '' },
      }
    }
    case 'adopt': {
      if (current.status !== 'decide' && current.status !== 'deferred')
        return fail('CONFLICT', '还没有可采纳的建议')
      if (current.attempt) return fail('CONFLICT', 'Owner 正在重新思考，请等这次结束')
      if (!current.draft?.options.some((item) => item.id === change.optionId))
        return fail('INVALID_INPUT', '所选方案不在建议中，请刷新后重试')
      return {
        ok: true,
        next: {
          ...base,
          status: 'adopted',
          chosenOptionId: change.optionId,
          decisionText: change.text,
          decidedAt: now,
        },
      }
    }
    case 'defer':
      if (current.status === 'adopted') return fail('CONFLICT', '已采纳的决策需先点“改主意”')
      if (current.attempt) return fail('CONFLICT', 'Owner 正在思考，请等这次结束')
      return { ok: true, next: { ...base, status: 'deferred' } }
    case 'reopen':
      if (current.status !== 'adopted' && current.status !== 'deferred')
        return fail('CONFLICT', '这条决策还没有定下来')
      return {
        ok: true,
        next: {
          ...base,
          status: current.draft ? 'decide' : current.questions.length ? 'clarify' : 'thinking',
          chosenOptionId: null,
          decisionText: '',
          decidedAt: null,
        },
      }
  }
}

export function decisionToRow(item: CompanyDecision): unknown[] {
  return [
    item.id,
    item.version,
    item.question,
    item.context,
    JSON.stringify(item.scopes),
    item.status,
    item.conversationId,
    item.attempt,
    item.runId,
    item.rounds,
    JSON.stringify(item.questions),
    JSON.stringify(item.answers),
    item.draft ? JSON.stringify(item.draft) : null,
    item.issue,
    item.chosenOptionId,
    item.decisionText,
    item.decidedAt,
    item.createdAt,
    item.updatedAt,
  ]
}
export const DECISION_COLUMNS =
  'id,version,question,context,scopes,status,conversation_id,attempt,run_id,rounds,questions,answers,draft,issue,chosen_option_id,decision_text,decided_at,created_at,updated_at'
export const DECISION_UPDATE =
  'UPDATE decisions SET version=?,status=?,attempt=?,run_id=?,rounds=?,questions=?,answers=?,draft=?,issue=?,chosen_option_id=?,decision_text=?,decided_at=?,updated_at=? WHERE id=? AND version=?'
export function decisionUpdateArgs(next: CompanyDecision, previousVersion: number): unknown[] {
  return [
    next.version,
    next.status,
    next.attempt,
    next.runId,
    next.rounds,
    JSON.stringify(next.questions),
    JSON.stringify(next.answers),
    next.draft ? JSON.stringify(next.draft) : null,
    next.issue,
    next.chosenOptionId,
    next.decisionText,
    next.decidedAt,
    next.updatedAt,
    next.id,
    previousVersion,
  ]
}

function json<T>(value: unknown, schema: z.ZodType<T>, fallback: T): { value: T; broken: boolean } {
  if (value === null || value === undefined) return { value: fallback, broken: false }
  try {
    const parsed = schema.safeParse(JSON.parse(String(value)))
    return parsed.success
      ? { value: parsed.data, broken: false }
      : { value: fallback, broken: true }
  } catch {
    return { value: fallback, broken: true }
  }
}
export function decisionFromRow(row: Row): CompanyDecision {
  const scopes = json(row.scopes, z.array(companyDecisionScopeSchema), [])
  const questions = json(row.questions, z.array(companyDecisionQuestionSchema), [])
  const answers = json(row.answers, z.array(companyDecisionAnswerSchema), [])
  const draft = json(row.draft, companyDecisionDraftSchema.nullable(), null)
  const broken = scopes.broken || questions.broken || answers.broken || draft.broken
  const status = String(row.status) as CompanyDecision['status']
  return {
    id: String(row.id),
    version: Number(row.version),
    question: String(row.question),
    context: String(row.context),
    scopes: scopes.value,
    status: draft.broken && (status === 'decide' || status === 'deferred') ? 'thinking' : status,
    conversationId: String(row.conversation_id),
    attempt: row.attempt === null ? null : String(row.attempt),
    runId: row.run_id === null ? null : String(row.run_id),
    rounds: Number(row.rounds),
    questions: questions.value,
    answers: answers.value,
    draft: draft.value,
    issue: broken ? '部分决策内容无法读取，原记录已保留；可重新思考' : String(row.issue),
    chosenOptionId: row.chosen_option_id === null ? null : String(row.chosen_option_id),
    decisionText: String(row.decision_text),
    decidedAt: row.decided_at === null ? null : String(row.decided_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}
