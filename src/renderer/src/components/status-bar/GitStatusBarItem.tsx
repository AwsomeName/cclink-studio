import { useEffect, useRef, useState } from 'react'
import type { HTMLAttributes } from 'react'
import type { GitRepositorySnapshot } from '@shared/git'
import { useGitStore } from '../../stores/git-store'
import { IconArrowLeft, IconBranch, IconChevronRight, IconRefresh } from '../common/Icons'
import {
  formatGitChangeSummary,
  formatGitUpstream,
  getGitBranchLabel,
} from './git-status-view-model'
import { GitChangesView } from './GitChangesView'
import { GitCommitView } from './GitCommitView'
import { useToastStore } from '../common/Toast'

interface GitStatusBarItemProps {
  workspacePath: string | null
  contextProps: HTMLAttributes<HTMLButtonElement>
}

export function GitStatusBarItem({
  workspacePath,
  contextProps,
}: GitStatusBarItemProps): React.ReactElement | null {
  const snapshot = useGitStore((state) => state.snapshot)
  const loading = useGitStore((state) => state.loading)
  const error = useGitStore((state) => state.error)
  const loadWorkspace = useGitStore((state) => state.loadWorkspace)
  const refresh = useGitStore((state) => state.refresh)
  const clearDiff = useGitStore((state) => state.clearDiff)
  const push = useGitStore((state) => state.push)
  const operation = useGitStore((state) => state.operation)
  const operationError = useGitStore((state) => state.operationError)
  const showToast = useToastStore((state) => state.show)
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'summary' | 'changes' | 'commit'>('summary')
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    void loadWorkspace(workspacePath)
  }, [loadWorkspace, workspacePath])

  useEffect(() => {
    setOpen(false)
    setView('summary')
    clearDiff()
  }, [clearDiff, workspacePath])

  useEffect(() => {
    if (open) return
    setView('summary')
    clearDiff()
  }, [clearDiff, open])

  useEffect(() => {
    if (!workspacePath) return
    const handleFocus = (): void => {
      void refresh()
    }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [refresh, workspacePath])

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: MouseEvent): void => {
      if (rootRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  if (!snapshot || snapshot.availability !== 'available') return null

  const branchLabel = getGitBranchLabel(snapshot)
  const primaryAction = getPrimaryAction(snapshot, operation)
  const canPushExisting =
    Boolean(snapshot.upstream && snapshot.headOid) &&
    (snapshot.ahead ?? 0) > 0 &&
    (snapshot.behind ?? 0) === 0 &&
    !snapshot.detached

  const runPrimaryAction = async (): Promise<void> => {
    if (primaryAction.kind === 'commit') {
      setView('commit')
      return
    }
    if (primaryAction.kind !== 'push') return
    const result = await push()
    if (result) showToast(result.message, result.success ? 'success' : 'error')
  }

  const runPush = async (): Promise<void> => {
    const result = await push()
    if (result) showToast(result.message, result.success ? 'success' : 'error')
  }

  return (
    <div className="git-status-root" ref={rootRef}>
      <button
        {...contextProps}
        ref={triggerRef}
        type="button"
        className={`status-bar-item git-status-trigger ${open ? 'active' : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={`${branchLabel} · ${snapshot.changeCount} 个变更`}
        onClick={() => {
          setOpen((value) => !value)
          if (!open) void refresh()
        }}
      >
        <IconBranch size={13} />
        <span>{branchLabel}</span>
        <span className="git-status-change-count">● {snapshot.changeCount}</span>
        {(snapshot.additions > 0 || snapshot.deletions > 0) && (
          <span className="git-status-lines" title="Git 可计算的已知增删行数">
            <span className="additions">+{snapshot.additions}</span>
            <span className="deletions">-{snapshot.deletions}</span>
            {snapshot.lineStatsIncomplete && <span aria-label="行数统计不完整">*</span>}
          </span>
        )}
      </button>

      {open && (
        <div
          className={`git-status-popover ${view !== 'summary' ? 'details-open' : ''}`}
          role="dialog"
          aria-label="Git 状态"
        >
          <div className="git-status-popover-header">
            <div className="git-status-popover-title">
              {view !== 'summary' && (
                <button
                  type="button"
                  className="git-status-back"
                  onClick={() => {
                    setView('summary')
                    clearDiff()
                  }}
                  aria-label="返回 Git 摘要"
                >
                  <IconArrowLeft size={14} />
                </button>
              )}
              <strong>{view === 'changes' ? '变更' : view === 'commit' ? '提交' : 'Git'}</strong>
            </div>
            <button
              type="button"
              className="git-status-refresh"
              disabled={loading}
              onClick={() => void refresh()}
              aria-label="刷新 Git 状态"
              title="刷新 Git 状态"
            >
              <IconRefresh size={14} />
            </button>
          </div>

          {view === 'summary' ? (
            <>
              <button
                type="button"
                className="git-status-row git-status-row-button"
                onClick={() => setView('changes')}
              >
                <span>变更</span>
                <span className="git-status-change-summary">
                  {formatGitChangeSummary(snapshot)} <IconChevronRight size={12} />
                </span>
              </button>
              <GitStatusRow label="仓库" value={snapshot.repositoryName ?? '未知'} />
              <GitStatusRow label="分支" value={branchLabel} />
              <GitStatusRow label="上游" value={formatGitUpstream(snapshot)} />

              {(error || operationError) && (
                <div className="git-status-error">{error ?? operationError}</div>
              )}
              <button
                type="button"
                className="git-status-primary-action enabled"
                disabled={primaryAction.disabled}
                title={primaryAction.reason}
                onClick={() => void runPrimaryAction()}
              >
                {primaryAction.label}
              </button>
              {primaryAction.kind === 'commit' && canPushExisting && (
                <button
                  type="button"
                  className="git-status-secondary-action"
                  disabled={operation !== null}
                  onClick={() => void runPush()}
                >
                  推送 {snapshot.ahead} 个已有提交
                </button>
              )}
            </>
          ) : view === 'changes' ? (
            <GitChangesView snapshot={snapshot} />
          ) : (
            <GitCommitView snapshot={snapshot} onCommitted={() => setView('summary')} />
          )}
        </div>
      )}
    </div>
  )
}

function getPrimaryAction(
  snapshot: GitRepositorySnapshot,
  operation: ReturnType<typeof useGitStore.getState>['operation'],
): { kind: 'commit' | 'push' | 'none'; label: string; disabled: boolean; reason?: string } {
  if (operation) {
    return {
      kind: 'none',
      label: operation === 'commit' ? '正在提交…' : '正在 Push…',
      disabled: true,
    }
  }
  if (snapshot.conflictedCount > 0) {
    return { kind: 'none', label: '存在冲突，无法提交', disabled: true }
  }
  if (snapshot.detached) {
    return { kind: 'none', label: 'detached HEAD，请使用 Terminal', disabled: true }
  }
  if (snapshot.changeCount > 0) {
    return {
      kind: 'commit',
      label: '提交…',
      disabled: false,
    }
  }
  if ((snapshot.ahead ?? 0) > 0 && snapshot.upstream && (snapshot.behind ?? 0) === 0) {
    return { kind: 'push', label: `推送 ${snapshot.ahead} 个提交`, disabled: false }
  }
  if (!snapshot.upstream) {
    return {
      kind: 'none',
      label: '未设置上游',
      disabled: true,
      reason: '请先使用 Terminal 或 Git 备份入口关联远程仓库',
    }
  }
  if ((snapshot.behind ?? 0) > 0) {
    return {
      kind: 'none',
      label: '上游有新提交',
      disabled: true,
      reason: '不会自动 Pull，请先在 Terminal 中同步历史',
    }
  }
  return { kind: 'none', label: '没有待提交或推送内容', disabled: true }
}

function GitStatusRow({
  label,
  value,
  valueClassName,
}: {
  label: string
  value: string
  valueClassName?: string
}): React.ReactElement {
  return (
    <div className="git-status-row">
      <span>{label}</span>
      <span className={valueClassName} title={value}>
        {value}
      </span>
    </div>
  )
}
