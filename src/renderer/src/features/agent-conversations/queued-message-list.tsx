import type { ReactElement } from 'react'
import type { QueuedAgentMessage } from './conversation-state'
import './queued-message-list.css'

export interface QueuedMessageListModel {
  items: QueuedAgentMessage[]
  pauseReason?: string | null
  dispatchId?: string | null
  canEdit: boolean
  onEdit(id: string): void
  onRemove(id: string): void
  onResume(): void
  onPause(): void
}

export function QueuedMessageList({
  model,
}: {
  model: QueuedMessageListModel
}): ReactElement | null {
  if (!model.items.length) return null
  return (
    <section className="agent-message-queue" aria-label="待发送消息">
      <div className="agent-message-queue-heading">
        <span role="status">
          待发送 · {model.items.length} 条{model.pauseReason ? ' · 已暂停' : ''}
        </span>
        <button type="button" onClick={model.pauseReason ? model.onResume : model.onPause}>
          {model.pauseReason ? '继续队列' : '暂停队列'}
        </button>
      </div>
      {model.pauseReason ? <p role="status">{model.pauseReason}</p> : null}
      <ol>
        {model.items.map((item, index) => (
          <li key={item.id}>
            <span className="agent-message-queue-number">{index + 1}</span>
            <div className="agent-message-queue-content">
              <span title={item.content}>{item.content}</span>
              {model.dispatchId === item.id ? <small>正在发送</small> : null}
              {item.pendingImages.length || item.missingImages ? (
                <small>
                  {item.missingImages ? '图片需重新添加' : `${item.pendingImages.length} 张图片`}
                </small>
              ) : null}
            </div>
            <button
              type="button"
              disabled={model.dispatchId === item.id || !model.canEdit}
              onClick={() => model.onEdit(item.id)}
              title={
                model.canEdit ? '移回输入框编辑，重新发送后排到队尾' : '请先处理输入框中的草稿'
              }
            >
              编辑
            </button>
            <button
              type="button"
              disabled={model.dispatchId === item.id}
              onClick={() => model.onRemove(item.id)}
            >
              删除
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}
