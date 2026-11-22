import { DiaryRootSetup } from './DiaryRootSetup'
import { DiarySetupWizard } from './DiarySetupWizard'
import { DiaryChangeReports } from './DiaryChangeReports'
import { DiarySyncStatus } from './DiarySyncStatus'
import { TaskDefinitionTransfer } from './TaskDefinitionTransfer'
import { useFixedSpacesStore } from './fixed-spaces-store'
import { PersonalDiaryGit } from './PersonalDiaryGit'
import { ConversationMarkdown } from '../../components/common/ConversationMarkdown'
import { useDiaryNavigation } from './personal-diary-navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
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
import { useWorkspaceStore } from '../../stores/workspace-store'
import { askAi, editRule } from './diary-ai'
import {
  createScheduledTaskTab,
  describeSchedule,
} from '../scheduled-tasks/scheduled-task-view-model'
import {
  defaultBuiltInChoice,
  ensureBuiltInDiaryTasks,
  findDailyDraft,
  isWeeklyReviewTask,
} from './diary-builtin-tasks'

type DiaryEntry = FsDirEntry & { year: string; month: string; day: string; rel: string }

const runLabel: Record<string, string> = {
  queued: '排队中',
  running: '运行中',
  completed: '完成',
  failed: '失败',
  cancelled: '已取消',
  interrupted: '中断',
  missed: '错过',
  skipped: '跳过',
}

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
    plans: FsDirEntry[]
  }>({
    diaries: [],
    others: [],
    plans: [],
  })
  const [tasks, setTasks] = useState<ScheduledTaskSnapshot[]>([])
  const [error, setError] = useState('')
  const { page, setPage } = useDiaryNavigation()
  const [preview, setPreview] = useState<DiaryDocument | null>(null)
  const [previewPath, setPreviewPath] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(true)
  const [reviewRoot, setReviewRoot] = useState(false)
  const [revision, setRevision] = useState(0)
  const [clock, setClock] = useState(() => Date.now())
  const [month, setMonth] = useState('')
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
      const plans: FsDirEntry[] = []
      const root = source.workspacePath + '/' + source.directory
      let visited = 0
      const walk = async (
        dir: string,
        section: 'root' | 'year' | 'month' | 'plans',
      ): Promise<void> => {
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
            if ((section === 'root' || section === 'year') && entry.name === '周计划')
              await walk(entry.path, 'plans')
          } else if (entry.type === 'file' && entry.name.toLowerCase().endsWith('.md')) {
            if (section === 'month') {
              const rel = entry.path.slice(root.length + 1)
              const date = classifyDiary(rel)
              if (date) diaries.push({ ...entry, ...date, rel })
              else others.push(entry)
            }
            if (section === 'plans' || section === 'root') plans.push(entry)
          }
          if (diaries.length + plans.length > 5000) throw new Error('资料超过 5000 份')
        }
      }
      await walk(root, 'root')
      const byPath = (a: FsDirEntry, b: FsDirEntry): number => b.path.localeCompare(a.path)
      const result = await window.cclinkStudio.scheduledTasks.list(source.workspacePath)
      if (!alive) return
      setFiles({ diaries: diaries.sort(byPath), others, plans: plans.sort(byPath) })
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
  const daily = findDailyDraft(tasks)
  const dailyRun =
    daily?.latestRun &&
    dayKey(daily.latestRun.scheduledFor ?? daily.latestRun.createdAt) === todayKey
      ? daily.latestRun
      : undefined
  // Mixed naming (第47周.md, 2026-11-23-周复盘.md): newest by modification time.
  const weeklyPlans = files.plans
    .filter((file) => file.path.includes('/周计划/'))
    .sort((a, b) => b.modifiedAt - a.modifiedAt)
  const longTermPlans = files.plans.filter(
    (file) => source && file.path === `${source.workspacePath}/${source.directory}/${file.name}`,
  )
  const months = useMemo(() => {
    const keys = [...new Set(files.diaries.map((file) => `${file.year}-${file.month}`))]
    return keys.sort().reverse()
  }, [files.diaries])
  const currentMonth = `${day.year}-${day.month}`
  const shownMonth =
    month || (months.includes(currentMonth) ? currentMonth : (months[0] ?? currentMonth))
  const selectedPreview =
    previewPath || (page === '今天' && today.length === 1 ? today[0].path : '')
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
    if (busy || !source || page !== '今天' || legacyLink || today.length || !daily) return
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
  }, [busy, source, page, legacyLink, today.length, daily, dailyRun, aiProblem, todayKey, clock])
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

  const weeklyPlan = weeklyPlans[0]
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
      {!today.length && source && aiProblem && (
        <div className="diary-card" role="alert">
          <b>本机 AI 不可用，今天的草稿无法自动生成</b>
          <p className="muted">
            {aiProblem}。请在 Studio 设置的 Agent 中修复；修复后会按时起草，也可现在起草。
          </p>
        </div>
      )}
      {!today.length && source && (
        <div className="diary-card" aria-label="今天的草稿">
          {draftRunning ? (
            <>
              <b>AI 正在起草今天的日记</b>
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
                自动生成今天的草稿
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
              <button onClick={() => openTask(daily)}>修改时间与要求</button>
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
                创建每日起草与每周复盘
              </button>
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
      {weeklyPlan ? (
        <button className="workspace-home-record" onClick={() => openFile(weeklyPlan)}>
          {weeklyPlan.name}
          <span>打开 ›</span>
        </button>
      ) : (
        <p className="muted">还没有周计划；每周复盘会生成下周计划。</p>
      )}
      <h3>同步</h3>
      {source && (
        <DiarySyncStatus workspacePath={source.workspacePath} onOpenGit={() => setPage('Git')} />
      )}
    </div>
  )
  const [shownYear, shownMonthNumber] = shownMonth.split('-')
  const monthEntries = files.diaries.filter(
    (file) => file.year === shownYear && file.month === shownMonthNumber,
  )
  const step = (delta: number): void => {
    const index = months.indexOf(shownMonth)
    const next = months[index - delta]
    if (next) setMonth(next)
  }
  const historyView = (
    <div className="diary-history">
      <div className="diary-month-nav">
        <button
          aria-label="上个月"
          disabled={months.indexOf(shownMonth) >= months.length - 1}
          onClick={() => step(-1)}
        >
          ‹
        </button>
        <b>
          {shownYear} 年 {Number(shownMonthNumber)} 月
        </b>
        <button
          aria-label="下个月"
          disabled={months.indexOf(shownMonth) <= 0}
          onClick={() => step(1)}
        >
          ›
        </button>
        <span className="spacer" />
        <button
          onClick={() =>
            askAi(
              `请阅读 ${source?.directory}/${shownYear} 年 ${Number(shownMonthNumber)} 月的日记，总结这个月：`,
            )
          }
        >
          AI 总结这个月
        </button>
      </div>
      {!monthEntries.length && <p className="muted">这个月没有日记。</p>}
      {monthEntries.map((file) => (
        <button
          className={`workspace-home-record diary-day-row ${previewPath === file.path ? 'selected' : ''}`}
          key={file.path}
          onClick={() => setPreviewPath(file.path)}
        >
          <span>{Number(file.day)} 日</span>
          <span>{file.name.replace(/^\d{4}[_-]/, '').replace(/\.md$/i, '')}</span>
          <span>{file.name}</span>
          <span className="diary-row-path">{file.rel}</span>
        </button>
      ))}
      {files.others.length > 0 && (
        <details>
          <summary>未识别日期 · {files.others.length} 个</summary>
          {files.others.map((file) => (
            <button
              className="workspace-home-record"
              key={file.path}
              onClick={() => setPreviewPath(file.path)}
            >
              {file.name}
            </button>
          ))}
        </details>
      )}
    </div>
  )
  const plansView = (
    <div className="diary-plans">
      <h3>周计划</h3>
      {!weeklyPlans.length && <p className="muted">还没有周计划。</p>}
      {weeklyPlans.map((file, index) => (
        <button
          className="workspace-home-record"
          key={file.path}
          onClick={() => setPreviewPath(file.path)}
        >
          {file.name}
          <span>{index === 0 ? '最近一份' : ''}</span>
        </button>
      ))}
      <h3>长期计划</h3>
      {!longTermPlans.length && <p className="muted">日记目录根下的 Markdown 会显示在这里。</p>}
      {longTermPlans.map((file) => (
        <button
          className="workspace-home-record"
          key={file.path}
          onClick={() => setPreviewPath(file.path)}
        >
          {file.name}
        </button>
      ))}
      <button
        onClick={() =>
          askAi(
            `请根据最近一周的日记和上一份周计划，起草下周计划，存入 ${source?.directory}/${day.year}/周计划/：`,
          )
        }
      >
        AI 生成下周计划
      </button>
    </div>
  )
  const tasksView = (
    <div className="diary-tasks">
      {!tasks.length && (
        <div className="diary-card">
          <b>还没有定时整理任务</b>
          <button className="primary" disabled={busy} onClick={() => act(createBuiltIns)}>
            创建每日起草与每周复盘
          </button>
        </div>
      )}
      {tasks.map((task) => (
        <button
          className="workspace-home-record diary-task-row"
          key={task.definition.id}
          onClick={() => openTask(task)}
        >
          <span>
            <b>{task.definition.title}</b>
            <span className="diary-tag">
              {task.definition.source === 'shared' ? '共享' : '本机'}
            </span>
          </span>
          <span>
            {describeSchedule(task.definition.schedule)} ·{' '}
            {task.activation.enabled &&
            (task.definition.source === 'local' ||
              task.activation.confirmedExecutionDigest === task.definition.executionDigest)
              ? `本机已启用 · 下次 ${formatNextInZone(task.activation.nextRunAt, task.definition.schedule.timezone)}`
              : task.activation.enabled
                ? '定义已变化，待重新确认'
                : '本机未启用'}
          </span>
        </button>
      ))}
      {tasks.length > 0 &&
        (!daily || !tasks.some((task) => isWeeklyReviewTask(task.definition))) && (
          <button disabled={busy} onClick={() => act(createBuiltIns)}>
            补齐内置任务
          </button>
        )}
      <h3>最近运行</h3>
      {tasks
        .filter((task) => task.latestRun)
        .sort((a, b) => (b.latestRun!.createdAt ?? 0) - (a.latestRun!.createdAt ?? 0))
        .map((task) => {
          const run = task.latestRun!
          return (
            <div className="workspace-home-record" key={run.id}>
              <span>
                {task.definition.title} · {runLabel[run.status] ?? run.status}
                {run.status === 'skipped' || run.status === 'missed' ? ` · ${run.currentStep}` : ''}
                {run.status === 'failed' && run.error ? ` · ${run.error.message}` : ''}
              </span>
              {run.artifact && source && (
                <button
                  onClick={() =>
                    openFile({
                      name: run.artifact!.relativePath.split('/').pop()!,
                      path: `${source.workspacePath}/${run.artifact!.relativePath}`,
                    })
                  }
                >
                  打开 {run.artifact.relativePath.split('/').pop()}
                </button>
              )}
            </div>
          )
        })}
      {source && (
        <TaskDefinitionTransfer
          workspacePath={source.workspacePath}
          taskIds={tasks.map((task) => task.definition.id)}
          onImported={() => setRevision((value) => value + 1)}
        />
      )}
    </div>
  )
  return (
    <section className="personal-diary-home">
      <h2>
        {page === '今天'
          ? `${Number(day.month)}月${Number(day.day)}日 ${day.weekday}`
          : page === '日记'
            ? '历史日记'
            : page}
      </h2>
      {legacyLink && source && ownerPath === fixedPath && (
        <div className="diary-card" role="status">
          <b>日记仍在另一个目录：{source.workspacePath}</b>
          <p className="muted">
            现在「我的空间」直接使用一个项目目录。核对后改用该目录，文件原样保留。
          </p>
          <button className="primary" onClick={() => setReviewRoot(true)}>
            将原资料目录用作项目目录
          </button>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
      {busy && (
        <p role="status" className="muted">
          正在读取…
        </p>
      )}
      {page === 'Git' ? (
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
          {/* Until a legacy link is migrated, only the migration prompt acts on it. */}
          {page === '今天' && !(legacyLink && ownerPath === fixedPath) && todayView}
          {page === '日记' && historyView}
          {page === '计划' && plansView}
          {page === '定时整理' && tasksView}
          {page !== '今天' && preview && (
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
