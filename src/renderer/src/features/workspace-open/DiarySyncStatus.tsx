import { useEffect, useState } from 'react'
import type { GitTransferSnapshot } from '@shared/git'

const AUTO_FETCH_MS = 15 * 60_000
const lastFetch = new Map<string, number>()

/**
 * Today's sync line. Checks the remote automatically at most every 15 minutes (download only,
 * no stored credentials); private remotes needing a token fall back to a manual check.
 */
export function DiarySyncStatus({
  workspacePath,
  onOpenGit,
}: {
  workspacePath: string
  onOpenGit: () => void
}): React.ReactElement {
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'none' }
    | { kind: 'ok'; snapshot: GitTransferSnapshot; fetched: boolean }
  >({ kind: 'loading' })
  useEffect(() => {
    let alive = true
    void (async () => {
      const git = window.cclinkStudio.git
      let fetched = false
      let result = await git.transfer({ action: 'inspect', workspacePath })
      if (!result.success) {
        if (alive) setState({ kind: 'none' })
        return
      }
      if (Date.now() - (lastFetch.get(workspacePath) ?? 0) > AUTO_FETCH_MS) {
        lastFetch.set(workspacePath, Date.now())
        const checked = await git.transfer({ action: 'fetch', workspacePath })
        if (checked.success) {
          result = checked
          fetched = true
        }
      } else fetched = true
      if (alive) setState({ kind: 'ok', snapshot: result.snapshot, fetched })
    })().catch(() => {
      if (alive) setState({ kind: 'none' })
    })
    return () => {
      alive = false
    }
  }, [workspacePath])
  if (state.kind === 'loading') return <p className="muted">正在检查同步…</p>
  if (state.kind === 'none')
    return (
      <p className="diary-sync">
        未连接 Git 同步 <button onClick={onOpenGit}>连接</button>
      </p>
    )
  const { snapshot } = state
  const behind = snapshot.head !== snapshot.target && !snapshot.diverged
  const text = snapshot.diverged
    ? '本地与远端分叉，需要处理'
    : behind
      ? '远端有更新'
      : snapshot.localChanges
        ? '本地有未上传的改动'
        : '已与远端同步'
  return (
    <p className="diary-sync">
      {text}
      <span className="muted">
        {' · '}
        {snapshot.branch}
        {state.fetched
          ? ` · ${new Date(snapshot.checkedAt).toLocaleTimeString()} 检查`
          : ' · 自动检查需要认证，请手动检查'}
      </span>{' '}
      <button onClick={onOpenGit}>查看</button>
    </p>
  )
}
