import type { Affair } from './affair'
import { authorization, STATE_LABEL, TIER_HINT, TIER_LABEL, type AffairStep } from './affair-plan'
import { sessionStatus, statusChips } from './owner-status'
import {
  citationCounts,
  decisionWorker,
  pendingSkips,
  planSources,
  workerLabel,
  workersOf,
} from './research-model'

export function StatusChips({
  a,
  active,
  workerLoading,
}: {
  a: Affair
  active: boolean
  workerLoading: boolean
}) {
  const c = statusChips(a, active, workerLoading)
  return (
    <div className="own-chips" data-owner-chips>
      <span className={'own-chip ' + c.tone}>
        <span>事务</span>
        <b>{c.state}</b>
      </span>
      <span className="own-chip">
        <span>Owner</span>
        <b>{c.owner}</b>
      </span>
      <span className={'own-chip' + (workerLoading ? ' blue' : '')}>
        <span>执行会话</span>
        <b>{c.worker}</b>
      </span>
    </div>
  )
}

/** The terms Owner proposes; confirmed once before any dispatch. */
export function AgreementCard({ a, sourceGrants }: { a: Affair; sourceGrants: number }) {
  const plan = a.research?.plan
  if (!plan)
    return (
      <div className="own-card">
        <h3>调研约定</h3>
        <p>Owner 正在把你的要求整理成范围、交付物和验收依据；需要补充时会在右侧问你。</p>
      </div>
    )
  return (
    <div className={'own-card' + (a.confirmed ? '' : ' amber')} data-owner-agreement>
      <h3>
        {a.confirmed ? '已确认的调研约定' : '调研约定 · 待你确认'}
        <small>{a.confirmed ? '变更需重新确认' : '确认后生效，之后常规补查不再问你'}</small>
      </h3>
      <dl className="own-kv">
        <dt>目标</dt>
        <dd>{a.goal}</dd>
        <dt>范围</dt>
        <dd>{plan.scope}</dd>
        <dt>交付与验收</dt>
        <dd>{plan.output}</dd>
        <dt>时间限制</dt>
        <dd>{plan.timing ?? '无硬截止 · 无投入上限 · 按回执推进'}</dd>
        {(plan.outcomes ?? []).length > 0 && (
          <>
            <dt>交付结果</dt>
            <dd data-owner-outcomes>
              {plan.outcomes!.map((o, i) => (
                <div key={i}>
                  <span className={'own-tool' + (o.required ? ' required' : '')}>
                    {o.required ? '必需' : '可选'}
                  </span>
                  {o.text}
                </div>
              ))}
              <small>必需结果依赖的步骤被跳过时，不会标为已交付。</small>
            </dd>
          </>
        )}
        <dt>这次会用到</dt>
        <dd data-owner-tools>
          {plan.repos.map((repo) => (
            <div key={repo}>
              <span className="own-tool github">GitHub</span>
              {repo} · 只读
            </div>
          ))}
          {(plan.folders ?? []).map((f) => (
            <div key={f.key}>
              <span className="own-tool local">本地</span>
              {f.label} · 只读
            </div>
          ))}
          {(plan.folders ?? []).length > 0 && (
            <small>所选本地片段会交给本次使用的模型分析；撤销授权后立即停止读取。</small>
          )}
          <small>
            其他本地文件：每次询问，60 秒无回应则跳过并继续；允许只对该文件、本事务、只读有效。
          </small>
          {!a.confirmed && sourceGrants > (plan.folders ?? []).length && (
            <small>另有已授权的本地目录未列入约定；需要使用时，在右侧告诉 Owner 加入。</small>
          )}
        </dd>
        {a.directory && (
          <>
            <dt>保存位置</dt>
            <dd className="own-path">{a.directory.path}</dd>
          </>
        )}
      </dl>
      {!a.confirmed && <small>在右侧确认，或继续讨论修改；已写入 事务配置.md（待确认草案）</small>}
    </div>
  )
}

/** The agreement's authorization in three tiers; derived from the plan, grants nothing itself. */
export function AuthorizationCard({ a }: { a: Affair }) {
  if (!a.research?.plan) return null
  const { caps, unused } = authorization(a)
  return (
    <div className="own-card" data-owner-authorization>
      <h3>
        这件事的授权
        <small>{a.confirmed ? '已随约定生效；变更需重新确认' : '确认约定即授权'}</small>
      </h3>
      <div className="own-tiers">
        {(['direct', 'ask', 'never'] as const).map((tier) => (
          <div key={tier} className="own-tier" data-owner-tier={tier}>
            <span className={'own-tier-tag ' + tier}>{TIER_LABEL[tier]}</span>
            <small>{TIER_HINT[tier]}</small>
            {caps
              .filter((c) => c.tier === tier)
              .map((c, i) => (
                <div key={i} className="own-cap">
                  <b>
                    {c.name}
                    {c.locked ? ' · 锁定' : ''}
                  </b>
                  <span>{c.scope}</span>
                </div>
              ))}
          </div>
        ))}
      </div>
      <small>这件事用不到：{unused.join('、')}</small>
    </div>
  )
}

/** Who does each step and why; runtime routing by work type is the next increment. */
export function RosterCard({ steps }: { steps: AffairStep[] }) {
  const used = steps.filter((s) => s.who !== 'Studio 核验')
  if (!used.length) return null
  return (
    <div className="own-card" data-owner-roster>
      <h3>
        分工
        <small>每一步由谁做、用哪个运行时</small>
      </h3>
      <table className="own-sess">
        <thead>
          <tr>
            <th>步骤</th>
            <th>工作类型</th>
            <th>运行时</th>
            <th>为什么</th>
          </tr>
        </thead>
        <tbody>
          {used.map((s) => (
            <tr key={s.key}>
              <td>
                {s.title}
                <small>{s.who}</small>
              </td>
              <td>{s.kind}</td>
              <td>{s.runtime}</td>
              <td>
                <small>{s.why}</small>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <small>
        运行时按 Owner 设置里每种工作类型的顺序选择，新开会话时生效。独立意见、复核和 Gemini CLI
        尚未接入。
      </small>
    </div>
  )
}

/** Every step with what it sees, what it may use, when it is done and where it writes. */
export function StepsCard({ steps }: { steps: AffairStep[] }) {
  const current = steps.find((s) => s.state === 'run' || s.state === 'wait')?.key
  return (
    <section className="own-steps" data-owner-steps>
      <h3>
        计划与进度<small>点一步查看：给它看的文件、能用的能力、完成条件、写回哪里</small>
      </h3>
      <ol>
        {steps.map((s, i) => (
          <li key={s.key} className={'own-step ' + s.state} data-owner-step-state={s.state}>
            <details open={s.key === current}>
              <summary>
                <span className="own-step-n">{s.state === 'done' ? '✓' : i + 1}</span>
                <span className="own-step-t">
                  {s.title}
                  {s.required !== undefined && (
                    <span className={'own-tool' + (s.required ? ' required' : '')}>
                      {s.required ? '必需' : '可选'}
                    </span>
                  )}
                  {s.note && <small>{s.note}</small>}
                </span>
                <span className="own-step-who">
                  {s.who} · {s.runtime}
                </span>
                <span className={'own-st ' + s.state}>{STATE_LABEL[s.state]}</span>
                {s.run && <span data-owner-worker-run={s.run} />}
              </summary>
              <dl className="own-kv">
                <dt>给它看</dt>
                <dd>{s.sees.join('、')}</dd>
                <dt>能用的能力</dt>
                <dd>{s.can.join('、')}</dd>
                <dt>完成条件</dt>
                <dd>{s.done}</dd>
                <dt>写回</dt>
                <dd>{s.out}</dd>
              </dl>
            </details>
          </li>
        ))}
      </ol>
    </section>
  )
}

/** Execution sessions of this affair: what each is responsible for, why it exists, where it is. */
export function SessionsCard({ a, running }: { a: Affair; running?: string }) {
  const r = a.research!
  const workers = workersOf(r)
  if (!workers.length) return null
  const decisions = r.decisions ?? []
  return (
    <div className="own-card" data-owner-sessions>
      <h3>
        执行会话 · {workers.length}
        <small>按依赖分配：连续的续用，独立的新开；同一时间只运行一个</small>
      </h3>
      <table className="own-sess">
        <thead>
          <tr>
            <th>会话</th>
            <th>负责什么</th>
            <th>状态</th>
            <th>Agent</th>
          </tr>
        </thead>
        <tbody>
          {workers.map((w) => {
            const continued = decisions.filter(
              (d) =>
                d.kind !== 'deliver' &&
                decisionWorker(d) === w.key &&
                d.workerChoice === 'continue',
            ).length
            const state = sessionStatus(r, w.key, running === w.key)
            return (
              <tr key={w.key} data-owner-session={w.key}>
                <td className="own-sess-key">{workerLabel(w.key)}</td>
                <td>
                  {w.purpose}
                  <small>
                    {w.reason}
                    {continued ? ' · 续用 ' + continued + ' 次' : ''}
                  </small>
                </td>
                <td>
                  <span className={'own-st ' + state.tone}>{state.text}</span>
                </td>
                <td>
                  {w.agent === 'codex' ? 'Codex' : w.agent === 'claude-code' ? 'Claude Code' : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function DeliveryCard({
  a,
  openReport,
  reveal,
}: {
  a: Affair
  openReport: () => void
  reveal: () => void
}) {
  const r = a.research!
  if (r.phase !== 'done' || !r.report) return null
  const saved = !!a.directory?.reportFile && !a.directory.error
  return (
    <div className={'own-card' + (saved ? ' green' : ' amber')} data-owner-delivery>
      <h3>{saved ? '交付物' : '交付物待保存'}</h3>
      {saved && (
        <div className="own-card-file">
          <span>📄 {a.directory!.reportFile}</span>
          <span className="own-flex" />
          <button className="own-primary" onClick={openReport}>
            打开交付物
          </button>
          <button onClick={reveal}>打开事务目录</button>
        </div>
      )}
      <dl className="own-kv">
        <dt>引用核对</dt>
        <dd data-owner-citations>
          {r.report.items.length} / {r.report.items.length} 条引文与证据原文一致
          {citationLine(r.report.items, planSources(r.plan).length)}
        </dd>
        <dt>证据快照</dt>
        <dd>{r.docs.length} 份，保存在 资料/</dd>
        <dt>文件</dt>
        <dd>{saved ? '写入后已核验' : '报告已核对，尚未写入磁盘；请在上方重试保存文件'}</dd>
      </dl>
    </div>
  )
}

function citationLine(items: { repo: string }[], sources: number) {
  const { local, github } = citationCounts(items)
  if (!local) return null
  return (
    <small>
      本地 {local} · GitHub {github} · 覆盖全部 {sources} 个来源
    </small>
  )
}

/**
 * Steps that waited for approval and were skipped. Required ones keep the affair from being
 * delivered; allowing one reruns only the skipped steps.
 */
export function SkippedCard({
  a,
  grant,
  decline,
  busy,
}: {
  a: Affair
  grant: (skipId: string) => void
  decline: (skipId: string) => void
  busy: boolean
}) {
  const r = a.research!
  const skips = r.skips ?? []
  const open = skips.filter((k) => k.status !== 'read' && k.status !== 'declined')
  if (!open.length && r.phase !== 'decide') return null
  const held = pendingSkips(r).filter((k) => k.required)
  const why = (k: (typeof skips)[number]) =>
    (k.why === 'timeout' ? '60 秒无回应，已跳过' : '你拒绝了，已跳过') +
    ' · ' +
    new Date(k.at).toLocaleTimeString()
  return (
    <div className={'own-card' + (held.length ? ' red' : ' amber')} data-owner-skipped>
      <h3>
        {r.phase === 'decide' ? '待你决定 · 未交付' : '跳过的步骤'}
        <small>
          {held.length
            ? held.length + ' 项必需步骤被跳过，因此不能标为已交付'
            : '允许后只重跑被跳过的步骤，已核对的引文不重做'}
        </small>
      </h3>
      {skips.map((k) => (
        <div key={k.id} className="own-skip" data-owner-skip={k.status}>
          <div>
            <span className={'own-tool' + (k.required ? ' required' : '')}>
              {k.required === undefined ? '待判断' : k.required ? '必需' : '可选'}
            </span>
            <span className="own-tool local">本地文件</span>
            <code>{k.path}</code>
          </div>
          <small>
            {why(k)}
            {k.affects ? ' · 影响：' + k.affects : ''}
          </small>
          {k.status === 'skipped' ? (
            <div className="own-card-actions">
              <button
                className={k.required ? 'own-primary' : ''}
                disabled={busy}
                onClick={() => grant(k.id)}
              >
                允许读取此文件并补查
              </button>
              {!k.required && (
                <button disabled={busy} onClick={() => decline(k.id)}>
                  不需要
                </button>
              )}
            </div>
          ) : (
            <small>
              {k.status === 'granted'
                ? '已允许（仅此文件、本事务、只读），等待补查'
                : k.status === 'read'
                  ? '已补查'
                  : '你选择不需要，列为未完成项'}
            </small>
          )}
        </div>
      ))}
      {r.draft && (
        <small>
          草稿已核对 {r.draft.items.length} 条引文，不是交付物；必需步骤补查完成后才交付。
        </small>
      )}
    </div>
  )
}
