import { useEffect, useState } from 'react'
import type { DiaryRootPreview } from '@shared/ipc/workspace-state'
import { openPersonalSpace } from './fixed-spaces-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useDiaryNavigation } from './personal-diary-navigation'

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
  const [git, setGit] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    setError('')
    setPreview(null)
    void window.cclinkStudio.workspaceState
      .inspectDiaryRoot(root)
      .then((result) => {
        if (alive) setPreview(result)
      })
      .catch((e) => {
        if (alive) setError(String(e))
      })
    return () => {
      alive = false
    }
  }, [root])
  async function choose(): Promise<void> {
    const result = await window.cclinkStudio.dialog.showOpenDialog({
      selectDirectory: true,
      title: '选择日记项目目录',
    })
    if (!result.canceled && result.filePaths[0]) setRoot(result.filePaths[0])
  }
  async function confirm(): Promise<void> {
    if (!preview || preview.workspacePath !== root) return
    setBusy(true)
    try {
      await window.cclinkStudio.workspaceState.confirmDiaryRoot(owner, preview)
      await openPersonalSpace()
      await useWorkspaceStore.getState().refreshSettings()
      useDiaryNavigation.getState().setPage(git ? 'Git' : '今天')
    } catch (e) {
      setError(String(e))
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
        <button disabled={busy} onClick={() => void choose().catch((e) => setError(String(e)))}>
          选择已有目录…
        </button>
      </div>
      {cancel && (
        <button disabled={busy} onClick={cancel}>
          返回原项目
        </button>
      )}
      <p className="workspace-home-path">{root}</p>
      {preview && (
        <p>
          日记目录 · {preview.directory}
          <br />
          最近日记 · {preview.latestFile ?? '暂无日记'}
        </p>
      )}
      <label>
        <input type="checkbox" checked={git} onChange={(e) => setGit(e.target.checked)} />
        确认目录后配置 Git 同步
      </label>
      <p>确认后将此目录设为默认日记项目。文件、会话和终端都从这里打开。</p>
      {error && <p role="alert">{error}</p>}
      <button disabled={busy || preview?.workspacePath !== root} onClick={() => void confirm()}>
        确认并进入项目
      </button>
    </section>
  )
}
