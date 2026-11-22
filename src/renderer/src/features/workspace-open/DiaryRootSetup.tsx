import { useEffect, useState } from 'react'
import type { DiaryRootPreview } from '@shared/ipc/workspace-state'
import { openPersonalSpace } from './fixed-spaces-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useDiaryNavigation } from './personal-diary-navigation'
import { useOpenProjectsStore } from '../../stores/open-projects-store'

const ipcMessage = (error: unknown): string =>
  String(error)
    .replace(/^Error: /, '')
    .replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/i, '')

export function DiaryRootSetup({
  owner,
  initialRoot = owner,
  cancel,
}: {
  owner: string
  initialRoot?: string
  cancel?: () => void
}): React.ReactElement {
  const [root, setRoot] = useState(initialRoot)
  const [preview, setPreview] = useState<DiaryRootPreview | null>(null)
  const [ownerPreview, setOwnerPreview] = useState<DiaryRootPreview | null>(null)
  const [pick, setPick] = useState<'' | 'owner' | 'root'>('')
  const [git, setGit] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    setError('')
    setPreview(null)
    setOwnerPreview(null)
    setPick('')
    const ws = window.cclinkStudio.workspaceState
    void ws
      .inspectDiaryRoot(root)
      .then((result) => {
        if (alive) setPreview(result)
      })
      .catch((e) => {
        if (alive) setError(ipcMessage(e))
      })
    // Read-only: when the current default folder also holds diaries, the user must choose.
    if (root !== owner)
      void ws
        .inspectDiaryRoot(owner)
        .then((result) => {
          if (alive) setOwnerPreview(result)
        })
        .catch(() => {})
    return () => {
      alive = false
    }
  }, [root, owner])
  async function choose(): Promise<void> {
    const result = await window.cclinkStudio.dialog.showOpenDialog({
      selectDirectory: true,
      title: '选择日记项目目录',
    })
    if (!result.canceled && result.filePaths[0]) setRoot(result.filePaths[0])
  }
  const both = Boolean(
    root !== owner && ownerPreview?.diaryCount && preview?.diaryCount && ownerPreview && preview,
  )
  async function confirm(): Promise<void> {
    if (!preview || preview.workspacePath !== root) return
    const chosen = both
      ? pick === 'owner'
        ? ownerPreview
        : pick === 'root'
          ? preview
          : null
      : preview
    if (!chosen) return
    setBusy(true)
    try {
      await window.cclinkStudio.workspaceState.confirmDiaryRoot(owner, chosen)
      await openPersonalSpace()
      // The previous default folder stays on disk and in 历史项目; only its stale tab is closed.
      const active = useWorkspaceStore.getState().activeWorkspaceRef
      if (chosen.workspacePath !== owner && active.kind === 'local' && active.path !== owner)
        useOpenProjectsStore.getState().removeProject(owner)
      await useWorkspaceStore.getState().refreshSettings()
      useDiaryNavigation.getState().setPage(git ? 'Git' : '今天')
    } catch (e) {
      setError(ipcMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="personal-diary-home diary-source-form diary-root-setup">
      <h2>确认本地项目目录</h2>
      <div>
        <button disabled={busy} aria-pressed={root === owner} onClick={() => setRoot(owner)}>
          使用默认目录
        </button>
        <button disabled={busy} onClick={() => void choose().catch((e) => setError(ipcMessage(e)))}>
          选择已有目录…
        </button>
      </div>
      {cancel && (
        <button disabled={busy} onClick={cancel}>
          返回原项目
        </button>
      )}
      <p className="workspace-home-path">{root}</p>
      {preview && !both && (
        <p>
          日记目录 · {preview.directory}
          <br />
          最近日记 · {preview.latestFile ?? '暂无日记'}
        </p>
      )}
      {both && ownerPreview && preview && (
        <div className="diary-root-compare" role="radiogroup" aria-label="两个位置都有日记">
          <p>两个位置都有日记。确认后只改变默认项目指向，另一处的文件原样保留，不会移动或合并。</p>
          {(
            [
              ['owner', '保留当前默认目录', ownerPreview],
              ['root', '改用原资料目录', preview],
            ] as const
          ).map(([key, label, item]) => (
            <label key={key}>
              <input
                type="radio"
                name="diary-root-pick"
                checked={pick === key}
                onChange={() => setPick(key)}
              />
              <span>
                {label}
                <br />
                <span className="workspace-home-path">{item.workspacePath}</span>
                <br />
                日记目录 · {item.directory}　日记 {item.diaryCount} 篇　最近 ·{' '}
                {item.latestFile ?? '暂无'}
              </span>
            </label>
          ))}
        </div>
      )}
      <label>
        <input type="checkbox" checked={git} onChange={(e) => setGit(e.target.checked)} />
        确认目录后配置 Git 同步
      </label>
      <p>确认后将此目录设为默认日记项目。文件、会话和终端都从这里打开。</p>
      {error && <p role="alert">{error}</p>}
      <button
        disabled={busy || preview?.workspacePath !== root || (both && !pick)}
        onClick={() => void confirm()}
      >
        确认并进入项目
      </button>
    </section>
  )
}
