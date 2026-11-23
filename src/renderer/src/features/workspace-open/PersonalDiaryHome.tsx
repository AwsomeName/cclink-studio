import { DiaryPlans } from './DiaryPlans'
import { DiaryRootSetup } from './DiaryRootSetup'
import { DiarySetupWizard } from './DiarySetupWizard'
import { DiaryChangeReports } from './DiaryChangeReports'
import { DiarySyncPage, useDiarySyncLabel, useDiarySyncRevision } from './DiarySyncStatus'
import { DiaryDayView } from './DiaryDayView'
import { useDiaryCalendar } from './diary-calendar-store'
import { DiaryTasksView } from './DiaryTasksView'
import { useFixedSpacesStore } from './fixed-spaces-store'
import { PersonalDiaryGit } from './PersonalDiaryGit'
import { ConversationMarkdown } from '../../components/common/ConversationMarkdown'
import { useDiaryNavigation } from './personal-diary-navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  defaultDiaryDirectory,
  defaultDiaryTimezone,
  diaryDateParts,
  diaryDayLocation,
  personalDiarySourceSchema,
  personalDiarySourceSection,
  type DiaryDocument,
  type PersonalDiarySource,
} from '@shared/personal-diary-source'
import type { FsDirEntry } from '@shared/ipc/fs'
import type { ScheduledTaskSnapshot } from '@shared/scheduled-task/scheduled-task-types'
import { useTabStore } from '../../stores/tab-store'
import { useCommandStore } from '../../stores/command-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { askAi, editRule } from './diary-ai'
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
  /** A legacy external link (D5): shown only as a one-time migration prompt. */
  const [legacyLink, setLegacyLink] = useState(false)
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
  const [reviewRoot, setReviewRoot] = useState(false)
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
    if (page === '资料接入') setPage('今天')
  }, [page, setPage])
  useEffect(() => {
    let alive = true
    setBusy(true)
    // Wait for this project's settings: a missing or stale snapshot must not look "unset".
    if (ownerPath && config?.workspacePath !== ownerPath) return
    void (async () => {
      const [items, snapshot] = await Promise.all([
        window.cclinkStudio.workspaceState.listLocalWorkspaces(),
        window.cclinkStudio.workspaceState.get(ownerPath),
      ])
      let value = snapshot.sections[personalDiarySourceSection]
      if (
        value === undefined &&
        !useFixedSpacesStore.getState().spaces?.personal?.diaryRootConfirmed &&
        ownerPath === useFixedSpacesStore.getState().spaces?.personal?.workspacePath
      )
        value = (await window.cclinkStudio.workspaceState.get(null)).sections[
          personalDiarySourceSection
        ]
      const root = items.find((item) => item.workspacePath === ownerPath)
      let link: PersonalDiarySource | null = value ? personalDiarySourceSchema.parse(value) : null
      if (
        !link &&
        ownerPath &&
        root?.projectId &&
        (config?.settings.diary ||
          ownerPath !== useFixedSpacesStore.getState().spaces?.personal?.workspacePath)
      )
        link = {
          version: 1,
          workspacePath: ownerPath,
          projectId: root.projectId,
          directory: config?.settings.diary?.directory ?? defaultDiaryDirectory,
          timezone: config?.settings.diary?.timezone ?? defaultDiaryTimezone,
          taskIds: [],
        }
      if (!alive) return
      setLegacyLink(Boolean(link && link.workspacePath !== ownerPath))
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
  const readDiary = useCallback(
    (path: string) =>
      window.cclinkStudio.workspaceState.diaryDocument({
        action: 'read',
        workspacePath: ownerPath ?? undefined,
        path: path.slice((source?.workspacePath.length ?? 0) + 1),
      }),
    [ownerPath, source?.workspacePath],
  )
  const daily = findDailyDraft(tasks)
  const dailyRun =
    daily?.latestRun &&
    dayKey(daily.latestRun.scheduledFor ?? daily.latestRun.createdAt) === todayKey
      ? daily.latestRun
      : undefined
  const selectedPreview =
    previewPath || (page === '今天' && today.length === 1 ? today[0].path : '')
  const todayDirty = useTabStore((state) =>
    state.tabs.some((tab) => tab.dirty && tab.filePath === today[0]?.path),
  )
  const syncText = useDiarySyncLabel(source?.workspacePath ?? null)
  // This week's plan for the home row: the newest file in <year>/周计划 (as the file shortcuts).
  const [weekPlan, setWeekPlan] = useState<string | null>(null)
  useEffect(() => {
    if (!source) return
    let alive = true
    void window.cclinkStudio.fs
      .readDir(`${source.workspacePath}/${source.directory}/${day.year}/周计划`)
      .catch(() => [])
      .then((entries) => {
        const newest = entries
          .filter((entry) => entry.type === 'file' && entry.name.endsWith('.md'))
          .sort((a, b) => b.modifiedAt - a.modifiedAt)[0]
        if (alive) setWeekPlan(newest?.name ?? null)
      })
    return () => {
      alive = false
    }
  }, [source, day.year, revision])
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
    if (busy || !source || page !== '今天' || ownerPath !== fixedPath || legacyLink) return
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
  }, [busy, source, page, ownerPath, fixedPath, legacyLink, daily])
  // Today's draft did not happen (missed or failed): the first visit today starts it once.
  const autoDraftKey = useRef('')
  useEffect(() => {
    if (busy || !source || page !== '今天' || today.length || !daily) return
    if (!daily.activation.enabled || aiProblem || daily.definition.schedule.kind !== 'daily') return
    // A draft the user cancelled is not restarted automatically.
    if (dailyRun && !['failed', 'interrupted', 'missed'].includes(dailyRun.status)) return
    const nowText = new Intl.DateTimeFormat('en-GB', {
      timeZone: daily.definition.schedule.timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(clock))
    if (nowText < daily.definition.schedule.time) return
    const key = `cclink.diary.autoDraft.${source.projectId}.${todayKey}`
    if (autoDraftKey.current === key) return
    autoDraftKey.current = key
    try {
      if (window.localStorage.getItem(key)) return
      window.localStorage.setItem(key, '1')
    } catch {
      /* storage unavailable: once per mount */
    }
    act(async () => {
      await draftNow()
      setNotice('今天的草稿未按时生成，已自动开始起草。')
    })
  }, [busy, source, page, today.length, daily, dailyRun, aiProblem, todayKey, clock])
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
  if (reviewRoot && source && ownerPath && ownerPath === fixedPath)
    return (
      <DiaryRootSetup
        owner={ownerPath}
        initialRoot={source.workspacePath}
        cancel={() => setReviewRoot(false)}
      />
    )
  if (!source && !busy && !error && ownerPath && ownerPath === fixedPath)
    return <DiarySetupWizard owner={ownerPath} />
  if (page === '更换目录' && ownerPath && ownerPath === fixedPath)
    return <DiaryRootSetup owner={ownerPath} cancel={() => setPage('今天')} />

  const draftRunning = dailyRun && ['queued', 'running'].includes(dailyRun.status)
  const todayView = (
    <div className="diary-today">
      {today.length === 1 && preview && (
        <article className="diary-today-entry" aria-label="今天的日记">
          <header>
            <strong>{today[0].name}</strong>
            {dailyRun?.status === 'completed' &&
              dailyRun.artifact?.relativePath.endsWith(today[0].name) && (
                <span className="diary-tag ai">
                  {dailyRun.trigger === 'manual'
                    ? 'AI 起草'
                    : `${daily?.definition.schedule.kind === 'daily' ? daily.definition.schedule.time : ''} 自动起草`}
                </span>
              )}
            <span className={`diary-tag ${todayDirty ? '' : 'ok'}`}>
              {todayDirty ? '未保存' : '已保存'}
            </span>
          </header>
          {summarizeDiary(preview.content).map((part) => (
            <div className="diary-quote" key={part.title}>
              <b>{part.title}</b>
              <span>{part.text || '（空）'}</span>
            </div>
          ))}
          <div className="diary-actions">
            <button className="primary" onClick={() => openFile(today[0])}>
              继续写
            </button>
            <button onClick={() => askAi(`${editRule}请修改今天的日记 ${today[0].path}：`)}>
              让 AI 修改…
            </button>
          </div>
        </article>
      )}
      {today.length > 1 && (
        <div className="diary-card">
          <b>今天有 {today.length} 篇日记，请选择要继续写的一篇</b>
          {today.map((file) => (
            <button
              className="workspace-home-record"
              key={file.path}
              onClick={() => openFile(file)}
            >
              {file.name}
            </button>
          ))}
        </div>
      )}
      {!today.length && source && aiProblem && !draftRunning && (
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
      {!today.length && source && (!aiProblem || draftRunning) && (
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
              {legacyLink ? (
                // Tasks are never created in the old linked directory: migrate first.
                <p className="muted">将原资料目录用作项目目录后，会自动创建每日起草。</p>
              ) : (
                <>
                  <p className="muted">创建后每天自动生成当天草稿，并每周自动复盘。</p>
                  <button className="primary" disabled={busy} onClick={() => act(createBuiltIns)}>
                    创建每日起草与周期计划
                  </button>
                </>
              )}
              <button disabled={busy} onClick={() => act(prepareBlank)}>
                空白模板
              </button>
            </>
          )}
        </div>
      )}
      {source && (
        <DiaryChangeReports
          workspacePath={source.workspacePath}
          onOpen={(path) => openFile({ path, name: path.split('/').pop()! })}
        />
      )}
      <h3>本周计划</h3>
      <button className="diary-row" onClick={() => setPage('计划')}>
        <span>{weekPlan ?? '还没有本周计划'}</span>
        <small>{weekPlan ? '打开 ›' : '去计划 ›'}</small>
      </button>
      <h3>同步</h3>
      {source && (
        <button className="diary-row" onClick={() => setPage('Git')}>
          <span>{syncText}</span>
          <small>查看 ›</small>
        </button>
      )}
    </div>
  )
  return (
    <section className="personal-diary-home">
      <h2>
        {page === '今天'
          ? `${Number(day.month)}月${Number(day.day)}日 ${day.weekday}`
          : page === 'Git'
            ? '同步'
            : page}
      </h2>
      {legacyLink && source && ownerPath === fixedPath && (
        <div className="diary-card" role="status">
          <b>日记仍在另一个目录：{source.workspacePath}</b>
          <p className="muted">
            下面直接显示该目录里今天的日记。核对后可将它用作「我的空间」的项目目录，文件原样保留。
          </p>
          <button onClick={() => setReviewRoot(true)}>将原资料目录用作项目目录</button>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
      {busy && (
        <p role="status" className="muted">
          正在读取…
        </p>
      )}
      {page === 'Git' && ownerPath && ownerPath === fixedPath ? (
        <DiarySyncPage key={ownerPath} path={ownerPath} />
      ) : page === 'Git' ? (
        <PersonalDiaryGit
          ownerPath={ownerPath}
          source={source}
          onConnected={(value) => {
            setPreviewPath('')
            setSource(value)
            setPage('今天')
          }}
          onUpdated={() => setRevision((value) => value + 1)}
        />
      ) : (
        <>
          {/* Today's diary shows even before a legacy link is migrated. */}
          {page === '今天' && todayView}
          {page === '日记' && source && (
            <DiaryDayView read={readDiary} openFile={openFile} directory={source.directory} />
          )}
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
                <button onClick={() => askAi(`${editRule}请修改 ${preview.path}：`)}>
                  让 AI 修改…
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
