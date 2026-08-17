import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useGitStore } from '../../stores/git-store'
import { IconBranch, IconClose, IconRefresh } from '../common/Icons'
import { GitChangesView } from './GitChangesView'
import { GitCommitView } from './GitCommitView'
import { formatGitUpstream, getGitBranchLabel } from './git-status-view-model'

export function GitOperationDialog(): React.ReactElement | null {
  const dialogOpen = useGitStore((state) => state.operationDialogOpen)
  const tab = useGitStore((state) => state.operationDialogTab)
  const dialogWorkspacePath = useGitStore((state) => state.operationDialogWorkspacePath)
  const baselineRevision = useGitStore((state) => state.operationDialogBaselineRevision)
  const snapshot = useGitStore((state) => state.snapshot)
  const loading = useGitStore((state) => state.loading)
  const operation = useGitStore((state) => state.operation)
  const operationError = useGitStore((state) => state.operationError)
  const message = useGitStore((state) => state.commitMessage)
  const selectedPaths = useGitStore((state) => state.selectedCommitPaths)
  const notice = useGitStore((state) => state.operationNotice)
  const closeDialog = useGitStore((state) => state.closeOperationDialog)
  const setTab = useGitStore((state) => state.setOperationDialogTab)
  const setMessage = useGitStore((state) => state.setCommitMessage)
  const togglePath = useGitStore((state) => state.toggleCommitPath)
  const clearDraft = useGitStore((state) => state.clearCommitDraft)
  const acceptLatestSnapshot = useGitStore((state) => state.acceptLatestDialogSnapshot)
  const setNotice = useGitStore((state) => state.setOperationNotice)
  const refresh = useGitStore((state) => state.refresh)
  const commit = useGitStore((state) => state.commit)
  const push = useGitStore((state) => state.push)
  const dialogRef = useRef<HTMLDivElement>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  const dirty = Boolean(message.trim()) || selectedPaths.length > 0
  const stale = Boolean(snapshot && baselineRevision && snapshot.revision !== baselineRevision)
  const requestClose = useCallback((): void => {
    if (operation) return
    if (dirty) {
      setConfirmDiscard(true)
      return
    }
    closeDialog()
  }, [closeDialog, dirty, operation])

  useEffect(() => {
    if (!dialogOpen) setConfirmDiscard(false)
  }, [dialogOpen])

  useEffect(() => {
    if (!dialogOpen) return
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (confirmDiscard) {
          setConfirmDiscard(false)
          return
        }
        requestClose()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), textarea:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])',
      )
      if (!focusable?.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [confirmDiscard, dialogOpen, requestClose])

  if (
    !dialogOpen ||
    !snapshot ||
    snapshot.availability !== 'available' ||
    dialogWorkspacePath !== snapshot.workspacePath
  ) {
    return null
  }

  const runCommit = async (pushAfterCommit: boolean): Promise<void> => {
    if (stale || operation) return
    setNotice(null)
    const result = await commit(message, selectedPaths)
    if (!result) {
      setNotice({
        tone: 'error',
        title: '提交失败',
        detail: useGitStore.getState().operationError ?? 'Git 提交没有完成，请刷新后重试。',
      })
      return
    }
    if (!result.success) {
      setNotice({ tone: 'error', title: '提交失败', detail: result.message })
      return
    }

    clearDraft()
    acceptLatestSnapshot()
    if (!pushAfterCommit) {
      setNotice({
        tone: 'success',
        title: '提交成功',
        detail: '本地提交已保留，尚未 Push。',
      })
      return
    }

    const pushResult = await push()
    if (!pushResult?.success) {
      setNotice({
        tone: 'error',
        title: '提交成功，Push 失败',
        detail: `${pushResult?.message ?? useGitStore.getState().operationError ?? '远程推送没有完成'}；本地提交已保留。`,
      })
      return
    }
    acceptLatestSnapshot()
    setNotice({ tone: 'success', title: '提交并 Push 成功', detail: pushResult.message })
  }

  const runPush = async (): Promise<void> => {
    if (stale || operation) return
    setNotice(null)
    const result = await push()
    if (!result?.success) {
      setNotice({
        tone: 'error',
        title: 'Push 失败',
        detail: result?.message ?? useGitStore.getState().operationError ?? '远程推送没有完成。',
      })
      return
    }
    acceptLatestSnapshot()
    setNotice({ tone: 'success', title: 'Push 成功', detail: result.message })
  }

  return createPortal(
    <div className="git-operation-overlay" onMouseDown={() => dialogRef.current?.focus()}>
      <div
        ref={dialogRef}
        className="git-operation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="git-operation-title"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="git-operation-header">
          <div>
            <h2 id="git-operation-title">Git</h2>
            <div className="git-operation-repository" title={snapshot.repositoryRoot ?? undefined}>
              <IconBranch size={14} />
              <strong>{getGitBranchLabel(snapshot)}</strong>
              <span>{snapshot.repositoryName ?? '未知仓库'}</span>
              <span>{formatGitUpstream(snapshot)}</span>
            </div>
          </div>
          <div className="git-operation-header-actions">
            <button
              type="button"
              disabled={loading || operation !== null}
              onClick={() => void refresh()}
              aria-label="刷新 Git 状态"
              title="刷新 Git 状态"
            >
              <IconRefresh size={15} />
            </button>
            <button
              type="button"
              disabled={operation !== null}
              onClick={requestClose}
              aria-label="关闭 Git 窗口"
              title="关闭"
            >
              <IconClose size={15} />
            </button>
          </div>
        </header>

        <nav className="git-operation-tabs" aria-label="Git 操作">
          <button
            type="button"
            className={tab === 'changes' ? 'active' : ''}
            aria-current={tab === 'changes' ? 'page' : undefined}
            onClick={() => setTab('changes')}
          >
            变更 {snapshot.changeCount}
          </button>
          <button
            type="button"
            className={tab === 'commit' ? 'active' : ''}
            aria-current={tab === 'commit' ? 'page' : undefined}
            onClick={() => setTab('commit')}
          >
            提交与推送
          </button>
        </nav>

        {stale && (
          <div className="git-operation-stale" role="alert">
            <span>Git 状态已变化。请确认最新状态后再执行写操作。</span>
            <button type="button" disabled={operation !== null} onClick={acceptLatestSnapshot}>
              使用最新状态
            </button>
          </div>
        )}
        {(notice || operationError) && (
          <div
            className={`git-operation-notice ${notice?.tone ?? 'error'}`}
            role={notice?.tone === 'success' ? 'status' : 'alert'}
          >
            <strong>{notice?.title ?? '操作失败'}</strong>
            <span>{notice?.detail ?? operationError}</span>
          </div>
        )}

        <main className="git-operation-content">
          {tab === 'changes' ? (
            <GitChangesView snapshot={snapshot} />
          ) : (
            <GitCommitView
              snapshot={snapshot}
              message={message}
              selectedPaths={selectedPaths}
              operation={operation}
              stale={stale}
              onMessageChange={setMessage}
              onTogglePath={togglePath}
              onCommit={() => void runCommit(false)}
              onCommitAndPush={() => void runCommit(true)}
              onPush={() => void runPush()}
            />
          )}
        </main>

        {confirmDiscard && (
          <div className="git-operation-discard" role="alertdialog" aria-modal="true">
            <div>
              <strong>放弃未提交的编辑？</strong>
              <p>提交信息和文件选择将被清空，工作区文件不会改变。</p>
              <div>
                <button type="button" autoFocus onClick={() => setConfirmDiscard(false)}>
                  继续编辑
                </button>
                <button type="button" className="danger" onClick={closeDialog}>
                  放弃并关闭
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
