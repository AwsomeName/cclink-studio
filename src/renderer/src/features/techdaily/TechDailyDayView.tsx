import { useCallback, useEffect, useState } from 'react'
import type { WorkspaceRef } from '@shared/workspace-ref'
import {
  TECHDAILY_PROVIDER_LABELS,
  type TechDailyRun,
  type TechDailyStatus,
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

const STATE_MARK: Record<TechDailyRun['steps'][number]['state'], string> = {
  pending: '○',
  running: '◐',
  done: '✓',
  failed: '✗',
  skipped: '–',
}
const RUN_STATUS: Record<TechDailyRun['status'], string> = {
  running: '正在生成',
  completed: '已生成',
  empty: '候选不足，只写了短报',
  failed: '生成失败',
  interrupted: 'Studio 退出，生成中断',
  stopped: '已停止',
}

/** Real step states from TechDailyService; nothing here is inferred from time. */
export function TechDailySteps({ run }: { run: TechDailyRun }): React.ReactElement {
  return (
    <section className="techdaily-steps" aria-label="执行详情">
      <header>
        <strong>执行详情</strong>
        <span className={`techdaily-run-status ${run.status}`}>{RUN_STATUS[run.status]}</span>
        <small>
          run {run.runId} · {time(run.startedAt)} 开始
          {run.endedAt ? ` · 用时 ${seconds(run.startedAt, run.endedAt)}` : ''}
        </small>
      </header>
      <ol>
        {run.steps.map((step, index) => (
          <li
            key={step.id}
            className={`techdaily-step ${step.state}`}
            aria-label={`第 ${index + 1} 步 ${step.label}`}
          >
            <span className="techdaily-step-mark" aria-hidden>
              {STATE_MARK[step.state]}
            </span>
            <span className="techdaily-step-body">
              <span className="techdaily-step-title">
                {index + 1}. {step.label}
                <small>{step.actor}</small>
                {step.endedAt && step.startedAt && (
                  <small>{seconds(step.startedAt, step.endedAt)}</small>
                )}
              </span>
              {step.detail && <small className="techdaily-step-detail">{step.detail}</small>}
            </span>
          </li>
        ))}
      </ol>
      {run.error && run.status !== 'completed' && <p role="alert">{run.error}</p>}
    </section>
  )
}

/**
 * 科技日报 page in My Space: the calendar picks a day; a day with a report opens its Markdown
 * in the same editor as diaries (docs/design/techdaily-2026-11-25/v2, view B).
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
  const [showSteps, setShowSteps] = useState(false)
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
    setShowSteps(false)
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
      setShowSteps(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setStarting(false)
    }
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
  const runbar = (
    <span className="techdaily-runbar">
      {run && (
        <small className={`techdaily-run-status ${run.status}`}>
          {run.status === 'completed' ? `${time(run.endedAt)} 生成` : RUN_STATUS[run.status]}
        </small>
      )}
      {run && (
        <button type="button" aria-pressed={showSteps} onClick={() => setShowSteps((v) => !v)}>
          执行详情
        </button>
      )}
      {selected === today && report && (
        <button type="button" disabled={!canGenerate} onClick={() => void generate(true)}>
          重新生成
        </button>
      )}
    </span>
  )

  const providerHint =
    status && providerState && !providerState.ready ? (
      <p className="techdaily-hint-line">
        {TECHDAILY_PROVIDER_LABELS[status.provider]}不可用：{providerState.reason}{' '}
        <button type="button" onClick={openSettings}>
          去项目设置
        </button>
      </p>
    ) : null

  return (
    <div className="diary-today techdaily-day">
      <article className="diary-today-entry" aria-label="当天科技日报">
        {report && !running ? (
          <>
            {showSteps && run && <TechDailySteps run={run} />}
            <div className="diary-today-editor">
              <MarkdownEditor
                key={`${report}:${revision}`}
                filePath={report}
                tabId={'techdaily:' + report}
                compact
                toolbarLead={nav}
                toolbarExtra={runbar}
              />
            </div>
          </>
        ) : (
          <div className="diary-day-empty techdaily-empty">
            <div className="diary-day-empty-bar">
              {nav}
              {runbar}
            </div>
            {running && run ? (
              <TechDailySteps run={run} />
            ) : selected === today ? (
              <div className="techdaily-empty-card">
                <h3>今天的科技日报还没生成</h3>
                <p className="muted">
                  按设置里的 {status ? '词表' : ''}搜索 → 过滤去重 → 本机 AI 精选成稿，结果写入
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
                {run && <TechDailySteps run={run} />}
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
                {run && <TechDailySteps run={run} />}
              </div>
            )}
            {error && <p role="alert">{error}</p>}
          </div>
        )}
      </article>
    </div>
  )
}
