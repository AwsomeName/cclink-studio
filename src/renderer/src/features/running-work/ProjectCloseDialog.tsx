import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'
import type { WorkspaceWork } from './workspace-work'
import { useFloatingSurfaceRegistration } from '../../components/common/floating-surface-registry'
import { useEscapeDismiss } from '../../components/common/dismissable-layer'
import '../workspace-open/fixed-spaces.css'

export type ProjectCloseChoice = 'view' | 'disable-tasks' | null

interface ProjectCloseRequest {
  name: string
  running: number
  work: WorkspaceWork
  resolve: (choice: ProjectCloseChoice) => void
}

const useProjectCloseStore = create<{ request: ProjectCloseRequest | null }>(() => ({
  request: null,
}))

/** Asks how to close a project that still has background work (mockup project-close-2026-11-24). */
export function askProjectClose(
  name: string,
  running: number,
  work: WorkspaceWork,
): Promise<ProjectCloseChoice> {
  useProjectCloseStore.getState().request?.resolve(null)
  return new Promise((resolve) =>
    useProjectCloseStore.setState({ request: { name, running, work, resolve } }),
  )
}

export function ProjectCloseDialog(): React.ReactElement | null {
  const request = useProjectCloseStore((state) => state.request)
  const [busy, setBusy] = useState(false)
  const primaryRef = useRef<HTMLButtonElement>(null)
  const finish = (choice: ProjectCloseChoice): void => {
    request?.resolve(choice)
    useProjectCloseStore.setState({ request: null })
  }
  useFloatingSurfaceRegistration(Boolean(request))
  useEscapeDismiss(Boolean(request), () => finish(null))
  useEffect(() => {
    setBusy(false)
    primaryRef.current?.focus()
  }, [request])
  if (!request) return null
  const { work, running } = request
  const taskNames = [...new Set(work.tasks.map((task) => task.definition.title))]
  const canDisable = work.tasks.some((task) => task.activation.enabled)
  const live = [
    running ? `${running} 个会话` : '',
    work.terminals.length ? `${work.terminals.length} 个终端` : '',
  ].filter(Boolean)
  return createPortal(
    <div className="fixed-space-overlay">
      <div
        className="fixed-space-dialog project-close-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="关闭项目"
      >
        <h2>关闭「{request.name}」？</h2>
        <p>这个项目还有后台工作。</p>
        {live.length > 0 && <div className="project-close-k">运行中 {live.join(' · ')}</div>}
        {taskNames.length > 0 && (
          <>
            <div className="project-close-k">定时任务 {work.tasks.length} 个</div>
            <ul>
              {taskNames.map((title) => (
                <li key={title}>{title}</li>
              ))}
            </ul>
          </>
        )}
        {work.affairs.length > 0 && (
          <div className="project-close-k">待处理事务 {work.affairs.length} 个</div>
        )}
        {live.length > 0 && (
          <p className="project-close-warn">
            会话和终端不会被结束，关闭后仍在后台运行；完全退出 Studio 才会中断它们。
          </p>
        )}
        {work.errors.length > 0 && (
          <p className="project-close-warn">{work.errors.join('；')}，尚未确认全部工作状态。</p>
        )}
        <footer>
          <span />
          <span className="project-close-buttons">
            <button disabled={busy} onClick={() => finish(null)}>
              取消
            </button>
            {canDisable && (
              <button
                disabled={busy}
                onClick={() => {
                  setBusy(true)
                  finish('disable-tasks')
                }}
              >
                关闭并停用定时任务
              </button>
            )}
            <button
              ref={primaryRef}
              className="primary"
              disabled={busy}
              onClick={() => finish('view')}
            >
              仅关闭视图
            </button>
          </span>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
