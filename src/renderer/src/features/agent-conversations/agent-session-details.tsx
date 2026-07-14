import type { ReactElement } from 'react'
import type { AgentSessionDetail, AgentSessionSummary } from './view-model'
import { IconClose, IconFile, IconHistory, IconRobot } from '../../components/common/Icons'

export function AgentSessionDetails({
  summary,
  detail,
  archived,
  onClose,
  onActivate,
  onOpenAsWork,
  onArchive,
  onRestore,
  onDelete,
}: {
  summary: AgentSessionSummary | null
  detail: AgentSessionDetail | null
  archived: boolean
  onClose: () => void
  onActivate: (conversationId: string) => void
  onOpenAsWork: (conversationId: string) => void
  onArchive: (conversationId: string) => void
  onRestore: (conversationId: string) => void
  onDelete: (conversationId: string) => void
}): ReactElement | null {
  if (!summary || !detail) return null

  return (
    <div className="agent-session-detail">
      <div className="agent-session-detail-head">
        <div className="agent-session-detail-title">
          {summary.isWorkspaceBound ? <IconFile size={13} /> : <IconRobot size={13} />}
          <span title={detail.title}>{detail.title}</span>
        </div>
        <button onClick={onClose} title="关闭详情">
          <IconClose size={12} />
        </button>
      </div>

      <div className="agent-session-detail-preview">{detail.preview}</div>

      <div className="agent-session-detail-rows">
        {detail.rows.map((row) => (
          <div key={row.label} className="agent-session-detail-row">
            <span>{row.label}</span>
            <strong title={row.title ?? row.value}>{row.value}</strong>
          </div>
        ))}
      </div>

      <div className="agent-session-detail-actions">
        {archived ? (
          <>
            <button onClick={() => onRestore(summary.id)} title="恢复并切换到这个会话">
              <IconHistory size={12} />
              恢复
            </button>
            <button
              className="danger"
              onClick={() => onDelete(summary.id)}
              title="永久删除归档会话"
            >
              删除
            </button>
          </>
        ) : (
          <>
            <button onClick={() => onActivate(summary.id)} title="切换到这个会话">
              <IconHistory size={12} />
              切换
            </button>
            <button onClick={() => onOpenAsWork(summary.id)} title="移到当前工作空间">
              <IconFile size={12} />
              工作会话
            </button>
            <button className="danger" onClick={() => onArchive(summary.id)} title="归档会话">
              归档
            </button>
          </>
        )}
      </div>
    </div>
  )
}
