import { useCallback, useEffect, useState } from 'react'
import type { WorkspaceRef } from '@shared/workspace-ref'
import {
  TECHDAILY_PROVIDER_LABELS,
  type TechDailyRun,
  type TechDailyStatus,
  type TechDailyStepId,
} from '@shared/techdaily/techdaily-types'
import { MarkdownEditor } from '../../components/workbench/MarkdownEditor'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { showWorkspaceHome } from '../workspace-open/workspace-home-navigation'
import { useTechDailyCalendar } from './techdaily-calendar-store'
import './techdaily-day.css'

const short = (date: string): string => `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`
const monthDay = (date: string): string =>
  `${Number(date.slice(5, 7))} 月 ${Number(date.slice(8))} 日`
const time = (iso?: string): string =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
const seconds = (from?: string, to?: string): string =>
  from && to ? `${Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 1000))} 秒` : ''

type Step = TechDailyRun['steps'][number]
const STATE_MARK: Record<Step['state'], string> = {
  pending: '○',
  running: '◐',
  done: '✓',
  failed: '✗',
  skipped: '–',
}
const STATE_TEXT: Record<Step['state'], string> = {
  pending: '未开始',
  running: '进行中',
  done: '完成',
  failed: '失败',
  skipped: '跳过',
}
const SHORT: Record<TechDailyStepId, string> = {
  check: '检查',
  read: '设置',
  search: '搜索',
  frontier: '前沿',
  merge: '入库',
  candidates: '候选',
  select: '精选',
  render: '成稿',
  leaderboard: '榜单',
  save: '保存',
}
const RUN_STATUS: Record<TechDailyRun['status'], string> = {
  running: '正在生成',
  completed: '已生成',
  empty: '候选不足，只写了短报',
  failed: '生成失败',
  interrupted: 'Studio 退出，生成中断',
  stopped: '已停止',
}

/**
 * One line under the report: run status, the 10 steps as chips (scrolls sideways), the
 * chosen step's detail and the run action. States come only from TechDailyService.
 */
export function TechDailyRunLine({
  run,
  idle,
  action,
}: {
  run: TechDailyRun | null
  /** Shown when there is no run for the day. */
  idle: string
  action?: React.ReactNode
}): React.ReactElement {
  const [chosen, setChosen] = useState<TechDailyStepId | null>(null)
  const runId = run?.runId
  useEffect(() => setChosen(null), [runId])
  const focus =
    run?.steps.find((s) => s.id === chosen) ??
    run?.steps.find((s) => s.state === 'running') ??
    run?.steps.find((s) => s.state === 'failed')
  const summary = run
    ? [
        `${time(run.startedAt)} 开始`,
        run.endedAt ? `用时 ${seconds(run.startedAt, run.endedAt)}` : '',
        run.itemCount ? `${run.itemCount} 条` : '',
        run.error && run.status !== 'completed' ? run.error : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : idle
  const detail = focus
    ? `${focus.label}（${focus.actor}，${STATE_TEXT[focus.state]}）${focus.detail ? '：' + focus.detail : ''}`
    : summary
  return (
    <div className="techdaily-runline" role="group" aria-label="执行详情">
      {run && (
        <span className={`techdaily-run-status ${run.status}`} title={`run ${run.runId}`}>
          {RUN_STATUS[run.status]}
        </span>
      )}
      {run && (
        <ol className="techdaily-chips">
          {run.steps.map((step, index) => (
            <li key={step.id}>
              <button
                type="button"
                className={`techdaily-chip ${step.state}`}
                aria-label={`第 ${index + 1} 步 ${step.label}`}
                aria-pressed={focus?.id === step.id}
                title={`${index + 1}. ${step.label} · ${step.actor} · ${STATE_TEXT[step.state]}${
                  step.startedAt && step.endedAt
                    ? ' · ' + seconds(step.startedAt, step.endedAt)
                    : ''
                }${step.detail ? '\n' + step.detail : ''}`}
                onClick={() => setChosen((c) => (c === step.id ? null : step.id))}
              >
                <span aria-hidden>{STATE_MARK[step.state]}</span>
                {SHORT[step.id]}
              </button>
            </li>
          ))}
        </ol>
      )}
      <span className="techdaily-runline-detail" title={detail}>
        {detail}
      </span>
      {action && <span className="techdaily-runline-actions">{action}</span>}
    </div>
  )
}

/**
 * 科技日报 page in My Space: the calendar picks a day; a day with a report opens its Markdown
 * in the same editor as diaries (docs/design/techdaily-2026-11-25/v2, view B). The report is
 * the page; the run is one line at the bottom.
 */
export function TechDailyDayView({
  workspaceRef,
}: {
  workspaceRef: Extract<WorkspaceRef, { kind: 'local' }>
}): React.ReactElement {
  const workspacePath = workspaceRef.path
  const { days, selected, today, select, load, refresh, revision } = useTechDailyCalendar()
  const [run, setRun] = useState<TechDailyRun | null>(null)
  const [status, setStatus] = useState<TechDailyStatus | null>(null)
  const [error, setError] = useState('')
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    void load(workspacePath)
  }, [load, workspacePath])

  const readRun = useCallback(async () => {
    if (!selected) return null
    const result = await window.cclinkStudio.techDaily.getRun({ workspacePath, day: selected })
    const next = result.success ? result.data : null
    setRun(next)
    return next
  }, [selected, workspacePath])

  useEffect(() => {
    setError('')
    void readRun()
    void window.cclinkStudio.techDaily.getStatus({ workspacePath }).then((r) => {
      if (r.success) setStatus(r.data)
    })
  }, [readRun, workspacePath])

  // Follow a running run; the page shows only what the service reports.
  const running = run?.status === 'running'
  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => {
      void readRun().then((next) => {
        if (next && next.status !== 'running') void refresh()
      })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [running, readRun, refresh])

  const report = days[selected]
  const dated = Object.keys(days).sort()
  const previous = [...dated].reverse().find((d) => d < selected)
  const next = dated.find((d) => d > selected)
  const provider = status?.provider
  const providerState = provider ? status?.providers[provider] : undefined
  const canGenerate = selected === today && !!providerState?.ready && !running && !starting

  const generate = async (overwrite: boolean) => {
    if (
      overwrite &&
      !window.confirm('重新生成会覆盖今天的日报文件（你在里面的修改也会被覆盖）。继续？')
    )
      return
    setStarting(true)
    setError('')
    try {
      const result = await window.cclinkStudio.techDaily.generate({ workspacePath, overwrite })
      if (!result.success) throw new Error(result.error)
      setRun(result.data)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setStarting(false)
    }
  }
  const stop = async () => {
    const result = await window.cclinkStudio.techDaily.stop({ workspacePath })
    if (!result.success) setError(result.error)
  }

  const openSettings = () =>
    showWorkspaceHome(useWorkspaceStore.getState().activeWorkspaceRef, 'user', 'workspace')

  const nav = (
    <span className="diary-day-nav" aria-label="切换日期">
      <button
        type="button"
        disabled={!previous}
        aria-label="上一份"
        onClick={() => previous && select(previous)}
      >
        ‹ {previous ? short(previous) : ''}
      </button>
      <b>{report ? report.split('/').pop() : `${short(selected)} 科技日报`}</b>
      <button
        type="button"
        disabled={!next}
        aria-label="下一份"
        onClick={() => next && select(next)}
      >
        {next ? short(next) : ''} ›
      </button>
    </span>
  )

  const action = running ? (
    <button type="button" onClick={() => void stop()}>
      停止
    </button>
  ) : selected === today && report ? (
    <button type="button" disabled={!canGenerate} onClick={() => void generate(true)}>
      重新生成
    </button>
  ) : null

  const providerHint =
    status && providerState && !providerState.ready ? (
      <p className="techdaily-hint-line">
        {TECHDAILY_PROVIDER_LABELS[status.provider]}不可用：{providerState.reason}{' '}
        <button type="button" onClick={openSettings}>
          去项目设置
        </button>
      </p>
    ) : null

  const idle =
    selected === today
      ? report
        ? '这份日报不是在这台电脑生成的'
        : '今天还没生成'
      : report
        ? '这份日报没有本机生成记录'
        : '那天没有生成'

  return (
    <div className="diary-today techdaily-day">
      <article className="diary-today-entry" aria-label="当天科技日报">
        {report ? (
          <div className="diary-today-editor">
            <MarkdownEditor
              key={`${report}:${revision}`}
              filePath={report}
              tabId={'techdaily:' + report}
              compact
              toolbarLead={nav}
            />
          </div>
        ) : (
          <div className="diary-day-empty techdaily-empty">
            <div className="diary-day-empty-bar">{nav}</div>
            {running ? (
              <div className="techdaily-empty-card">
                <h3>正在生成今天的科技日报</h3>
                <p className="muted">每一步的进度在下方执行条里，点步骤可看详情。</p>
              </div>
            ) : selected === today ? (
              <div className="techdaily-empty-card">
                <h3>今天的科技日报还没生成</h3>
                <p className="muted">
                  按设置里的词表搜索 → 过滤去重 → 本机 AI 精选成稿 → 更新模型能力榜，结果写入
                  <code>
                    {' '}
                    科技日报/{today.slice(0, 4)}/{today.slice(5, 7)}/{today.slice(5, 7)}
                    {today.slice(8)}.md
                  </code>
                  。
                </p>
                {providerHint}
                <div className="workspace-form-actions">
                  <button
                    type="button"
                    className="techdaily-primary"
                    disabled={!canGenerate}
                    onClick={() => void generate(false)}
                  >
                    {starting ? '正在开始…' : '生成今天的日报'}
                  </button>
                  <button type="button" onClick={openSettings}>
                    科技日报设置
                  </button>
                </div>
              </div>
            ) : (
              <div className="techdaily-empty-card">
                <h3>{monthDay(selected)}没有科技日报</h3>
                <p className="muted">
                  {run
                    ? `那天的生成${RUN_STATUS[run.status]}${run.error ? `：${run.error}` : ''}。`
                    : '那天没有生成。'}
                  过去的日子不补生成。
                </p>
              </div>
            )}
          </div>
        )}
        {error && (
          <p className="techdaily-error" role="alert">
            {error}
          </p>
        )}
        <TechDailyRunLine run={run} idle={idle} action={action} />
      </article>
    </div>
  )
}
