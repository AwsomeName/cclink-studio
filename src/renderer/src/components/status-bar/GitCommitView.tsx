import { useMemo } from 'react'
import type { GitChangeEntry, GitRepositorySnapshot } from '@shared/git'

interface GitCommitViewProps {
  snapshot: GitRepositorySnapshot
  message: string
  selectedPaths: string[]
  operation: 'commit' | 'push' | null
  stale: boolean
  onMessageChange: (message: string) => void
  onTogglePath: (path: string) => void
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
  onTogglePath,
  onSetPaths,
  onCommit,
  onCommitAndPush,
  onPush,
}: GitCommitViewProps): React.ReactElement {
  const selectedPathSet = useMemo(() => new Set(selectedPaths), [selectedPaths])
  const staged = useMemo(
    () => snapshot.changes.filter((change) => !change.conflicted && change.stagedStatus),
    [snapshot.changes],
  )
  const stageable = useMemo(
    () =>
      snapshot.changes.filter(
        (change) => !change.conflicted && (change.unstagedStatus || change.untracked),
      ),
    [snapshot.changes],
  )
  const commitFileCount = new Set([...staged.map((change) => change.path), ...selectedPaths]).size
  const selectedStageableCount = stageable.filter((change) =>
    selectedPathSet.has(change.path),
  ).length
  const allStageableSelected = selectedStageableCount === stageable.length
  const canCommit =
    Boolean(message.trim()) &&
    commitFileCount > 0 &&
    snapshot.conflictedCount === 0 &&
    operation === null &&
    !stale
  const canPush =
    Boolean(snapshot.upstream && snapshot.headOid) &&
    (snapshot.ahead ?? 0) > 0 &&
    (snapshot.behind ?? 0) === 0 &&
    !snapshot.detached &&
    operation === null &&
    !stale
  const canCommitAndPush =
    canCommit && Boolean(snapshot.upstream) && (snapshot.behind ?? 0) === 0 && !snapshot.detached

  return (
    <div className="git-commit-view">
      <label className="git-commit-message">
        <span>提交信息</span>
        <textarea
          value={message}
          maxLength={1000}
          rows={3}
          autoFocus
          disabled={operation !== null}
          onChange={(event) => onMessageChange(event.target.value)}
          placeholder="说明这次修改"
        />
      </label>

      <div className="git-commit-files">
        {staged.length > 0 && (
          <CommitGroup title="已暂存，将保留现有 index 意图">
            {staged.map((change) => (
              <CommitFileRow key={`staged:${change.path}`} change={change} checked disabled />
            ))}
          </CommitGroup>
        )}
        {stageable.length > 0 && (
          <CommitGroup
            title="选择要加入本次提交的完整文件"
            action={
              <div className="git-commit-group-actions">
                <span>
                  已选 {selectedStageableCount}/{stageable.length}
                </span>
                <button
                  type="button"
                  disabled={operation !== null || stale}
                  onClick={() =>
                    onSetPaths(allStageableSelected ? [] : stageable.map((change) => change.path))
                  }
                >
                  {allStageableSelected ? '取消全选' : '全选'}
                </button>
              </div>
            }
          >
            {stageable.map((change) => (
              <CommitFileRow
                key={`stageable:${change.path}`}
                change={change}
                checked={selectedPathSet.has(change.path)}
                disabled={operation !== null || stale}
                onChange={() => onTogglePath(change.path)}
              />
            ))}
          </CommitGroup>
        )}
        {staged.length === 0 && stageable.length === 0 && (
          <div className="git-changes-empty">没有待提交文件</div>
        )}
      </div>

      {snapshot.conflictedCount > 0 && (
        <div className="git-status-error">存在冲突文件，请先在 Terminal 中处理</div>
      )}

      <div className="git-operation-actions">
        <button
          type="button"
          className="git-status-primary-action enabled"
          disabled={!canCommit}
          onClick={onCommit}
        >
          {operation === 'commit' ? '正在提交…' : `提交 ${commitFileCount} 个文件`}
        </button>
        <button
          type="button"
          className="git-status-secondary-action"
          disabled={!canCommitAndPush}
          onClick={onCommitAndPush}
        >
          {(snapshot.ahead ?? 0) > 0
            ? `提交并推送（含已有 ${snapshot.ahead} 个提交）`
            : '提交并推送'}
        </button>
        {Boolean(snapshot.upstream) && (snapshot.ahead ?? 0) > 0 && (
          <button
            type="button"
            className="git-status-secondary-action"
            disabled={!canPush}
            onClick={onPush}
          >
            {operation === 'push' ? '正在 Push…' : `推送 ${snapshot.ahead} 个已有提交`}
          </button>
        )}
      </div>
      <div className="git-commit-hint">
        只会提交已暂存文件和你勾选的完整文件；敏感文件、过期状态和缺失 identity 会停止操作。
      </div>
    </div>
  )
}

function CommitGroup({
  title,
  action,
  children,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}): React.ReactElement {
  return (
    <section className="git-commit-group">
      <div className="git-change-group-title">
        <span>{title}</span>
        {action}
      </div>
      {children}
    </section>
  )
}

function CommitFileRow({
  change,
  checked,
  disabled,
  onChange,
}: {
  change: GitChangeEntry
  checked: boolean
  disabled: boolean
  onChange?: () => void
}): React.ReactElement {
  const partial = Boolean(change.stagedStatus && change.unstagedStatus)
  return (
    <label className="git-commit-file" title={change.path}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onChange} />
      <span>{change.path}</span>
      {partial && <em>部分暂存</em>}
    </label>
  )
}
