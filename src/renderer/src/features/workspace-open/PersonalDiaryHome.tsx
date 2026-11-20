import { TaskDefinitionTransfer } from './TaskDefinitionTransfer'
import { useFixedSpacesStore } from './fixed-spaces-store'
import { PersonalDiaryGit } from './PersonalDiaryGit'
import { diaryDateParts, type DiaryDocument } from '@shared/personal-diary-source'
import { ConversationMarkdown } from '../../components/common/ConversationMarkdown'
import { useDiaryNavigation } from './personal-diary-navigation'
import {
  renderScheduledTaskFileName,
  renderScheduledTaskDirectory,
} from '@shared/scheduled-task/scheduled-task-file-name'
import { useEffect, useState } from 'react'
import {
  defaultDiaryDirectory,
  defaultDiaryTimezone,
  diaryDayLocation,
  personalDiarySourceSchema,
  personalDiarySourceSection,
  type PersonalDiarySource,
} from '@shared/personal-diary-source'
import type { WorkspaceStateLocalWorkspaceSummary } from '@shared/ipc/workspace-state'
import type { FsDirEntry } from '@shared/ipc/fs'
import type { ScheduledTaskSnapshot } from '@shared/scheduled-task/scheduled-task-types'
import { openWorkspaceRef } from './workspace-open-controller'
import { useTabStore } from '../../stores/tab-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import {
  createScheduledTaskTab,
  describeSchedule,
  formatNextRun,
} from '../scheduled-tasks/scheduled-task-view-model'

export function PersonalDiaryHome(): React.ReactElement {
  const ownerRef = useWorkspaceStore((state) => state.activeWorkspaceRef)
  const ownerPath = ownerRef.kind === 'local' ? ownerRef.path : null
  const config = useWorkspaceStore((state) => state.settingsSnapshot)
  const [source, setSource] = useState<PersonalDiarySource | null>(null)
  const [known, setKnown] = useState<WorkspaceStateLocalWorkspaceSummary[]>([])
  const [path, setPath] = useState('')
  const [directory, setDirectory] = useState(defaultDiaryDirectory)
  const [files, setFiles] = useState<FsDirEntry[]>([])
  const [tasks, setTasks] = useState<ScheduledTaskSnapshot[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [error, setError] = useState('')
  const { page, setPage } = useDiaryNavigation()
  const [preview, setPreview] = useState<DiaryDocument | null>(null)
  const [previewPath, setPreviewPath] = useState('')
  const [notice, setNotice] = useState('')
  const [timezone, setTimezone] = useState(defaultDiaryTimezone)
  const [busy, setBusy] = useState(true)
  const [revision, setRevision] = useState(0)
  const [clock, setClock] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    let alive = true
    void Promise.all([
      window.cclinkStudio.workspaceState.listLocalWorkspaces(),
      window.cclinkStudio.workspaceState.get(ownerPath),
    ])
      .then(async ([items, snapshot]) => {
        if (!alive) return
        setKnown(items.filter((item) => item.projectId))
        let value = snapshot.sections[personalDiarySourceSection]
        if (
          value === undefined &&
          ownerPath === useFixedSpacesStore.getState().spaces?.personal?.workspacePath
        )
          value = (await window.cclinkStudio.workspaceState.get(null)).sections[
            personalDiarySourceSection
          ]
        if (!alive) return
        if (value === undefined && config?.settings.diary) {
          const root = items.find((item) => item.workspacePath === ownerPath)
          if (root?.projectId)
            value = {
              version: 1,
              workspacePath: ownerPath,
              projectId: root.projectId,
              ...config.settings.diary,
            }
        }
        if (value) {
          const link = personalDiarySourceSchema.parse(value)
          setSource(link)
          setPath(link.workspacePath)
          setDirectory(link.directory)
          setTimezone(link.timezone)
          setSelected(link.taskIds)
        } else setPage('资料接入')
      })
      .catch((e) => {
        if (alive) setError(String(e))
      })
      .finally(() => {
        if (alive) setBusy(false)
      })
    return () => {
      alive = false
    }
  }, [ownerPath, config?.revision])
  useEffect(() => {
    if (!source) return
    let alive = true
    setError('')
    setFiles([])
    setTasks([])
    setBusy(true)
    void (async () => {
      const entries = await window.cclinkStudio.workspaceState.listLocalWorkspaces()
      if (
        !entries.some(
          (entry) =>
            entry.workspacePath === source.workspacePath && entry.projectId === source.projectId,
        )
      )
        throw new Error('来源身份不可用，请重新连接；原资料已保留')
      await window.cclinkStudio.workspaceState.verifyLocalIdentity(
        source.workspacePath,
        source.projectId,
      )
      const found: FsDirEntry[] = []
      let visited = 0
      const walk = async (dir: string, depth: number): Promise<void> => {
        if (++visited > 150) throw new Error('目录过多，请连接更具体的个人资料目录')
        for (const entry of await window.cclinkStudio.fs.readDir(dir)) {
          if (entry.symbolicLink) continue
          if (entry.type === 'file' && entry.name.toLowerCase().endsWith('.md')) found.push(entry)
          else if (
            entry.type === 'directory' &&
            depth < 3 &&
            !entry.name.endsWith('.assets') &&
            !entry.name.startsWith('.')
          )
            await walk(entry.path, depth + 1)
          if (found.length > 2000) throw new Error('资料超过 2000 份，请缩小连接目录')
        }
      }
      await walk(source.workspacePath + '/' + source.directory, 0)
      if (alive) setFiles(found.sort((a, b) => b.path.localeCompare(a.path)))
      const result = await window.cclinkStudio.scheduledTasks.inspect(source.workspacePath)
      if (!result.success) throw new Error(result.error?.message || '原任务读取失败')
      if (alive) {
        setTasks(result.tasks)
        if (result.issues?.length) setError(result.issues.map((i) => i.message).join('；'))
      }
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
  const connect = async (): Promise<void> => {
    const item = known.find((entry) => entry.workspacePath === path)
    if (!item?.projectId) throw new Error('请选择已经打开过的原工作空间')
    const value = personalDiarySourceSchema.parse({
      version: 1,
      workspacePath: path,
      projectId: item.projectId,
      directory,
      timezone,
      taskIds: source?.workspacePath === path ? selected : [],
    })
    await window.cclinkStudio.fs.readDir(path + '/' + value.directory)
    const result = await window.cclinkStudio.workspaceState.setSection(
      ownerPath,
      personalDiarySourceSection,
      value,
    )
    if (!result.success) throw new Error(result.error)
    setPreviewPath('')
    setSource(value)
    setSelected(value.taskIds)
    setPage('今天')
  }
  const startBlank = async (): Promise<void> => {
    const ref = useWorkspaceStore.getState().activeWorkspaceRef
    if (ref.kind !== 'local') throw Error('请先进入我的空间')
    await window.cclinkStudio.fs.mkdir(ref.path + '/' + defaultDiaryDirectory)
    const roots = await window.cclinkStudio.workspaceState.listLocalWorkspaces()
    const root = roots.find((item) => item.workspacePath === ref.path)
    if (!root?.projectId) throw Error('个人空间身份不可用，请重新进入')
    const value = personalDiarySourceSchema.parse({
      version: 1,
      workspacePath: ref.path,
      projectId: root.projectId,
      directory: defaultDiaryDirectory,
      timezone,
      taskIds: [],
    })
    const result = await window.cclinkStudio.workspaceState.setSection(
      ownerPath,
      personalDiarySourceSection,
      value,
    )
    if (!result.success) throw Error(result.error)
    if (config?.status === 'saved') {
      await window.cclinkStudio.workspaceState.saveSettings({
        workspacePath: ref.path,
        revision: config.revision,
        settings: {
          ...config.settings,
          diary: { directory: defaultDiaryDirectory, timezone, taskIds: [] },
        },
      })
      await useWorkspaceStore.getState().refreshSettings()
    }
    setKnown(roots.filter((item) => item.projectId))
    setSource(value)
    setPath(value.workspacePath)
    setDirectory(value.directory)
    setSelected([])
    setPage('今天')
  }
  const open = async (
    file?: Pick<FsDirEntry, 'path' | 'name'>,
    task?: ScheduledTaskSnapshot,
  ): Promise<void> => {
    if (!source) return
    const ref = { kind: 'local' as const, path: source.workspacePath }
    await openWorkspaceRef(ref)
    const active = useWorkspaceStore.getState().activeWorkspaceRef
    if (active.kind !== 'local' || active.path !== ref.path) throw new Error('来源切换未完成')
    if (file)
      useTabStore.getState().openTab({
        type: 'editor',
        title: file.name,
        filePath: file.path,
        workspaceRef: ref,
        icon: '📄',
      })
    if (task) useTabStore.getState().openTab(createScheduledTaskTab(ref.path, task))
  }
  const day = diaryDateParts(source?.timezone ?? timezone, new Date(clock))
  const location = diaryDayLocation(day)
  const diaries = files.filter((file) => /^\d{4}[_-]周.*\.md$/.test(file.name))
  const today = diaries.filter(
    (file) =>
      source &&
      location.matchesName(file.name) &&
      file.path === [source.workspacePath, source.directory, location.folder, file.name].join('/'),
  )
  const plans = files.filter((file) => !diaries.includes(file))
  const shown = page === '今天' ? today : page === '日记' ? diaries : plans
  const selectedPreview =
    previewPath || (page === '今天' && today.length === 1 ? today[0].path : '')
  useEffect(() => {
    setPreviewPath('')
  }, [page, day.year, day.month, day.day])
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
  const prepare = async (): Promise<void> => {
    const result = await window.cclinkStudio.workspaceState.diaryDocument({
      action: 'prepare',
      workspacePath: ownerPath ?? undefined,
    })
    setPreviewPath(result.path)
    setPreview(result)
    setRevision((value) => value + 1)
    setNotice(
      result.created
        ? '已新建今日空白模板；尚未运行 AI 整理，未知事实保持空白。'
        : '今日日记已存在，继续使用原文件。',
    )
  }
  const prepareWithTask = async (task: ScheduledTaskSnapshot): Promise<void> => {
    if (!source) return
    if (today.length > 1) throw Error('今天有多份日记，请在日记列表中选择原文件')
    if (today.length) {
      setPreviewPath(today[0].path)
      setNotice('今天已有日记，继续写原文件。')
      return
    }
    const timestamp = Date.now()
    const taskDay = diaryDayLocation(diaryDateParts(source.timezone, new Date(timestamp)))
    const definition = task.definition
    const output =
      renderScheduledTaskDirectory(
        definition.outputPolicy.directory,
        timestamp,
        definition.schedule.timezone,
      ) +
      '/' +
      renderScheduledTaskFileName({
        template: definition.outputPolicy.fileNameTemplate,
        timestamp,
        timezone: definition.schedule.timezone,
        taskId: definition.id,
        runId: 'preview',
      })
    const expected = [source.directory, taskDay.folder, taskDay.filename].join('/')
    if (output !== expected)
      throw Error(
        `原任务输出为 ${output}，今日应为 ${expected}。请打开原任务核对输出目录和命名；未修改或运行原任务。目录可用 {year}/{month}，文件名可用 {monthDay}_{weekday}.md。`,
      )
    const result = await window.cclinkStudio.scheduledTasks.runNow({
      workspacePath: source.workspacePath,
      taskId: definition.id,
    })
    if (!result.success) throw Error(result.error?.message || '整理未能开始')
    setNotice(
      `原任务已${result.run?.status === 'queued' ? '排队' : '启动'}，请在下方查看实际进度；还未完成日记。`,
    )
    setRevision((value) => value + 1)
  }
  return (
    <section className="personal-diary-home">
      <h2>
        {page === '今天' ? `今天 · ${day.year}-${day.month}-${day.day} ${day.weekday}` : page}
      </h2>
      <p>接着写原日记，继续原计划与定时整理。</p>
      {source && (
        <p className="workspace-home-path">
          资料来源：{source.workspacePath}/{source.directory}{' '}
          <button onClick={() => setRevision((value) => value + 1)}>刷新</button>
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
      {busy && <p role="status">正在读取原资料…</p>}
      {page === 'Git' ? (
        <PersonalDiaryGit
          ownerPath={ownerPath}
          source={source}
          onConnected={(value) => {
            setPreviewPath('')
            setSource(value)
            setTimezone(value.timezone)
            setPath(value.workspacePath)
            setDirectory(value.directory)
            setSelected([])
            setPage('今天')
          }}
        />
      ) : page === '资料接入' ? (
        <div className="diary-source-form">
          <button
            disabled={busy}
            onClick={() =>
              act(async () => {
                const picked = await window.cclinkStudio.dialog.showOpenDialog({
                  selectDirectory: true,
                  title: '选择原资料所在项目',
                })
                if (picked.canceled || !picked.filePaths[0]) return
                const root = picked.filePaths[0]
                await window.cclinkStudio.workspaceState.get(root)
                const roots = await window.cclinkStudio.workspaceState.listLocalWorkspaces()
                setKnown(roots.filter((item) => item.projectId))
                setPath(root)
              })
            }
          >
            选择原资料目录
          </button>
          <label>
            原工作空间
            <select aria-label="原工作空间" value={path} onChange={(e) => setPath(e.target.value)}>
              <option value="">选择已打开过的空间</option>
              {known.map((item) => (
                <option key={item.workspacePath} value={item.workspacePath}>
                  {item.workspacePath}
                </option>
              ))}
            </select>
          </label>
          <label>
            个人资料目录
            <input
              aria-label="个人资料目录"
              value={directory}
              onChange={(e) => setDirectory(e.target.value)}
            />
          </label>
          <label>
            日记时区
            <input
              aria-label="日记时区"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
            />
          </label>
          {!source && (
            <button disabled={busy} onClick={() => act(startBlank)}>
              从空白日记开始
            </button>
          )}
          <p>使用原目录及文件名，仅保存本机连接。也可直接选择原资料所在的项目目录。</p>
          <button disabled={busy || !path} onClick={() => act(connect)}>
            确认连接
          </button>
          {source && (
            <button
              onClick={() =>
                act(async () => {
                  const result = await window.cclinkStudio.workspaceState.setSection(
                    ownerPath,
                    personalDiarySourceSection,
                    null,
                  )
                  if (!result.success) throw new Error(result.error)
                  setSource(null)
                  setFiles([])
                  setTasks([])
                })
              }
            >
              解除资料连接（原文件保留）
            </button>
          )}
        </div>
      ) : page === '定时整理' ? (
        <div>
          <p>勾选要在个人空间关联的原任务；关联不会启用、复制或运行任务。</p>
          {!tasks.length && (
            <p>
              尚未接回任务定义。请使用下方“接回原任务定义”，或获取已共享定义的 Git
              项目；本机启用状态不会复制。
            </p>
          )}
          {source && (
            <TaskDefinitionTransfer
              workspacePath={source.workspacePath}
              taskIds={selected}
              onImported={(ids) => {
                setSelected((current) => [...new Set([...current, ...ids])])
                setRevision((value) => value + 1)
              }}
            />
          )}
          {tasks.map((task) => (
            <div className="workspace-home-record" key={task.definition.id}>
              <label>
                <input
                  type="checkbox"
                  checked={selected.includes(task.definition.id)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...selected, task.definition.id]
                        : selected.filter((id) => id !== task.definition.id),
                    )
                  }
                />
                {task.definition.title}
              </label>
              {/\/(Users|home)\//.test(task.definition.instruction) && (
                <small>指令含电脑绝对路径；换机后请打开原任务核对资源位置。</small>
              )}
              <span>
                {describeSchedule(task.definition.schedule)} ·{' '}
                {task.activation.enabled &&
                (task.definition.source === 'local' ||
                  task.activation.confirmedExecutionDigest === task.definition.executionDigest)
                  ? `此设备已启用 · ${formatNextRun(task.activation.nextRunAt)}`
                  : task.activation.enabled
                    ? '定义已变化，待重新确认'
                    : '此设备未启用'}
              </span>
              <button onClick={() => act(() => open(undefined, task))}>打开原任务与历史</button>
            </div>
          ))}
          {source && (
            <button
              onClick={() =>
                act(async () => {
                  const value = { ...source, taskIds: selected }
                  const result = await window.cclinkStudio.workspaceState.setSection(
                    ownerPath,
                    personalDiarySourceSection,
                    value,
                  )
                  if (!result.success) throw new Error(result.error)
                  if (source.workspacePath === ownerPath && config?.status === 'saved') {
                    await window.cclinkStudio.workspaceState.saveSettings({
                      workspacePath: ownerPath!,
                      revision: config.revision,
                      settings: {
                        ...config.settings,
                        diary: {
                          directory: source.directory,
                          timezone: source.timezone,
                          taskIds: selected,
                        },
                      },
                    })
                    await useWorkspaceStore.getState().refreshSettings()
                  }
                  setSource(value)
                })
              }
            >
              保存任务关联
            </button>
          )}
        </div>
      ) : (
        <div>
          {page === '今天' && source && !today.length && (
            <div className="diary-prepare">
              <h3>准备今日日记</h3>
              <p>在原目录按年 / 月新增；同名文件已存在时继续使用原文。</p>
              {tasks
                .filter(
                  (task) =>
                    source.taskIds.includes(task.definition.id) &&
                    task.definition.schedule.kind === 'daily',
                )
                .map((task) => (
                  <button
                    disabled={busy}
                    key={task.definition.id}
                    onClick={() => act(() => prepareWithTask(task))}
                  >
                    用“{task.definition.title}”准备今天
                  </button>
                ))}
              <button disabled={busy} onClick={() => act(prepare)}>
                创建今日空白模板
              </button>
            </div>
          )}
          {!busy && !shown.length && (
            <p>
              {source
                ? '此处尚未找到对应文件，可查看日记目录或调整资料连接。'
                : '先连接原资料，日记与计划就会在这里出现。'}
            </p>
          )}
          {shown.map((file) => (
            <button
              className="workspace-home-record"
              key={file.path}
              onClick={() => {
                setPreviewPath(file.path)
                setNotice('')
              }}
            >
              {file.name}
              <span>{file.path.slice((source?.workspacePath.length ?? 0) + 1)}</span>
            </button>
          ))}
          {preview && (
            <article className="diary-preview" aria-label="日记正文预览">
              <header>
                <strong>已保存正文 · {preview.path.split('/').pop()}</strong>
                <button
                  onClick={() =>
                    act(() => open({ name: preview.path.split('/').pop()!, path: preview.path }))
                  }
                >
                  继续写原文
                </button>
              </header>
              <ConversationMarkdown source={preview.content} />
              {preview.truncated && <p>正文较长，显示前 128 KB；打开原文可查看全文。</p>}
            </article>
          )}
          {page === '今天' &&
            tasks
              .filter((task) => source?.taskIds.includes(task.definition.id))
              .map((task) => (
                <button
                  className="workspace-home-record"
                  key={task.definition.id}
                  onClick={() => act(() => open(undefined, task))}
                >
                  {task.definition.title}
                  <span>
                    {task.latestRun
                      ? `${task.latestRun.status} · ${task.latestRun.currentStep}`
                      : '尚无运行记录'}{' '}
                    · 查看原任务与产物
                  </span>
                </button>
              ))}
        </div>
      )}
    </section>
  )
}
