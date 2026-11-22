import { WorkspaceCreationForm } from '../workspace-open/WorkspaceSettingsForm'
import { companyLinkedWorkspaceSchema } from '@shared/company-workspace/company-workspace-schema'
import { openWorkspaceRef } from '../workspace-open/workspace-open-controller'
import { showWorkspaceHome } from '../workspace-open/workspace-home-navigation'
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
import { WorkspaceDataLocation } from '../workspace-open/WorkspaceDataLocation'
import { CompanyHome } from './CompanyHome'
import { CompanyPromote } from './CompanyPromote'
import { CompanyCustomers } from './CompanyCustomers'
import { useCompanyLedger, useCompanyWebAccounts } from './use-company-sources'
import type { CompanyCaseFilter } from './company-home-model'
import { resolveAndOpenWebResourceTab } from '../web-resources/web-resource-tab'
import { createArticlePublishingDraftTab } from '../article-publishing/article-publishing-tab'
const currentMonth = () => {
  const d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
}
const money = (n: number, currency: string) =>
  new Intl.NumberFormat('zh-CN', { style: 'currency', currency }).format(n / 100)
export function CompanyWorkbench({ tab }: { tab: Tab }): React.ReactElement {
  const ref = tab.workspaceRef
  const generation = useWorkspaceStore((state) => state.generation)
  const [month, setMonth] = useState(tab.companyWorkspace?.month ?? currentMonth)
  const [snapshot, setSnapshot] = useState<CompanyWorkspaceSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [companyName, setCompanyName] = useState('')
  const [creatingWorkspace, setCreatingWorkspace] = useState(false)
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
  const ledgerSource = useCompanyLedger(month, ref?.kind === 'local' && Boolean(snapshot?.enabled))
  const webAccounts = useCompanyWebAccounts(ref?.kind === 'local' ? ref : undefined)
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
  const rawPage = tab.companyWorkspace?.section ?? 'overview'
  const page = rawPage === 'operations' ? 'promote' : rawPage
  const caseFilter =
    (tab.companyWorkspace?.caseFilter as CompanyCaseFilter | undefined) ?? 'waiting-me'
  const now = Date.now()
  const formatMoney = (minor: number) => money(minor, snapshot?.finance.currency ?? 'CNY')
  const openPublication = (affairId: string, title: string) =>
    useTabStore.getState().openTab({
      type: 'article-publishing',
      title: '发布 · ' + title,
      icon: '📰',
      workspaceRef: ref,
      articlePublishing: { affairId },
    })
  const openAccount = (accountId: string) =>
    void resolveAndOpenWebResourceTab(accountId, ref).catch((reason) =>
      setError(reason instanceof Error ? reason.message : '账号页面打开失败'),
    )
  const openAccountSettings = () =>
    useTabStore
      .getState()
      .openTab({ type: 'settings', title: '设置', icon: '⚙️', settingsSection: 'web-accounts' })
  const caseRun = async (
    operation: () => Promise<CompanyWorkspaceResult<CompanyWorkspaceSnapshot>>,
  ): Promise<boolean> => {
    let ok = false
    await run(operation, () => {
      ok = true
    })
    return ok
  }
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
  const attachWorkspace = async (): Promise<void> => {
    if (!business) return
    const target = { ...scope, businessId: business.id }
    try {
      const picked = await window.cclinkStudio.dialog.showOpenDialog({
        title: '选择已有工程项目',
        selectDirectory: true,
      })
      if (!isCurrent() || picked.canceled || !picked.filePaths[0]) return
      const path = picked.filePaths[0]
      await window.cclinkStudio.workspaceState.get(path)
      const roots = await window.cclinkStudio.workspaceState.listLocalWorkspaces()
      const linked = roots.find((root) => root.workspacePath === path)
      if (!linked?.projectId) throw Error('工程身份不可用')
      if (!isCurrent()) return
      await run(() =>
        window.cclinkStudio.companyWorkspace.linkResource({
          ...target,
          kind: 'workspace',
          target: JSON.stringify({ workspacePath: path, workspaceId: linked.projectId }),
        }),
      )
    } catch (e) {
      if (isCurrent()) setError(String(e))
    }
  }
  const openLink = (link: CompanyResourceLink): void => {
    if (link.kind === 'workspace') {
      const target = companyLinkedWorkspaceSchema.parse(JSON.parse(link.target))
      void window.cclinkStudio.workspaceState
        .listLocalWorkspaces()
        .then(() =>
          window.cclinkStudio.workspaceState.verifyLocalIdentity(
            target.workspacePath,
            target.workspaceId,
          ),
        )
        .then(() => openWorkspaceRef({ kind: 'local', path: target.workspacePath }))
        .then(showWorkspaceHome)
        .catch((e) => setError(String(e)))
    } else if (link.kind === 'file') {
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
                {link.kind === 'workspace'
                  ? '关联工程'
                  : link.kind === 'file'
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
      <WorkspaceDataLocation path={ref.path} />
      {error && (
        <div className="company-error" role="alert">
          {error} <button onClick={() => void load()}>重新读取</button>
        </div>
      )}
      {!snapshot ? (
        !error && <p>正在读取公司资料…</p>
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
                  ? '项目首页'
                  : page === 'projects'
                    ? (business?.name ?? '业务项目')
                    : page === 'promote'
                      ? '推广'
                      : page === 'customers'
                        ? '客户与售后'
                        : '资料与会话'}
              </h1>
            </div>
            <div className="company-actions">
              <label>
                账目月份
                <input
                  type="month"
                  value={month}
                  disabled={busy}
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
              <CompanyHome
                snapshot={snapshot}
                month={month}
                money={formatMoney}
                ledger={ledgerSource.ledger}
                ledgerError={ledgerSource.error}
                accounts={webAccounts.rows}
                accountsError={webAccounts.error}
                now={now}
                actions={{
                  openLedger,
                  openBusiness: selectBusiness,
                  createBusiness: () => {
                    openCompanyWorkspace('projects')
                    setCreating(true)
                  },
                  openCustomers: (filter) =>
                    openCompanyWorkspace('customers', undefined, undefined, filter),
                  openPromote: () => openCompanyWorkspace('promote'),
                  openPublication,
                  openAccount,
                  openAccountSettings,
                  confirmRecord: async (recordId, expectedVersion) => {
                    try {
                      const result = await window.cclinkStudio.companyAccounts.confirmRecord({
                        recordId,
                        expectedVersion,
                      })
                      await Promise.all([ledgerSource.reload(), load()])
                      return result.success ? null : result.error.message + '，请打开核对补全'
                    } catch (reason) {
                      return reason instanceof Error ? reason.message : '确认失败'
                    }
                  },
                }}
              />
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
                <span className="company-muted">保留业务、账目、客户记录、文件与会话。</span>
              </section>
            </>
          )}
          {page === 'promote' && (
            <CompanyPromote
              snapshot={snapshot}
              accounts={webAccounts.rows}
              openPublication={openPublication}
              createPublication={() =>
                useTabStore.getState().openTab(createArticlePublishingDraftTab(ref))
              }
              openAccount={openAccount}
              openAccountSettings={openAccountSettings}
            />
          )}
          {page === 'customers' && (
            <CompanyCustomers
              cases={snapshot.cases}
              businesses={projects}
              filter={caseFilter}
              busy={busy}
              now={now}
              setFilter={(filter) =>
                openCompanyWorkspace('customers', undefined, undefined, filter)
              }
              create={(fields) =>
                caseRun(() =>
                  window.cclinkStudio.companyWorkspace.createCase({ ...scope, ...fields }),
                )
              }
              update={(fields) =>
                caseRun(() =>
                  window.cclinkStudio.companyWorkspace.updateCase({ ...scope, ...fields }),
                )
              }
            />
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
                        onClick={() => void attachWorkspace()}
                      >
                        关联已有工程
                      </button>
                      <button
                        disabled={busy || business.archived}
                        onClick={() => setCreatingWorkspace((value) => !value)}
                      >
                        新建工程并关联
                      </button>
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
                    {creatingWorkspace && (
                      <WorkspaceCreationForm
                        initialType="electronics"
                        onOpened={() => setCreatingWorkspace(false)}
                        onCreated={async (path) => {
                          const roots =
                            await window.cclinkStudio.workspaceState.listLocalWorkspaces()
                          const linked = roots.find((root) => root.workspacePath === path)
                          if (!linked?.projectId)
                            throw Error('新工程已创建，但身份不可用，请从业务记录重新关联')
                          const result = await window.cclinkStudio.companyWorkspace.linkResource({
                            ...scope,
                            businessId: business.id,
                            kind: 'workspace',
                            target: JSON.stringify({
                              workspacePath: path,
                              workspaceId: linked.projectId,
                            }),
                          })
                          if (!result.success)
                            throw Error('新工程已创建，关联未完成：' + result.error?.message)
                        }}
                      />
                    )}
                    {renderLinks()}
                  </section>
                  <section>
                    <h2>推广（发布任务）</h2>
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
          {page === 'knowledge' && (
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
                  {renderLinks()}
                  <button onClick={() => selectBusiness(business.id)}>管理业务关联</button>
                </>
              ) : (
                <p>选择业务项目，查看它关联的文件与原有会话。</p>
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
