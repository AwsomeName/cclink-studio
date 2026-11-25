import { useState } from 'react'
import type {
  CompanyBusiness,
  CompanyCreateCaseInput,
  CompanyCustomerCase,
  CompanyCustomerCaseStatus,
  CompanyUpdateCaseInput,
} from '@shared/company-workspace/company-workspace-types'
import { caseMatches, formatWaiting, type CompanyCaseFilter } from './company-home-model'

type CaseFields = Omit<CompanyCreateCaseInput, 'workspaceRef' | 'month'>

const FILTERS: Array<{ id: CompanyCaseFilter; label: string }> = [
  { id: 'waiting-me', label: '等你' },
  { id: 'after-sales', label: '售后' },
  { id: 'lead', label: '意向' },
  { id: 'waiting-customer', label: '等对方' },
  { id: 'resolved', label: '已解决' },
  { id: 'all', label: '全部' },
]

const STATUS_LABEL: Record<CompanyCustomerCaseStatus, string> = {
  'waiting-me': '等你回复',
  'waiting-customer': '已回复，等对方',
  resolved: '已解决',
}

const empty = (kind: CaseFields['kind']): CaseFields => ({
  kind,
  customer: '',
  channel: '',
  summary: '',
  orderRef: '',
  nextStep: '',
  businessId: null,
})

export function CompanyCustomers({
  cases,
  businesses,
  filter,
  busy,
  now,
  setFilter,
  create,
  update,
}: {
  cases: CompanyCustomerCase[]
  businesses: CompanyBusiness[]
  filter: CompanyCaseFilter
  busy: boolean
  now: number
  setFilter(filter: CompanyCaseFilter): void
  create(fields: CaseFields): Promise<boolean>
  update(fields: Omit<CompanyUpdateCaseInput, 'workspaceRef' | 'month'>): Promise<boolean>
}): React.ReactElement {
  const [draft, setDraft] = useState<CaseFields | null>(null)
  const [editing, setEditing] = useState<CompanyCustomerCase | null>(null)
  const shown = cases.filter((item) => caseMatches(item, filter))
  const count = (id: CompanyCaseFilter) => cases.filter((item) => caseMatches(item, id)).length
  const openCases = cases.filter((item) => item.status !== 'resolved')
  const businessName = (id: string | null) => businesses.find((item) => item.id === id)?.name
  const move = (item: CompanyCustomerCase, status: CompanyCustomerCaseStatus) =>
    void update({ ...fieldsOf(item), caseId: item.id, expectedVersion: item.version, status })
  return (
    <div className="company-customers">
      <div className="company-section-heading">
        <div className="company-chips" role="tablist" aria-label="客户筛选">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              role="tab"
              aria-selected={filter === item.id}
              onClick={() => setFilter(item.id)}
            >
              {item.label} <span>{count(item.id)}</span>
            </button>
          ))}
        </div>
        <div className="company-actions">
          <button
            className="company-primary"
            disabled={busy}
            onClick={() => {
              setEditing(null)
              setDraft(empty(filter === 'lead' ? 'lead' : 'after-sales'))
            }}
          >
            记一条
          </button>
        </div>
      </div>
      <p className="company-muted">
        本版需要你把网店、平台私信或电话里的问题记在这里。记录保存在本机，不进诊断；为这个项目开启同步后，会随项目上传到你的
        GitHub 私有仓库，能打开仓库的人都能看到。价格、企业报价和退款仍由你在原平台处理。
      </p>
      {(draft || editing) && (
        <CaseForm
          key={editing?.id ?? 'new'}
          initial={editing ? fieldsOf(editing) : draft!}
          businesses={businesses.filter((item) => !item.archived)}
          busy={busy}
          submitLabel={editing ? '保存' : '记下，等你处理'}
          cancel={() => {
            setDraft(null)
            setEditing(null)
          }}
          submit={async (fields) => {
            const ok = editing
              ? await update({
                  ...fields,
                  caseId: editing.id,
                  expectedVersion: editing.version,
                  status: editing.status,
                })
              : await create(fields)
            if (ok) {
              setDraft(null)
              setEditing(null)
            }
          }}
        />
      )}
      <div className="company-customers-body">
        <ul className="company-cases">
          {shown.map((item) => (
            <li key={item.id} className={item.status}>
              <div className="company-case-head">
                <span className={`company-tag ${item.kind}`}>
                  {item.kind === 'after-sales' ? '售后' : '意向'}
                </span>
                <strong>{item.customer}</strong>
                <span className="company-muted">
                  {[
                    item.channel,
                    item.orderRef && '订单 ' + item.orderRef,
                    businessName(item.businessId),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                <span className={`company-status ${item.status}`}>
                  {STATUS_LABEL[item.status]}
                  {item.status === 'waiting-me' &&
                    ' · 等了 ' + formatWaiting(item.waitingSince, now)}
                </span>
              </div>
              <p>{item.summary}</p>
              {item.nextStep && <p className="company-muted">下一步：{item.nextStep}</p>}
              <div className="company-actions">
                {item.status === 'waiting-me' && (
                  <button disabled={busy} onClick={() => move(item, 'waiting-customer')}>
                    已回复，等对方
                  </button>
                )}
                {item.status === 'waiting-customer' && (
                  <button disabled={busy} onClick={() => move(item, 'waiting-me')}>
                    对方回复了
                  </button>
                )}
                {item.status !== 'resolved' ? (
                  <button disabled={busy} onClick={() => move(item, 'resolved')}>
                    已解决
                  </button>
                ) : (
                  <button disabled={busy} onClick={() => move(item, 'waiting-me')}>
                    重新打开
                  </button>
                )}
                <button
                  disabled={busy}
                  onClick={() => {
                    setDraft(null)
                    setEditing(item)
                  }}
                >
                  修改
                </button>
              </div>
            </li>
          ))}
          {!shown.length && (
            <li className="company-empty">
              {cases.length
                ? '这个筛选下没有记录。'
                : '还没有客户记录。点“记一条”记下第一个售后问题或意向客户。'}
            </li>
          )}
        </ul>
        <aside className="company-card company-case-stats" aria-label="客户与售后统计">
          <h2>进行中</h2>
          <dl>
            <div>
              <dt>售后</dt>
              <dd>{openCases.filter((item) => item.kind === 'after-sales').length}</dd>
            </div>
            <div>
              <dt>意向客户</dt>
              <dd>{openCases.filter((item) => item.kind === 'lead').length}</dd>
            </div>
            <div>
              <dt>等你回复</dt>
              <dd>{count('waiting-me')}</dd>
            </div>
            <div>
              <dt>已解决</dt>
              <dd>{count('resolved')}</dd>
            </div>
          </dl>
        </aside>
      </div>
    </div>
  )
}

function fieldsOf(item: CompanyCustomerCase): CaseFields {
  return {
    kind: item.kind,
    customer: item.customer,
    channel: item.channel,
    summary: item.summary,
    orderRef: item.orderRef,
    nextStep: item.nextStep,
    businessId: item.businessId,
  }
}

function CaseForm({
  initial,
  businesses,
  busy,
  submitLabel,
  submit,
  cancel,
}: {
  initial: CaseFields
  businesses: CompanyBusiness[]
  busy: boolean
  submitLabel: string
  submit(fields: CaseFields): Promise<void>
  cancel(): void
}): React.ReactElement {
  const [fields, setFields] = useState(initial)
  const set = <K extends keyof CaseFields>(key: K, value: CaseFields[K]) =>
    setFields((current) => ({ ...current, [key]: value }))
  return (
    <form
      className="company-form company-case-form"
      onSubmit={(event) => {
        event.preventDefault()
        void submit(fields)
      }}
    >
      <label>
        类型
        <select
          value={fields.kind}
          onChange={(event) => set('kind', event.target.value as CaseFields['kind'])}
        >
          <option value="after-sales">售后（已购买）</option>
          <option value="lead">意向客户（未购买）</option>
        </select>
      </label>
      <label>
        客户
        <input
          required
          maxLength={128}
          placeholder="称呼或平台昵称"
          value={fields.customer}
          onChange={(event) => set('customer', event.target.value)}
        />
      </label>
      <label>
        来源
        <input
          maxLength={64}
          placeholder="网店、小红书私信、电话…"
          value={fields.channel}
          onChange={(event) => set('channel', event.target.value)}
        />
      </label>
      <label>
        订单号（可选）
        <input
          maxLength={128}
          value={fields.orderRef}
          onChange={(event) => set('orderRef', event.target.value)}
        />
      </label>
      <label className="company-wide">
        问题或需求
        <textarea
          required
          maxLength={2000}
          value={fields.summary}
          onChange={(event) => set('summary', event.target.value)}
        />
      </label>
      <label>
        下一步（可选）
        <input
          maxLength={500}
          value={fields.nextStep}
          onChange={(event) => set('nextStep', event.target.value)}
        />
      </label>
      <label>
        业务项目
        <select
          value={fields.businessId ?? ''}
          onChange={(event) => set('businessId', event.target.value || null)}
        >
          <option value="">不关联</option>
          {businesses.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <div className="company-actions company-wide">
        <button
          className="company-primary"
          disabled={busy || !fields.customer.trim() || !fields.summary.trim()}
        >
          {submitLabel}
        </button>
        <button type="button" onClick={cancel}>
          取消
        </button>
      </div>
    </form>
  )
}
