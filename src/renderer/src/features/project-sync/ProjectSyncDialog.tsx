import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  parseGitHubHttpsRepository,
  type ProjectSyncFileResolution,
  type ProjectSyncPreview,
} from '@shared/git'
import { useFloatingSurfaceRegistration } from '../../components/common/floating-surface-registry'
import { useEscapeDismiss } from '../../components/common/dismissable-layer'
import { useTabStore } from '../../stores/tab-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import {
  DiarySyncChoice,
  diarySyncChoiceReady,
  type DiarySyncChoiceValue,
} from '../workspace-open/DiarySyncChoice'
import {
  loadProjectSyncPreview,
  projectSyncLabel,
  runProjectSync,
  stopProjectSync,
  useProjectSync,
  useProjectSyncDialog,
} from './project-sync-store'
import '../workspace-open/fixed-spaces.css'
import './project-sync.css'

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return (bytes / 1024 ** 3).toFixed(1) + ' GB'
  if (bytes >= 1024 ** 2) return Math.round(bytes / 1024 ** 2) + ' MB'
  if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB'
  return bytes + ' B'
}

/** GitHub allows letters, digits, “.”, “_” and “-”; Chinese folder names fall back. */
export function defaultRepositoryName(path: string): string {
  const base = path.split('/').filter(Boolean).at(-1) ?? ''
  const name = base
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 100)
  return name || 'studio-project'
}

const skipReason: Record<string, string> = {
  large: '超过 50 MB',
  sensitive: '可能含密钥',
  'nested-repository': '另一个 Git 仓库',
}

function ScopePreview({ preview }: { preview: ProjectSyncPreview }): React.ReactElement {
  const groups = preview.groups.slice(0, 7)
  const rest = preview.groups.slice(7).reduce((n, g) => n + g.files, 0)
  return (
    <div className="project-sync-scope">
      <section>
        <header>
          <b>项目文件</b>
          <small>
            {preview.files}
            {preview.truncated ? '+' : ''} 个 · {formatBytes(preview.bytes)}
          </small>
        </header>
        <ul>
          {groups.map((g) => (
            <li key={g.name}>
              <span>
                {g.name === ''
                  ? '其他文件'
                  : g.name === '.cclink-studio'
                    ? '项目设置、共享定时任务'
                    : g.name + '/'}
              </span>
              <small>
                {g.files} · {formatBytes(g.bytes)}
              </small>
            </li>
          ))}
          {rest > 0 && (
            <li>
              <span>其余文件夹</span>
              <small>{rest}</small>
            </li>
          )}
          {!preview.files && <li className="muted">还没有可上传的文件</li>}
        </ul>
      </section>
      {preview.company && (
        <section className="project-sync-company">
          <header>
            <b>公司记录与账目</b>
            <small>逐条同步</small>
          </header>
          <ul>
            {preview.company.map((c) => (
              <li key={c.label}>
                <span>{c.label}</span>
                <small>{c.count}</small>
              </li>
            ))}
            {!preview.company.length && <li className="muted">启用公司视图后随项目同步</li>}
          </ul>
        </section>
      )}
      <section>
        <header>
          <b>不会上传</b>
          <small>已排除</small>
        </header>
        <ul>
          {preview.skipped.slice(0, 8).map((s) => (
            <li key={s.path}>
              <span title={s.path}>{s.path}</span>
              <small>
                {s.size ? formatBytes(s.size) + ' · ' : ''}
                {skipReason[s.reason]}
              </small>
            </li>
          ))}
          {preview.generated.slice(0, 4).map((p) => (
            <li key={p}>
              <span title={p}>{p}</span>
              <small>可重新生成</small>
            </li>
          ))}
          {preview.skipped.length + preview.generated.length === 0 && (
            <li className="muted">没有</li>
          )}
          {preview.skipped.length > 8 && (
            <li className="muted">还有 {preview.skipped.length - 8} 个</li>
          )}
        </ul>
      </section>
      <section>
        <header>
          <b>只在这台电脑</b>
          <small>不随同步</small>
        </header>
        <ul>
          <li>
            <span>Agent 会话、窗口布局</span>
            <small>本机</small>
          </li>
          <li>
            <span>发布任务记录、下载</span>
            <small>本机</small>
          </li>
          <li>
            <span>网站账号登录、GitHub Token</span>
            <small>从不上传</small>
          </li>
          <li>
            <span>公司数据库文件</span>
            <small>由记录读入</small>
          </li>
        </ul>
      </section>
    </div>
  )
}

function usePreview(path: string): { preview?: ProjectSyncPreview; error: string } {
  const preview = useProjectSync(path).preview
  const [error, setError] = useState('')
  useEffect(() => {
    setError('')
    loadProjectSyncPreview(path).catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [path])
  return { preview: preview?.workspacePath === path ? preview : undefined, error }
}

function SetupView({ path, onDone }: { path: string; onDone(): void }): React.ReactElement {
  const name = useWorkspaceStore((s) => s.settingsSnapshot?.settings.name) ?? ''
  const { preview, error: previewError } = usePreview(path)
  const [choice, setChoice] = useState<DiarySyncChoiceValue>({
    mode: 'none',
    name: defaultRepositoryName(path),
    url: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const urlInvalid =
    choice.mode === 'url' && choice.url.trim() !== '' && !parseGitHubHttpsRepository(choice.url)
  const ready = choice.mode !== 'none' && diarySyncChoiceReady(choice) && !urlInvalid && !!preview
  const save = async () => {
    setBusy(true)
    setError('')
    try {
      let url = choice.url.trim()
      if (choice.mode === 'create') {
        const created = await window.cclinkStudio.gitBackup.createPrivateRepository(
          choice.name.trim(),
        )
        if (!created.success || !created.cloneUrl)
          throw Error(
            created.errorCode === 'REMOTE_CONFLICT'
              ? `GitHub 上已有公开仓库 ${choice.name.trim()}，项目只能同步到私有仓库。请换一个仓库名。`
              : created.error || 'GitHub 新建仓库失败',
          )
        url = created.cloneUrl
      }
      // The dialog turns into the live status once the address is recorded.
      await runProjectSync(path, true, { url })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  if (preview?.gitManaged)
    return (
      <>
        <h2>这个项目由 Git 管理</h2>
        <p>
          这个文件夹本身是 Git 仓库。Studio 不会替你自动提交或推送，请用左下角 Git
          查看变更、提交并推送。
        </p>
      </>
    )
  return (
    <>
      <h2>设置同步</h2>
      <p className="project-sync-sub">
        {name} · {path}
      </p>
      <h3>同步到哪里</h3>
      <DiarySyncChoice value={choice} onChange={setChoice} disabled={busy} />
      {urlInvalid && (
        <p role="alert">只接受 GitHub 私有仓库地址，例如 https://github.com/你的账号/仓库.git</p>
      )}
      {choice.mode === 'url' && !urlInvalid && (
        <p className="project-sync-hint">
          保存时用已保存的 GitHub 账号检查：公开仓库、无权访问的仓库无法保存。仓库只用于这个项目。
        </p>
      )}
      <h3>第一次会上传什么</h3>
      {preview ? (
        <ScopePreview preview={preview} />
      ) : previewError ? (
        <p role="alert">{previewError}</p>
      ) : (
        <p>正在列出文件…</p>
      )}
      {choice.mode !== 'none' && (
        <>
          <h3>谁能看到</h3>
          <p>
            项目文件（公司项目还包括客户和账目记录）会存在这个 GitHub
            私有仓库里，能打开仓库的人都能读到，不需要另设密码。不要把仓库设为公开或添加不需要的协作者；仓库变成公开时同步会自动暂停。
          </p>
        </>
      )}
      <p className="project-sync-note">
        保存后，进入这个项目时、留在前台每个整点自动双向同步，也可随时点“立即同步”。两边改了同一处时会暂停等你决定，不会覆盖任何一份。
      </p>
      {error && <p role="alert">{error}</p>}
      <footer>
        <button className="primary" disabled={!ready || busy} onClick={() => void save()}>
          {busy ? '正在同步…' : '保存并同步'}
        </button>
        <button onClick={onDone} disabled={busy}>
          取消
        </button>
      </footer>
    </>
  )
}

function ConflictView({ path }: { path: string }): React.ReactElement {
  const state = useProjectSync(path)
  const snap = state.snapshot!
  const files = snap.conflictFiles ?? []
  const texts = files.filter((f) => f.kind === 'text')
  const binaries = files.filter((f) => f.kind !== 'text')
  const [feedback, setFeedback] = useState('')
  const [choices, setChoices] = useState<Record<string, ProjectSyncFileResolution>>({})
  const ready =
    (!texts.length || feedback.trim()) && binaries.every((f) => choices[f.path]) && !state.busy
  return (
    <>
      <h2>两份内容需要你决定</h2>
      <p>这台电脑和另一台电脑改了同一处。两份都已保留，你决定前不会覆盖任何一份。</p>
      {texts.length > 0 && (
        <>
          <h3>文字：{texts.map((t) => t.path).join('、')}</h3>
          <pre className="project-sync-pre">{snap.conflict}</pre>
          <label className="project-sync-field">
            告诉 AI 怎么处理
            <textarea
              placeholder="例如：价格用 659 元，其余用 MacBook Air 的写法。"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
            />
          </label>
        </>
      )}
      {binaries.map((f) => (
        <fieldset key={f.path} className="project-sync-choice">
          <legend>{f.kind === 'record' ? f.label : f.path}</legend>
          {f.kind === 'record' && (
            <table className="project-sync-fields">
              <thead>
                <tr>
                  <th>字段</th>
                  <th>这台电脑</th>
                  <th>另一台电脑</th>
                </tr>
              </thead>
              <tbody>
                {f.fields?.map((field) => (
                  <tr key={field.name}>
                    <td>{field.name}</td>
                    <td>{field.local}</td>
                    <td>{field.remote}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {(
            [
              ['local', f.hasLocal ? '用这台电脑的' : '照这台电脑删除'],
              ['remote', f.hasRemote ? '用另一台电脑的' : '照另一台电脑删除'],
              ...(f.kind === 'file' && f.hasLocal && f.hasRemote
                ? [['both', '两份都留（另一份加后缀）']]
                : []),
            ] as Array<[ProjectSyncFileResolution, string]>
          ).map(([value, label]) => (
            <label key={value}>
              <input
                type="radio"
                name={'resolve-' + f.path}
                checked={choices[f.path] === value}
                onChange={() => setChoices({ ...choices, [f.path]: value })}
              />
              {label}
            </label>
          ))}
        </fieldset>
      ))}
      {state.error && <p role="alert">{state.error}</p>}
      <footer>
        <button
          className="primary"
          disabled={!ready}
          onClick={() =>
            void runProjectSync(path, true, {
              feedback: feedback.trim() || undefined,
              resolutions: binaries.length ? choices : undefined,
            })
          }
        >
          {state.busy ? '正在同步…' : '继续同步'}
        </button>
        <span className="muted">稍后处理也可以，状态会一直显示“同步暂停”。</span>
      </footer>
    </>
  )
}

function DeletionsView({ path }: { path: string }): React.ReactElement {
  const state = useProjectSync(path)
  const deleted = state.snapshot!.pendingDeletions!
  return (
    <>
      <h2>另一台电脑删除了 {deleted.length} 个文件</h2>
      <p>一次删除很多文件时先停下来问你。这台电脑上的文件还在。</p>
      <ul className="project-sync-list">
        {deleted.slice(0, 12).map((p) => (
          <li key={p}>{p}</li>
        ))}
        {deleted.length > 12 && <li className="muted">还有 {deleted.length - 12} 个</li>}
      </ul>
      {state.error && <p role="alert">{state.error}</p>}
      <footer>
        <button
          className="primary"
          disabled={state.busy}
          onClick={() => void runProjectSync(path, true, { deletions: 'apply' })}
        >
          照做，删除这些文件
        </button>
        <button
          disabled={state.busy}
          onClick={() => void runProjectSync(path, true, { deletions: 'restore' })}
        >
          不删除，重新上传它们
        </button>
      </footer>
      <p className="muted">删除后仍可从同步历史找回。</p>
    </>
  )
}

function openGitHubSettings(): void {
  useTabStore.getState().openTab({
    type: 'settings',
    title: '设置',
    icon: '⚙️',
    settingsSection: 'connections',
  })
}

function StatusView({ path, onClose }: { path: string; onClose(): void }): React.ReactElement {
  const state = useProjectSync(path)
  const snap = state.snapshot!
  const { preview } = usePreview(path)
  const [stopping, setStopping] = useState(false)
  const [error, setError] = useState('')
  const publicRepo = state.errorCode === 'REPOSITORY_NOT_PRIVATE'
  const account = ['AUTHENTICATION_FAILED', 'ACCOUNT_NOT_CONFIGURED'].includes(
    state.errorCode ?? '',
  )
  const repo = snap.repository ?? parseGitHubHttpsRepository(snap.remoteUrl)?.name
  return (
    <>
      <h2>{publicRepo ? '仓库不是私有的，同步已暂停' : state.error ? '同步暂停' : '同步位置'}</h2>
      {publicRepo && (
        <>
          <p className="project-sync-warn">
            这台电脑上的项目、公司记录和账目都没有变化，可以照常使用。Studio
            不会再上传，也不会从中接收。之前已上传的内容在仓库改回私有前仍可被看到。
          </p>
          <ol className="project-sync-list">
            <li>
              在 GitHub 打开仓库 Settings → General → Danger Zone，把 Visibility 改回 Private。
            </li>
            <li>回到这里点“已改回私有，重新检查”。</li>
          </ol>
        </>
      )}
      {state.error && <p role="alert">{state.error}</p>}
      {account && (
        <p>
          在设置中保存正确的 GitHub 账号和 Token 后会自动继续。{' '}
          <button className="project-sync-link" onClick={openGitHubSettings}>
            去设置
          </button>
        </p>
      )}
      <dl className="project-sync-kv">
        <dt>仓库</dt>
        <dd>github.com/{repo}（私有）</dd>
        <dt>上次</dt>
        <dd>
          {snap.checkedAt
            ? new Date(snap.checkedAt).toLocaleString() +
              ` · 收到 ${snap.received ?? 0} 个文件，上传 ${snap.sent ?? 0} 个`
            : '还没有完成过同步'}
        </dd>
        <dt>自动</dt>
        <dd>进入项目时、留在前台每个整点</dd>
        <dt>账号</dt>
        <dd>设置中已保存的 GitHub 账号</dd>
      </dl>
      <h3>同步范围</h3>
      {preview ? <ScopePreview preview={preview} /> : <p>正在列出文件…</p>}
      {error && <p role="alert">{error}</p>}
      <footer>
        <button
          className="primary"
          disabled={state.busy}
          onClick={() => void runProjectSync(path, true)}
        >
          {state.busy ? '正在同步…' : publicRepo ? '已改回私有，重新检查' : '立即同步'}
        </button>
        <button
          disabled={state.busy || stopping}
          onClick={async () => {
            if (!window.confirm('停止同步这个项目？文件和同步历史保留在这台电脑和 GitHub 上。'))
              return
            setStopping(true)
            try {
              await stopProjectSync(path)
              onClose()
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e))
            } finally {
              setStopping(false)
            }
          }}
        >
          停止同步
        </button>
      </footer>
      <p className="muted">{projectSyncLabel(state)}</p>
    </>
  )
}

export function ProjectSyncDialog(): React.ReactElement | null {
  const { path, setup } = useProjectSyncDialog()
  const state = useProjectSync(path)
  const close = () => useProjectSyncDialog.setState({ path: null, setup: false })
  useFloatingSurfaceRegistration(Boolean(path))
  useEscapeDismiss(Boolean(path), close)
  const view = useMemo(() => {
    const s = state.snapshot
    if (!s?.remoteUrl || setup) return 'setup'
    if (s.pendingDeletions?.length) return 'deletions'
    if (s.conflict || s.conflictFiles?.length) return 'conflict'
    return 'status'
  }, [state.snapshot, setup])
  // Once the first round has started, the setup form gives way to the live status.
  useEffect(() => {
    if (setup && state.snapshot?.remoteUrl) useProjectSyncDialog.setState({ setup: false })
  }, [setup, state.snapshot?.remoteUrl])
  if (!path) return null
  return createPortal(
    <div
      className="fixed-space-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div
        className="fixed-space-dialog project-sync-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="项目同步"
      >
        <button className="project-sync-close" aria-label="关闭" onClick={close}>
          ✕
        </button>
        {view === 'setup' ? (
          <SetupView path={path} onDone={close} />
        ) : view === 'deletions' ? (
          <DeletionsView path={path} />
        ) : view === 'conflict' ? (
          <ConflictView path={path} />
        ) : (
          <StatusView path={path} onClose={close} />
        )}
      </div>
    </div>,
    document.body,
  )
}
