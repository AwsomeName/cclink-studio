import { useMemo } from 'react'
import type { GitRepositorySnapshot } from '@shared/git'
import { IconCheck, IconCloud } from '../common/Icons'

interface GitCommitViewProps {
  snapshot: GitRepositorySnapshot
  message: string
  selectedPaths: string[]
  operation: 'commit' | 'push' | null
  stale: boolean
  onMessageChange: (message: string) => void
  onSetPaths: (paths: string[]) => void
  onCommit: () => void
  onCommitAndPush: () => void
  onPush: () => void
}

export function GitCommitView({
  snapshot,
  message,
  selectedPaths,
  operation,
  stale,
  onMessageChange,
  onSetPaths,
  onCommit,
  onCommitAndPush,
  onPush,
}: GitCommitViewProps): React.ReactElement {
  const selectedPathSet = useMemo(() => new Set(selectedPaths), [selectedPaths])
  const stagedPaths = useMemo(
    () =>
      snapshot.changes
        .filter((change) => !change.conflicted && change.stagedStatus)
        .map((change) => change.path),
    [snapshot.changes],
  )
  const stageablePaths = useMemo(
    () =>
      snapshot.changes
        .filter((change) => !change.conflicted && (change.unstagedStatus || change.untracked))
        .map((change) => change.path),
    [snapshot.changes],
  )
  const selectedStageableCount = stageablePaths.filter((path) => selectedPathSet.has(path)).length
  const includesUnstaged =
    stageablePaths.length > 0 && selectedStageableCount === stageablePaths.length
  const commitFileCount = new Set([...stagedPaths, ...selectedPaths]).size
  const canCommit =
    commitFileCount > 0 &&
    snapshot.conflictedCount === 0 &&
    operation === null &&
    !snapshot.detached &&
    !stale
  const canPush =
    Boolean(snapshot.upstream && snapshot.headOid) &&
    (snapshot.ahead ?? 0) > 0 &&
    (snapshot.behind ?? 0) === 0 &&
    !snapshot.detached &&
    operation === null &&
    !stale
  const canCommitAndPush = canCommit && Boolean(snapshot.upstream) && (snapshot.behind ?? 0) === 0

  const handleMessageKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey) || !canCommit) return
    event.preventDefault()
    onCommit()
  }

  return (
    <div className="git-commit-view">
      <input
        className="git-commit-message-input"
        type="text"
        value={message}
        maxLength={1000}
        autoFocus
        disabled={operation !== null}
        onChange={(event) => onMessageChange(event.target.value)}
        onKeyDown={handleMessageKeyDown}
        placeholder="提交信息（留空将自动生成）"
        aria-label="提交信息"
      />

      <label className={`git-include-unstaged ${stageablePaths.length === 0 ? 'disabled' : ''}`}>
        <input
          type="checkbox"
          aria-label="包含未暂存的更改"
          checked={includesUnstaged}
          disabled={stageablePaths.length === 0 || operation !== null || stale}
          onChange={() => onSetPaths(includesUnstaged ? [] : stageablePaths)}
        />
        <span>包含未暂存的更改</span>
        <span className="git-commit-line-summary" aria-label="变更行数">
          <span className="additions">+{snapshot.additions}</span>
          <span className="deletions">-{snapshot.deletions}</span>
        </span>
      </label>

      <div className="git-compact-actions">
        <button
          type="button"
          aria-label="提交"
          disabled={!canCommit}
          title={getCommitDisabledReason(snapshot, stale, commitFileCount)}
          onClick={onCommit}
        >
          <IconCheck size={17} />
          <span>{operation === 'commit' ? '正在提交…' : '提交'}</span>
          <kbd>⌘↵</kbd>
        </button>
        <button
          type="button"
          aria-label="提交并推送"
          disabled={!canCommitAndPush}
          title={getCommitAndPushDisabledReason(snapshot, stale, commitFileCount)}
          onClick={onCommitAndPush}
        >
          <IconCloud size={17} />
          <span>提交并推送</span>
        </button>
        <button
          type="button"
          aria-label="推送"
          disabled={!canPush}
          title={getPushDisabledReason(snapshot, stale)}
          onClick={onPush}
        >
          <IconCloud size={17} />
          <span>{operation === 'push' ? '正在推送…' : '推送'}</span>
          {(snapshot.ahead ?? 0) > 0 && <em>{snapshot.ahead}</em>}
        </button>
      </div>

      {snapshot.conflictedCount > 0 && (
        <div className="git-status-error">存在冲突文件，请先在 Terminal 中处理</div>
      )}
      {commitFileCount === 0 && snapshot.conflictedCount === 0 && (
        <div className="git-compact-hint">没有可提交的更改</div>
      )}
    </div>
  )
}

export function createDefaultCommitMessage(
  snapshot: GitRepositorySnapshot,
  selectedPaths: string[],
): string {
  const selectedPathSet = new Set(selectedPaths)
  const paths = snapshot.changes
    .filter(
      (change) => !change.conflicted && (change.stagedStatus || selectedPathSet.has(change.path)),
    )
    .map((change) => change.path)
  const uniquePaths = [...new Set(paths)]
  if (uniquePaths.length === 1) return `更新 ${uniquePaths[0]}`
  if (uniquePaths.length > 1) return `更新 ${uniquePaths.length} 个文件`
  return '更新项目文件'
}

function getCommitDisabledReason(
  snapshot: GitRepositorySnapshot,
  stale: boolean,
  commitFileCount: number,
): string | undefined {
  if (stale) return 'Git 状态已变化，请先确认最新状态'
  if (snapshot.detached) return 'detached HEAD 不支持快捷提交'
  if (snapshot.conflictedCount > 0) return '存在冲突文件，请先处理冲突'
  if (commitFileCount === 0) return '没有可提交的更改'
  return undefined
}

function getCommitAndPushDisabledReason(
  snapshot: GitRepositorySnapshot,
  stale: boolean,
  commitFileCount: number,
): string | undefined {
  const commitReason = getCommitDisabledReason(snapshot, stale, commitFileCount)
  if (commitReason) return commitReason
  if (!snapshot.upstream) return '当前分支没有上游，请先在 Terminal 中设置'
  if ((snapshot.behind ?? 0) > 0) return '远程包含新提交，请先同步'
  return undefined
}

function getPushDisabledReason(
  snapshot: GitRepositorySnapshot,
  stale: boolean,
): string | undefined {
  if (stale) return 'Git 状态已变化，请先确认最新状态'
  if (!snapshot.upstream) return '当前分支没有上游'
  if ((snapshot.behind ?? 0) > 0) return '远程包含新提交，请先同步'
  if ((snapshot.ahead ?? 0) === 0) return '没有待推送的提交'
  return undefined
}
