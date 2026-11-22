import { describe, expect, it } from 'vitest'
import type { CompanyAccountsRecord } from '@shared/company-accounts/company-accounts-types'
import type {
  CompanyBusiness,
  CompanyCustomerCase,
} from '@shared/company-workspace/company-workspace-types'
import {
  buildCompanyTodos,
  caseMatches,
  formatWaiting,
  pendingLedgerTotals,
  publicationNeedsAttention,
} from './company-home-model'

const now = Date.parse('2026-11-22T10:00:00.000Z')
const hoursAgo = (hours: number) => new Date(now - hours * 3600_000).toISOString()
const customerCase = (over: Partial<CompanyCustomerCase>): CompanyCustomerCase => ({
  id: 'case',
  version: 1,
  kind: 'after-sales',
  status: 'waiting-me',
  customer: '周先生',
  channel: '网店',
  summary: '镜腿松动',
  orderRef: '',
  nextStep: '',
  businessId: null,
  waitingSince: hoursAgo(1),
  resolvedAt: null,
  createdAt: hoursAgo(1),
  updatedAt: hoursAgo(1),
  ...over,
})
const business = (over: Partial<CompanyBusiness>): CompanyBusiness => ({
  id: 'b',
  version: 1,
  name: 'AR 眼镜一代',
  goal: '年底售出 200 副',
  deliverable: '月度销量',
  dueDate: null,
  ledgerProjectId: null,
  archived: false,
  createdAt: hoursAgo(100),
  updatedAt: hoursAgo(100),
  ...over,
})
const record = (over: Partial<CompanyAccountsRecord>): CompanyAccountsRecord =>
  ({
    id: 'r',
    month: '2026-11',
    status: 'pending',
    direction: 'expense',
    amountMinor: 100,
    ...over,
  }) as CompanyAccountsRecord

describe('company home model', () => {
  it('lists customers waiting on the user first, oldest wait first, and points each to its owner', () => {
    const todos = buildCompanyTodos({
      now,
      cases: [
        customerCase({ id: 'a', customer: '刘同学', waitingSince: hoursAgo(3) }),
        customerCase({ id: 'b', customer: '陈女士', waitingSince: hoursAgo(20) }),
        customerCase({ id: 'c', kind: 'lead', customer: '王经理', waitingSince: hoursAgo(5) }),
        customerCase({ id: 'd', status: 'waiting-customer', waitingSince: null }),
        customerCase({ id: 'e', status: 'resolved', waitingSince: null }),
      ],
      pendingLedgerCount: 23,
      accounts: [{ accountId: 'x', label: '@星河眼镜', websiteName: '小红书' }],
      publications: [
        { id: 'p1', title: '通勤一个月', status: 'not-started', execution: 'waiting-human' },
        { id: 'p2', title: '已发', status: 'published', execution: 'published' },
      ],
      businesses: [
        business({}),
        business({ id: 'n', name: '二代研发', goal: '' }),
        business({ id: 'k', name: '企业采购' }),
      ],
      businessesNeedingCheck: ['k'],
    })
    expect(todos.map((item) => item.id)).toEqual([
      'cases-after-sales',
      'cases-lead',
      'ledger',
      'account-x',
      'publication-p1',
      'business-n',
      'business-k',
    ])
    expect(todos.at(-1)).toMatchObject({ action: '检查关联', target: { businessId: 'k' } })
    expect(todos[0]).toMatchObject({
      tone: 'urgent',
      title: '回复 2 个售后问题',
      detail: '陈女士、刘同学 · 最久等了 20 小时',
      target: { kind: 'customers', filter: 'after-sales' },
    })
    expect(todos[4]).toMatchObject({
      tone: 'urgent',
      target: { kind: 'publication', affairId: 'p1', title: '通勤一个月' },
    })
  })

  it('shows nothing when no one is waiting and nothing needs review', () => {
    expect(
      buildCompanyTodos({
        now,
        cases: [customerCase({ status: 'resolved' })],
        pendingLedgerCount: 0,
        accounts: [],
        publications: [{ id: 'p', title: 't', status: 'published', execution: 'published' }],
        businesses: [business({}), business({ id: 'old', goal: '', archived: true })],
      }),
    ).toEqual([])
  })

  it('keeps pending amounts for the month apart by direction', () => {
    expect(
      pendingLedgerTotals(
        [
          record({ id: '1', direction: 'income', amountMinor: 1_499_500 }),
          record({ id: '2', amountMinor: 980_000 }),
          record({ id: '3', status: 'confirmed', amountMinor: 5 }),
          record({ id: '4', month: '2026-10', amountMinor: 7 }),
        ],
        '2026-11',
      ),
    ).toEqual({ count: 2, incomeMinor: 1_499_500, expenseMinor: 980_000 })
  })

  it('filters cases and formats waiting time', () => {
    const open = customerCase({ kind: 'lead' })
    const done = customerCase({ kind: 'lead', status: 'resolved' })
    expect(caseMatches(open, 'lead')).toBe(true)
    expect(caseMatches(done, 'lead')).toBe(false)
    expect(caseMatches(done, 'resolved')).toBe(true)
    expect(caseMatches(open, 'after-sales')).toBe(false)
    expect(formatWaiting(hoursAgo(0), now)).toBe('1 分钟')
    expect(formatWaiting(hoursAgo(20), now)).toBe('20 小时')
    expect(formatWaiting(hoursAgo(72), now)).toBe('3 天')
    expect(formatWaiting(null, now)).toBe('')
    expect(publicationNeedsAttention({ id: 'p', title: 't', status: 'x' })).toBe(false)
    expect(
      publicationNeedsAttention({ id: 'p', title: 't', status: 'x', execution: 'result-unknown' }),
    ).toBe(true)
  })
})
