import { describe, expect, it } from 'vitest'
import {
  applyDecisionChange,
  decisionFromRow,
  decisionToRow,
  DECISION_COLUMNS,
  newDecision,
} from './company-decisions'
import type {
  CompanyDecision,
  CompanyDecisionDraft,
} from '../../shared/company-workspace/company-decision'

const now = '2026-11-22T10:00:00.000Z'
const base = () =>
  newDecision(
    {
      decisionId: '0b7f2b6e-1f43-4d2a-9d5c-2a7f6f1c8e01',
      question: '首批先卖给谁，怎么定价？',
      context: '首批 300 台',
      scopes: ['accounts', 'sales', 'business'],
    },
    now,
  )
const draft = (patch: Partial<CompanyDecisionDraft> = {}): CompanyDecisionDraft => ({
  summary: '先卖给近视通勤个人用户，早鸟价 1299',
  recommendedOptionId: 'a',
  options: [
    {
      id: 'a',
      title: '个人用户',
      audience: '近视通勤',
      price: '¥1,299',
      pros: '反馈快',
      cons: '客服量大',
    },
    {
      id: 'b',
      title: '小团队',
      audience: '设计工作室',
      price: '¥1,499',
      pros: '单量大',
      cons: '周期长',
    },
  ],
  evidence: [{ text: '本月推广带来 12 位意向客户', source: 'sales', kind: 'fact' }],
  numbers: [{ label: '每台剩余', value: '约 ¥532', kind: 'estimate' }],
  rethinkWhen: ['零件成本超过 ¥800'],
  ...patch,
})
function step(current: CompanyDecision, change: Parameters<typeof applyDecisionChange>[1]) {
  const result = applyDecisionChange(current, change, now)
  if (!result.ok) throw Error(result.message)
  return result.next
}

describe('company decisions', () => {
  it('runs ask → clarify → answer → decide → adopt', () => {
    let d = step(base(), { action: 'dispatch', expectedVersion: 1, attempt: 't1' })
    d = step(d, { action: 'run', attempt: 't1', runId: 'r1' })
    expect(d.runId).toBe('r1')
    d = step(d, {
      action: 'result',
      attempt: 't1',
      reply: {
        ticket: 't1',
        questions: [{ id: 'q1', text: '首批能交多少台？', why: '', choices: ['300', '1000'] }],
      },
    })
    expect(d).toMatchObject({ status: 'clarify', rounds: 1, attempt: null })
    d = step(d, {
      action: 'answer',
      expectedVersion: d.version,
      answers: [{ questionId: 'q1', question: '首批能交多少台？', answer: '300' }],
    })
    expect(d).toMatchObject({ status: 'thinking', questions: [] })
    d = step(d, { action: 'dispatch', expectedVersion: d.version, attempt: 't2' })
    d = step(d, { action: 'result', attempt: 't2', reply: { ticket: 't2', draft: draft() } })
    expect(d.status).toBe('decide')
    d = step(d, {
      action: 'adopt',
      expectedVersion: d.version,
      optionId: 'a',
      text: '先卖个人，1299',
    })
    expect(d).toMatchObject({ status: 'adopted', chosenOptionId: 'a', decidedAt: now })
  })

  it('ignores stale receipts and refuses double dispatch', () => {
    const d = step(base(), { action: 'dispatch', expectedVersion: 1, attempt: 't1' })
    expect(applyDecisionChange(d, { action: 'run', attempt: 'old', runId: 'x' }, now).ok).toBe(
      false,
    )
    expect(
      applyDecisionChange(d, { action: 'dispatch', expectedVersion: d.version, attempt: 't9' }, now)
        .ok,
    ).toBe(false)
    expect(applyDecisionChange(d, { action: 'defer', expectedVersion: 1 }, now).ok).toBe(false)
  })

  it('rejects drafts that cite unauthorised scopes, web without links, or only unverified claims', () => {
    const d = step(base(), { action: 'dispatch', expectedVersion: 1, attempt: 't1' })
    const cases: CompanyDecisionDraft[] = [
      draft({
        evidence: [
          { text: '行业均价 ¥1,500', source: 'web', kind: 'fact', url: 'https://example.com' },
        ],
      }),
      draft({ evidence: [{ text: '听说竞品卖 999', source: 'sales', kind: 'unverified' }] }),
      draft({ recommendedOptionId: 'z' }),
    ]
    for (const item of cases) {
      const next = step(d, {
        action: 'result',
        attempt: 't1',
        reply: { ticket: 't1', draft: item },
      })
      expect(next).toMatchObject({ status: 'thinking', attempt: null, draft: null })
      expect(next.issue).not.toBe('')
    }
    const web = step(
      { ...d, scopes: [...d.scopes, 'web'] },
      {
        action: 'result',
        attempt: 't1',
        reply: {
          ticket: 't1',
          draft: draft({ evidence: [{ text: '均价', source: 'web', kind: 'fact' }] }),
        },
      },
    )
    expect(web.issue).toContain('链接')
  })

  it('stops after two clarify rounds', () => {
    const ask = {
      ticket: 't',
      questions: [{ id: 'q', text: '还要问？', why: '', choices: ['是', '否'] }],
    }
    const d = { ...base(), rounds: 2, attempt: 't' }
    const next = step(d, { action: 'result', attempt: 't', reply: ask })
    expect(next.status).toBe('thinking')
    expect(next.issue).toContain('两轮')
  })

  it('round-trips through a row and survives a corrupt draft', () => {
    const d = { ...base(), status: 'decide' as const, draft: draft() }
    const row = Object.fromEntries(
      DECISION_COLUMNS.split(',').map((column, index) => [column, decisionToRow(d)[index]]),
    )
    expect(decisionFromRow(row)).toEqual(d)
    const broken = decisionFromRow({ ...row, draft: '{"oops"' })
    expect(broken).toMatchObject({ status: 'thinking', draft: null })
    expect(broken.issue).toContain('无法读取')
  })
})

describe('owner reply tolerance', () => {
  it('drops unknown keys and accepts null optionals instead of rejecting the reply', async () => {
    const { companyDecisionReplySchema, companyDecisionReplyProblem } =
      await import('../../shared/company-workspace/company-decision')
    const reply = {
      ticket: 't',
      confidence: 'high',
      draft: {
        ...draft(),
        numbers: null,
        evidence: [{ text: '12 位意向客户', source: 'sales', kind: 'fact', url: null, note: 'x' }],
      },
    }
    expect(companyDecisionReplyProblem(reply)).toBeNull()
    const parsed = companyDecisionReplySchema.parse(reply)
    expect(parsed).not.toHaveProperty('confidence')
    expect('draft' in parsed && parsed.draft.numbers).toEqual([])
    expect(
      companyDecisionReplyProblem({ ticket: 't', draft: { ...draft(), options: [] } }),
    ).toContain('draft.options')
  })
})
