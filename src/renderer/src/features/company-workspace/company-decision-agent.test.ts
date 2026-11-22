import { describe, expect, it } from 'vitest'
import type { CompanyWorkspaceSnapshot } from '@shared/company-workspace/company-workspace-types'
import {
  buildDecisionMaterials,
  buildDecisionPrompt,
  findDecisionReply,
} from './company-decision-agent'

const snapshot = {
  workspaceId: 'w',
  enabled: true,
  name: '公司',
  revision: 1,
  projects: [
    {
      id: 'b1',
      version: 1,
      name: 'AR 眼镜一代',
      goal: '首批上市',
      deliverable: '300 台',
      dueDate: null,
      ledgerProjectId: null,
      archived: false,
      createdAt: '',
      updatedAt: '',
    },
  ],
  links: [],
  cases: [
    {
      id: 'c1',
      version: 1,
      kind: 'lead',
      status: 'waiting-me',
      customer: '张三',
      channel: '小红书',
      summary: '问近视能不能用',
      orderRef: 'ORDER-9',
      nextStep: '',
      businessId: 'b1',
      waitingSince: null,
      resolvedAt: null,
      createdAt: '',
      updatedAt: '',
    },
  ],
  decisions: [],
  conversations: [],
  publications: [],
  sourceIssues: {},
  finance: {
    state: 'ready',
    month: '2026-11',
    currency: 'CNY',
    projects: [],
    summary: {
      month: '2026-11',
      incomeMinor: 129900,
      expenseMinor: 50000,
      refundMinor: 0,
      netMinor: 79900,
      confirmedCount: 3,
      pendingCount: 1,
      projectSpending: [],
    },
  },
} satisfies CompanyWorkspaceSnapshot as CompanyWorkspaceSnapshot

describe('company decision agent', () => {
  it('passes only ticked scopes and never customer names or order numbers', () => {
    const sales = buildDecisionMaterials(snapshot, ['sales'])
    expect(Object.keys(sales)).toEqual(['sales'])
    const text = JSON.stringify(sales)
    expect(text).toContain('问近视能不能用')
    expect(text).not.toContain('张三')
    expect(text).not.toContain('ORDER-9')
    expect(buildDecisionMaterials(snapshot, ['accounts'])).toMatchObject({
      accounts: { income: '1299.00', net: '799.00' },
    })
  })

  it('tells Owner not to use tools unless web is ticked', () => {
    const decision = {
      question: 'Q',
      context: '',
      answers: [],
      scopes: ['accounts'],
      rounds: 0,
    } as never
    expect(buildDecisionPrompt(decision, 't', {})).toContain('不要联网')
    expect(
      buildDecisionPrompt({ ...(decision as object), scopes: ['web'] } as never, 't', {}),
    ).toContain('http(s) 链接')
    expect(buildDecisionPrompt({ ...(decision as object), rounds: 2 } as never, 't', {})).toContain(
      '不允许再追问',
    )
  })

  it('finds the reply for this ticket only, tolerating code fences and prose', () => {
    const ask = {
      ticket: 't2',
      questions: [{ id: 'q', text: '多少台？', why: '', choices: ['300', '1000'] }],
    }
    const found = findDecisionReply(
      ['{"ticket":"t1","questions":[]}', '好的：\n```json\n' + JSON.stringify(ask) + '\n```'],
      't2',
    )
    expect(found).toMatchObject({ problem: null, reply: ask })
    expect(findDecisionReply(['{"ticket":"t1"}'], 't2')).toBeNull()
    expect(findDecisionReply(['{"ticket":"t2","draft":{}}'], 't2')?.problem).toContain(
      'draft.summary',
    )
  })
})
