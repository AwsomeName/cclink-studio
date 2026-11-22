import type {
  CompanyResourceLink,
  CompanyWorkspaceSnapshot,
} from '@shared/company-workspace/company-workspace-types'
import {
  PUBLICATION_LABELS,
  PUBLICATION_PLATFORM,
  publicationNeedsAttention,
} from './company-home-model'
import type { CompanyWebAccountRow } from './use-company-sources'

/**
 * Promotion is a projection of WebAffair article-publishing tasks. Approval, execution, hand-off
 * and public-result verification all stay inside the original publishing task.
 */
export function CompanyPromote({
  snapshot,
  accounts,
  openPublication,
  createPublication,
  openAccount,
  openAccountSettings,
}: {
  snapshot: CompanyWorkspaceSnapshot
  accounts: CompanyWebAccountRow[]
  openPublication(affairId: string, title: string): void
  createPublication(): void
  openAccount(accountId: string): void
  openAccountSettings(): void
}): React.ReactElement {
  const publications = [...snapshot.publications].sort((a, b) =>
    (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''),
  )
  const attention = publications.filter(publicationNeedsAttention)
  const rest = publications.filter((item) => !publicationNeedsAttention(item))
  const businessOf = (id: string) => {
    const link = snapshot.links.find(
      (item: CompanyResourceLink) => item.kind === 'publishing' && item.target === id,
    )
    return snapshot.projects.find((item) => item.id === link?.businessId)?.name
  }
  const row = (item: CompanyWorkspaceSnapshot['publications'][number]) => (
    <li key={item.id}>
      <div>
        <strong>{item.title}</strong>
        <p>
          {[
            item.adapterId && PUBLICATION_PLATFORM[item.adapterId],
            PUBLICATION_LABELS[item.execution ?? item.status] ?? item.execution ?? item.status,
            businessOf(item.id),
            item.observedAt && '核验于 ' + item.observedAt.slice(0, 16).replace('T', ' '),
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>
      <div className="company-actions">
        <button onClick={() => openPublication(item.id, item.title)}>打开发布任务</button>
      </div>
    </li>
  )
  return (
    <div className="company-promote">
      <div className="company-section-heading">
        <p className="company-muted">
          写好的 Markdown
          从这里发到已登录的账号。每次公开发布都在发布任务里由你确认账号和内容；只有在平台读回公开结果后才显示“已发布”。
        </p>
        <button className="company-primary" onClick={createPublication}>
          新建文章发布
        </button>
      </div>
      {snapshot.sourceIssues.publications && <p>{snapshot.sourceIssues.publications}</p>}
      <section className="company-card">
        <h2>等你处理</h2>
        {attention.length ? (
          <ul className="company-publications">{attention.map(row)}</ul>
        ) : (
          <p>没有等你处理的发布任务。</p>
        )}
      </section>
      <section className="company-card">
        <h2>全部发布任务</h2>
        {rest.length ? (
          <ul className="company-publications">{rest.map(row)}</ul>
        ) : (
          <p>还没有其他发布任务。</p>
        )}
      </section>
      <section className="company-card">
        <div className="company-section-heading">
          <h2>发布账号</h2>
          <button className="company-link" onClick={openAccountSettings}>
            管理账号
          </button>
        </div>
        <ul className="company-publications">
          {accounts.map((item) => (
            <li key={item.account.id}>
              <div>
                <strong>
                  {item.website.name} · {item.account.label}
                </strong>
                <p className={`company-account ${item.status}`}>{item.label}</p>
              </div>
              <button onClick={() => openAccount(item.account.id)}>
                {item.status === 'not-authenticated' ? '打开并登录' : '打开账号页面'}
              </button>
            </li>
          ))}
          {!accounts.length && <li className="company-empty">还没有添加网站账号。</li>}
        </ul>
      </section>
    </div>
  )
}
