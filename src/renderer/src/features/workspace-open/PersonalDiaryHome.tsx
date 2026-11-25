import { DiaryPlans } from './DiaryPlans'
import { DiarySetupWizard } from './DiarySetupWizard'
import { DiarySyncPage, useDiarySyncRevision } from './DiarySyncStatus'
import { DiaryDayView, DiaryFilePicker } from './DiaryDayView'
import { FoldedTabCreateActions } from '../../components/workbench/TabBar'
import { useDiaryCalendar } from './diary-calendar-store'
import { DiaryTasksView } from './DiaryTasksView'
import { TechDailyDayView } from '../techdaily/TechDailyDayView'
import { DiaryLedgerView } from './DiaryLedgerView'
import { financeLedger, healthLedger } from './diary-ledger'
import { useFixedSpacesStore } from './fixed-spaces-store'
import { DiaryImportPage } from './DiaryImport'
import { ConversationMarkdown } from '../../components/common/ConversationMarkdown'
import { useDiaryNavigation } from './personal-diary-navigation'
import { useEffect, useRef, useState } from 'react'
import {
  defaultDiaryDirectory,
  defaultDiaryTimezone,
  diaryDateParts,
  diaryDayLocation,
  type DiaryDocument,
  type PersonalDiarySource,
} from '@shared/personal-diary-source'
import type { FsDirEntry } from '@shared/ipc/fs'
import type { ScheduledTaskSnapshot } from '@shared/scheduled-task/scheduled-task-types'
import { useTabStore } from '../../stores/tab-store'
import { MarkdownEditor } from '../../components/workbench/MarkdownEditor'
import { useCommandStore } from '../../stores/command-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { createScheduledTaskTab } from '../scheduled-tasks/scheduled-task-view-model'
import {
  defaultBuiltInChoice,
  ensureBuiltInDiaryTasks,
  findDailyDraft,
} from './diary-builtin-tasks'

type DiaryEntry = FsDirEntry & { year: string; month: string; day: string; rel: string }

/** Section headings with their first paragraph: a compact view of a day's entry. */
export function summarizeDiary(content: string): Array<{ title: string; text: string }> {
  const parts: Array<{ title: string; text: string }> = []
  let current: { title: string; text: string } | null = null
  for (const line of content.split('\n')) {
    const heading = /^##\s+(.+)$/.exec(line)
    if (heading) {
      current = { title: heading[1].trim(), text: '' }
      parts.push(current)
    } else if (current && !current.text && line.trim() && !/^\|?\s*-{3}/.test(line))
      current.text = line.trim().startsWith('|')
        ? '（表格）'
        : line.replace(/^[-*]\s+(\[[ x]\]\s+)?/, '').trim()
  }
  return parts.slice(0, 5).map((part) => ({ ...part, text: part.text.slice(0, 120) }))
}

/** Places a diary file in its month; merged month folders use the date in the file name. */
export function classifyDiary(rel: string): { year: string; month: string; day: string } | null {
  const match = /^(\d{4})\/(\d{2})(?:-\d{2})?\/(\d{2})(\d{2})[_-]/.exec(rel)
  return match ? { year: match[1], month: match[3], day: match[4] } : null
}

/** Next run in the task's own timezone, labelled when it differs from this computer. */
function formatNextInZone(value: number | null, timezone: string): string {
  if (value === null) return '未安排'
  const text = new Intl.DateTimeFormat('zh-CN', {
    timeZone: timezone,
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value))
  return timezone === Intl.DateTimeFormat().resolvedOptions().timeZone
    ? text
    : `${text}（${timezone}）`
}

export function PersonalDiaryHome(): React.ReactElement {
  const ownerRef = useWorkspaceStore((state) => state.activeWorkspaceRef)
  const ownerPath = ownerRef.kind === 'local' ? ownerRef.path : null
  const config = useWorkspaceStore((state) => state.settingsSnapshot)
  const fixedPath = useFixedSpacesStore((state) => state.spaces?.personal?.workspacePath)
  const [source, setSource] = useState<PersonalDiarySource | null>(null)
  const [files, setFiles] = useState<{
    diaries: DiaryEntry[]
    others: FsDirEntry[]
  }>({
    diaries: [],
    others: [],
  })
  const [tasks, setTasks] = useState<ScheduledTaskSnapshot[]>([])
  const [error, setError] = useState('')
  const { page, setPage } = useDiaryNavigation()
  const [preview, setPreview] = useState<DiaryDocument | null>(null)
  const [previewPath, setPreviewPath] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(true)
  const syncedAt = useDiarySyncRevision(ownerPath)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (syncedAt) setRevision((r) => r + 1)
  }, [syncedAt])
  const [clock, setClock] = useState(() => Date.now())
  const [aiProblem, setAiProblem] = useState('')
  useEffect(() => {
    void window.cclinkStudio.agent
      .getCapabilities()
      .then((items) => {
        const backend = items.find((item) => item.name === 'agent-backend')
        setAiProblem(backend && backend.state !== 'ready' ? backend.reason || backend.state : '')
      })
      .catch(() => {})
  }, [revision])
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    // Import, sync, 财务 and 健康 are My Space pages; other diary projects return to 今天.
    if (['导入历史', 'Git', '财务', '健康', '科技日报'].includes(page) && ownerPath !== fixedPath)
      setPage('今天')
  }, [page, setPage, ownerPath, fixedPath])
  useEffect(() => {
    let alive = true
    setBusy(true)
    // Wait for this project's settings: a missing or stale snapshot must not look "unset".
    if (ownerPath && config?.workspacePath !== ownerPath) return
    void (async () => {
      // A diary project's files are always in its own folder, under its configured directory.
      const items = await window.cclinkStudio.workspaceState.listLocalWorkspaces()
      const root = items.find((item) => item.workspacePath === ownerPath)
      const link: PersonalDiarySource | null =
        ownerPath &&
        root?.projectId &&
        (config?.settings.diary ||
          ownerPath !== useFixedSpacesStore.getState().spaces?.personal?.workspacePath)
          ? {
              version: 1,
              workspacePath: ownerPath,
              projectId: root.projectId,
              directory: config?.settings.diary?.directory ?? defaultDiaryDirectory,
              timezone: config?.settings.diary?.timezone ?? defaultDiaryTimezone,
              taskIds: [],
            }
          : null
      if (!alive) return
      setSource(link)
    })()
      .catch((e) => {
        if (alive) setError(String(e))
      })
      .finally(() => {
        if (alive) setBusy(false)
      })
    return () => {
      alive = false
    }
  }, [ownerPath, config?.revision, config?.workspacePath])
  useEffect(() => {
    if (!source) return
    let alive = true
    setError('')
    setBusy(true)
    void (async () => {
      await window.cclinkStudio.workspaceState.verifyLocalIdentity(
        source.workspacePath,
        source.projectId,
      )
      const diaries: DiaryEntry[] = []
      const others: FsDirEntry[] = []
      const root = source.workspacePath + '/' + source.directory
      let visited = 0
      const walk = async (dir: string, section: 'root' | 'year' | 'month'): Promise<void> => {
        if (++visited > 200) throw new Error('目录过多，请在项目设置中指定更具体的日记目录')
        const entries = await window.cclinkStudio.fs.readDir(dir).catch((e) => {
          if (section === 'root') throw e
          return []
        })
        for (const entry of entries) {
          if (entry.symbolicLink) continue
          if (entry.type === 'directory') {
            if (section === 'root' && /^\d{4}$/.test(entry.name)) await walk(entry.path, 'year')
            if (section === 'year' && /^(0[1-9]|1[0-2])(-(0[1-9]|1[0-2]))?$/.test(entry.name))
              await walk(entry.path, 'month')
          } else if (entry.type === 'file' && entry.name.toLowerCase().endsWith('.md')) {
            if (section === 'month') {
              const rel = entry.path.slice(root.length + 1)
              const date = classifyDiary(rel)
              if (date) diaries.push({ ...entry, ...date, rel })
              else others.push(entry)
            }
          }
          if (diaries.length + others.length > 5000) throw new Error('资料超过 5000 份')
        }
      }
      await walk(root, 'root')
      const byPath = (a: FsDirEntry, b: FsDirEntry): number => b.path.localeCompare(a.path)
      const result = await window.cclinkStudio.scheduledTasks.list(source.workspacePath)
      if (!alive) return
      setFiles({ diaries: diaries.sort(byPath), others })
      if (!result.success) throw new Error(result.error?.message || '任务读取失败')
      setTasks(result.tasks)
    })()
      .catch((e) => {
        if (alive) setError(String(e))
      })
      .finally(() => {
        if (alive) setBusy(false)
      })
    return () => {
      alive = false
    }
  }, [source, revision])
  useEffect(
    () =>
      window.cclinkStudio.scheduledTasks.onChanged((changed) => {
        if (changed === source?.workspacePath) setRevision((value) => value + 1)
      }),
    [source?.workspacePath],
  )
  const act = (action: () => Promise<void>): void => {
    setError('')
    setNotice('')
    setBusy(true)
    void action()
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false))
  }
  const openFile = (file: Pick<FsDirEntry, 'path' | 'name'>): void => {
    if (!source) return
    useTabStore.getState().openTab({
      type: 'editor',
      title: file.name,
      filePath: file.path,
      workspaceRef: { kind: 'local', path: source.workspacePath },
      icon: '📄',
    })
  }
  const openTask = (task: ScheduledTaskSnapshot): void => {
    if (source) useTabStore.getState().openTab(createScheduledTaskTab(source.workspacePath, task))
  }
  const timezone = source?.timezone ?? defaultDiaryTimezone
  const day = diaryDateParts(timezone, new Date(clock))
  const location = diaryDayLocation(day)
  const today = files.diaries.filter(
    (file) =>
      source &&
      location.matchesName(file.name) &&
      file.path === [source.workspacePath, source.directory, location.folder, file.name].join('/'),
  )
  const [todayPick, setTodayPick] = useState('')
  const todayFile = today.find((file) => file.path === todayPick) ?? today[0]
  const dayKey = (value: number): string => {
    const parts = diaryDateParts(timezone, new Date(value))
    return `${parts.year}${parts.month}${parts.day}`
  }
  const todayKey = `${day.year}${day.month}${day.day}`
  // Feed the sidebar calendar: dated diary files by day, plus today in the project timezone.
  useEffect(() => {
    const byDay: Record<string, Array<{ path: string; name: string }>> = {}
    for (const file of files.diaries)
      (byDay[`${file.year}-${file.month}-${file.day}`] ??= []).push({
        path: file.path,
        name: file.name,
      })
    // The standard MMDD_周X name first; alternates (e.g. MMDD-周X) follow.
    for (const entries of Object.values(byDay))
      entries.sort(
        (a, b) =>
          Number(/^\d{4}-/.test(a.name)) - Number(/^\d{4}-/.test(b.name)) ||
          a.name.localeCompare(b.name),
      )
    useDiaryCalendar.getState().publish(byDay, `${day.year}-${day.month}-${day.day}`)
  }, [files.diaries, day.year, day.month, day.day])
  const daily = findDailyDraft(tasks)
  const dailyRun =
    daily?.latestRun &&
    dayKey(daily.latestRun.scheduledFor ?? daily.latestRun.createdAt) === todayKey
      ? daily.latestRun
      : undefined
  const selectedPreview = page === '今天' ? '' : previewPath
  useEffect(() => {
    setPreviewPath('')
  }, [page, todayKey])
  useEffect(() => {
    let alive = true
    setPreview(null)
    if (source && selectedPreview)
      void window.cclinkStudio.workspaceState
        .diaryDocument({
          action: 'read',
          workspacePath: ownerPath ?? undefined,
          path: selectedPreview.slice(source.workspacePath.length + 1),
        })
        .then((result) => {
          if (alive) setPreview(result)
        })
        .catch((e) => {
          if (alive) setError(String(e))
        })
    return () => {
      alive = false
    }
  }, [source, selectedPreview, revision, ownerPath])
  const prepareBlank = async (): Promise<void> => {
    const result = await window.cclinkStudio.workspaceState.diaryDocument({
      action: 'prepare',
      workspacePath: ownerPath ?? undefined,
    })
    setPreviewPath(result.path)
    setPreview(result)
    setRevision((value) => value + 1)
    setNotice(
      result.created ? '已新建空白日记（未经 AI 起草）。' : '今天已有日记，继续使用原文件。',
    )
  }
  const draftNow = async (): Promise<void> => {
    if (!source || !daily) return
    const result = await window.cclinkStudio.scheduledTasks.runNow({
      workspacePath: source.workspacePath,
      taskId: daily.definition.id,
    })
    if (!result.success) throw Error(result.error?.message || '起草未能开始')
    setRevision((value) => value + 1)
  }
  // My Space always has the daily draft task: create the built-ins once if they are missing.
  const builtInsChecked = useRef(false)
  useEffect(() => {
    if (busy || !source || page !== '今天' || ownerPath !== fixedPath) return
    if (builtInsChecked.current || daily) return
    builtInsChecked.current = true
    const key = `cclink.diary.builtins.${source.projectId}`
    try {
      if (window.localStorage.getItem(key)) return
      window.localStorage.setItem(key, '1')
    } catch {
      /* storage unavailable: still create once per mount */
    }
    act(createBuiltIns)
  }, [busy, source, page, ownerPath, fixedPath, daily])
  // Today's draft did not happen (missed or failed): the first visit today starts it once.
  // Entering 今天 always ends in today's file: with no file yet, draft it now (any time of
  // day, not only after the scheduled time); without AI or a draft task, create it from the
  // blank template. A draft that is running is awaited; one the user cancelled falls back
  // to the blank template instead of starting again.
  const autoDraftKey = useRef('')
  const [autoTried, setAutoTried] = useState('')
  // The "drafting started" note is stale once today's file is open.
  const hasToday = today.length > 0
  useEffect(() => {
    if (hasToday) setNotice('')
  }, [hasToday])
  useEffect(() => {
    if (busy || !source || page !== '今天' || today.length) return
    if (dailyRun && ['queued', 'running'].includes(dailyRun.status)) return
    // My Space creates its built-in tasks first; wait for them.
    if (!daily && ownerPath === fixedPath) return
    const key = `cclink.diary.autoDraft.${source.projectId}.${todayKey}`
    if (autoDraftKey.current === key) return
    autoDraftKey.current = key
    setAutoTried(key)
    const canDraft =
      daily &&
      daily.activation.enabled &&
      !aiProblem &&
      (!dailyRun || ['failed', 'interrupted', 'missed'].includes(dailyRun.status))
    let drafted = false
    try {
      drafted = Boolean(window.localStorage.getItem(key))
      window.localStorage.setItem(key, '1')
    } catch {
      /* storage unavailable: once per mount */
    }
    act(async () => {
      if (canDraft && !drafted) {
        await draftNow()
        setNotice('今天还没有日记，已开始起草，写好后直接打开。')
      } else await prepareBlank()
    })
  }, [busy, source, page, today.length, daily, dailyRun, aiProblem, todayKey, ownerPath, fixedPath])
  const cancelDraft = async (): Promise<void> => {
    if (!source || !dailyRun) return
    await window.cclinkStudio.scheduledTasks.cancelRun({
      workspacePath: source.workspacePath,
      runId: dailyRun.id,
    })
    setRevision((value) => value + 1)
  }
  const createBuiltIns = async (): Promise<void> => {
    if (!source) return
    await ensureBuiltInDiaryTasks(
      source.workspacePath,
      source.directory,
      source.timezone,
      defaultBuiltInChoice,
    )
    setRevision((value) => value + 1)
  }
  if (!source && !busy && !error && ownerPath && ownerPath === fixedPath)
    return <DiarySetupWizard />

  const draftRunning = dailyRun && ['queued', 'running'].includes(dailyRun.status)
  // Status and actions sit in the home header row (mockup 24), not in a card.
  const draftLabel =
    dailyRun?.status === 'completed' &&
    todayFile &&
    dailyRun.artifact?.relativePath.endsWith(todayFile.name)
      ? dailyRun.trigger === 'manual'
        ? 'AI 起草'
        : `${daily?.definition.schedule.kind === 'daily' ? daily.definition.schedule.time : ''} 自动起草`
      : ''
  // Draft source and notices sit at the right of the editor toolbar; saving shows the editor's
  // own save state, and AI edits go through the conversation panel on the right.
  const toolbarExtra = todayFile ? (
    <span className="diary-today-actions">
      {(draftLabel || notice) && (
        <span className="diary-today-state" aria-label="今天的日记状态">
          {[draftLabel, notice].filter(Boolean).join(' · ')}
        </span>
      )}
      <FoldedTabCreateActions />
    </span>
  ) : null
  // Until the automatic draft or blank file has started, show no waiting card at all.
  const opening =
    !today.length &&
    Boolean(source) &&
    !draftRunning &&
    !error &&
    (autoTried !== `cclink.diary.autoDraft.${source?.projectId}.${todayKey}` ||
      // Started, but the run or the file has not shown up yet.
      !dailyRun)
  const todayView = (
    <div className="diary-today">
      {todayFile && (
        // Entering 今天 opens today's diary right here, ready to type (no summary card).
        <article className="diary-today-entry" aria-label="今天的日记">
          <div className="diary-today-editor">
            <MarkdownEditor
              key={todayFile.path}
              filePath={todayFile.path}
              tabId={'today:' + todayFile.path}
              compact
              toolbarLead={
                <span className="diary-day-nav">
                  <DiaryFilePicker
                    files={today}
                    current={todayFile.path}
                    onPick={setTodayPick}
                    label="今天的日记"
                  />
                </span>
              }
              toolbarExtra={toolbarExtra}
            />
          </div>
        </article>
      )}
      {!todayFile && (
        <h1 className="diary-today-title">
          {Number(day.month)} 月 {Number(day.day)} 日 {day.weekday}
        </h1>
      )}
      {opening && (
        <p className="muted" role="status">
          正在打开今天的日记…
        </p>
      )}
      {!today.length && source && !opening && aiProblem && !draftRunning && (
        <div className="diary-card diary-card-alert" role="alert" aria-label="今天的草稿">
          <b>
            AI 起草不可用 <span className="diary-tag danger">{aiProblem}</span>
          </b>
          <p className="muted">
            {daily?.definition.schedule.kind === 'daily'
              ? daily.definition.schedule.time + ' '
              : ''}
            自动起草无法进行。在 Studio 设置的 Agent 中修复后，会自动补起草今天。
          </p>
          <button
            className="primary"
            onClick={() =>
              void useCommandStore.getState().executeCommand('settings.open', { source: 'toolbar' })
            }
          >
            去修复
          </button>
          <button disabled={busy} onClick={() => act(prepareBlank)}>
            空白模板（未经 AI 起草）
          </button>
        </div>
      )}
      {!today.length && source && !opening && (!aiProblem || draftRunning) && (
        <div className="diary-card" aria-label="今天的草稿">
          {draftRunning ? (
            <>
              <b>
                AI 正在{dailyRun?.trigger === 'manual' ? '' : '自动'}起草今天的日记
                {dailyRun?.trigger !== 'manual' && daily?.definition.schedule.kind === 'daily'
                  ? ` · ${daily.definition.schedule.time} 定时`
                  : ''}
              </b>
              <p className="muted">{dailyRun?.currentStep}</p>
              <button onClick={() => act(cancelDraft)}>取消</button>
            </>
          ) : dailyRun && ['failed', 'interrupted', 'cancelled'].includes(dailyRun.status) ? (
            <>
              <b>今天的自动起草未成功</b>
              <p role="alert">{dailyRun.error?.message ?? dailyRun.currentStep}</p>
              <button className="primary" disabled={busy} onClick={() => act(draftNow)}>
                重新起草
              </button>
              <button disabled={busy} onClick={() => act(prepareBlank)}>
                空白模板（未经 AI 起草）
              </button>
            </>
          ) : daily?.activation.enabled ? (
            <>
              <b>
                {daily.definition.schedule.kind === 'daily' ? daily.definition.schedule.time : ''}
                {daily.definition.schedule.timezone !==
                Intl.DateTimeFormat().resolvedOptions().timeZone
                  ? `（${daily.definition.schedule.timezone}）`
                  : ''}{' '}
                自动生成今天的草稿 <span className="diary-tag ai">每日起草 · 本机已启用</span>
              </b>
              <p className="muted">
                将写入 {source.directory}/{location.folder}/{location.filename}
                {' · '}下次{' '}
                {formatNextInZone(daily.activation.nextRunAt, daily.definition.schedule.timezone)}
              </p>
              <button disabled={busy} onClick={() => act(draftNow)}>
                现在起草
              </button>
              <button disabled={busy} onClick={() => act(prepareBlank)}>
                空白模板
              </button>
              <button className="diary-link" onClick={() => openTask(daily)}>
                修改时间 ›
              </button>
            </>
          ) : daily ? (
            <>
              <b>每日起草在这台设备未启用</b>
              <p className="muted">启用后每天自动生成当天草稿。</p>
              <button className="primary" onClick={() => openTask(daily)}>
                检查并启用
              </button>
              <button disabled={busy} onClick={() => act(draftNow)}>
                现在起草
              </button>
              <button disabled={busy} onClick={() => act(prepareBlank)}>
                空白模板
              </button>
            </>
          ) : (
            <>
              <b>还没有每日起草任务</b>
              <p className="muted">创建后每天自动生成当天草稿，并每周自动复盘。</p>
              <button className="primary" disabled={busy} onClick={() => act(createBuiltIns)}>
                创建每日起草与周期计划
              </button>
              <button disabled={busy} onClick={() => act(prepareBlank)}>
                空白模板
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
  // 科技日报 is its own page in My Space (docs/features/personal-techdaily.md §2).
  if (page === '科技日报' && ownerRef.kind === 'local' && ownerPath === fixedPath)
    return (
      <section className="personal-diary-home diary-today-doc">
        <TechDailyDayView workspaceRef={ownerRef} />
      </section>
    )
  return (
    <section
      className={
        page === '今天' || page === '日记'
          ? 'personal-diary-home diary-today-doc'
          : 'personal-diary-home'
      }
    >
      {page !== '今天' && page !== '日记' && page !== '财务' && page !== '健康' && (
        <h2>{page === 'Git' ? '同步' : page === '导入历史' ? '从历史导入' : page}</h2>
      )}
      {notice && page !== '日记' && !(page === '今天' && todayFile) && (
        <p role="status">{notice}</p>
      )}
      {error && <p role="alert">{error}</p>}
      {busy && !todayFile && (
        <p role="status" className="muted">
          正在读取…
        </p>
      )}
      {page === 'Git' && ownerPath && ownerPath === fixedPath ? (
        <DiarySyncPage key={ownerPath} path={ownerPath} />
      ) : page === '导入历史' && ownerPath === fixedPath ? (
        <DiaryImportPage
          onDone={() => {
            setRevision((value) => value + 1)
            setPage('今天')
          }}
        />
      ) : (
        <>
          {page === '今天' && todayView}
          {page === '日记' && source && <DiaryDayView />}
          {page === '计划' && source && source.workspacePath === ownerPath && (
            <DiaryPlans
              key={ownerPath}
              workspace={ownerPath}
              planDirectory={config?.settings.diary?.planDirectory ?? '计划'}
              directory={source.directory}
              timezone={timezone}
              today={`${day.year}-${day.month}-${day.day}`}
              diaries={files.diaries}
              tasks={tasks}
              openTask={openTask}
              openFile={openFile}
              refresh={() => setRevision((v) => v + 1)}
            />
          )}
          {page === '定时整理' && source && (
            <DiaryTasksView
              workspacePath={source.workspacePath}
              directory={source.directory}
              timezone={source.timezone}
              tasks={tasks}
              onChanged={() => setRevision((value) => value + 1)}
              openTask={openTask}
              openFile={openFile}
            />
          )}
          {(page === '财务' || page === '健康') && source && ownerPath === fixedPath && (
            <DiaryLedgerView
              key={page}
              kind={page === '财务' ? financeLedger : healthLedger}
              workspacePath={source.workspacePath}
              diaries={files.diaries}
              today={`${day.year}-${day.month}-${day.day}`}
              revision={revision}
              openFile={openFile}
            />
          )}
          {page !== '今天' && page !== '日记' && preview && (
            <article className="diary-preview" aria-label="日记正文预览">
              <header>
                <strong>{preview.path.split('/').pop()}</strong>
                <button
                  onClick={() =>
                    openFile({ name: preview.path.split('/').pop()!, path: preview.path })
                  }
                >
                  打开原文
                </button>
              </header>
              <ConversationMarkdown source={preview.content} />
              {preview.truncated && <p>正文较长，显示前 128 KB；打开原文可查看全文。</p>}
            </article>
          )}
        </>
      )}
    </section>
  )
}
