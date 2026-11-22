import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  companyDecisionScopeKeys,
  companyDecisionScopeLabels,
  type CompanyDecision,
  type CompanyDecisionEvidence,
  type CompanyDecisionScope,
} from '@shared/company-workspace/company-decision'
import type {
  CompanyWorkspaceResult,
  CompanyWorkspaceSnapshot,
} from '@shared/company-workspace/company-workspace-types'
import { useAgentStore } from '../../stores/agent-store'
import { useUIStore } from '../../stores/ui-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { openCompanyWorkspace } from './company-workspace-commands'
import {
  buildDecisionMaterials,
  dispatchDecision,
  reconcileDecision,
  type DecisionUpdate,
} from './company-decision-agent'
import './company-decisions.css'

interface CompanyDecisionActions {
  update: DecisionUpdate
  openConversation(conversationId: string): void
  openPromote(): void
  openLeads(): void
  openAfterSales(): void
}
type Saved = { decision: CompanyDecision } | { error: string }

async function saved(
  decisionId: string,
  call: () => Promise<CompanyWorkspaceResult<CompanyWorkspaceSnapshot>>,
): Promise<Saved> {
  try {
    const result = await call()
    if (!result.success) return { error: result.error.message }
    const decision = result.data.decisions.find((item) => item.id === decisionId)
    return decision ? { decision } : { error: '决策没有保存，请刷新后重试' }
  } catch (reason) {
    return { error: reason instanceof Error ? reason.message : '决策保存失败' }
  }
}
const navigation = {
  openConversation(conversationId: string) {
    useAgentStore.getState().switchConversation(conversationId)
    useUIStore.getState().setAgentPanelMode('right', 'user')
  },
  openPromote: () => openCompanyWorkspace('promote'),
  openLeads: () => openCompanyWorkspace('customers', undefined, undefined, 'lead'),
  openAfterSales: () => openCompanyWorkspace('customers', undefined, undefined, 'after-sales'),
}

const ACTIVE = new Set(['thinking', 'clarify', 'decide'])
const DEFAULT_SCOPES: CompanyDecisionScope[] = ['accounts', 'sales', 'business']
const sourceLabel: Record<CompanyDecisionEvidence['source'], string> = {
  ...companyDecisionScopeLabels,
  note: '你补充的情况',
}
const date = (iso: string | null) => (iso ? iso.slice(0, 10) : '')

/**
 * “帮我想清楚一个问题”: the company-owned decision record plus the Owner run that fills it.
 * Saves go through Company IPC; the workbench reloads on the change event.
 */
export function CompanyDecisionCard({
  snapshot,
  month,
}: {
  snapshot: CompanyWorkspaceSnapshot
  month: string
}): React.ReactElement {
  const workspaceRef = useWorkspaceStore((state) => state.activeWorkspaceRef)
  const decisions = snapshot.decisions
  const update = useCallback<DecisionUpdate>(
    (decisionId, change) =>
      workspaceRef.kind !== 'local'
        ? Promise.resolve({ error: '请先打开本地公司工作空间' })
        : saved(decisionId, () =>
            window.cclinkStudio.companyWorkspace.updateDecision({
              workspaceRef,
              month,
              decisionId,
              change,
            }),
          ),
    [workspaceRef, month],
  )
  const actions = useMemo<CompanyDecisionActions>(() => ({ ...navigation, update }), [update])
  const [asking, setAsking] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [issue, setIssue] = useState<string | null>(null)
  const sorted = useMemo(
    () => [...decisions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [decisions],
  )
  const current =
    sorted.find((item) => item.id === selected) ??
    sorted.find((item) => ACTIVE.has(item.status)) ??
    null
  const history = sorted.filter((item) => item !== current).slice(0, 5)
  const pending = decisions.filter((item) => ACTIVE.has(item.status)).length

  // Only read back recorded runs; dispatch happens on explicit user actions.
  const inFlight = decisions.some((item) => item.attempt)
  useEffect(() => {
    if (!inFlight) return
    let busy = false
    const timer = setInterval(async () => {
      if (busy) return
      busy = true
      try {
        for (const item of decisions)
          if (item.attempt) await reconcileDecision(item, actions.update)
      } finally {
        busy = false
      }
    }, 1500)
    return () => clearInterval(timer)
  }, [decisions, inFlight, actions])

  const think = async (decision: CompanyDecision) => {
    setIssue(null)
    const error = await dispatchDecision(
      decision,
      buildDecisionMaterials(snapshot, decision.scopes),
      actions.update,
    )
    if (error) setIssue(error)
  }
  const run = async (
    decision: CompanyDecision,
    change: Parameters<DecisionUpdate>[1],
    thenThink = false,
  ) => {
    setIssue(null)
    const result = await actions.update(decision.id, change)
    if ('error' in result) setIssue(result.error)
    else if (thenThink) await think(result.decision)
  }

  return (
    <section className="company-card company-decision" aria-labelledby="company-decision-title">
      <div className="company-section-heading">
        <h2 id="company-decision-title">经营决策</h2>
        {pending > 0 && <span className="company-count">{pending}</span>}
        <button className="company-decision-ask" onClick={() => setAsking(true)}>
          帮我想清楚一个问题
        </button>
      </div>
      {issue && (
        <p className="company-issue" role="alert">
          {issue}
        </p>
      )}
      {current ? (
        <DecisionBody
          key={current.id + ':' + current.version}
          decision={current}
          actions={actions}
          onThink={() => void think(current)}
          onChange={(change, thenThink) => void run(current, change, thenThink)}
        />
      ) : (
        <p>
          遇到拿不准的经营问题，例如“首批先卖给谁，怎么定价？”，交给 Owner。它只读你勾选的资料，
          不清楚的先问你，再给出几个可选方案和依据，由你决定。
        </p>
      )}
      {history.length > 0 && (
        <div className="company-decision-history">
          <span className="company-muted">最近的决策</span>
          <ul>
            {history.map((item) => (
              <li key={item.id}>
                <button className="company-link" onClick={() => setSelected(item.id)}>
                  {item.question}
                </button>
                <span className={`company-decision-tag ${item.status}`}>{statusLabel(item)}</span>
                {item.decidedAt && <span className="company-muted">{date(item.decidedAt)}</span>}
              </li>
            ))}
          </ul>
          {selected && (
            <button className="company-link" onClick={() => setSelected(null)}>
              回到待决定的问题
            </button>
          )}
        </div>
      )}
      {asking && (
        <AskDialog
          onClose={() => setAsking(false)}
          onSubmit={async (input) => {
            const decisionId = crypto.randomUUID()
            if (workspaceRef.kind !== 'local') return '请先打开本地公司工作空间'
            const created = await saved(decisionId, () =>
              window.cclinkStudio.companyWorkspace.createDecision({
                workspaceRef,
                month,
                decisionId,
                ...input,
              }),
            )
            if ('error' in created) return created.error
            setAsking(false)
            setSelected(decisionId)
            await think(created.decision)
            return null
          }}
        />
      )}
    </section>
  )
}

function statusLabel(item: CompanyDecision): string {
  if (item.status === 'adopted') return '已采纳'
  if (item.status === 'deferred') return '先不决定'
  if (item.status === 'decide') return '等你决定'
  if (item.status === 'clarify') return 'Owner 在问你'
  return item.attempt ? 'Owner 思考中' : item.issue ? '思考中断' : '待继续'
}

function DecisionBody({
  decision,
  actions,
  onThink,
  onChange,
}: {
  decision: CompanyDecision
  actions: CompanyDecisionActions
  onThink(): void
  onChange(change: Parameters<DecisionUpdate>[1], thenThink?: boolean): void
}): React.ReactElement {
  const draft = decision.draft
  const [optionId, setOptionId] = useState(
    decision.chosenOptionId ?? draft?.recommendedOptionId ?? '',
  )
  const option = draft?.options.find((item) => item.id === optionId)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const scopeNote = decision.scopes.length
    ? decision.scopes.map((key) => companyDecisionScopeLabels[key]).join('、')
    : '只用你写的情况'
  const defaultText = option ? `${option.title}：${option.audience}，${option.price}` : ''
  const facts = draft?.evidence.filter((item) => item.kind !== 'unverified') ?? []
  const unverified = draft?.evidence.filter((item) => item.kind === 'unverified') ?? []

  return (
    <div className="company-decision-body">
      <div className="company-decision-question">
        <strong>{decision.question}</strong>
        <span className={`company-decision-tag ${decision.status}`}>{statusLabel(decision)}</span>
      </div>
      <p className="company-muted">
        Owner 只读：{scopeNote}
        {' · '}
        <button
          className="company-link"
          onClick={() => actions.openConversation(decision.conversationId)}
        >
          打开 Owner 会话
        </button>
      </p>
      {decision.answers.length > 0 && (
        <ul className="company-decision-answers">
          {decision.answers.map((item) => (
            <li key={item.questionId + item.answer}>
              {item.question} <strong>{item.answer}</strong>
            </li>
          ))}
        </ul>
      )}

      {decision.status === 'thinking' &&
        (decision.attempt ? (
          <p className="company-decision-wait">
            Owner 正在读资料并思考，通常一两分钟。可以先做别的事。
          </p>
        ) : (
          <div className="company-decision-stopped">
            <p className={decision.issue ? 'company-issue' : undefined}>
              {decision.issue || '还没开始思考。'}
            </p>
            <button onClick={onThink}>{decision.issue ? '重新思考' : '开始思考'}</button>
          </div>
        ))}

      {decision.status === 'clarify' && (
        <form
          className="company-decision-clarify"
          onSubmit={(event) => {
            event.preventDefault()
            onChange(
              {
                action: 'answer',
                expectedVersion: decision.version,
                answers: decision.questions.map((item) => ({
                  questionId: item.id,
                  question: item.text,
                  answer: answers[item.id]!.trim(),
                })),
              },
              true,
            )
          }}
        >
          <p>Owner 想先确认几件会改变建议的事：</p>
          {decision.questions.map((item) => (
            <fieldset key={item.id}>
              <legend>{item.text}</legend>
              {item.why && <p className="company-muted">{item.why}</p>}
              <div className="company-decision-choices">
                {item.choices.map((choice) => (
                  <button
                    type="button"
                    key={choice}
                    aria-pressed={answers[item.id] === choice}
                    onClick={() => setAnswers({ ...answers, [item.id]: choice })}
                  >
                    {choice}
                  </button>
                ))}
                <input
                  aria-label="其他回答"
                  placeholder="其他，直接写"
                  maxLength={300}
                  value={
                    item.choices.includes(answers[item.id] ?? '') ? '' : (answers[item.id] ?? '')
                  }
                  onChange={(event) => setAnswers({ ...answers, [item.id]: event.target.value })}
                />
              </div>
            </fieldset>
          ))}
          <div className="company-actions">
            <button
              type="submit"
              disabled={decision.questions.some((item) => !answers[item.id]?.trim())}
            >
              回答并继续
            </button>
            <button
              type="button"
              onClick={() => onChange({ action: 'defer', expectedVersion: decision.version })}
            >
              先不决定
            </button>
          </div>
        </form>
      )}

      {draft && decision.status !== 'thinking' && decision.status !== 'clarify' && (
        <>
          <p className="company-decision-summary">
            <span>Owner 建议</span>
            {draft.summary}
          </p>
          <div className="company-decision-options" role="radiogroup" aria-label="可选方案">
            {draft.options.map((item) => (
              <label
                key={item.id}
                className={item.id === optionId ? 'chosen' : undefined}
                aria-disabled={decision.status === 'adopted'}
              >
                <input
                  type="radio"
                  name={'decision-' + decision.id}
                  checked={item.id === optionId}
                  disabled={decision.status === 'adopted'}
                  onChange={() => setOptionId(item.id)}
                />
                <span className="company-decision-option-title">
                  {item.title}
                  {item.id === draft.recommendedOptionId && <em>推荐</em>}
                  {decision.status === 'adopted' && item.id === decision.chosenOptionId && (
                    <em className="company-decision-chosen">你选的</em>
                  )}
                </span>
                <span>卖给：{item.audience}</span>
                <span>价格：{item.price}</span>
                <span className="company-in">好处：{item.pros}</span>
                <span className="company-out">代价：{item.cons}</span>
              </label>
            ))}
          </div>
          {draft.numbers.length > 0 && (
            <ul className="company-decision-numbers">
              {draft.numbers.map((item) => (
                <li key={item.label}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                  {item.kind === 'estimate' && <em>估算</em>}
                </li>
              ))}
            </ul>
          )}
          <details className="company-decision-evidence">
            <summary>依据（{facts.length} 条）</summary>
            <ul>
              {facts.map((item, index) => (
                <Evidence key={index} item={item} />
              ))}
            </ul>
            {unverified.length > 0 && (
              <>
                <p className="company-muted">未核实，没有用于建议：</p>
                <ul>
                  {unverified.map((item, index) => (
                    <Evidence key={index} item={item} />
                  ))}
                </ul>
              </>
            )}
          </details>
          <div className="company-decision-rethink">
            <span className="company-muted">出现这些情况要重新想：</span>
            <ul>
              {draft.rethinkWhen.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>

          {decision.status === 'adopted' ? (
            <div className="company-decision-done">
              <p>
                <strong>已记为决策</strong>（{date(decision.decidedAt)}）：{decision.decisionText}
              </p>
              <p className="company-muted">
                只记录了决定，没有改价格、没有发消息、没有动账目。接下来可以去：
              </p>
              <div className="company-actions">
                <button onClick={actions.openPromote}>推广产品</button>
                <button onClick={actions.openLeads}>跟进客户</button>
                <button onClick={actions.openAfterSales}>售后服务</button>
                <button
                  className="company-link"
                  onClick={() => onChange({ action: 'reopen', expectedVersion: decision.version })}
                >
                  改主意
                </button>
              </div>
            </div>
          ) : editing ? (
            <div className="company-decision-edit">
              <label>
                写下你的决定
                <textarea
                  rows={3}
                  maxLength={1000}
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                />
              </label>
              <div className="company-actions">
                <button
                  disabled={!text.trim() || !option}
                  onClick={() =>
                    onChange({
                      action: 'adopt',
                      expectedVersion: decision.version,
                      optionId,
                      text: text.trim(),
                    })
                  }
                >
                  采纳并记为决策
                </button>
                <button onClick={() => setEditing(false)}>取消</button>
              </div>
            </div>
          ) : (
            <div className="company-decision-choose">
              <div className="company-actions">
                <button
                  className="primary"
                  disabled={!option}
                  onClick={() =>
                    onChange({
                      action: 'adopt',
                      expectedVersion: decision.version,
                      optionId,
                      text: defaultText,
                    })
                  }
                >
                  采纳并记为决策
                </button>
                <button
                  disabled={!option}
                  onClick={() => {
                    setText(defaultText)
                    setEditing(true)
                  }}
                >
                  改一下再采纳
                </button>
                {decision.status === 'decide' ? (
                  <button
                    onClick={() => onChange({ action: 'defer', expectedVersion: decision.version })}
                  >
                    先不决定
                  </button>
                ) : (
                  <span className="company-muted">你之前选了先不决定</span>
                )}
                <button className="company-link" onClick={onThink}>
                  重新思考
                </button>
              </div>
              <p className="company-muted">采纳只记录决定，不改价格、不发消息、不动账目。</p>
            </div>
          )}
        </>
      )}

      {!draft && decision.status === 'deferred' && (
        <div className="company-actions">
          <span className="company-muted">你选了先不决定。</span>
          <button onClick={() => onChange({ action: 'reopen', expectedVersion: decision.version })}>
            继续想
          </button>
        </div>
      )}
    </div>
  )
}

function Evidence({ item }: { item: CompanyDecisionEvidence }): React.ReactElement {
  return (
    <li>
      {item.text}
      <span className="company-decision-source">
        {item.url ? (
          <a href={item.url} target="_blank" rel="noreferrer">
            {sourceLabel[item.source]}
          </a>
        ) : (
          sourceLabel[item.source]
        )}
        {item.kind === 'estimate' ? ' · 估算' : item.kind === 'unverified' ? ' · 未核实' : ''}
      </span>
    </li>
  )
}

function AskDialog({
  onClose,
  onSubmit,
}: {
  onClose(): void
  onSubmit(input: {
    question: string
    context: string
    scopes: CompanyDecisionScope[]
  }): Promise<string | null>
}): React.ReactElement {
  const [question, setQuestion] = useState('')
  const [context, setContext] = useState('')
  const [scopes, setScopes] = useState<CompanyDecisionScope[]>(DEFAULT_SCOPES)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <div
      className="company-decision-dialog-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <form
        className="company-decision-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="company-decision-dialog-title"
        onKeyDown={(event) => event.key === 'Escape' && onClose()}
        onSubmit={async (event) => {
          event.preventDefault()
          setBusy(true)
          setError(null)
          const issue = await onSubmit({
            question: question.trim(),
            context: context.trim(),
            scopes,
          })
          setBusy(false)
          if (issue) setError(issue)
        }}
      >
        <h3 id="company-decision-dialog-title">帮我想清楚一个问题</h3>
        <label>
          你想决定什么？
          <textarea
            autoFocus
            rows={2}
            maxLength={300}
            placeholder="例如：AR 眼镜一代首批先卖给谁，怎么定价？"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
          />
        </label>
        <label>
          补充情况（可选）
          <textarea
            rows={3}
            maxLength={2000}
            placeholder="例如：首批能交 300 台，零件成本约每台 600 元，还没有渠道。"
            value={context}
            onChange={(event) => setContext(event.target.value)}
          />
        </label>
        <fieldset>
          <legend>Owner 可以只读这些资料</legend>
          {companyDecisionScopeKeys.map((key) => (
            <label key={key} className="company-decision-scope">
              <input
                type="checkbox"
                checked={scopes.includes(key)}
                onChange={(event) =>
                  setScopes(
                    event.target.checked ? [...scopes, key] : scopes.filter((item) => item !== key),
                  )
                }
              />
              {companyDecisionScopeLabels[key]}
              {key === 'sales' && <span className="company-muted">（不含客户姓名和订单号）</span>}
              {key === 'web' && <span className="company-muted">（每条都要附链接）</span>}
            </label>
          ))}
        </fieldset>
        <p className="company-muted">
          Owner 只读、不改任何资料。不清楚的地方会先问你，再给出几个方案和依据。
        </p>
        {error && (
          <p className="company-issue" role="alert">
            {error}
          </p>
        )}
        <div className="company-actions">
          <button type="submit" className="primary" disabled={busy || !question.trim()}>
            {busy ? '交办中…' : '交给 Owner'}
          </button>
          <button type="button" onClick={onClose}>
            取消
          </button>
        </div>
      </form>
    </div>
  )
}
