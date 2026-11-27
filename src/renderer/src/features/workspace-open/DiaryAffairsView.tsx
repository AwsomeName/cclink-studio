import { useEffect, useMemo, useState } from 'react'
import { editorSessionState } from '../editor-save-target'
import { useEditorStore } from '../../stores/editor-store'
import { useDiaryCalendar } from './diary-calendar-store'
import { useDiaryNavigation } from './personal-diary-navigation'
import {
  AFFAIR_STALE_DAYS,
  affairKey,
  affairKeywords,
  daysBetween,
  diffText,
  findMentions,
  groupTodos,
  isStale,
  parseAffairsSection,
  plainText,
  summarizeAffairs,
  writeAffair,
  type AffairDiaryInput,
  type AffairMention,
  type AffairVersion,
  type DiaryAffair,
  type DiffPart,
} from './diary-affairs'
import './diary-affairs.css'

/** Most recent diaries read, as for 财务 / 健康; older days stay in the diaries themselves. */
const AFFAIRS_DIARY_LIMIT = 120
/** Timeline nodes shown before 「展开更早的」. */
const TIMELINE_STEP = 12
const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

const short = (date: string): string => `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`
const dayLabel = (date: string): string =>
  `${short(date)} ${weekdays[new Date(date + 'T00:00:00Z').getUTCDay()]}`
const diaryTag = (date: string): string => `日记 ${date.slice(5).replace('-', '')}`
const fileName = (path: string): string => path.split('/').pop() ?? path

type Filter = 'all' | 'week' | 'stale' | 'idle' | 'removed'

function Diff({ parts, added }: { parts: DiffPart[]; added?: boolean }): React.ReactElement {
  return (
    <>
      {parts.map((part, index) =>
        part.kind === 'add' ? (
          <ins key={index}>{part.text}</ins>
        ) : part.kind === 'del' ? (
          added ? null : (
            <del key={index}>{part.text}</del>
          )
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  )
}

/** The newest 进展, with what its last change added highlighted. */
function LatestProgress({ affair }: { affair: DiaryAffair }): React.ReactElement {
  const { latest } = affair
  const change = affair.versions.filter((version) => version.progressChanged).at(-1)
  if (!change?.previous || affair.status === 'removed')
    return <>{plainText(latest.progress) || '—'}</>
  return <Diff parts={diffText(change.previous.progress, latest.progress)} added />
}

function ageLabel(
  affair: DiaryAffair,
  today: string,
): { text: string; detail: string; stale: boolean } {
  if (affair.status === 'removed')
    return { text: '已移出', detail: `最后在 ${short(affair.latest.date)}`, stale: false }
  if (affair.status === 'idle') return { text: '未开始', detail: '', stale: false }
  const days = daysBetween(affair.lastChange, today)
  const stale = isStale(affair, today)
  return {
    text: days <= 0 ? '今天' : stale ? `${days} 天没动` : `${days} 天前`,
    detail: `${short(affair.lastChange)} 改`,
    stale,
  }
}

interface TimelineNode {
  date: string
  path: string
  kind: 'appeared' | 'changed' | 'same' | 'missing' | 'quiet'
  version?: AffairVersion
  mentions: AffairMention[]
  /** For a run of quiet days: the first and count. */
  from?: string
  count?: number
}

/** Newest first: changes, days that mention the item, and quiet runs folded into one node. */
function timeline(affair: DiaryAffair, diaries: AffairDiaryInput[]): TimelineNode[] {
  const words = affairKeywords(affair.name)
  const byDate = new Map(affair.versions.map((version) => [version.path, version]))
  const missing = new Set(affair.missingDates)
  const nodes: TimelineNode[] = []
  const days = diaries
    .filter((diary) => diary.date >= affair.firstSeen && parseAffairsSection(diary.content))
    .sort((a, b) => a.date.localeCompare(b.date) || a.path.localeCompare(b.path))
  for (const diary of days) {
    const version = byDate.get(diary.path)
    const mentions = findMentions(diary.content, words)
    const kind: TimelineNode['kind'] = version
      ? version.appeared
        ? 'appeared'
        : version.progressChanged || version.planChanged
          ? 'changed'
          : mentions.length
            ? 'same'
            : 'quiet'
      : missing.has(diary.date)
        ? 'missing'
        : 'quiet'
    const last = nodes.at(-1)
    if (kind === 'quiet' && last?.kind === 'quiet') {
      last.count = (last.count ?? 1) + 1
      last.date = diary.date
      continue
    }
    nodes.push({
      date: diary.date,
      path: diary.path,
      kind,
      version,
      mentions,
      ...(kind === 'quiet' ? { from: diary.date, count: 1 } : {}),
    })
  }
  return nodes.reverse()
}

/**
 * 事务 (mockup v2): the 「项目进度与计划」 section of My Space's diaries, read live. Nothing is
 * stored by this page; 更新今天的进展 changes only that row's cells in today's diary.
 */
/** The 01:00 drafts Studio kept for these diaries; none when the space or ledger is unavailable. */
async function readDrafts(
  workspacePath: string | undefined,
  paths: string[],
): Promise<Map<string, string>> {
  const drafts = new Map<string, string>()
  if (!workspacePath) return drafts
  const prefix = workspacePath.replace(/\/+$/, '') + '/'
  const relative = paths
    .filter((path) => path.startsWith(prefix))
    .map((path) => path.slice(prefix.length))
  if (!relative.length) return drafts
  const result = await window.cclinkStudio.scheduledTasks
    .readDrafts(workspacePath, relative)
    .catch(() => null)
  for (const draft of result?.drafts ?? []) drafts.set(prefix + draft.relativePath, draft.markdown)
  return drafts
}

const SOURCE_LABEL = { draft: '起草更新', you: '你改的', both: '起草后你又改了' } as const
/** A first appearance is an addition, not an edit. */
const ADDED_LABEL = { draft: '起草加的', you: '你加的', both: '起草加的，你又改了' } as const

export function DiaryAffairsView({
  workspacePath,
  diaries,
  today,
  todayPath,
  revision,
  openFile,
}: {
  /** My Space root, used to find the drafts Studio kept. */
  workspacePath?: string
  diaries: Array<{ path: string; year: string; month: string; day: string }>
  /** YYYY-MM-DD in the diary's timezone. */
  today: string
  /** Today's diary when it exists. */
  todayPath?: string
  revision: number
  openFile: (file: { path: string; name: string }) => void
}): React.ReactElement {
  const [inputs, setInputs] = useState<AffairDiaryInput[] | null>(null)
  const [error, setError] = useState('')
  const [ownRevision, setOwnRevision] = useState(0)
  const [filter, setFilter] = useState<Filter>('all')
  const [selected, setSelected] = useState<string | null>(null)
  const recent = diaries.slice(0, AFFAIRS_DIARY_LIMIT)
  const key = recent.map((file) => file.path).join('\n')
  useEffect(() => {
    let alive = true
    setError('')
    void Promise.all([
      Promise.all(
        recent.map(async (file) => {
          const result = await window.cclinkStudio.fs.readFile(file.path)
          return {
            date: `${file.year}-${file.month}-${file.day}`,
            path: file.path,
            content: result.encoding === 'utf-8' ? result.content : '',
          }
        }),
      ),
      readDrafts(
        workspacePath,
        recent.map((file) => file.path),
      ),
    ])
      .then(([read, drafts]) => {
        const items: AffairDiaryInput[] = read.map((item) => {
          const draft = drafts.get(item.path)
          return draft === undefined ? item : { ...item, draft }
        })
        if (alive) setInputs(items)
      })
      .catch((e) => {
        if (alive) setError(String(e))
      })
    return () => {
      alive = false
    }
    // `key` stands for the diary list.
  }, [key, revision, ownRevision, workspacePath])
  const summary = useMemo(() => (inputs ? summarizeAffairs(inputs) : null), [inputs])
  const openDay = (date: string): void => {
    useDiaryCalendar.getState().select(date)
    useDiaryNavigation.getState().setPage('日记')
  }
  const affair = summary?.affairs.find((item) => item.key === selected) ?? null
  if (affair && inputs)
    return (
      <AffairDetail
        affair={affair}
        diaries={inputs}
        today={today}
        todayPath={todayPath}
        back={() => setSelected(null)}
        openDay={openDay}
        written={() => setOwnRevision((value) => value + 1)}
      />
    )
  const affairs = summary?.affairs ?? []
  const counts: Record<Filter, number> = {
    all: affairs.filter((item) => item.status !== 'removed').length,
    week: affairs.filter(
      (item) => item.status === 'active' && daysBetween(item.lastChange, today) < 7,
    ).length,
    stale: affairs.filter((item) => isStale(item, today)).length,
    idle: affairs.filter((item) => item.status === 'idle').length,
    removed: affairs.filter((item) => item.status === 'removed').length,
  }
  const shown = affairs.filter((item) =>
    filter === 'all'
      ? item.status !== 'removed'
      : filter === 'week'
        ? item.status === 'active' && daysBetween(item.lastChange, today) < 7
        : filter === 'stale'
          ? isStale(item, today)
          : item.status === filter,
  )
  const latest = summary?.latest ?? null
  const filters: Array<[Filter, string]> = [
    ['all', '全部'],
    ['week', '本周有进展'],
    ['stale', `超过 ${AFFAIR_STALE_DAYS} 天没动`],
    ['idle', '未开始'],
    ...(counts.removed ? ([['removed', '已移出']] as Array<[Filter, string]>) : []),
  ]
  return (
    <div className="diary-affairs" aria-label="事务">
      <header className="diary-ledger-head">
        <h2>事务</h2>
        <span className="muted">日记里「项目进度与计划」的每一行</span>
        <span className="gap" />
        {latest && (
          <button
            type="button"
            className="diary-link"
            onClick={() => openFile({ path: latest.path, name: fileName(latest.path) })}
          >
            打开 {fileName(latest.path)} ›
          </button>
        )}
      </header>
      {error && <p role="alert">{error}</p>}
      {!summary && !error && (
        <p className="muted" role="status">
          正在读取…
        </p>
      )}
      {summary && !latest && (
        <div className="diary-affairs-empty">
          <p>
            最近 {recent.length} 篇日记里还没有「## 项目进度与计划」。在日记里加这一节，按「###
            分组」写「| 事项 | 进展记录 | 计划 |」表格，这里就会列出每一件事。
          </p>
          <button type="button" onClick={() => useDiaryNavigation.getState().setPage('今天')}>
            去今天的日记
          </button>
        </div>
      )}
      {summary && latest && (
        <>
          <p className="diary-affairs-source">
            来源 <b>{fileName(latest.path)} › 项目进度与计划</b>　·　读了最近 {recent.length}{' '}
            篇日记，其中 {summary.diariesWithSection} 篇有这一节　·
            {summary.groups.length} 组 {counts.all} 项
            {latest.date !== today && (
              <span className="warn">
                　·　今天的日记还没有这一节，显示的是 {short(latest.date)} 的
              </span>
            )}
          </p>
          <div className="diary-affairs-filters" role="group" aria-label="筛选">
            {filters.map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={filter === id}
                onClick={() => setFilter(id)}
              >
                {label} {counts[id]}
              </button>
            ))}
          </div>
          {summary.groups.map((group) => {
            const items = shown.filter((item) => item.group === group)
            if (!items.length) return null
            const todos = groupTodos(latest.content, group)
            return (
              <section
                key={group || '-'}
                className="diary-affairs-group"
                aria-label={group || '未分组'}
              >
                <h3>
                  {group || '未分组'}
                  <span className="muted">
                    {items.length} 项
                    {todos.total > 0 && ` · 今日待做 ${todos.total} 条，已勾 ${todos.done}`}
                  </span>
                </h3>
                {items.map((item) => {
                  const age = ageLabel(item, today)
                  return (
                    <button
                      key={item.key}
                      type="button"
                      className={`diary-affairs-row ${item.status}`}
                      onClick={() => setSelected(item.key)}
                    >
                      <span className={`dot ${item.status}`} />
                      <span className="name">
                        {plainText(item.name)}
                        <small>首次出现 {short(item.firstSeen)}</small>
                      </span>
                      <span className="progress">
                        <LatestProgress affair={item} />
                      </span>
                      <span className="plan">
                        <i>计划</i>
                        {plainText(item.latest.plan) || '—'}
                      </span>
                      <span className={`age${age.stale ? ' stale' : ''}`}>
                        {age.text}
                        {age.detail && <small>{age.detail}</small>}
                      </span>
                    </button>
                  )
                })}
              </section>
            )
          })}
          {!shown.length && <p className="muted">没有符合这个筛选的事项。</p>}
        </>
      )}
    </div>
  )
}

function AffairDetail({
  affair,
  diaries,
  today,
  todayPath,
  back,
  openDay,
  written,
}: {
  affair: DiaryAffair
  diaries: AffairDiaryInput[]
  today: string
  todayPath?: string
  back: () => void
  openDay: (date: string) => void
  written: () => void
}): React.ReactElement {
  const nodes = useMemo(() => timeline(affair, diaries), [affair, diaries])
  const [limit, setLimit] = useState(TIMELINE_STEP)
  const [editing, setEditing] = useState(false)
  const changes = affair.versions.filter((version) => version.progressChanged).length
  const status =
    affair.status === 'removed' ? '已移出' : affair.status === 'idle' ? '未开始' : '进行中'
  return (
    <div className="diary-affairs" aria-label={`事务：${affair.name}`}>
      <nav className="diary-affairs-crumb" aria-label="位置">
        <button type="button" className="diary-link" onClick={back}>
          事务
        </button>
        　›　{affair.group || '未分组'}　›　{plainText(affair.name)}
      </nav>
      <header className="diary-ledger-head">
        <h2>{plainText(affair.name)}</h2>
        <span className={`diary-affairs-chip ${affair.status}`}>{status}</span>
        <span className="gap" />
        {!editing && (
          <button type="button" className="primary" onClick={() => setEditing(true)}>
            更新今天的进展
          </button>
        )}
      </header>
      <p className="muted diary-affairs-meta">
        {short(affair.firstSeen)} 首次出现在日记表格里 · 进展变过 {changes} 次 · 最近{' '}
        {short(affair.lastChange)}
        {isStale(affair, today) && (
          <span className="warn"> · {daysBetween(affair.lastChange, today)} 天没动</span>
        )}
      </p>
      {editing && (
        <AffairEditor
          affair={affair}
          todayPath={todayPath}
          close={() => setEditing(false)}
          written={written}
        />
      )}
      <ol className="diary-affairs-timeline" aria-label="进展记录">
        {nodes.slice(0, limit).map((node) => (
          <li key={node.path + node.kind} className={node.kind}>
            <div className="when">
              <b>
                {node.kind === 'quiet' && node.count && node.count > 1
                  ? `${short(node.from!)} – ${short(node.date)}`
                  : dayLabel(node.date)}
              </b>
              {node.kind === 'quiet' ? (
                <span className="muted">{node.count} 篇日记，这一行没变</span>
              ) : (
                <button
                  type="button"
                  className="diary-ledger-tag diary"
                  title="打开这篇日记"
                  onClick={() => openDay(node.date)}
                >
                  {diaryTag(node.date)}
                </button>
              )}
              {node.kind === 'appeared' && (
                <span className="diary-affairs-chip state">
                  {node.version?.previous ? '重新出现' : '首次出现'}
                </span>
              )}
              {node.version?.source && (node.kind === 'appeared' || node.kind === 'changed') && (
                <span
                  className={`diary-affairs-chip source ${node.version.source}`}
                  title={
                    node.version.source === 'draft'
                      ? '01:00 起草时改的，之后没人动过'
                      : node.version.source === 'you'
                        ? '起草之后，这一行是你改的'
                        : '起草改了这一行，你之后又改了'
                  }
                >
                  {(node.kind === 'appeared' ? ADDED_LABEL : SOURCE_LABEL)[node.version.source]}
                </span>
              )}
              {node.kind === 'same' && <span className="muted">表格这一行和前一篇一样</span>}
              {node.kind === 'missing' && <span className="muted">这一天的表格里没有这一行</span>}
            </div>
            {node.version && (node.kind === 'appeared' || node.kind === 'changed') && (
              <div className="txt">
                <div>
                  <i>进展</i>
                  {node.version.previous && node.version.progressChanged ? (
                    <Diff parts={diffText(node.version.previous.progress, node.version.progress)} />
                  ) : (
                    plainText(node.version.progress) || '—'
                  )}
                </div>
                <div className="plan">
                  <i>计划</i>
                  {node.version.previous && node.version.planChanged ? (
                    <Diff parts={diffText(node.version.previous.plan, node.version.plan)} />
                  ) : (
                    plainText(node.version.plan) || '—'
                  )}
                </div>
                {node.version.drafted && (
                  <p className="drafted">
                    <span className="k">起草时写的</span>
                    {plainText(node.version.drafted.progress) || '—'}
                    {plainText(node.version.drafted.plan) !== plainText(node.version.plan) && (
                      <>　计划：{plainText(node.version.drafted.plan) || '—'}</>
                    )}
                  </p>
                )}
              </div>
            )}
            {node.mentions.map((mention, index) => (
              <p key={index} className="mention">
                <span className="k">{mention.section}</span>
                {mention.text}
              </p>
            ))}
          </li>
        ))}
      </ol>
      {nodes.length > limit && (
        <div className="diary-ledger-fold">
          <button type="button" onClick={() => setLimit((value) => value + TIMELINE_STEP)}>
            ▾ 展开更早的（还有 {nodes.length - limit} 个节点）
          </button>
        </div>
      )}
    </div>
  )
}

interface Written {
  path: string
  before: string
  after: string
  line: number
}

function AffairEditor({
  affair,
  todayPath,
  close,
  written,
}: {
  affair: DiaryAffair
  todayPath?: string
  close: () => void
  written: () => void
}): React.ReactElement {
  const [content, setContent] = useState<string | null>(null)
  const [progress, setProgress] = useState('')
  const [plan, setPlan] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState<Written | null>(null)
  useEffect(() => {
    if (!todayPath) return
    let alive = true
    void window.cclinkStudio.fs
      .readFile(todayPath)
      .then((result) => {
        if (!alive) return
        const text = result.encoding === 'utf-8' ? result.content : ''
        const row = parseAffairsSection(text)?.rows.find(
          (item) => affairKey(item.group, item.name) === affair.key,
        )
        setContent(text)
        setProgress(row?.progress ?? affair.latest.progress)
        setPlan(row?.plan ?? affair.latest.plan)
      })
      .catch((e) => alive && setError(String(e)))
    return () => {
      alive = false
    }
  }, [todayPath, affair.key, affair.latest])
  if (!todayPath)
    return (
      <div className="diary-affairs-edit" role="group" aria-label="更新今天的进展">
        <p>今天的日记还没生成。先生成今天的日记，再把进展写进去。</p>
        <div className="bar">
          <span className="gap" />
          <button type="button" onClick={close}>
            取消
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => useDiaryNavigation.getState().setPage('今天')}
          >
            先生成今天的日记
          </button>
        </div>
      </div>
    )
  const name = fileName(todayPath)
  const preview =
    content === null
      ? null
      : writeAffair(content, { group: affair.group, name: affair.name, progress, plan })
  const unchanged = preview !== null && preview.content === content
  const blocked = (): string => {
    const session = editorSessionState(useEditorStore.getState().files, todayPath)
    return session.dirty || session.conflict
      ? `${name} 在编辑器里有未保存的修改，先保存再写入，避免覆盖你正在写的内容。`
      : ''
  }
  const reloadEditor = async (): Promise<void> => {
    if (useEditorStore.getState().files[todayPath])
      await useEditorStore.getState().checkExternalChange(todayPath)
  }
  const save = async (): Promise<void> => {
    setError('')
    const problem = blocked()
    if (problem) return setError(problem)
    setSaving(true)
    try {
      // Read again right before writing: the diary may have changed since the form opened.
      const result = await window.cclinkStudio.fs.readFile(todayPath)
      const current = result.encoding === 'utf-8' ? result.content : ''
      const next = writeAffair(current, { group: affair.group, name: affair.name, progress, plan })
      await window.cclinkStudio.fs.writeFile(todayPath, next.content)
      await reloadEditor()
      setDone({ path: todayPath, before: current, after: next.content, line: next.line })
      setContent(next.content)
      written()
    } catch (e) {
      setError(`没写进去：${String(e)}`)
    } finally {
      setSaving(false)
    }
  }
  const undo = async (): Promise<void> => {
    if (!done) return
    setError('')
    const problem = blocked()
    if (problem) return setError(problem)
    setSaving(true)
    try {
      const result = await window.cclinkStudio.fs.readFile(done.path)
      if ((result.encoding === 'utf-8' ? result.content : '') !== done.after)
        throw new Error(`${name} 在写入后又改过，没有撤销；请在编辑器里手动改回`)
      await window.cclinkStudio.fs.writeFile(done.path, done.before)
      await reloadEditor()
      setDone(null)
      setContent(done.before)
      written()
      close()
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    } finally {
      setSaving(false)
    }
  }
  if (done)
    return (
      <div className="diary-affairs-edit done" role="status" aria-label="已写入今天的日记">
        <p>
          已写入 {name} 第 {done.line} 行。明天起草日记时会带上这一行。
        </p>
        <div className="bar">
          <span className="gap" />
          <button type="button" disabled={saving} onClick={() => void undo()}>
            撤销这次写入
          </button>
          <button type="button" className="primary" onClick={close}>
            完成
          </button>
        </div>
        {error && <p role="alert">{error}</p>}
      </div>
    )
  return (
    <form
      className="diary-affairs-edit"
      aria-label="更新今天的进展"
      onSubmit={(event) => {
        event.preventDefault()
        if (!saving && preview && !unchanged) void save()
      }}
    >
      <p className="muted">
        写入 {name} › 项目进度与计划 › {affair.group || '未分组'}
      </p>
      <label>
        <span>进展记录</span>
        <textarea
          rows={3}
          value={progress}
          disabled={content === null}
          onChange={(event) => setProgress(event.target.value)}
        />
      </label>
      <label>
        <span>计划</span>
        <textarea
          rows={2}
          value={plan}
          disabled={content === null}
          onChange={(event) => setPlan(event.target.value)}
        />
      </label>
      {preview && !unchanged && (
        <div className="diary-affairs-diff" aria-label="将改动">
          <div className="h">
            {preview.before
              ? `将改动 ${name} 第 ${preview.line} 行（只改这一行的进展和计划）`
              : `今天的日记里还没有这一行，将加在第 ${preview.line} 行`}
          </div>
          {preview.before && <div className="l m">- {preview.before}</div>}
          <div className="l p">+ {preview.after}</div>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="bar">
        <span className="muted">
          {unchanged ? '和今天日记里的一样，没有要写的' : '写入后可撤销'}
        </span>
        <span className="gap" />
        <button type="button" onClick={close}>
          取消
        </button>
        <button type="submit" className="primary" disabled={saving || !preview || unchanged}>
          {saving ? '正在写入…' : '写入日记'}
        </button>
      </div>
    </form>
  )
}
