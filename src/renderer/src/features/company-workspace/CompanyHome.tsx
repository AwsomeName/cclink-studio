import { useMemo, useState } from 'react'
import type { CompanyAccountsSnapshot } from '@shared/company-accounts/company-accounts-types'
import type { CompanyWorkspaceSnapshot } from '@shared/company-workspace/company-workspace-types'
import {
  buildCompanyTodos,
  caseMatches,
  pendingLedgerTotals,
  publicationNeedsAttention,
  type CompanyCaseFilter,
  type CompanyTodo,
} from './company-home-model'
import type { CompanyWebAccountRow } from './use-company-sources'
import { CompanyDecisionCard } from './CompanyDecisionCard'

export interface CompanyHomeActions {
  openLedger(projectId?: string): void
  openBusiness(id: string): void
  createBusiness(): void
  openCustomers(filter: CompanyCaseFilter): void
  openPromote(): void
  openPublication(affairId: string, title: string): void
  openAccount(accountId: string): void
  openAccountSettings(): void
  confirmRecord(recordId: string, expectedVersion: number): Promise<string | null>
}

export function CompanyHome({
  snapshot,
  month,
  money,
  ledger,
  ledgerError,
  accounts,
  accountsError,
  actions,
  now,
}: {
  snapshot: CompanyWorkspaceSnapshot
  month: string
  money(minor: number): string
  ledger: CompanyAccountsSnapshot | null
  ledgerError: string | null
  accounts: CompanyWebAccountRow[]
  accountsError: string | null
  actions: CompanyHomeActions
  now: number
}): React.ReactElement {
  const [confirming, setConfirming] = useState<string | null>(null)
  const [recordIssue, setRecordIssue] = useState<{ id: string; message: string } | null>(null)
  const finance = snapshot.finance
  const summary = finance.summary
  const pending = useMemo(() => pendingLedgerTotals(ledger?.records ?? [], month), [ledger, month])
  const pendingRecords = useMemo(
    () =>
      (ledger?.records ?? [])
        .filter((item) => item.status === 'pending' && item.month === month)
        .sort((a, b) => b.amountMinor - a.amountMinor)
        .slice(0, 5),
    [ledger, month],
  )
  const needsLogin = accounts.filter(
    (row) => row.status === 'not-authenticated' && row.account.loginConfirmedAt,
  )
  const visible = snapshot.projects.filter((item) => !item.archived)
  const todos = buildCompanyTodos({
    now,
    cases: snapshot.cases,
    pendingLedgerCount: summary?.pendingCount ?? 0,
    accounts: needsLogin.map((row) => ({
      accountId: row.account.id,
      label: row.account.label,
      websiteName: row.website.name,
    })),
    publications: snapshot.publications,
    businesses: visible,
    businessesNeedingCheck: visible
      .filter(
        (item) =>
          snapshot.links.some(
            (link) => link.businessId === item.id && link.availability !== 'available',
          ) ||
          (item.ledgerProjectId &&
            finance.state === 'ready' &&
            !finance.projects.some((project) => project.id === item.ledgerProjectId)),
      )
      .map((item) => item.id),
  })
  const waitingAfterSales = snapshot.cases.filter(
    (item) => item.kind === 'after-sales' && item.status === 'waiting-me',
  ).length
  const waitingLeads = snapshot.cases.filter(
    (item) => item.kind === 'lead' && item.status === 'waiting-me',
  ).length
  const openAfterSales = snapshot.cases.filter((item) => caseMatches(item, 'after-sales')).length
  const openLeads = snapshot.cases.filter((item) => caseMatches(item, 'lead')).length
  const promotionAttention = snapshot.publications.filter(publicationNeedsAttention).length
  const publishedThisMonth = snapshot.publications.filter(
    (item) => item.status === 'published' && (item.observedAt ?? '').startsWith(month),
  ).length
  const ledgerName = (id: string | null) =>
    finance.projects.find((item) => item.id === id)?.name ?? '未归属'
  const go = (todo: CompanyTodo) => {
    const target = todo.target
    if (target.kind === 'customers') actions.openCustomers(target.filter)
    else if (target.kind === 'ledger') actions.openLedger()
    else if (target.kind === 'account') actions.openAccount(target.accountId)
    else if (target.kind === 'publication') actions.openPublication(target.affairId, target.title)
    else actions.openBusiness(target.businessId)
  }
  const confirm = async (id: string, version: number) => {
    setConfirming(id)
    setRecordIssue(null)
    const issue = await actions.confirmRecord(id, version)
    setConfirming(null)
    if (issue) setRecordIssue({ id, message: issue })
  }
  return (
    <div className="company-home">
      <CompanyDecisionCard snapshot={snapshot} month={month} />
      <section className="company-card company-today" aria-labelledby="company-today-title">
        <div className="company-section-heading">
          <h2 id="company-today-title">今天要处理</h2>
          <span className="company-count">{todos.length}</span>
        </div>
        {todos.length ? (
          <ol className="company-todos">
            {todos.map((todo) => (
              <li key={todo.id} className={todo.tone === 'urgent' ? 'urgent' : undefined}>
                <div>
                  <strong>{todo.title}</strong>
                  <p>{todo.detail}</p>
                </div>
                <button onClick={() => go(todo)}>{todo.action}</button>
              </li>
            ))}
          </ol>
        ) : (
          <p>今天没有等你处理的事。新的售后和意向客户记在“客户与售后”。</p>
        )}
      </section>

      <section className="company-card" aria-labelledby="company-money-title">
        <div className="company-section-heading">
          <h2 id="company-money-title">{month} 收支</h2>
          <button onClick={() => actions.openLedger()}>打开公司账目</button>
        </div>
        {summary ? (
          <>
            <div className="company-metrics">
              <div>
                已确认收入<strong>{money(summary.incomeMinor)}</strong>
              </div>
              <div>
                已确认支出<strong>{money(summary.expenseMinor)}</strong>
              </div>
              <div>
                净流入<strong>{money(summary.netMinor)}</strong>
              </div>
            </div>
            {summary.projectSpending.length > 0 && (
              <ul className="company-split">
                {summary.projectSpending.map((item) => (
                  <li key={item.projectId}>
                    <span>{item.projectName}</span>
                    <strong>{money(item.spentMinor)}</strong>
                  </li>
                ))}
              </ul>
            )}
            {pending.count > 0 && (
              <p className="company-pending-note">
                另有 {pending.count} 条待核对，未计入：收入 {money(pending.incomeMinor)} · 支出{' '}
                {money(pending.expenseMinor)}
              </p>
            )}
          </>
        ) : (
          <p>
            {finance.state === 'not-initialized'
              ? '还没有启用公司账目。打开公司账目导入银行或支付流水后，这里显示本月收支。'
              : (finance.issue ?? '账目暂不可用，其他公司功能仍可使用。')}
          </p>
        )}
        <p className="company-muted">
          只统计已确认流水；资料是否齐全仍需你核对，净流入不等于利润。
        </p>
      </section>

      <section className="company-card" aria-labelledby="company-review-title">
        <div className="company-section-heading">
          <h2 id="company-review-title">待核对流水</h2>
          {pending.count > 0 && <span className="company-count">{pending.count}</span>}
        </div>
        {ledgerError && <p>{ledgerError}</p>}
        {pendingRecords.length ? (
          <ul className="company-ledger">
            {pendingRecords.map((record) => (
              <li key={record.id}>
                <div>
                  <strong>{record.counterparty || record.purpose || record.account}</strong>
                  <p>
                    {record.date} · {record.suggestion?.category || record.category || '分类待定'} ·{' '}
                    {ledgerName(record.projectId)}
                  </p>
                  {recordIssue?.id === record.id && (
                    <p className="company-issue" role="alert">
                      {recordIssue.message}
                    </p>
                  )}
                </div>
                <span className={record.direction === 'income' ? 'company-in' : 'company-out'}>
                  {record.direction === 'income' ? '+' : '−'}
                  {money(record.amountMinor)}
                </span>
                <div className="company-actions">
                  <button
                    disabled={confirming !== null}
                    onClick={() => void confirm(record.id, record.version)}
                  >
                    {confirming === record.id ? '确认中…' : '确认'}
                  </button>
                  <button onClick={() => actions.openLedger(record.projectId ?? undefined)}>
                    打开核对
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          !ledgerError && <p>本月没有待核对流水。</p>
        )}
        {pending.count > pendingRecords.length && (
          <button className="company-link" onClick={() => actions.openLedger()}>
            查看全部 {pending.count} 条
          </button>
        )}
      </section>

      <section className="company-card" aria-labelledby="company-business-title">
        <div className="company-section-heading">
          <h2 id="company-business-title">业务项目</h2>
          <button onClick={actions.createBusiness}>创建业务项目</button>
        </div>
        {visible.length ? (
          <ul className="company-businesses">
            {visible.map((item) => {
              const spent = summary?.projectSpending.find(
                (row) => row.projectId === item.ledgerProjectId,
              )
              const cases = snapshot.cases.filter(
                (row) => row.businessId === item.id && row.status !== 'resolved',
              ).length
              return (
                <li key={item.id}>
                  <button className="company-link" onClick={() => actions.openBusiness(item.id)}>
                    {item.name}
                  </button>
                  <p>{item.goal || '目标待补充'}</p>
                  <p className="company-muted">
                    {item.ledgerProjectId
                      ? `本月已确认支出 ${money(spent?.spentMinor ?? 0)}`
                      : '未绑定账目归属'}
                    {cases ? ` · 客户与售后进行中 ${cases}` : ''}
                    {item.dueDate ? ` · 目标日期 ${item.dueDate}` : ''}
                  </p>
                </li>
              )
            })}
          </ul>
        ) : (
          <p>先创建一件业务，例如“AR 眼镜一代”，再关联工程、账目和发布任务。</p>
        )}
      </section>

      <section className="company-card company-reach" aria-labelledby="company-reach-title">
        <h2 id="company-reach-title">推广与客户</h2>
        <div className="company-tiles">
          <div>
            <span>推广</span>
            <strong>{promotionAttention ? `${promotionAttention} 项等你` : '无待处理'}</strong>
            <p>本月已发布并核验 {publishedThisMonth} 篇</p>
            <button onClick={actions.openPromote}>去推广</button>
          </div>
          <div>
            <span>意向客户</span>
            <strong>{waitingLeads ? `${waitingLeads} 位等你回复` : `${openLeads} 位跟进中`}</strong>
            <p>询价、适配、企业采购</p>
            <button onClick={() => actions.openCustomers('lead')}>跟进意向客户</button>
          </div>
          <div>
            <span>售后</span>
            <strong>
              {waitingAfterSales ? `${waitingAfterSales} 个等你回复` : `${openAfterSales} 个处理中`}
            </strong>
            <p>换件、使用问题、退货</p>
            <button onClick={() => actions.openCustomers('after-sales')}>处理售后</button>
          </div>
        </div>
        <div className="company-accounts-strip">
          <span className="company-muted">推广与客服账号</span>
          {accountsError && <span className="company-muted">{accountsError}</span>}
          {accounts.slice(0, 8).map((row) => (
            <span key={row.account.id} className={`company-account ${row.status}`}>
              {row.website.name} · {row.account.label} · {row.label}
              {row.status === 'not-authenticated' && (
                <button onClick={() => actions.openAccount(row.account.id)}>登录</button>
              )}
            </span>
          ))}
          {!accounts.length && !accountsError && (
            <span className="company-muted">还没有添加网站账号</span>
          )}
          <button className="company-link" onClick={actions.openAccountSettings}>
            管理账号
          </button>
        </div>
      </section>
    </div>
  )
}
