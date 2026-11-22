import { useWorkspaceStore } from '../../stores/workspace-store'
import { useEffect, useState } from 'react'
import { create } from 'zustand'
import type { GitTransferSnapshot } from '@shared/git'
import { useTabStore } from '../../stores/tab-store'

interface State {
  busy?: boolean
  error?: string
  snapshot?: GitTransferSnapshot
  pending?: boolean
  authentication?: boolean
}
const empty: State = {}
const useSync = create<Record<string, State>>(() => ({}))
export async function syncDiarySpace(
  path: string,
  manual = false,
  options: { url?: string; feedback?: string; token?: string; sshKeyPath?: string } = {},
): Promise<void> {
  const old = useSync.getState()[path] ?? empty
  if (old.busy || (!manual && (old.snapshot?.conflict || old.authentication))) return
  useSync.setState({ [path]: { ...old, busy: true, error: undefined } })
  try {
    if (useTabStore.getState().tabs.some((t) => t.dirty))
      throw Error('有正在编辑的内容，请保存后继续同步。')
    const result = await window.cclinkStudio.git.transfer({
      action: 'diary-sync',
      workspacePath: path,
      ...options,
      expectedHead: old.snapshot?.head || undefined,
      expectedTarget: old.snapshot?.target || undefined,
    })
    if (!result.success) throw Error(result.error.message)
    useSync.setState({ [path]: { snapshot: result.snapshot } })
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    const saved = await window.cclinkStudio.workspaceState
      .get(path)
      .then((v) => v.sections['personal-diary-sync'] as GitTransferSnapshot | undefined)
      .catch(() => undefined)
    useSync.setState({
      [path]: {
        ...old,
        snapshot: saved?.remoteUrl ? saved : old.snapshot,
        busy: false,
        error,
        authentication: /认证|私钥/.test(error),
      },
    })
  }
}
function label(s: State) {
  return s.busy
    ? '同步中…'
    : s.error || s.snapshot?.conflict
      ? '同步暂停 · 查看原因'
      : s.pending
        ? '有待同步的改动'
        : s.snapshot?.checkedAt
          ? '已同步 · ' +
            new Date(s.snapshot.checkedAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })
          : '未设置同步'
}
export function useDiarySyncRevision(path: string | null): string | undefined {
  return useSync((s) => (path ? s[path]?.snapshot?.checkedAt : undefined))
}
export function DiarySyncStatus({
  workspacePath,
  onOpenGit,
}: {
  workspacePath: string
  onOpenGit: () => void
}): React.ReactElement {
  const state = useSync((s) => s[workspacePath] ?? empty)
  return (
    <button
      className="diary-sync status-bar-item"
      onClick={onOpenGit}
      aria-label={'同步：' + label(state)}
    >
      ↻ {label(state)}
    </button>
  )
}
export function useDiarySyncSchedule(path: string | null): void {
  useEffect(() => {
    if (!path) return
    let timer: number | undefined,
      active = false,
      disposed = false,
      received = false
    const api = window.cclinkStudio.window
    function schedule() {
      const now = new Date(),
        next = new Date(now)
      next.setHours(now.getHours() + 1, 0, 0, 0)
      timer = window.setTimeout(async () => {
        if (disposed || !active) return
        if ((await api.isForeground()) && active && !disposed) {
          void syncDiarySpace(path!)
          schedule()
        }
      }, next.getTime() - now.getTime())
    }
    function update(foreground: boolean) {
      if (disposed || active === foreground) return
      active = foreground
      window.clearTimeout(timer)
      if (active) {
        void syncDiarySpace(path!)
        schedule()
      }
    }
    let refreshTimer: number | undefined
    const root = path
    const unwatch = window.cclinkStudio.fs
      .watchDir(root, ({ filePath }) => {
        const relative = filePath.slice(root.length + 1)
        const cfg = useWorkspaceStore.getState().settingsSnapshot?.settings.diary
        if (
          !cfg ||
          (![cfg.directory, cfg.planDirectory || '计划', '.cclink-studio/shared'].some((dir) =>
            relative.startsWith(dir + '/'),
          ) &&
            relative !== '.cclink-studio/workspace-settings.json')
        )
          return
        window.clearTimeout(refreshTimer)
        refreshTimer = window.setTimeout(async () => {
          const snapshot = await window.cclinkStudio.git.getSnapshot(root).catch(() => null)
          const s = useSync.getState()[root]
          if (disposed || !s?.snapshot?.remoteUrl || s.busy || !snapshot) return
          const pending = snapshot.changes.some(
            (c) =>
              [cfg.directory, cfg.planDirectory || '计划', '.cclink-studio/shared'].some((d) =>
                c.path.startsWith(d + '/'),
              ) || c.path === '.cclink-studio/workspace-settings.json',
          )
          if (!!s.pending !== pending) useSync.setState({ [root]: { ...s, pending } })
        }, 250)
      })
      .catch(() => () => {})
    const unsubscribe = api.onForegroundChanged((value) => {
      received = true
      update(value)
    })
    void api
      .isForeground()
      .then((value) => {
        if (!received) update(value)
      })
      .catch(() => {})
    return () => {
      disposed = true
      window.clearTimeout(timer)
      window.clearTimeout(refreshTimer)
      void unwatch.then((stop) => stop())
      unsubscribe()
    }
  }, [path])
}
export function DiarySyncPage({ path }: { path: string }): React.ReactElement {
  const state = useSync((s) => s[path] ?? empty),
    [url, setUrl] = useState(''),
    [feedback, setFeedback] = useState(''),
    [credential, setCredential] = useState(''),
    [editing, setEditing] = useState(false)
  const snap = state.snapshot,
    conflict = !editing && snap?.conflict,
    first = editing || !snap?.remoteUrl
  return (
    <section className="diary-source-form diary-sync-panel" aria-label="我的空间同步">
      <h3>
        {first
          ? '设置同步地址'
          : conflict
            ? '两份内容需要你决定'
            : state.error
              ? '同步暂停'
              : '同步位置'}
      </h3>
      {first ? (
        <>
          <label>
            Git 项目地址
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="粘贴项目地址"
            />
          </label>
          <p>进入空间时自动接收和上传；留在前台，每小时整点再同步。</p>
        </>
      ) : (
        !conflict && (
          <div>
            <small>{snap?.remoteUrl || url}</small>{' '}
            <button
              onClick={() => {
                setUrl(snap?.remoteUrl || '')
                setEditing(true)
              }}
              disabled={state.busy}
            >
              更换地址
            </button>
          </div>
        )
      )}
      {state.error && <p role="alert">{state.error}</p>}
      {conflict && (
        <>
          <p>两边改了同一处，两份原文都已保留。</p>
          <pre>{conflict}</pre>
          <label>
            告诉 AI 怎么处理
            <textarea
              placeholder="例如：用下午两点的安排。"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
            />
          </label>
        </>
      )}
      {state.authentication && (
        <label>
          本次认证（HTTPS Token 或 SSH 私钥路径）
          <input
            type="password"
            value={credential}
            onChange={(e) => setCredential(e.target.value)}
            autoComplete="off"
          />
        </label>
      )}
      <button
        className="primary"
        disabled={state.busy || (first && !url.trim()) || (!!conflict && !feedback.trim())}
        onClick={() => {
          void syncDiarySpace(path, true, {
            ...(first ? { url: url.trim() } : {}),
            feedback: (!first && feedback) || undefined,
            ...(credential
              ? credential.startsWith('/')
                ? { sshKeyPath: credential }
                : { token: credential }
              : {}),
          })
          setEditing(false)
          setCredential('')
        }}
      >
        {state.busy
          ? '正在同步…'
          : first
            ? '保存并同步'
            : state.error || conflict
              ? '继续同步'
              : '同步'}
      </button>
      {snap?.remoteUrl && !state.error && !conflict && <small>{label(state)}</small>}
    </section>
  )
}
