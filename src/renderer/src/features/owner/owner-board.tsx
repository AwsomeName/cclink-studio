import type { Affair } from './affair'
import { statusChips } from './owner-status'

const short = (s: string, n = 90) => (s.length > n ? s.slice(0, n) + '…' : s)

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
        <span>执行会话 A</span>
        <b>{c.worker}</b>
      </span>
    </div>
  )
}

/** The terms Owner proposes; confirmed once before any dispatch. */
export function AgreementCard({
  a,
  ready,
  confirm,
  sourceGrants,
}: {
  a: Affair
  ready: boolean
  confirm: () => void
  sourceGrants: number
}) {
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
        <dt>可用来源</dt>
        <dd>
          公开 GitHub 仓库：{plan.repos.join('、')}
          <br />
          本地参考目录：
          {sourceGrants ? '已授权 ' + sourceGrants + ' 个（仅供你浏览，暂不用于取证）' : '无'}
        </dd>
        {a.directory && (
          <>
            <dt>保存位置</dt>
            <dd className="own-path">{a.directory.path}</dd>
          </>
        )}
      </dl>
      {!a.confirmed && (
        <div className="own-card-actions">
          <button className="own-primary" disabled={!ready} onClick={confirm}>
            确认约定，开始
          </button>
          <small>也可以在右侧继续讨论修改；已写入 事务配置.md（待确认草案）</small>
        </div>
      )}
    </div>
  )
}

/** What Owner is working on right now: question, who, why, what came back. */
export function StepCard({ a, workerRun }: { a: Affair; workerRun?: string }) {
  const r = a.research!
  const d = r.decisions?.at(-1)
  if (!a.confirmed || !d || r.phase === 'done') return null
  const looking = d.workerFiles?.length
    ? d.workerFiles.map((f) => f.repo + ' · ' + f.path + '：' + f.purpose)
    : (d.requests?.map((q) => q.repo + (q.terms.length ? ' · 检索 ' + q.terms.join('、') : '')) ??
      [])
  const returned = d.workerReturned ? '已交回' : workerRun || d.workerRunId ? '执行中' : '尚未派出'
  return (
    <div className="own-card blue" data-owner-step>
      <h3>
        当前步骤 ·{' '}
        {d.kind === 'deliver' ? '写入交付物' : d.kind === 'more' ? '定向补查' : '首次取证'}
        <small>第 {r.decisions!.length} 次判断</small>
      </h3>
      <dl className="own-kv">
        <dt>负责</dt>
        <dd>
          {d.kind === 'deliver'
            ? 'Owner（写入并逐条核对引用）'
            : d.kind === 'more'
              ? '执行会话 A（续用：目标、权限、上下文都没变）'
              : '执行会话 A（首次委派）'}
        </dd>
        <dt>为什么</dt>
        <dd>{d.reason}</dd>
        {looking.length > 0 && (
          <>
            <dt>本轮查找</dt>
            <dd>
              {looking.map((l, i) => (
                <div key={i}>{short(l, 140)}</div>
              ))}
            </dd>
          </>
        )}
        {d.kind !== 'deliver' && (
          <>
            <dt>A 的进度</dt>
            <dd>
              {returned}
              {workerRun && <span data-owner-worker-run={workerRun} />}
              　· 已存证据 {r.docs.length} 份
            </dd>
          </>
        )}
      </dl>
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
        <dd>
          {r.report.items.length} / {r.report.items.length} 条引文与证据原文一致
        </dd>
        <dt>证据快照</dt>
        <dd>{r.docs.length} 份，保存在 资料/</dd>
        <dt>文件</dt>
        <dd>{saved ? '写入后已核验' : '报告已核对，尚未写入磁盘；请在上方重试保存文件'}</dd>
      </dl>
    </div>
  )
}

type Step = { state: 'ok' | 'now' | 'todo'; title: string; hint?: string }
export function Timeline({ a, active }: { a: Affair; active: boolean }) {
  const r = a.research!
  const steps: Step[] = [{ state: 'ok', title: '交办并建档', hint: a.directory?.path }]
  steps.push(
    !r.plan
      ? { state: active ? 'now' : 'todo', title: 'Owner 整理约定' }
      : !a.confirmed
        ? { state: 'now', title: '等你确认约定' }
        : { state: 'ok', title: '约定已确认', hint: '写入 事务配置.md' },
  )
  const decisions = r.decisions ?? []
  decisions.forEach((d, i) => {
    const last = i === decisions.length - 1
    const done = d.kind === 'deliver' ? r.phase === 'done' : !!d.workerReturned || !last
    steps.push({
      state: done ? 'ok' : 'now',
      title:
        d.kind === 'read'
          ? '派 A 首次取证'
          : d.kind === 'more'
            ? 'Owner 判断证据不足 → 续用 A 补查'
            : '写入交付物并逐条核对引用',
      hint: short(d.reason),
    })
  })
  if (a.confirmed && !decisions.some((d) => d.kind === 'deliver'))
    steps.push({ state: 'todo', title: '写入交付物并逐条核对引用' })
  if (r.phase === 'done')
    steps.push({
      state: a.directory?.error ? 'now' : 'ok',
      title: a.directory?.error ? '交付物待保存' : '已交付',
      hint: r.report ? r.report.items.length + ' 条引文已核对' : undefined,
    })
  return (
    <section>
      <h3>事务进度</h3>
      <ul className="own-tl">
        {steps.map((s, i) => (
          <li key={i} className={s.state}>
            <b>{s.title}</b>
            {s.hint && <small>{s.hint}</small>}
          </li>
        ))}
      </ul>
    </section>
  )
}
