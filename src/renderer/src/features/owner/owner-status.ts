import { create } from 'zustand'
import type { OwnerPreferencesView } from '@shared/ipc/owner-preferences'
import { next, type Affair } from './affair'
import { decisionWorker, workerLabel, workersOf } from './research-model'

// List groups. Only the first three need the user; Owner working on its own never counts.
export const GROUPS = [
  { key: 'confirm', label: '等我确认', waits: true, states: ['等我确认'] },
  { key: 'material', label: '等我提供资料', waits: true, states: ['等我提供资料'] },
  {
    key: 'attention',
    label: '需要我处理',
    waits: true,
    states: ['待保存', '需要处理', '待恢复', '待你决定'],
  },
  {
    key: 'active',
    label: '进行中',
    waits: false,
    states: ['进行中', '待交办', '核对执行状态', '待整理'],
  },
  { key: 'done', label: '已交付', waits: false, states: ['已交付'] },
] as const
export type GroupKey = (typeof GROUPS)[number]['key']
export const groupOf = (a: Affair, active: boolean): GroupKey => {
  const state = next(a, active)[0]
  return GROUPS.find((g) => (g.states as readonly string[]).includes(state))?.key ?? 'active'
}
export const waitsForMe = (a: Affair, active: boolean) =>
  GROUPS.find((g) => g.key === groupOf(a, active))!.waits

const workerRuns = (a: Affair) => a.research?.decisions?.filter((d) => d.workerRunId) ?? []
/** The execution session of the latest dispatch; 'a' for legacy single-session records. */
export const currentWorker = (a: Affair) => {
  const d = a.research?.decisions?.filter((x) => x.kind !== 'deliver').at(-1)
  return d ? decisionWorker(d) : 'a'
}

/** Second line of a list row: what Owner is doing, or what was delivered. */
export function rowMeta(a: Affair, active: boolean): string {
  const r = a.research
  if (!r) return a.result ? a.sources.length + ' 份材料已摘录' : '资料摘录事务'
  if (r.phase === 'done' && a.directory?.reportFile)
    return a.directory.reportFile + ' · ' + (r.report?.items.length ?? 0) + ' 条引文已核对'
  const runs = workerRuns(a).length
  if (!a.confirmed) return r.plan ? '确认后 Owner 才会派工' : 'Owner 正在整理约定'
  const sessions = workersOf(r).length
  if (groupOf(a, active) !== 'active')
    return runs
      ? (sessions > 1 ? sessions + ' 个执行会话' : '执行会话') + '已运行 ' + runs + ' 次'
      : ''
  return runs
    ? '执行会话 ' + workerLabel(currentWorker(a)) + ' · 共 ' + runs + ' 次运行'
    : '尚未派工'
}

type Research = NonNullable<Affair['research']>
export type SessionTone = 'run' | 'warn' | 'q' | 'ok'
/**
 * One execution session's row in the sessions card. "核对" is Owner checking the session's
 * hand-back; it never means the user still has to accept something. A returned run without a
 * recorded check is resolved by Owner's later decision: delivering on it, or moving on.
 */
export function sessionStatus(
  r: Research,
  key: string,
  running: boolean,
): { text: string; tone: SessionTone } {
  const decisions = r.decisions ?? []
  const mine = decisions.filter((d) => d.kind !== 'deliver' && decisionWorker(d) === key)
  const runs = mine.filter((d) => d.workerRunId).length
  const last = mine.filter((d) => d.workerRunId).at(-1)
  const newest = mine.at(-1)
  if (running) return { text: '第 ' + Math.max(runs, 1) + ' 次运行 · 运行中', tone: 'run' }
  if (newest && !newest.workerRunId && newest.collectionClosed)
    return { text: '最近一轮未派出（检索失败）', tone: 'warn' }
  if (!last) return { text: '尚未运行', tone: 'q' }
  if (last.verdict)
    return last.verdict.met
      ? { text: 'Owner 已核对 · ' + runs + ' 次运行', tone: 'ok' }
      : { text: 'Owner 核对未通过 · 待补查', tone: 'warn' }
  if (!last.workerReturned) return { text: runs + ' 次运行 · 未交回', tone: 'q' }
  const later = decisions.slice(decisions.indexOf(last) + 1)
  if (later.some((d) => d.kind === 'deliver'))
    return { text: '已交回 · Owner 已据此交付', tone: 'ok' }
  if (later.length) return { text: '已交回 · 未记录核对结论', tone: 'q' }
  return { text: '已交回 · 待 Owner 核对', tone: 'run' }
}

export function relativeTime(at: number) {
  const s = Math.max(0, (Date.now() - at) / 1000)
  if (s < 60) return '刚刚'
  if (s < 3600) return Math.floor(s / 60) + ' 分钟前'
  if (s < 86400) return Math.floor(s / 3600) + ' 小时前'
  const d = new Date(at)
  return d.getMonth() + 1 + '/' + d.getDate()
}

/** The three separate states: the affair, Owner's current action, and the worker's real run. */
export function statusChips(a: Affair, active: boolean, workerLoading: boolean) {
  const r = a.research!
  const [state] = next(a, active)
  const tone =
    groupOf(a, active) === 'done'
      ? 'green'
      : GROUPS.find((g) => g.key === groupOf(a, active))!.waits
        ? 'amber'
        : 'blue'
  const last = r.decisions?.at(-1)
  const owner = a.directory?.error
    ? '等待重试保存'
    : !active && ['planning', 'reading', 'writing', 'checking'].includes(r.phase)
      ? '已停下，等你继续'
      : (
          {
            draft: '整理约定',
            planning: '整理约定',
            ready: '等你确认约定',
            reading:
              last?.workerRunId && !last.workerReturned
                ? '等 ' + workerLabel(decisionWorker(last)) + ' 交回'
                : '派工',
            checking: last ? '核对证据' : '准备派工',
            writing: '写入交付物',
            decide: '等你决定跳过的步骤',
            done: '无后续派工',
            error: '已停下',
          } as const
        )[r.phase]
  const key = currentWorker(a)
  const runs = workerRuns(a).filter((d) => decisionWorker(d) === key)
  const lastRun = runs.at(-1)
  const sessions = workersOf(r).length
  const prefix = sessions ? workerLabel(key) + ' · ' : ''
  const worker = workerLoading
    ? prefix + '第 ' + Math.max(runs.length, 1) + ' 次运行 · 运行中'
    : !runs.length
      ? sessions
        ? prefix + '尚未运行'
        : '尚未派工'
      : prefix +
        '第 ' +
        runs.length +
        ' 次运行 · ' +
        (lastRun?.workerReturned ? '已完成' : lastRun?.collectionClosed ? '已结束' : '未交回')
  return { state, tone, owner, worker }
}

type PrefsState = {
  prefs: OwnerPreferencesView | null
  error: string
  load: () => Promise<void>
  set: (p: OwnerPreferencesView) => void
}
export const useOwnerPrefs = create<PrefsState>((set) => ({
  prefs: null,
  error: '',
  set: (prefs) => set({ prefs, error: '' }),
  load: async () => {
    try {
      set({ prefs: await window.cclinkStudio.ownerPreferences.get(), error: '' })
    } catch (e) {
      set({ error: String(e) })
    }
  },
}))
