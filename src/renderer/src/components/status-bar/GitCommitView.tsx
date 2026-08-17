import { useMemo, useState } from 'react'
import type { GitChangeEntry, GitRepositorySnapshot } from '@shared/git'
import { useGitStore } from '../../stores/git-store'
import { useToastStore } from '../common/Toast'

export function GitCommitView({
  snapshot,
  onCommitted,
}: {
  snapshot: GitRepositorySnapshot
  onCommitted: () => void
}): React.ReactElement {
  const commit = useGitStore((state) => state.commit)
  const operation = useGitStore((state) => state.operation)
  const operationError = useGitStore((state) => state.operationError)
  const showToast = useToastStore((state) => state.show)
  const [message, setMessage] = useState('')
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set())

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
  const canCommit =
    Boolean(message.trim()) &&
    (staged.length > 0 || selectedPaths.size > 0) &&
    snapshot.conflictedCount === 0 &&
    operation === null

  const togglePath = (path: string): void => {
    setSelectedPaths((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const submit = async (): Promise<void> => {
    if (!canCommit) return
    const result = await commit(message, [...selectedPaths])
    if (!result) return
    showToast(result.message, result.success ? 'success' : 'error')
    if (result.success) onCommitted()
  }

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
          onChange={(event) => setMessage(event.target.value)}
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
          <CommitGroup title="选择要加入本次提交的完整文件">
            {stageable.map((change) => (
              <CommitFileRow
                key={`stageable:${change.path}`}
                change={change}
                checked={selectedPaths.has(change.path)}
                disabled={operation !== null}
                onChange={() => togglePath(change.path)}
              />
            ))}
          </CommitGroup>
        )}
      </div>

      {snapshot.conflictedCount > 0 && (
        <div className="git-status-error">存在冲突文件，请先在 Terminal 中处理</div>
      )}
      {operationError && <div className="git-status-error">{operationError}</div>}

      <button
        type="button"
        className="git-status-primary-action enabled"
        disabled={!canCommit}
        onClick={() => void submit()}
      >
        {operation === 'commit'
          ? '正在提交…'
          : `提交 ${new Set([...staged.map((change) => change.path), ...selectedPaths]).size} 个文件`}
      </button>
      <div className="git-commit-hint">
        提交不会自动 Push；敏感文件、过期状态和缺失 identity 会停止操作。
      </div>
    </div>
  )
}

function CommitGroup({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <section className="git-commit-group">
      <div className="git-change-group-title">{title}</div>
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
