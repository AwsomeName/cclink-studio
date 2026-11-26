import type { Affair } from './affair'
import { decisionWorker, isLocalKey, sourceLabel, workerLabel, workersOf } from './research-model'

/**
 * Read-only presentation of an affair as tiered authorization and steps. Everything here is
 * derived from the affair record; nothing grants permission or changes state.
 */
export type Tier = 'direct' | 'ask' | 'never'
export type Capability = { name: string; scope: string; tier: Tier; locked?: boolean }
export const TIER_LABEL: Record<Tier, string> = { direct: '直接做', ask: '先问我', never: '不做' }
export const TIER_HINT: Record<Tier, string> = {
  direct: '确认约定后，不再逐项问你',
  ask: '运行到这里在右侧问你；60 秒无回应就跳过这一步，其余继续',
  never: '这件事里不会做',
}

export function authorization(a: Affair): { caps: Capability[]; unused: string[] } {
  const plan = a.research?.plan
  const folders = plan?.folders ?? []
  const caps: Capability[] = [
    ...folders.map((f) => ({
      name: '读本地资料',
      scope: f.label + '（只读）',
      tier: 'direct' as const,
    })),
    ...(plan?.repos ?? []).map((repo) => ({
      name: '查公开资料',
      scope: 'GitHub ' + repo,
      tier: 'direct' as const,
    })),
    { name: '写事务目录', scope: '本事务目录', tier: 'direct', locked: true },
    { name: '读约定外的本地文件', scope: '逐个文件问你', tier: 'ask', locked: true },
  ]
  if (folders.length)
    caps.push({
      name: '修改本地资料',
      scope: folders.map((f) => f.label).join('、'),
      tier: 'never',
    })
  caps.push({ name: '对外发布或发送', scope: '任何内容', tier: 'never', locked: true })
  return { caps, unused: ['网站账号', '运行命令'] }
}

export const runtimeName = (kind?: string) =>
  kind === 'codex' ? 'Codex' : kind === 'claude-code' ? 'Claude Code' : kind ? kind : undefined

export type StepState = 'todo' | 'run' | 'wait' | 'skip' | 'done'
export type AffairStep = {
  key: string
  title: string
  who: 'Owner' | '执行' | 'Studio 核验'
  /** Work type used to pick a runtime. */
  kind: string
  runtime: string
  why: string
  sees: string[]
  can: string[]
  done: string
  out: string
  state: StepState
  required?: boolean
  note?: string
  /** Live run id of the step in progress, for diagnostics and smoke checks. */
  run?: string
}
export const STATE_LABEL: Record<StepState, string> = {
  todo: '待开始',
  run: '进行中',
  wait: '等你',
  skip: '已跳过',
  done: '完成',
}

const short = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s)
const AUTO = '派出时按 Owner 设置里检索取证的运行时顺序选择'

export function affairSteps(
  a: Affair,
  ctx: { ownerRuntime?: string; active: boolean; workerRun?: string },
): AffairStep[] {
  const r = a.research
  if (!r) return []
  const steps: AffairStep[] = []
  const folders = r.plan?.folders ?? []
  steps.push({
    key: 'owner',
    title: '写约定和计划',
    who: 'Owner',
    kind: '统筹',
    runtime:
      runtimeName(r.owner?.agent) ??
      ctx.ownerRuntime ??
      (a.confirmed ? '未记录' : '首次对话时选择'),
    why: r.owner?.why ?? '维护事务文件、拆解和判断',
    sees: ['你的原话', ...(folders.length || !r.plan ? ['已授权参考目录的名称'] : [])],
    can: ['写事务目录'],
    done: '你确认约定',
    out: '事务配置.md、调度.md',
    state: a.confirmed ? 'done' : r.plan ? 'wait' : ctx.active ? 'run' : 'todo',
  })
  const decisions = r.decisions ?? []
  const workers = workersOf(r)
  decisions.forEach((d, i) => {
    if (d.kind === 'deliver') return
    const last = i === decisions.length - 1
    const key = decisionWorker(d)
    const fileOnly = !d.requests?.length && !!d.localFiles?.length
    const w = workers.find((x) => x.key === key)
    const can = [
      ...new Set(
        (d.requests ?? []).map(
          (q) =>
            (isLocalKey(q.repo) ? '读本地资料 · ' : '查公开资料 · ') +
            sourceLabel(r.plan, q.repo, r.files),
        ),
      ),
    ]
    if (d.localFiles?.length) can.push('读约定外的本地文件 · 先问你')
    const live = last && ctx.active && !d.workerReturned
    steps.push({
      key: 'd' + i,
      title: fileOnly
        ? '读取本地文件：' + d.localFiles!.join('、')
        : '执行 ' + workerLabel(key) + '：' + short(d.ask ?? d.reason, 64),
      who: '执行',
      kind: '检索取证',
      runtime: fileOnly
        ? 'Studio 读取'
        : (runtimeName(w?.agent) ??
          (!last || d.workerRunId || d.workerReturned ? '未记录（旧事务）' : AUTO)),
      why: fileOnly
        ? '只读文件，不调用模型'
        : (w?.agentWhy ? w.agentWhy + '；' : '') +
          (d.workerChoice === 'continue'
            ? '续用 ' + workerLabel(key) + '，保留它已读过的上下文'
            : '新开 ' + workerLabel(key) + (w?.purpose ? '，负责' + w.purpose : '')),
      sees: fileOnly ? ['请求的文件路径'] : ['事务配置.md', '调度.md · 本步'],
      can: can.length ? can : ['无外部能力'],
      done: d.doneWhen ?? '交回带出处的结果，由 Owner 核对',
      out: '资料/',
      state:
        !last || d.workerReturned || (fileOnly && d.localFilesDone)
          ? 'done'
          : live
            ? 'run'
            : 'wait',
      note: d.verdict
        ? d.verdict.met
          ? 'Owner 已核对'
          : 'Owner 核对未通过：' + short(d.verdict.note, 50)
        : undefined,
      run: live ? (ctx.workerRun ?? d.workerRunId) : undefined,
    })
  })
  for (const k of r.skips ?? [])
    steps.push({
      key: 'k' + k.id,
      title: '读取 ' + k.path,
      who: '执行',
      kind: '检索取证',
      runtime: 'Studio 读取',
      why: '约定外的文件，需要你批准',
      sees: ['请求的文件路径'],
      can: ['读约定外的本地文件 · 先问你'],
      done: k.affects ? '读到：' + k.affects : '读到文件内容',
      out: '资料/',
      state: k.status === 'read' ? 'done' : k.status === 'granted' ? 'run' : 'skip',
      required: k.required,
      note:
        k.status === 'read'
          ? '你允许后只重跑了这一步'
          : k.status === 'declined'
            ? '你选择不需要，列为未完成项'
            : k.status === 'skipped'
              ? (k.why === 'timeout' ? '60 秒无回应' : '你拒绝了') + '，其余步骤继续'
              : undefined,
    })
  const delivering = decisions.some((d) => d.kind === 'deliver')
  steps.push({
    key: 'deliver',
    title: '核对引用并写入交付物',
    who: 'Studio 核验',
    kind: '核验',
    runtime: '—',
    why: 'Studio 按规则核对，不调用模型',
    sees: ['报告草稿', '资料/'],
    can: ['写事务目录'],
    done: '每条引用都能在资料快照里找到原文；必需步骤都已完成',
    out: a.directory?.reportFile ?? '交付物/',
    state:
      r.phase === 'done'
        ? a.directory?.error
          ? 'wait'
          : 'done'
        : r.phase === 'decide'
          ? 'wait'
          : delivering && ctx.active
            ? 'run'
            : 'todo',
  })
  return steps
}

/** Things only the user can settle, all of which are handled in the right-hand panel. */
export function pendingCount(a: Affair, ready: boolean, permissions: number, recovery = 0) {
  const r = a.research
  const skipped = (r?.skips ?? []).filter((k) => k.status === 'skipped').length
  return (ready ? 1 : 0) + permissions + skipped + recovery
}
