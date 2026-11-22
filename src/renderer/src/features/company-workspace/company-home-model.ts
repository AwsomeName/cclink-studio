import type { CompanyAccountsRecord } from '@shared/company-accounts/company-accounts-types'
import type {
  CompanyBusiness,
  CompanyCustomerCase,
  CompanyPublishingSource,
} from '@shared/company-workspace/company-workspace-types'

/** Where a to-do sends the user. Every destination is an existing owner page, never the home itself. */
export type CompanyTodoTarget =
  | { kind: 'customers'; filter: CompanyCaseFilter }
  | { kind: 'ledger' }
  | { kind: 'account'; accountId: string }
  | { kind: 'publication'; affairId: string; title: string }
  | { kind: 'business'; businessId: string }

export interface CompanyTodo {
  id: string
  tone: 'urgent' | 'normal'
  title: string
  detail: string
  action: string
  target: CompanyTodoTarget
}

export type CompanyCaseFilter =
  | 'waiting-me'
  | 'after-sales'
  | 'lead'
  | 'waiting-customer'
  | 'resolved'
  | 'all'

export interface CompanyAccountAttention {
  accountId: string
  label: string
  websiteName: string
}

/** Publications that need the user: waiting on a hand-off, stopped, or with an unverified result. */
export const PUBLICATION_ATTENTION: Record<string, string> = {
  'waiting-human': '等你处理',
  interrupted: '已中断',
  failed: '失败',
  'result-unknown': '结果未知，需要核对',
}

export const PUBLICATION_LABELS: Record<string, string> = {
  draft: '草稿',
  preparing: '正在启动',
  running: '执行中',
  'checking-runtime': '待核验',
  'waiting-human': '等你处理',
  interrupted: '已中断',
  cancelled: '已终止',
  failed: '失败',
  published: '已发布 · 结果已核验',
  'result-unknown': '结果未知',
}

export const PUBLICATION_PLATFORM: Record<string, string> = {
  csdn: 'CSDN',
  zhihu: '知乎',
  juejin: '掘金',
  xiaohongshu: '小红书',
  weibo: '微博',
  toutiao: '头条',
  bilibili: 'B 站',
  jike: '即刻',
}

export function publicationNeedsAttention(item: CompanyPublishingSource): boolean {
  return Boolean(item.execution && item.execution in PUBLICATION_ATTENTION)
}

export function caseMatches(item: CompanyCustomerCase, filter: CompanyCaseFilter): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'waiting-me':
    case 'waiting-customer':
    case 'resolved':
      return item.status === filter
    default:
      return item.kind === filter && item.status !== 'resolved'
  }
}

/** Human wait time, e.g. "20 小时". Never negative. */
export function formatWaiting(since: string | null, now: number): string {
  if (!since) return ''
  const minutes = Math.max(0, Math.floor((now - Date.parse(since)) / 60000))
  if (minutes < 60) return `${Math.max(1, minutes)} 分钟`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours} 小时`
  return `${Math.floor(hours / 24)} 天`
}

export interface PendingLedgerTotals {
  count: number
  incomeMinor: number
  expenseMinor: number
}

/** Pending amounts for the selected month; they are shown apart from, never added to, confirmed totals. */
export function pendingLedgerTotals(
  records: CompanyAccountsRecord[],
  month: string,
): PendingLedgerTotals {
  const pending = records.filter((item) => item.status === 'pending' && item.month === month)
  return {
    count: pending.length,
    incomeMinor: pending
      .filter((item) => item.direction === 'income')
      .reduce((sum, item) => sum + item.amountMinor, 0),
    expenseMinor: pending
      .filter((item) => item.direction === 'expense')
      .reduce((sum, item) => sum + item.amountMinor, 0),
  }
}

export interface CompanyTodoInput {
  now: number
  cases: CompanyCustomerCase[]
  pendingLedgerCount: number
  accounts: CompanyAccountAttention[]
  publications: CompanyPublishingSource[]
  businesses: CompanyBusiness[]
  /** Businesses whose linked files, projects or ledger owner are missing or changed. */
  businessesNeedingCheck?: string[]
}

/**
 * Today's list, most time-sensitive first: customers waiting on the user, then money to review,
 * then the things that block promotion. Each entry only points at the record's owner.
 */
export function buildCompanyTodos(input: CompanyTodoInput): CompanyTodo[] {
  const todos: CompanyTodo[] = []
  const waiting = input.cases
    .filter((item) => item.status === 'waiting-me')
    .sort(
      (a, b) =>
        Date.parse(a.waitingSince ?? a.updatedAt) - Date.parse(b.waitingSince ?? b.updatedAt),
    )
  for (const kind of ['after-sales', 'lead'] as const) {
    const group = waiting.filter((item) => item.kind === kind)
    if (!group.length) continue
    const oldest = group[0]
    const names = group
      .slice(0, 3)
      .map((item) => item.customer)
      .join('、')
    todos.push({
      id: 'cases-' + kind,
      tone: kind === 'after-sales' ? 'urgent' : 'normal',
      title:
        kind === 'after-sales'
          ? `回复 ${group.length} 个售后问题`
          : `回复 ${group.length} 位意向客户`,
      detail: `${names}${group.length > 3 ? ' 等' : ''} · 最久等了 ${formatWaiting(oldest.waitingSince, input.now)}`,
      action: kind === 'after-sales' ? '去处理售后' : '去回复',
      target: { kind: 'customers', filter: kind },
    })
  }
  if (input.pendingLedgerCount > 0)
    todos.push({
      id: 'ledger',
      tone: 'normal',
      title: `核对 ${input.pendingLedgerCount} 条流水`,
      detail: '未核对的不计入本月收支',
      action: '打开核对',
      target: { kind: 'ledger' },
    })
  for (const account of input.accounts)
    todos.push({
      id: 'account-' + account.accountId,
      tone: 'normal',
      title: `${account.websiteName} ${account.label} 需重新登录`,
      detail: '登录后推广和读取才能继续；扫码和验证码由你完成',
      action: '打开账号页面',
      target: { kind: 'account', accountId: account.accountId },
    })
  for (const item of input.publications.filter(publicationNeedsAttention))
    todos.push({
      id: 'publication-' + item.id,
      tone: item.execution === 'waiting-human' ? 'urgent' : 'normal',
      title: `推广《${item.title}》${PUBLICATION_ATTENTION[item.execution!]}`,
      detail:
        (item.adapterId ? PUBLICATION_PLATFORM[item.adapterId] + ' · ' : '') + '在原发布任务中处理',
      action: '打开发布任务',
      target: { kind: 'publication', affairId: item.id, title: item.title },
    })
  const needsCheck = new Set(input.businessesNeedingCheck ?? [])
  for (const item of input.businesses.filter((b) => !b.archived)) {
    const missingInfo = !item.goal || !item.deliverable
    if (!missingInfo && !needsCheck.has(item.id)) continue
    todos.push({
      id: 'business-' + item.id,
      tone: 'normal',
      title: missingInfo
        ? `补全业务“${item.name}”的目标或交付条件`
        : `检查业务“${item.name}”的关联资料`,
      detail: missingInfo ? '首页进展按这两项判断' : '关联的文件、工程或账目归属缺失或已变化',
      action: missingInfo ? '去补全' : '检查关联',
      target: { kind: 'business', businessId: item.id },
    })
  }
  return todos
}
