import { useCallback, useEffect, useMemo, useState } from 'react'
import type { WebAffairProjectSnapshot } from '@shared/web-affairs/web-affair-types'
import type { WorkspaceRef } from '@shared/workspace-ref'
import { useTabStore } from '../../stores/tab-store'

const STATUS_LABELS = {
  draft: '草稿',
  running: '执行中',
  'waiting-human': '待处理',
  interrupted: '已中断',
  failed: '失败',
  published: '已发布',
  'result-unknown': '结果未知',
} as const

export function ArticlePublishingSidebar({
  workspaceRef,
}: {
  workspaceRef: WorkspaceRef
}): React.ReactElement {
  const openTab = useTabStore((state) => state.openTab)
  const [snapshot, setSnapshot] = useState<WebAffairProjectSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async (): Promise<void> => {
    const result = await window.cclinkStudio.webAffairs.getSnapshot({ workspaceRef })
    if (!result.success) throw new Error(result.error.message)
    setSnapshot(result.data)
    setError(null)
  }, [workspaceRef])

  useEffect(() => {
    void reload().catch((reason) =>
      setError(reason instanceof Error ? reason.message : String(reason)),
    )
    return window.cclinkStudio.webAffairs.onChanged(() => {
      void reload().catch((reason) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      )
    })
  }, [reload])

  const tasks = useMemo(
    () =>
      [...(snapshot?.affairs ?? [])]
        .filter((affair) => affair.kind === 'article-publishing' && affair.articlePublishing)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [snapshot],
  )

  if (workspaceRef.kind !== 'local') {
    return <div className="article-publishing-sidebar-empty">请先打开本地工作空间。</div>
  }

  return (
    <div className="article-publishing-sidebar">
      {error ? <div className="article-publishing-error">{error}</div> : null}
      {!snapshot && !error ? (
        <div className="article-publishing-sidebar-empty">正在读取发布历史…</div>
      ) : null}
      {snapshot && tasks.length === 0 ? (
        <div className="article-publishing-sidebar-empty">
          还没有发布记录。点击标题栏的＋选择一篇 Markdown。
        </div>
      ) : null}
      <div className="article-publishing-history-list">
        {tasks.map((affair) => {
          const publishing = affair.articlePublishing!
          const account = publishing.accountId.slice(0, 8)
          return (
            <button
              type="button"
              key={affair.id}
              className="article-publishing-history-row"
              onClick={() =>
                openTab({
                  type: 'article-publishing',
                  title: `发布 · ${affair.title}`,
                  icon: '📰',
                  workspaceRef,
                  articlePublishing: { affairId: affair.id },
                })
              }
            >
              <span className="article-publishing-history-title">{affair.title}</span>
              <span className={`article-publishing-status ${publishing.execution.status}`}>
                {STATUS_LABELS[publishing.execution.status]}
              </span>
              <small>
                CSDN · 账号 {account} · {new Date(affair.updatedAt).toLocaleString()}
              </small>
            </button>
          )
        })}
      </div>
    </div>
  )
}
