import {
  personalDiarySourceSchema,
  personalDiarySourceSection,
} from '@shared/personal-diary-source'
import { refreshFixedSpaces } from './fixed-spaces-store'
import type { GitRepositorySnapshot } from '@shared/git'
import { useEffect, useState } from 'react'
import {
  workspaceTypeLabels,
  workspaceTypes,
  type WorkspaceSettings,
  type WorkspaceType,
} from '@shared/workspace-settings'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useTabStore } from '../../stores/tab-store'
import { useDiaryNavigation } from './personal-diary-navigation'
import { showWorkspaceHome } from './workspace-home-navigation'
import { openWorkspaceRef } from './workspace-open-controller'
import './workspace-settings.css'

const descriptions: Record<WorkspaceType, string> = {
  general: '项目首页、文件、会话与通用工具',
  diary: '今天、日记、计划和定时整理；接回原资料',
  company: '公司概览、业务项目、账目与运营内容',
  electronics: '设计文件、生产资料与检查；保留现有查看和受限修改能力',
}

export function openWorkspaceSettings(): void {
  useTabStore
    .getState()
    .openTab({ type: 'settings', title: '项目设置', icon: '⚙', settingsSection: 'workspace' })
}

function TypeSelector({
  value,
  onChange,
}: {
  value: WorkspaceType
  onChange: (type: WorkspaceType) => void
}): React.ReactElement {
  return (
    <label>
      项目类型
      <select
        aria-label="项目类型"
        value={value}
        onChange={(e) => onChange(e.target.value as WorkspaceType)}
      >
        {workspaceTypes.map((type) => (
          <option key={type} value={type}>
            {workspaceTypeLabels[type]}
          </option>
        ))}
      </select>
      <small>{descriptions[value]}</small>
    </label>
  )
}

export function WorkspaceSettingsForm(): React.ReactElement {
  const ref = useWorkspaceStore((s) => s.activeWorkspaceRef)
  const snapshot = useWorkspaceStore((s) => s.settingsSnapshot)
  const [sourceStatus, setSourceStatus] = useState('资料：正在读取…')
  const [taskStatus, setTaskStatus] = useState('自动整理：正在读取…')
  const [git, setGit] = useState<GitRepositorySnapshot | null>(null)
  useEffect(() => {
    let alive = true
    setGit(null)
    if (ref.kind === 'local')
      void window.cclinkStudio.git
        .getSnapshot(ref.path)
        .then((value) => {
          if (alive) setGit(value)
        })
        .catch(() => {})
    return () => {
      alive = false
    }
  }, [ref, snapshot?.revision])
  useEffect(() => {
    let alive = true
    if (ref.kind !== 'local') return
    const load = async (): Promise<void> => {
      const state = await window.cclinkStudio.workspaceState.get(ref.path)
      const parsed = personalDiarySourceSchema.safeParse(state.sections[personalDiarySourceSection])
      const directory = parsed.success ? parsed.data.directory : snapshot?.settings.diary?.directory
      const sourcePath = parsed.success ? parsed.data.workspacePath : ref.path
      const ids = parsed.success ? parsed.data.taskIds : (snapshot?.settings.diary?.taskIds ?? [])
      if (alive)
        setSourceStatus(
          directory
            ? `资料：${sourcePath === ref.path ? '项目内' : '关联本机目录'} · ${sourcePath}/${directory}`
            : '资料：尚未关联日记目录',
        )
      if (!ids.length) {
        if (alive) setTaskStatus('自动整理：尚未关联原任务')
        return
      }
      await window.cclinkStudio.workspaceState.listLocalWorkspaces()
      const result = await window.cclinkStudio.scheduledTasks.inspect(sourcePath)
      const found = result.tasks.filter((task) => ids.includes(task.definition.id))
      if (alive)
        setTaskStatus(
          !result.success
            ? '自动整理：原任务状态不可用'
            : found.length < ids.length
              ? `自动整理：${ids.length - found.length} 个定义尚未接回`
              : `自动整理：已关联 ${found.length} 个任务，${found.filter((task) => task.activation.enabled).length} 个在本机启用`,
        )
    }
    void load().catch((error) => {
      if (alive) {
        setSourceStatus('资料：' + String(error))
        setTaskStatus('自动整理：状态不可用')
      }
    })
    return () => {
      alive = false
    }
  }, [ref, snapshot?.revision])
  const [draft, setDraft] = useState<WorkspaceSettings | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [useDiary, setUseDiary] = useState(false)
  const [directory, setDirectory] = useState('日记')
  useEffect(() => {
    setDraft(snapshot?.settings ?? null)
    setUseDiary(!!snapshot?.settings.diary)
    setDirectory(snapshot?.settings.diary?.directory ?? '日记')
    setError('')
    setNotice('')
  }, [snapshot])
  if (ref.kind !== 'local') return <p>当前项目设置仅支持本地目录；远程文件、会话与终端仍可使用。</p>
  if (!draft || !snapshot) return <p role="status">正在读取项目设置…</p>
  const save = async (): Promise<void> => {
    setBusy(true)
    setError('')
    setNotice('')
    const target = useWorkspaceStore.getState().generation
    try {
      const settings = { ...draft }
      if (useDiary)
        settings.diary = {
          directory,
          timezone: draft.diary?.timezone ?? 'Asia/Shanghai',
          taskIds: draft.diary?.taskIds ?? [],
        }
      else delete settings.diary
      await window.cclinkStudio.workspaceState.saveSettings({
        workspacePath: ref.path,
        revision: snapshot.revision,
        settings,
      })
      if (useWorkspaceStore.getState().generation !== target) return
      await useWorkspaceStore.getState().refreshSettings()
      setNotice('项目设置已保存；原文件与任务保持原位。')
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="workspace-settings-form" aria-label="当前项目设置">
      <h2>当前项目</h2>
      <p className="workspace-home-path">{ref.path}</p>
      <label>
        显示名称
        <input
          aria-label="项目显示名称"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
      </label>
      <TypeSelector value={draft.type} onChange={(type) => setDraft({ ...draft, type })} />
      {draft.type !== snapshot.settings.type && (
        <p role="status">
          保存后首页与侧栏变为{workspaceTypeLabels[draft.type]}
          类型。原文件、会话和任务继续保留，不自动运行任务。
        </p>
      )}
      {draft.type === 'diary' && (
        <>
          <label>
            <input
              type="checkbox"
              checked={useDiary}
              onChange={(e) => setUseDiary(e.target.checked)}
            />
            项目内日记目录（随项目配置保存）
          </label>
          {useDiary && (
            <label>
              相对目录
              <input
                aria-label="项目内日记目录"
                value={directory}
                onChange={(e) => setDirectory(e.target.value)}
              />
              <small>
                只记录位置，不创建或移动目录；本机外部关联优先，需在资料接入页解除后才使用此目录。
              </small>
            </label>
          )}
          <button
            onClick={() => {
              useDiaryNavigation.getState().setPage('资料接入')
              showWorkspaceHome(ref)
            }}
          >
            接回本机原资料与任务
          </button>
        </>
      )}
      <div className="workspace-form-actions">
        <button
          disabled={busy}
          onClick={() => {
            setBusy(true)
            setError('')
            void window.cclinkStudio.workspaceState
              .setDefaultWorkspace(ref.path)
              .then(async (result) => {
                if (!result.success) throw Error(result.error)
                await refreshFixedSpaces()
                setNotice('“我的空间”已关联当前项目；旧项目和资料保持原位。')
              })
              .catch((e) => setError(String(e)))
              .finally(() => setBusy(false))
          }}
        >
          将此项目关联到“我的空间”
        </button>
        {
          <button
            disabled={busy}
            onClick={() => {
              setBusy(true)
              setError('')
              void window.cclinkStudio.workspaceState
                .connectCompanySpace({ workspacePath: ref.path, shortcutOnly: true })
                .then(async () => {
                  await refreshFixedSpaces()
                  setNotice(
                    draft.type === 'company'
                      ? '“我的公司”已关联当前公司。'
                      : '“我的公司”已关联当前项目；入口按项目实际类型打开。',
                  )
                })
                .catch((e) => setError(String(e)))
                .finally(() => setBusy(false))
            }}
          >
            {draft.type === 'company' ? '将此公司关联到“我的公司”' : '将此项目关联到“我的公司”'}
          </button>
        }
      </div>
      <p>配置位置：.cclink-studio/workspace-settings.json</p>
      <button
        onClick={() => {
          void window.cclinkStudio.fs
            .revealPath({
              workspacePath: ref.path,
              targetPath: ref.path + '/.cclink-studio/workspace-settings.json',
            })
            .catch((e) => setError(String(e)))
        }}
      >
        在文件夹中显示项目配置
      </button>
      {draft.type === 'diary' && (
        <>
          <p>{sourceStatus}</p>
          <p>{taskStatus}</p>
        </>
      )}
      <p>
        项目设置：{git?.workspaceSettingsTracked ? '已纳入 Git' : '仅在本机'}
        {git?.changes.some((item) => item.path === '.cclink-studio/workspace-settings.json')
          ? ' · 配置有未提交变更'
          : ''}
        {git?.ahead ? ` · ${git.ahead} 个提交未推送` : ''}
      </p>
      <button
        disabled={busy || git?.availability !== 'available' || snapshot.status !== 'saved'}
        onClick={() => {
          setBusy(true)
          setError('')
          void window.cclinkStudio.git
            .shareWorkspaceSettings(ref.path)
            .then((result) => {
              if (!result.success) throw Error(result.message)
              setGit(result.snapshot)
              setNotice(result.message)
            })
            .catch((e) => setError(String(e)))
            .finally(() => setBusy(false))
        }}
      >
        将项目配置纳入 Git（仅暂存）
      </button>
      {snapshot.error && <p role="alert">{snapshot.error}</p>}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <div className="workspace-form-actions">
        <button
          disabled={busy || !['saved', 'missing'].includes(snapshot.status)}
          onClick={() => void save()}
        >
          保存项目设置
        </button>
        <button disabled={busy} onClick={() => void useWorkspaceStore.getState().refreshSettings()}>
          重新加载
        </button>
      </div>
    </section>
  )
}

export function WorkspaceCreationForm({
  onOpened,
  initialType = 'general',
  onCreated,
}: {
  onOpened: () => void
  initialType?: WorkspaceType
  onCreated?: (path: string) => Promise<void>
}): React.ReactElement {
  const [type, setType] = useState<WorkspaceType>(initialType)
  const [name, setName] = useState('')
  const [parent, setParent] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const create = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const result = await window.cclinkStudio.workspaceState.createWorkspace({
        parentPath: parent,
        directoryName: name,
        settings: { version: 1, name, type },
      })
      await onCreated?.(result.workspacePath)
      const ref = await openWorkspaceRef({ kind: 'local', path: result.workspacePath })
      await useWorkspaceStore.getState().refreshSettings()
      showWorkspaceHome(ref)
      onOpened()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="workspace-settings-form" aria-label="新建项目表单">
      <h2>新建项目</h2>
      <TypeSelector value={type} onChange={setType} />
      <label>
        名称
        <input aria-label="新项目名称" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        父目录
        <input aria-label="项目父目录" readOnly value={parent} />
      </label>
      <button
        disabled={busy}
        onClick={() => {
          void window.cclinkStudio.dialog
            .showOpenDialog({ selectDirectory: true, title: '选择新项目的父目录' })
            .then((r) => {
              if (!r.canceled) setParent(r.filePaths[0] ?? '')
            })
            .catch((e) => setError(String(e)))
        }}
      >
        选择父目录
      </button>
      <p>将创建：{parent && name ? `${parent}/${name}` : '请选择位置并填写名称'}</p>
      <p>只创建新目录和项目配置。资料、模板与任务在首页按需接回或创建。</p>
      {error && <p role="alert">{error}</p>}
      <button disabled={busy || !parent || !name.trim()} onClick={() => void create()}>
        {busy ? '正在创建…' : '创建并打开'}
      </button>
    </section>
  )
}

export function WorkspaceGitAcquire({ onOpened }: { onOpened: () => void }): React.ReactElement {
  const [url, setUrl] = useState('')
  const [parent, setParent] = useState('')
  const [username, setUsername] = useState('')
  const [token, setToken] = useState('')
  const [sshKeyPath, setSshKeyPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const acquire = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const result = await window.cclinkStudio.git.transfer({
        action: 'clone',
        url,
        destinationParent: parent,
        username,
        token: token || undefined,
        sshKeyPath: sshKeyPath || undefined,
      })
      if (!result.success) throw Error(result.error.message)
      const ref = await openWorkspaceRef({ kind: 'local', path: result.snapshot.workspacePath })
      await useWorkspaceStore.getState().refreshSettings()
      showWorkspaceHome(ref)
      onOpened()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
      setToken('')
    }
  }
  return (
    <section className="workspace-settings-form" aria-label="从 Git 获取项目">
      <h2>从 Git 获取</h2>
      <label>
        仓库地址
        <input aria-label="获取项目仓库地址" value={url} onChange={(e) => setUrl(e.target.value)} />
      </label>
      <label>
        保存位置
        <input aria-label="Git 保存位置" readOnly value={parent} />
      </label>
      <button
        disabled={busy}
        onClick={() => {
          void window.cclinkStudio.dialog
            .showOpenDialog({ selectDirectory: true, title: '选择 Git 副本的父目录' })
            .then((r) => {
              if (!r.canceled) setParent(r.filePaths[0] ?? '')
            })
            .catch((e) => setError(String(e)))
        }}
      >
        选择 Git 保存位置
      </button>
      <p>
        在所选位置创建独立新副本，不合并已有目录。下载后读取项目类型；本机账号与任务启用状态不会复制。
      </p>
      <details>
        <summary>本次认证（可选）</summary>
        <label>
          HTTPS 用户名
          <input value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label>
          HTTPS Token
          <input
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </label>
        <label>
          SSH 私钥路径
          <input value={sshKeyPath} onChange={(e) => setSshKeyPath(e.target.value)} />
        </label>
      </details>
      {error && <p role="alert">{error}</p>}
      <button disabled={busy || !url.trim() || !parent} onClick={() => void acquire()}>
        {busy ? '正在获取…' : '获取并打开'}
      </button>
    </section>
  )
}
