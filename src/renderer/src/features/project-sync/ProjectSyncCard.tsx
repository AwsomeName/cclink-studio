import { useEffect } from 'react'
import { parseGitHubHttpsRepository } from '@shared/git'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useFixedSpacesStore } from '../workspace-open/fixed-spaces-store'
import {
  isProjectSyncPaused,
  loadProjectSyncPreview,
  openProjectSyncDialog,
  projectSyncLabel,
  runProjectSync,
  useProjectSync,
} from './project-sync-store'
import './project-sync.css'

/** The local project that may use project sync: not My Space, not a diary, not remote. */
export function useProjectSyncPath(): string | null {
  const ref = useWorkspaceStore((s) => s.activeWorkspaceRef)
  const settings = useWorkspaceStore((s) => s.settingsSnapshot)
  const personal = useFixedSpacesStore((s) => s.spaces?.personal?.workspacePath)
  if (ref.kind !== 'local' || ref.path === personal) return null
  if (settings?.workspacePath !== ref.path || settings.settings.type === 'diary') return null
  return ref.path
}

function describeLast(received?: number, sent?: number): string {
  const parts = [
    received ? `收到 ${received} 个文件` : '',
    sent ? `上传 ${sent} 个文件` : '',
  ].filter(Boolean)
  return parts.length ? parts.join('，') : '没有改动'
}

/** 项目首页“同步”卡片（效果稿 project-sync-2026-11-24：home / synced / git）。 */
export function ProjectSyncCard({
  className = '',
}: {
  className?: string
}): React.ReactElement | null {
  const path = useProjectSyncPath()
  const state = useProjectSync(path)
  const type = useWorkspaceStore((s) => s.settingsSnapshot?.settings.type)
  useEffect(() => {
    if (path) void loadProjectSyncPreview(path).catch(() => {})
  }, [path])
  if (!path || !state.loaded) return null
  const snap = state.snapshot
  const gitManaged = !snap?.remoteUrl && state.preview?.gitManaged
  const heading = (
    <div className="project-sync-card-head">
      <h2>同步</h2>
      <span
        className={
          'project-sync-tag ' + (!snap?.remoteUrl ? '' : isProjectSyncPaused(state) ? 'warn' : 'ok')
        }
      >
        {gitManaged
          ? '由 Git 管理'
          : !snap?.remoteUrl
            ? '未设置'
            : isProjectSyncPaused(state)
              ? '已暂停'
              : state.busy
                ? '同步中'
                : '已同步'}
      </span>
      {snap?.remoteUrl && (
        <button disabled={state.busy} onClick={() => void runProjectSync(path, true)}>
          {state.busy ? '同步中…' : '立即同步'}
        </button>
      )}
    </div>
  )
  if (gitManaged)
    return (
      <section className={'project-sync-card ' + className} aria-label="同步">
        {heading}
        <p>
          这个文件夹本身是 Git 仓库。Studio 不会替你自动提交或推送，请用左下角 Git
          查看变更、提交并推送。
        </p>
      </section>
    )
  if (!snap?.remoteUrl)
    return (
      <section className={'project-sync-card ' + className} aria-label="同步">
        {heading}
        <p>
          把这个项目同步到你自己的 GitHub 私有仓库，另一台电脑下载后两边自动保持一致，也可当作备份。
        </p>
        <dl className="project-sync-kv">
          <dt>会同步</dt>
          <dd>
            项目里的文档、图片、设计稿，项目设置和共享定时任务
            {type === 'company' ? '；公司记录（业务、客户与售后、决策）和公司账目' : ''}
          </dd>
          <dt>只在本机</dt>
          <dd>Agent 会话、网站登录、Token、超过 50 MB 的文件</dd>
        </dl>
        <button className="primary" onClick={() => openProjectSyncDialog(path, true)}>
          设置同步
        </button>
      </section>
    )
  const repo = snap.repository ?? parseGitHubHttpsRepository(snap.remoteUrl)?.name
  const next = new Date()
  next.setHours(next.getHours() + 1, 0, 0, 0)
  return (
    <section className={'project-sync-card ' + className} aria-label="同步">
      {heading}
      {isProjectSyncPaused(state) && (
        <p className="project-sync-warn">
          {projectSyncLabel(state)}{' '}
          <button className="project-sync-link" onClick={() => openProjectSyncDialog(path)}>
            查看
          </button>
        </p>
      )}
      <dl className="project-sync-kv">
        <dt>位置</dt>
        <dd>github.com/{repo}（私有）</dd>
        <dt>上次</dt>
        <dd>
          {snap.checkedAt
            ? new Date(snap.checkedAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              }) +
              ' · ' +
              describeLast(snap.received, snap.sent)
            : '还没有完成过同步'}
        </dd>
        <dt>下次</dt>
        <dd>
          {next.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}，或下次进入项目时
        </dd>
        {!!snap.skipped?.length && (
          <>
            <dt>未同步</dt>
            <dd>
              {snap.skipped.length} 个文件 ·{' '}
              <button className="project-sync-link" onClick={() => openProjectSyncDialog(path)}>
                查看
              </button>
            </dd>
          </>
        )}
      </dl>
      <p className="project-sync-foot">
        只同步到私有仓库 · 会话与网站登录只在这台电脑 ·{' '}
        <button className="project-sync-link" onClick={() => openProjectSyncDialog(path)}>
          同步位置
        </button>
      </p>
    </section>
  )
}

/** Status bar item replacing the Git item for projects that use project sync. */
export function ProjectSyncStatus({ path }: { path: string }): React.ReactElement {
  const state = useProjectSync(path)
  return (
    <button
      className={
        'status-bar-item project-sync-status' + (isProjectSyncPaused(state) ? ' alert' : '')
      }
      onClick={() => openProjectSyncDialog(path)}
      aria-label={'同步：' + projectSyncLabel(state)}
    >
      {isProjectSyncPaused(state) ? '⚠' : '↻'} {projectSyncLabel(state)}
    </button>
  )
}
