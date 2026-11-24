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
import { editRule } from './diary-ai'
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
  const [drafts, setDrafts] = useState<Record<string, string>>({})
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
    setDrafts((prev) => (prev[target] === prompt ? { ...prev, [target]: '' } : prev))
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
  return (
    <div className="diary-plan-layout">
      <div className="diary-plan-center">
        {error && <p role="alert">{error}</p>}
        {listing?.key !== key ? (
          <p>正在读取计划…</p>
        ) : file ? (
          <>
            <header>
              <strong>{file.name}</strong>　
              <small>
                {text.includes('起草来源：AI 生成')
                  ? 'AI 生成'
                  : text.includes('起草来源：手写')
                    ? '手写'
                    : '来源未记录'}
              </small>
              　{progress(text)}　
            </header>
            <div className="diary-plan-editor">
              <MarkdownEditor key={path} filePath={path} tabId={'plan:' + path} />
            </div>
            <section className="diary-plan-chat">
              <strong>与 AI 对话</strong> <small>当前文稿 · {file.name}</small>
              {chatId && (
                <button
                  onClick={() => {
                    useAgentStore.getState().switchConversation(chatId)
                    useUIStore.getState().setAgentPanelMode('right', 'user')
                  }}
                >
                  {needsConfirmation ? '查看待确认操作' : '完整对话'}
                </button>
              )}
              {chat?.loading && <small role="status"> AI 正在处理…</small>}
              <div aria-live="polite">
                {chat?.messages.slice(-4).map((m) => (
                  <p key={m.id}>
                    {m.role === 'user' ? '你' : 'AI'}　{m.rawText}
                  </p>
                ))}
              </div>
              <textarea
                aria-label="调整当前计划"
                value={drafts[path] ?? ''}
                onChange={(e) => setDrafts({ ...drafts, [path]: e.target.value })}
                placeholder="希望怎样调整这份计划？"
              />
              <button
                disabled={busy || !drafts[path]?.trim()}
                onClick={() => void run(() => send(path, drafts[path]))}
              >
                发送
              </button>
            </section>
          </>
        ) : current ? (
          <section>
            <h3>{current.label}</h3>
            <p>这期还没有计划</p>
            <p>生成依据：上一期计划、待办完成情况和期间日记。</p>
            <p>{path.slice(workspace.length + 1)}</p>
            {current.end >= today && (
              <button disabled={busy} onClick={() => void run(() => create(true))}>
                AI 生成计划
              </button>
            )}
            <button disabled={busy} onClick={() => void run(() => create())}>
              {current.end < today ? '补写计划' : '空白计划'}
            </button>
            <p className="muted">创建后，底部 AI 对话会自动关联这份计划。</p>
          </section>
        ) : (
          <p>从右侧新建长期计划。</p>
        )}
      </div>
      <aside>
        <nav>
          {(Object.keys(labels) as Mode[]).map((m) => (
            <button key={m} disabled={busy} aria-pressed={mode === m} onClick={() => choose(m)}>
              {labels[m]}
            </button>
          ))}
        </nav>
        {mode === 'monthly' && <strong>{Number(today.slice(0, 4)) + offset} 年</strong>}
        {(mode === 'weekly' || mode === 'monthly') && (
          <div>
            <button disabled={busy} onClick={() => setOffset(offset - 1)}>
              ‹ 上一页
            </button>
            <button disabled={busy} onClick={() => setOffset(offset + 1)}>
              下一页 ›
            </button>
          </div>
        )}
        <div className={mode === 'monthly' ? 'diary-plan-months' : 'diary-plan-periods'}>
          {periods.map((p) => (
            <button
              disabled={busy}
              key={p.path}
              aria-pressed={p.path === current?.path}
              onClick={() => setSelected(p.path)}
            >
              {p.label} {p.start <= today && p.end >= today ? '· 本期' : ''}{' '}
              {(p.path === current?.path && file
                ? progress(text)
                : listing?.counts[root + p.path]) ||
                (files.some((f) => f.path === root + p.path) ? '有计划' : '')}
            </button>
          ))}
        </div>
        {mode === 'long' && (
          <>
            <button
              disabled={busy}
              onClick={() => {
                setName('')
                setAction('new')
              }}
            >
              ＋ 新建计划
            </button>
            {files.map((f) => (
              <button
                className="diary-plan-row"
                key={f.path}
                disabled={busy}
                aria-pressed={f.path === path}
                onClick={() => {
                  setSelected(f.path)
                  setAction('')
                }}
              >
                {f.name}
              </button>
            ))}
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
            {action && (
              <div>
                {action === 'delete' ? (
                  <p>将「{file?.name}」移入废纸篓？</p>
                ) : (
                  <input
                    aria-label="计划名称"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                )}
                <button
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
                        if (target !== path)
                          setDrafts((prev) => ({ ...prev, [target]: prev[path] ?? '', [path]: '' }))
                        setSelected(target)
                      } else {
                        const result = await window.cclinkStudio.fs.trashMarkdownDocument({
                          workspacePath: workspace,
                          documentPath: path,
                          includeAssets: false,
                        })
                        removeTrashedTargets(result.trashedPaths)
                        if (result.failedPaths.length) throw Error('删除失败')
                        setDrafts((prev) => ({ ...prev, [path]: '' }))
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
            )}
          </>
        )}
        {file && (
          <p>
            {file.path.slice(workspace.length + 1)}
            <br />
            修改于 {modifiedAt ? new Date(modifiedAt).toLocaleString() : '读取中'}
          </p>
        )}
        {current && (
          <details>
            <summary>本期日记 · {dated.length} 篇</summary>
            {dated.map((d) => (
              <button key={d.path} onClick={() => openFile(d)}>
                {d.name}
              </button>
            ))}
          </details>
        )}
        {mode !== 'long' && (
          <section>
            <h4>{labels[mode]}计划生成</h4>
            {task ? (
              <>
                <p>
                  {describeSchedule(task.definition.schedule)} · {task.definition.schedule.timezone}
                </p>
                <p>依据：上一期计划、期间日记、待办完成情况</p>
                <p>
                  {task.definition.outputPolicy.directory.replace('{planRoot}', planDirectory)}/
                  {task.definition.outputPolicy.fileNameTemplate}
                </p>
                <button
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
                  {task.activation.enabled ? '本机已启用 · 停用' : '本机未启用 · 启用'}
                </button>
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
