import { useCallback, useEffect, useRef, useState } from 'react'
import type { Tab } from '../../types'
import type {
  CompanyBusiness,
  CompanyCreateBusinessInput,
  CompanyResourceLink,
  CompanyWorkspaceResult,
  CompanyWorkspaceSnapshot,
} from '@shared/company-workspace/company-workspace-types'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useTabStore } from '../../stores/tab-store'
import { getTabTypeForFile } from '../../utils/model-files'
import { openConversationInWorkbench } from '../agent-conversations/conversation-workbench'
import { openCompanyWorkspace } from './company-workspace-commands'
import './company-workspace.css'
const currentMonth = () => {
  const d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
}
const money = (n: number, currency: string) =>
  new Intl.NumberFormat('zh-CN', { style: 'currency', currency }).format(n / 100)
const publicationLabel: Record<string, string> = {
  'not-started': '尚未提交发布',
  dispatched: '已提交，结果待核验',
  verifying: '正在核验',
  published: '已发布 · 结果已核验',
  'result-unknown': '提交结果未知',
}
export function CompanyWorkbench({ tab }: { tab: Tab }): React.ReactElement {
  const ref = tab.workspaceRef
  const generation = useWorkspaceStore((state) => state.generation)
  const [month, setMonth] = useState(tab.companyWorkspace?.month ?? currentMonth)
  const [snapshot, setSnapshot] = useState<CompanyWorkspaceSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [companyName, setCompanyName] = useState('')
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState(false)
  const [conversationId, setConversationId] = useState('')
  const [publicationId, setPublicationId] = useState('')
  const [businessChoice, setBusinessChoice] = useState('')
  const requestId = useRef(0)
  const live = useRef(true)
  const workspaceId = useRef<string | null>(null)
  const isCurrent = useCallback(() => {
    const state = useWorkspaceStore.getState()
    return (
      live.current &&
      state.generation === generation &&
      ref?.kind === 'local' &&
      state.activeWorkspaceRef.kind === 'local' &&
      state.activeWorkspaceRef.path === ref.path
    )
  }, [generation, ref])
  const load = useCallback(async () => {
    if (ref?.kind !== 'local' || !isCurrent()) return
    const id = ++requestId.current
    try {
      const result = await window.cclinkStudio.companyWorkspace.getSnapshot({
        workspaceRef: ref,
        month,
      })
      if (!isCurrent() || id !== requestId.current) return
      if (!result.success) throw new Error(result.error.message)
      workspaceId.current = result.data.workspaceId
      setSnapshot(result.data)
      setError(null)
    } catch (reason) {
      if (isCurrent() && id === requestId.current)
        setError(reason instanceof Error ? reason.message : '公司资料读取失败')
    }
  }, [isCurrent, month, ref])
  useEffect(() => {
    live.current = true
    workspaceId.current = null
    setSnapshot(null)
    setError(null)
    void load()
    const unsubscribe = window.cclinkStudio.companyWorkspace.onChanged((change) => {
      if (change.workspaceId === workspaceId.current) void load()
    })
    window.addEventListener('focus', load)
    return () => {
      live.current = false
      requestId.current++
      unsubscribe()
      window.removeEventListener('focus', load)
    }
  }, [load])
  const run = async (
    operation: () => Promise<CompanyWorkspaceResult<CompanyWorkspaceSnapshot>>,
    after?: (next: CompanyWorkspaceSnapshot) => void,
  ): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const result = await operation()
      if (!isCurrent()) return
      if (!result.success) throw new Error(result.error.message)
      setSnapshot(result.data)
      workspaceId.current = result.data.workspaceId
      after?.(result.data)
    } catch (reason) {
      if (isCurrent()) {
        setError(reason instanceof Error ? reason.message : '公司操作失败')
      }
    } finally {
      if (isCurrent()) setBusy(false)
    }
  }
  if (ref?.kind !== 'local')
    return (
      <div className="company-workbench">
        <h2>公司经营</h2>
        <p>请先打开一个本地工作空间。</p>
      </div>
    )
  const scope = { workspaceRef: ref, month }
  const page = tab.companyWorkspace?.section ?? 'overview'
  const projects = snapshot?.projects ?? []
  const selectedId = tab.companyWorkspace?.businessId ?? businessChoice
  const business = projects.find((item) => item.id === selectedId)
  const visible = projects.filter((item) => !item.archived)
  const links = snapshot?.links.filter((item) => item.businessId === business?.id) ?? []
  const selectBusiness = (id: string): void => {
    setBusinessChoice(id)
    openCompanyWorkspace('projects', id)
    setEditing(false)
    setCreating(false)
  }
  const openLedger = (id?: string): void => {
    useTabStore.getState().openTab({
      type: 'company-accounts',
      title: '公司账目',
      icon: '账',
      workspaceRef: ref,
      companyAccounts: { month, projectId: id ?? null },
    })
  }
  const attachFile = async (): Promise<void> => {
    if (!business) return
    const target = { ...scope, businessId: business.id }
    try {
      const result = await window.cclinkStudio.dialog.showOpenDialog({
        title: '选择要关联的工作空间文件',
        defaultPath: ref.path,
      })
      if (!isCurrent() || result.canceled || !result.filePaths[0]) return
      await run(() =>
        window.cclinkStudio.companyWorkspace.linkResource({
          ...target,
          kind: 'file',
          target: result.filePaths[0],
        }),
      )
    } catch (reason) {
      if (isCurrent()) setError(reason instanceof Error ? reason.message : '选择文件失败')
    }
  }
  const openLink = (link: CompanyResourceLink): void => {
    if (link.kind === 'file') {
      const filePath = ref.path + '/' + link.target
      const ext = '.' + (link.target.split('.').at(-1) ?? '')
      useTabStore.getState().openTab({
        type: getTabTypeForFile(ext),
        title: link.label,
        icon: '📄',
        filePath,
        workspaceRef: ref,
      })
    } else if (link.kind === 'conversation') {
      if (!openConversationInWorkbench(link.target))
        setError('会话尚未恢复或已归档，请刷新后再打开')
    } else {
      useTabStore.getState().openTab({
        type: 'article-publishing',
        title: link.label,
        icon: '发布',
        workspaceRef: ref,
        articlePublishing: { affairId: link.target },
      })
    }
  }
  const renderLinks = (kind?: CompanyResourceLink['kind']) => (
    <div className="company-list">
      {links
        .filter((item) => !kind || item.kind === kind)
        .map((link) => (
          <article key={link.id} className="company-row">
            <div>
              <strong>{link.label}</strong>
              <p>
                {link.kind === 'file'
                  ? link.target
                  : link.kind === 'conversation'
                    ? '原有工作会话'
                    : '原发布任务'}{' '}
                ·{' '}
                {link.availability === 'available'
                  ? '可查看'
                  : link.availability === 'changed'
                    ? '文件已变化，使用前请核对'
                    : (link.issue ?? '来源缺失')}
              </p>
            </div>
            <div className="company-actions">
              <button
                disabled={busy || link.availability === 'missing'}
                onClick={() => openLink(link)}
              >
                打开原记录
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    window.cclinkStudio.companyWorkspace.unlinkResource({
                      ...scope,
                      businessId: link.businessId,
                      linkId: link.id,
                    }),
                  )
                }
              >
                解除关联
              </button>
            </div>
          </article>
        ))}
    </div>
  )
  return (
    <div className="company-workbench">
      {error && (
        <div className="company-error" role="alert">
          {error} <button onClick={() => void load()}>重新读取</button>
        </div>
      )}
      {!snapshot ? (
        <p>正在读取公司资料…</p>
      ) : !snapshot.enabled ? (
        <section className="company-start">
          <h1>启用公司视图</h1>
          <p>将当前工作空间用于经营公司，关联业务项目、财务、运营和已有资料。</p>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void run(() =>
                window.cclinkStudio.companyWorkspace.configure({
                  ...scope,
                  enabled: true,
                  name: companyName.trim() || snapshot.name,
                }),
              )
            }}
          >
            <label>
              公司显示名称
              <input
                value={companyName}
                placeholder={snapshot.name}
                maxLength={128}
                onChange={(event) => setCompanyName(event.target.value)}
              />
            </label>
            <button disabled={busy} className="company-primary">
              开始使用
            </button>
          </form>
        </section>
      ) : (
        <>
          <header className="company-heading">
            <div>
              <span>{snapshot.name} · 公司经营</span>
              <h1>
                {page === 'overview'
                  ? '公司总览'
                  : page === 'projects'
                    ? (business?.name ?? '业务项目')
                    : page === 'operations'
                      ? '运营内容'
                      : '资料与会话'}
              </h1>
            </div>
            <div className="company-actions">
              <label>
                账目月份
                <input
                  type="month"
                  value={month}
                  onChange={(event) => {
                    if (event.target.value) {
                      setMonth(event.target.value)
                      openCompanyWorkspace(
                        page,
                        tab.companyWorkspace?.businessId ?? undefined,
                        event.target.value,
                      )
                    }
                  }}
                />
              </label>
              <button disabled={busy} onClick={() => void load()}>
                刷新
              </button>
            </div>
          </header>
          {page === 'overview' && (
            <>
              <section>
                <h2>需要我处理</h2>
                {visible
                  .filter(
                    (item) =>
                      !item.goal ||
                      !item.deliverable ||
                      snapshot.links.some(
                        (link) => link.businessId === item.id && link.availability !== 'available',
                      ) ||
                      (item.ledgerProjectId &&
                        !snapshot.finance.projects.some((p) => p.id === item.ledgerProjectId)),
                  )
                  .map((item) => (
                    <article className="company-row" key={item.id}>
                      <div>
                        <strong>{item.name}</strong>
                        <p>
                          {!item.goal || !item.deliverable
                            ? '待补目标或交付条件'
                            : '关联资料或账目归属需要检查'}
                        </p>
                      </div>
                      <button onClick={() => selectBusiness(item.id)}>查看下一步</button>
                    </article>
                  ))}
                {snapshot.finance.summary?.pendingCount ? (
                  <article className="company-row">
                    <div>
                      <strong>{snapshot.finance.summary.pendingCount} 条账目待核对</strong>
                      <p>未计入已确认汇总。</p>
                    </div>
                    <button onClick={() => openLedger()}>打开核对</button>
                  </article>
                ) : null}
                {!visible.length && <p>先创建一件业务，再关联已有资料。</p>}
              </section>
              <section>
                <div className="company-section-heading">
                  <h2>业务项目</h2>
                  <button
                    onClick={() => {
                      openCompanyWorkspace('projects')
                      setCreating(true)
                    }}
                  >
                    创建业务项目
                  </button>
                </div>
                {visible.map((item) => (
                  <article className="company-row" key={item.id}>
                    <div>
                      <button className="company-link" onClick={() => selectBusiness(item.id)}>
                        {item.name}
                      </button>
                      <p>{item.goal || '目标待补充'}</p>
                    </div>
                    <span>
                      {snapshot.links.filter((link) => link.businessId === item.id).length}{' '}
                      项关联资料
                    </span>
                  </article>
                ))}
              </section>
              <section>
                <div className="company-section-heading">
                  <h2>{month} 经营账</h2>
                  <button onClick={() => openLedger()}>打开原始账目</button>
                </div>
                {snapshot.finance.summary ? (
                  <div className="company-metrics">
                    <div>
                      已确认收入
                      <strong>
                        {money(snapshot.finance.summary.incomeMinor, snapshot.finance.currency)}
                      </strong>
                    </div>
                    <div>
                      已确认支出
                      <strong>
                        {money(snapshot.finance.summary.expenseMinor, snapshot.finance.currency)}
                      </strong>
                    </div>
                    <div>
                      净流入
                      <strong>
                        {money(snapshot.finance.summary.netMinor, snapshot.finance.currency)}
                      </strong>
                    </div>
                  </div>
                ) : (
                  <p>
                    {snapshot.finance.state === 'not-initialized'
                      ? '尚未启用账目，可从财务导入资料。'
                      : (snapshot.finance.issue ?? '财务暂不可用。')}
                  </p>
                )}
                <p className="company-muted">
                  仅统计已确认记录；月份资料是否完整仍需核对，净流入不等于利润。
                </p>
              </section>
              <section className="company-actions">
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      window.cclinkStudio.companyWorkspace.configure({
                        ...scope,
                        name: snapshot.name,
                        enabled: false,
                      }),
                    )
                  }
                >
                  关闭公司视图
                </button>
                <span className="company-muted">保留业务、账目、文件与会话。</span>
              </section>
            </>
          )}
          {page === 'projects' && (
            <>
              {!business && (
                <>
                  <div className="company-actions">
                    <button className="company-primary" onClick={() => setCreating(!creating)}>
                      创建业务项目
                    </button>
                  </div>
                  {projects.map((item) => (
                    <article className="company-row" key={item.id}>
                      <div>
                        <button className="company-link" onClick={() => selectBusiness(item.id)}>
                          {item.name}
                        </button>
                        <p>
                          {item.goal || '目标待补充'} · {item.archived ? '已归档' : '未归档'}
                        </p>
                      </div>
                    </article>
                  ))}
                </>
              )}
              {(creating || editing) && (
                <BusinessForm
                  key={business?.id ?? 'new'}
                  business={editing ? business : undefined}
                  scope={scope}
                  financeProjects={snapshot.finance.projects}
                  busy={busy}
                  submit={(fields) =>
                    void run(
                      () =>
                        editing && business
                          ? window.cclinkStudio.companyWorkspace.updateBusiness({
                              ...fields,
                              businessId: business.id,
                              expectedVersion: business.version,
                              archived: business.archived,
                            })
                          : window.cclinkStudio.companyWorkspace.createBusiness(fields),
                      (next) => {
                        setCreating(false)
                        setEditing(false)
                        const added = next.projects.find(
                          (item) => !projects.some((old) => old.id === item.id),
                        )
                        if (added) selectBusiness(added.id)
                      },
                    )
                  }
                />
              )}
              {business && (
                <>
                  <p>{business.goal || '目标待补充'}</p>
                  <p>
                    交付条件：{business.deliverable || '待补充'}
                    {business.dueDate ? ' · 目标日期 ' + business.dueDate : ''}
                  </p>
                  <div className="company-actions">
                    <button onClick={() => setEditing(!editing)}>修改业务信息</button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          window.cclinkStudio.companyWorkspace.updateBusiness({
                            ...scope,
                            name: business.name,
                            goal: business.goal,
                            deliverable: business.deliverable,
                            dueDate: business.dueDate,
                            ledgerProjectId: business.ledgerProjectId,
                            businessId: business.id,
                            expectedVersion: business.version,
                            archived: !business.archived,
                          }),
                        )
                      }
                    >
                      {business.archived ? '重新打开业务' : '归档业务'}
                    </button>
                  </div>
                  <section>
                    <h2>关联支出</h2>
                    {business.ledgerProjectId ? (
                      <>
                        <p>
                          账目归属：
                          {snapshot.finance.projects.find(
                            (item) => item.id === business.ledgerProjectId,
                          )?.name ?? '原归属缺失'}
                        </p>
                        {snapshot.finance.summary && (
                          <strong>
                            {money(
                              snapshot.finance.summary.projectSpending.find(
                                (item) => item.projectId === business.ledgerProjectId,
                              )?.spentMinor ?? 0,
                              snapshot.finance.currency,
                            )}{' '}
                            · 本月已确认实际支出
                          </strong>
                        )}
                        <div className="company-actions">
                          <button onClick={() => openLedger(business.ledgerProjectId ?? undefined)}>
                            查看关联流水与凭证
                          </button>
                        </div>
                      </>
                    ) : (
                      <p>尚未绑定账目归属，可在业务信息中选择已有归属。</p>
                    )}
                  </section>
                  <section>
                    <h2>资料与会话</h2>
                    {snapshot.sourceIssues.conversations && (
                      <p>{snapshot.sourceIssues.conversations}</p>
                    )}
                    <div className="company-actions">
                      <button
                        disabled={busy || business.archived}
                        onClick={() => void attachFile()}
                      >
                        关联文件
                      </button>
                      <select
                        aria-label="选择关联会话"
                        value={conversationId}
                        onChange={(event) => setConversationId(event.target.value)}
                      >
                        <option value="">选择当前工作空间会话</option>
                        {snapshot.conversations.map((item) => (
                          <option value={item.id} key={item.id}>
                            {item.title}
                          </option>
                        ))}
                      </select>
                      <button
                        disabled={busy || !conversationId || business.archived}
                        onClick={() =>
                          void run(() =>
                            window.cclinkStudio.companyWorkspace.linkResource({
                              ...scope,
                              businessId: business.id,
                              kind: 'conversation',
                              target: conversationId,
                            }),
                          )
                        }
                      >
                        关联会话
                      </button>
                    </div>
                    {renderLinks()}
                  </section>
                  <section>
                    <h2>运营内容</h2>
                    {snapshot.sourceIssues.publications && (
                      <p>{snapshot.sourceIssues.publications}</p>
                    )}
                    <div className="company-actions">
                      <select
                        aria-label="选择已有发布任务"
                        value={publicationId}
                        onChange={(event) => setPublicationId(event.target.value)}
                      >
                        <option value="">选择已有发布任务</option>
                        {snapshot.publications.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.title}
                          </option>
                        ))}
                      </select>
                      <button
                        disabled={busy || !publicationId || business.archived}
                        onClick={() =>
                          void run(() =>
                            window.cclinkStudio.companyWorkspace.linkResource({
                              ...scope,
                              businessId: business.id,
                              kind: 'publishing',
                              target: publicationId,
                            }),
                          )
                        }
                      >
                        关联发布任务
                      </button>
                    </div>
                    <p className="company-muted">
                      发布配置、执行步骤与结果核验在原发布任务中处理。
                    </p>
                  </section>
                </>
              )}
            </>
          )}
          {(page === 'operations' || page === 'knowledge') && (
            <>
              <label>
                业务项目
                <select
                  value={businessChoice}
                  onChange={(event) => setBusinessChoice(event.target.value)}
                >
                  <option value="">选择业务项目</option>
                  {visible.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              {business ? (
                <>
                  {page === 'operations' ? (
                    <>
                      {links
                        .filter((item) => item.kind === 'publishing')
                        .map((link) => {
                          const source = snapshot.publications.find(
                            (item) => item.id === link.target,
                          )
                          return (
                            <article key={link.id} className="company-row">
                              <div>
                                <strong>{link.label}</strong>
                                <p>
                                  {source
                                    ? (publicationLabel[source.status] ?? source.status)
                                    : link.issue}
                                  {source?.observedAt ? ' · 核验于 ' + source.observedAt : ''}
                                </p>
                              </div>
                              <button disabled={!source} onClick={() => openLink(link)}>
                                查看发布任务
                              </button>
                            </article>
                          )
                        })}
                      {!links.some((item) => item.kind === 'publishing') && (
                        <p>此业务尚未关联发布任务。</p>
                      )}
                    </>
                  ) : (
                    renderLinks()
                  )}
                  <button onClick={() => selectBusiness(business.id)}>管理业务关联</button>
                </>
              ) : (
                <p>
                  选择业务项目，查看它关联的
                  {page === 'operations' ? '真实发布任务' : '文件与原有会话'}。
                </p>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
function BusinessForm({
  business,
  scope,
  financeProjects,
  busy,
  submit,
}: {
  business?: CompanyBusiness
  scope: Pick<CompanyCreateBusinessInput, 'workspaceRef' | 'month'>
  financeProjects: CompanyWorkspaceSnapshot['finance']['projects']
  busy: boolean
  submit(fields: CompanyCreateBusinessInput): void
}): React.ReactElement {
  const [name, setName] = useState(business?.name ?? '')
  const [goal, setGoal] = useState(business?.goal ?? '')
  const [deliverable, setDeliverable] = useState(business?.deliverable ?? '')
  const [dueDate, setDueDate] = useState(business?.dueDate ?? '')
  const [ledgerProjectId, setLedger] = useState(business?.ledgerProjectId ?? '')
  return (
    <form
      className="company-form"
      onSubmit={(event) => {
        event.preventDefault()
        submit({
          ...scope,
          name,
          goal,
          deliverable,
          dueDate: dueDate || null,
          ledgerProjectId: ledgerProjectId || null,
        })
      }}
    >
      <label>
        业务项目名称
        <input
          required
          maxLength={128}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label>
        目标
        <textarea maxLength={2000} value={goal} onChange={(event) => setGoal(event.target.value)} />
      </label>
      <label>
        交付条件
        <textarea
          maxLength={2000}
          value={deliverable}
          onChange={(event) => setDeliverable(event.target.value)}
        />
      </label>
      <label>
        目标日期（可选）
        <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
      </label>
      <label>
        账目归属
        <select value={ledgerProjectId} onChange={(event) => setLedger(event.target.value)}>
          <option value="">暂不绑定</option>
          {financeProjects.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <button className="company-primary" disabled={busy || !name.trim()}>
        {business ? '保存业务信息' : '创建并打开业务'}
      </button>
    </form>
  )
}
