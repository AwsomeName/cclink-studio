import { useEffect, useMemo, useState } from 'react'
import type { FsDirEntry } from '@shared/ipc/fs'
import type { ScheduledTaskSnapshot } from '@shared/scheduled-task/scheduled-task-types'
import { isoWeek } from '@shared/scheduled-task/scheduled-task-file-name'
import { MarkdownEditor } from '../../components/workbench/MarkdownEditor'
import { useEditorStore } from '../../stores/editor-store'
import { useAgentStore } from '../../stores/agent-store'
import { useUIStore } from '../../stores/ui-store'
import { useFsStore } from '../../stores/fs-store'
import { createConversationRunController } from '../agent-conversations/conversation-run-controller'
import { createConversationRuntimeForWorkspace } from '../agent-conversations/view-model'
import { removeTrashedTargets } from '../context-actions/domains/file-context-actions'
import { describeSchedule } from '../scheduled-tasks/scheduled-task-view-model'
import { askAi, editRule } from './diary-ai'
import { ensurePlanTask, planOutputs, type PlanTaskKind } from './diary-builtin-tasks'
import './diary-plans.css'

function findPlanChat(
  state: ReturnType<typeof useAgentStore.getState>,
  workspace: string,
  path: string,
) {
  return Object.values(state.conversations).find(
    (conversation) =>
      conversation.id.startsWith('plan-chat-') &&
      !conversation.archivedAt &&
      conversation.runtime.workspaceRef?.kind === 'local' &&
      conversation.runtime.workspaceRef.path === workspace &&
      conversation.mountedResources.some(
        (resource) => resource.ref.type === 'file' && resource.ref.path === path,
      ),
  )
}

type Mode = PlanTaskKind | 'long'
const labels = { weekly: '周度', monthly: '月度', yearly: '年度', long: '长期' }
const dayMs = 86400000
const iso = (date: Date) => date.toISOString().slice(0, 10)
function period(mode: Exclude<Mode, 'long'>, date: Date) {
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth()
  if (mode === 'weekly') {
    const start = new Date(+date - ((date.getUTCDay() + 6) % 7) * dayMs)
    const end = new Date(+start + 6 * dayMs)
    const week = isoWeek(start)
    return {
      path: `周/${week.year}/${week.year}-W${week.week}.md`,
      label: `W${week.week} · ${iso(start).slice(5)}–${iso(end).slice(5)}`,
      start: iso(start),
      end: iso(end),
    }
  }
  if (mode === 'monthly')
    return {
      path: `月/${year}/${iso(date).slice(0, 7)}.md`,
      label: `${month + 1} 月`,
      start: iso(new Date(Date.UTC(year, month, 1))),
      end: iso(new Date(Date.UTC(year, month + 1, 0))),
    }
  return {
    path: `年/${year}.md`,
    label: `${year} 年`,
    start: `${year}-01-01`,
    end: `${year}-12-31`,
  }
}
function progress(text: string) {
  const tasks = [...text.matchAll(/^\s*[-*+] \[([ xX])\]/gm)]
  return tasks.length ? `${tasks.filter((match) => match[1] !== ' ').length}/${tasks.length}` : ''
}
async function readDirectory(path: string) {
  try {
    return await window.cclinkStudio.fs.readDir(path)
  } catch (error) {
    if (/ENOENT/.test(String(error))) return []
    throw error
  }
}
interface Props {
  workspace: string
  planDirectory: string
  directory: string
  timezone: string
  today: string
  diaries: Array<{ year: string; month: string; day: string; name: string; path: string }>
  tasks: ScheduledTaskSnapshot[]
  openTask: (task: ScheduledTaskSnapshot) => void
  openFile: (file: { path: string; name: string }) => void
  refresh: () => void
}
export function DiaryPlans({
  workspace,
  planDirectory,
  directory,
  timezone,
  today,
  diaries,
  tasks,
  openTask,
  openFile,
  refresh,
}: Props) {
  const [mode, setMode] = useState<Mode>('weekly')
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState('')
  const [revision, setRevision] = useState(0)
  const [listing, setListing] = useState<{
    key: string
    files: FsDirEntry[]
    counts: Record<string, string>
  } | null>(null)
  const [action, setAction] = useState<'' | 'new' | 'rename' | 'delete'>('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const root = workspace + '/' + planDirectory + '/'
  const periods = useMemo(() => {
    const date = new Date(today + 'T00:00:00Z')
    if (mode === 'long') return []
    return Array.from({ length: mode === 'weekly' ? 9 : mode === 'monthly' ? 12 : 5 }, (_, i) =>
      period(
        mode,
        mode === 'weekly'
          ? new Date(+date + (offset * 9 + i - 6) * 7 * dayMs)
          : mode === 'monthly'
            ? new Date(Date.UTC(date.getUTCFullYear() + offset, i, 1))
            : new Date(Date.UTC(date.getUTCFullYear() + i - 3, 0, 1)),
      ),
    )
  }, [mode, offset, today])
  const dirs = useMemo(
    () =>
      mode === 'long'
        ? ['长期']
        : [...new Set(periods.map((p) => p.path.slice(0, p.path.lastIndexOf('/'))))],
    [periods, mode],
  )
  const key = root + dirs.join('|')
  useEffect(() => {
    let alive = true
    async function load() {
      const files = (await Promise.all(dirs.map((dir) => readDirectory(root + dir))))
        .flat()
        .filter((f) => f.type === 'file' && !f.symbolicLink && f.name.endsWith('.md'))
      const counts: Record<string, string> = {}
      await Promise.all(
        periods.map(async (p) => {
          const path = root + p.path
          if (files.some((f) => f.path === path))
            counts[path] = progress((await window.cclinkStudio.fs.readTextDocument(path)).content)
        }),
      )
      if (alive) setListing({ key, files, counts })
    }
    void load().catch((e) => {
      if (alive) setError(String(e))
    })
    return () => {
      alive = false
    }
  }, [key, root, dirs, periods, revision])
  const current =
    periods.find((p) => p.path === selected) ??
    periods.find((p) => p.start <= today && p.end >= today) ??
    periods[0]
  const files = listing?.key === key ? listing.files : []
  const path =
    mode === 'long'
      ? (files.find((f) => f.path === selected)?.path ?? files[0]?.path ?? '')
      : root + current?.path
  const file = files.find((f) => f.path === path)
  const fileExists = Boolean(file)
  const text = useEditorStore((s) => s.files[path]?.currentContent ?? '')
  const modifiedAt = useEditorStore((s) => s.files[path]?.modifiedAt)
  const [showDiaries, setShowDiaries] = useState(false)
  const task =
    mode === 'long'
      ? undefined
      : tasks.find(
          (t) =>
            t.definition.outputPolicy.directory === planOutputs[mode][1] &&
            t.definition.outputPolicy.fileNameTemplate === planOutputs[mode][2],
        )
  const dated = diaries.filter(
    (d) =>
      current &&
      [d.year, d.month, d.day].join('-') >= current.start &&
      [d.year, d.month, d.day].join('-') <= current.end,
  )
  const chat = useAgentStore((state) => findPlanChat(state, workspace, path))
  const chatId = chat?.id
  const needsConfirmation = useAgentStore(
    (s) => !!chatId && s.pendingConfirmations.some((r) => r.conversationId === chatId),
  )
  const [actionPath, setActionPath] = useState('')
  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
      setRevision((v) => v + 1)
    }
  }
  async function send(target: string, prompt: string) {
    const editors = useEditorStore.getState()
    if (editors.files[target]?.dirty && (await editors.saveFile(target)) !== 'saved')
      throw Error('请先处理文稿的保存冲突')
    const store = useAgentStore.getState()
    let id = findPlanChat(store, workspace, target)?.id
    if (!id || !store.conversations[id]) {
      id = store.createConversation({
        id: 'plan-chat-' + crypto.randomUUID(),
        activate: false,
        runtime: createConversationRuntimeForWorkspace({ kind: 'local', path: workspace }),
      })
    }
    store.addMountedResource(
      {
        id: 'file:' + target,
        kind: 'file',
        label: target.split('/').pop()!,
        detail: target,
        ref: { type: 'file', path: target },
      },
      id,
    )
    const result = await createConversationRunController({ conversationId: id }).send(
      `当前计划：${target}\n${prompt}\n${editRule}`,
    )
    if (result.status === 'failed' || result.status === 'ignored')
      throw Error(result.status === 'failed' ? result.error : result.reason)
  }
  useEffect(() => {
    let alive = true
    let timer: number | undefined
    const stop = window.cclinkStudio.fs.watchDir(workspace, (event) => {
      if (!alive || !event.filePath.startsWith(root)) return
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        if (fileExists)
          void useEditorStore
            .getState()
            .checkExternalChange(path)
            .catch((e) => {
              if (alive && !String(e).includes('ENOENT')) setError(String(e))
            })
        setRevision((v) => v + 1)
      }, 120)
    })
    void stop.catch((e) => {
      if (alive) setError(String(e))
    })
    return () => {
      alive = false
      window.clearTimeout(timer)
      void stop.then(
        (fn) => fn(),
        () => {},
      )
    }
  }, [root, workspace, path, fileExists])
  function fileName() {
    const value = name.trim().replace(/\.md$/i, '')
    if (!value || value.startsWith('.') || /[\\/\0]/.test(value) || value.length > 120)
      throw Error('请输入有效的计划名称')
    return value + '.md'
  }
  async function create(ai = false) {
    const target = mode === 'long' ? root + '长期/' + fileName() : path
    const title = target.split('/').pop()!.slice(0, -3)
    await window.cclinkStudio.fs.mkdir(target.slice(0, target.lastIndexOf('/')))
    await window.cclinkStudio.fs.createFile(target)
    const blank = await window.cclinkStudio.fs.readTextDocument(target)
    if (blank.content !== '') throw Error('文件已有内容，请重新打开')
    const saved = await window.cclinkStudio.fs.saveTextDocument({
      filePath: target,
      expectedHash: blank.hash,
      content:
        '# ' +
        title +
        '\n\n' +
        (mode === 'long' ? '' : '## 上期回顾\n\n## 本期目标\n\n## 待办\n\n## 备注\n') +
        (ai ? '' : '\n*起草来源：手写*\n'),
    })
    if (saved.status !== 'saved') throw Error('文件已变更，请重新打开')
    setAction('')
    if (mode === 'long') setSelected(target)
    if (ai)
      await send(
        target,
        `请起草 ${current.start} 至 ${current.end} 的${labels[mode]}计划，参考上一期计划、已完成待办及 ${directory} 的相关日记，填入当前计划，完成后在末尾标注「起草来源：AI 生成」。`,
      )
  }
  function choose(next: Mode) {
    setMode(next)
    setOffset(0)
    setSelected('')
    setAction('')
    setError('')
  }
  const isCurrent = (p: { start: string; end: string }) => p.start <= today && p.end >= today
  const split = (label: string) => {
    const [name, range = ''] = label.split(' · ')
    return { name, range: range.replace('–', ' – ') }
  }
  const title = current ? split(current.label) : null
  const md = (date: string) => `${Number(date.slice(5, 7))}/${date.slice(8, 10)}`
  // Design 13: "2026 第48周 · 11/23—11/29", "2026 年 11 月", "2026 年".
  const heading =
    mode === 'long'
      ? (file?.name.replace(/\.md$/, '') ?? '')
      : current
        ? mode === 'weekly'
          ? `${current.start.slice(0, 4)} 第${title?.name.slice(1)}周 · ${md(current.start)}—${md(current.end)}`
          : mode === 'monthly'
            ? `${current.start.slice(0, 4)} 年 ${Number(current.start.slice(5, 7))} 月`
            : `${current.start.slice(0, 4)} 年`
        : ''
  const source = text.includes('起草来源：AI 生成')
    ? 'AI 生成'
    : text.includes('起草来源：手写')
      ? '手写'
      : ''
  const unit = { weekly: '周', monthly: '月', yearly: '年', long: '' }[mode]
  return (
    <div className="diary-plan-layout">
      <div className="diary-plan-center">
        {error && <p role="alert">{error}</p>}
        {listing?.key !== key ? (
          <p className="muted">正在读取计划…</p>
        ) : file ? (
          <>
            <div className="diary-plan-editor" data-file={file.name}>
              <MarkdownEditor key={path} filePath={path} tabId={'plan:' + path} />
            </div>
          </>
        ) : current ? (
          <section className="diary-plan-empty">
            <h3>{heading}</h3>
            <p className="muted">还没有计划</p>
            <div className="diary-plan-actions">
              {current.end >= today && (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => void run(() => create(true))}
                >
                  AI 生成计划
                </button>
              )}
              <button disabled={busy} onClick={() => void run(() => create())}>
                {current.end < today ? '补写计划' : '空白计划'}
              </button>
            </div>
          </section>
        ) : (
          <section className="diary-plan-empty">
            <p className="muted">选择或新建一份长期计划</p>
          </section>
        )}
      </div>
      <aside>
        <nav className="diary-plan-modes">
          {(Object.keys(labels) as Mode[]).map((m) => (
            <button key={m} disabled={busy} aria-pressed={mode === m} onClick={() => choose(m)}>
              {labels[m]}
            </button>
          ))}
        </nav>
        <div className={mode === 'monthly' ? 'diary-plan-months' : 'diary-plan-periods'}>
          {periods.map((p) => {
            const label = split(p.label)
            const status =
              (p.path === current?.path && file
                ? progress(text)
                : listing?.counts[root + p.path]) ||
              (files.some((f) => f.path === root + p.path) ? '有计划' : '')
            return (
              <button
                disabled={busy}
                key={p.path}
                className={`diary-plan-period ${isCurrent(p) ? 'now' : ''}`}
                aria-pressed={p.path === current?.path}
                onClick={() => setSelected(p.path)}
              >
                <b>{label.name}</b>
                {label.range && (
                  <span className="range">
                    {label.range
                      .replace(/(\d{2})-(\d{2})/g, (_m, a, b) => `${Number(a)}/${b}`)
                      .replace(' – ', '—')}
                  </span>
                )}
                {isCurrent(p) && <span className="now-label">本{unit}</span>}
                {status && (
                  <span className="state">
                    <i />
                    {status === '有计划' ? '' : status}
                  </span>
                )}
              </button>
            )
          })}
        </div>
        {(mode === 'weekly' || mode === 'monthly') && (
          <div className="diary-plan-pager">
            <button className="link" disabled={busy} onClick={() => setOffset(offset - 1)}>
              ‹ 更早的{unit}
            </button>
            {offset !== 0 && (
              <button className="link" disabled={busy} onClick={() => setOffset(0)}>
                回到本{unit}
              </button>
            )}
            {offset < 0 && (
              <button className="link" disabled={busy} onClick={() => setOffset(offset + 1)}>
                更晚的{unit} ›
              </button>
            )}
          </div>
        )}
        {mode === 'long' && (
          <div className="diary-plan-long">
            {files.map((f) => (
              <button
                className="diary-plan-period"
                key={f.path}
                disabled={busy}
                aria-pressed={f.path === path}
                onClick={() => {
                  setSelected(f.path)
                  setAction('')
                }}
              >
                <b>{f.name.replace(/\.md$/, '')}</b>
              </button>
            ))}
            <div className="diary-plan-actions">
              <button
                disabled={busy}
                onClick={() => {
                  setName('')
                  setAction('new')
                }}
              >
                ＋ 新建计划
              </button>
              {file && (
                <>
                  <button
                    disabled={busy}
                    onClick={() => {
                      setName(file.name.slice(0, -3))
                      setActionPath(path)
                      setAction('rename')
                    }}
                  >
                    重命名
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => {
                      setActionPath(path)
                      setAction('delete')
                    }}
                  >
                    删除
                  </button>
                </>
              )}
            </div>
            {action && (
              <div className="diary-plan-card">
                {action === 'delete' ? (
                  <p>将「{file?.name}」移入废纸篓？</p>
                ) : (
                  <input
                    aria-label="计划名称"
                    value={name}
                    placeholder="计划名称"
                    onChange={(e) => setName(e.target.value)}
                  />
                )}
                <div className="diary-plan-actions">
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        if (action === 'new') return create()
                        if (!file || path !== actionPath) throw Error('目标文件已变化，请重新选择')
                        if (chat?.loading) throw Error('请等待当前计划的 AI 操作结束')
                        if (
                          useEditorStore.getState().files[path]?.dirty &&
                          (await useEditorStore.getState().saveFile(path)) !== 'saved'
                        )
                          throw Error('请先处理保存冲突')
                        if (action === 'rename') {
                          const next = fileName()
                          if (!(await useFsStore.getState().confirmRename(path, next)))
                            throw Error('重命名失败')
                          const target = root + '长期/' + next
                          setSelected(target)
                        } else {
                          const result = await window.cclinkStudio.fs.trashMarkdownDocument({
                            workspacePath: workspace,
                            documentPath: path,
                            includeAssets: false,
                          })
                          removeTrashedTargets(result.trashedPaths)
                          if (result.failedPaths.length) throw Error('删除失败')
                          setSelected('')
                        }
                        setAction('')
                      })
                    }
                  >
                    确认{action === 'delete' ? '删除' : ''}
                  </button>
                  <button disabled={busy} onClick={() => setAction('')}>
                    取消
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        {file && (
          <section className="diary-plan-info">
            <h4>这份计划</h4>
            <dl>
              <dt>文件</dt>
              <dd title={file.path}>{file.path.slice(workspace.length + 1)}</dd>
              <dt>修改</dt>
              <dd>{modifiedAt ? new Date(modifiedAt).toLocaleString() : '—'}</dd>
              {source && (
                <>
                  <dt>来源</dt>
                  <dd>{source}</dd>
                </>
              )}
              {current && (
                <>
                  <dt>本{unit}日记</dt>
                  <dd>
                    <button className="link" onClick={() => setShowDiaries(!showDiaries)}>
                      {dated.length} 篇 {showDiaries ? '⌄' : '›'}
                    </button>
                  </dd>
                </>
              )}
            </dl>
            {showDiaries &&
              dated.map((d) => (
                <button className="link diary-plan-diary" key={d.path} onClick={() => openFile(d)}>
                  {d.name.replace(/\.md$/, '')}
                </button>
              ))}
            <div className="diary-plan-actions">
              {/* Adjusting a plan uses the one conversation panel on the right. */}
              <button onClick={() => askAi(`调整计划 ${path.slice(workspace.length + 1)}：`)}>
                让 AI 调整
              </button>
              {chat?.loading && <small role="status">AI 正在处理…</small>}
              {chatId && (chat?.loading || needsConfirmation) && (
                <button
                  className="link"
                  onClick={() => {
                    useAgentStore.getState().switchConversation(chatId)
                    useUIStore.getState().setAgentPanelMode('right', 'user')
                  }}
                >
                  {needsConfirmation ? '查看待确认操作' : '查看'}
                </button>
              )}
            </div>
          </section>
        )}
        {mode !== 'long' && (
          <section className="diary-plan-info">
            <h4>{labels[mode]}计划生成</h4>
            {task ? (
              <>
                <dl>
                  <dt>时机</dt>
                  <dd>{describeSchedule(task.definition.schedule)}</dd>
                  <dt>本机</dt>
                  <dd>
                    <span className={task.activation.enabled ? 'on' : 'muted'}>
                      {task.activation.enabled ? '已启用' : '未启用'}
                    </span>{' '}
                    <button
                      className="link"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const r = await window.cclinkStudio.scheduledTasks.setEnabled({
                            workspacePath: workspace,
                            taskId: task.definition.id,
                            enabled: !task.activation.enabled,
                          })
                          if (!r.success) throw Error(r.error?.message)
                          refresh()
                        })
                      }
                    >
                      {task.activation.enabled ? '停用' : '启用'}
                    </button>
                  </dd>
                </dl>
                <button onClick={() => openTask(task)}>编辑生成要求</button>
              </>
            ) : (
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await ensurePlanTask(workspace, directory, timezone, mode)
                    refresh()
                  })
                }
              >
                创建{labels[mode]}计划任务
              </button>
            )}
          </section>
        )}
      </aside>
    </div>
  )
}
