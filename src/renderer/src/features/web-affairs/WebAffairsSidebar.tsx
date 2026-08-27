import { useCallback, useEffect, useMemo, useState } from 'react'
import type { WebAffairProjectSnapshot } from '@shared/web-affairs/web-affair-types'
import { workspaceRefLabel, type WorkspaceRef } from '@shared/workspace-ref'
import { IconPlus } from '../../components/common/Icons'
import { useTabStore } from '../../stores'
import { createWebAffairDraftTab } from './web-affair-draft'
import { getStaleWebAffairTabIds } from './web-affair-tab-reconciliation'
import { WEB_AFFAIR_CHANGED_EVENT, WEB_AFFAIR_STATUS_LABELS } from './web-affair-view-model'

export function WebAffairsSidebar({
  workspaceRef,
}: {
  workspaceRef: WorkspaceRef
}): React.ReactElement {
  const openTab = useTabStore((state) => state.openTab)
  const [affairs, setAffairs] = useState<WebAffairProjectSnapshot | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmClaimId, setConfirmClaimId] = useState<string | null>(null)

  const reload = useCallback(async (): Promise<void> => {
    const affairResult = await window.cclinkStudio.webAffairs.getSnapshot({ workspaceRef })
    if (!affairResult.success) throw new Error(affairResult.error.message)
    const tabStore = useTabStore.getState()
    for (const tabId of getStaleWebAffairTabIds(tabStore.tabs, affairResult.data, workspaceRef)) {
      tabStore.closeTab(tabId)
    }
    setAffairs(affairResult.data)
    setError(null)
  }, [workspaceRef])

  useEffect(() => {
    void reload().catch((reason) =>
      setError(reason instanceof Error ? reason.message : String(reason)),
    )
  }, [reload])

  useEffect(() => {
    const handleChange = (): void => {
      void reload().catch((reason) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      )
    }
    window.addEventListener(WEB_AFFAIR_CHANGED_EVENT, handleChange)
    return () => window.removeEventListener(WEB_AFFAIR_CHANGED_EVENT, handleChange)
  }, [reload])

  useEffect(
    () =>
      window.cclinkStudio.webAffairs.onChanged(() => {
        void reload().catch((reason) =>
          setError(reason instanceof Error ? reason.message : String(reason)),
        )
      }),
    [reload],
  )

  const sortedAffairs = useMemo(
    () =>
      [...(affairs?.affairs ?? [])]
        .filter((affair) => affair.kind === 'generic')
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [affairs],
  )

  const openAffair = (affairId: string, affairTitle: string): void => {
    openTab({
      type: 'web-affair',
      title: affairTitle,
      icon: '📋',
      webAffair: { affairId },
      workspaceRef,
    })
  }

  const claimLegacyAffair = async (affairId: string): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      const result = await window.cclinkStudio.webAffairs.claimLegacyAffair({
        workspaceRef,
        affairId,
      })
      if (!result.success) {
        setError(result.error.message)
        return
      }
      setConfirmClaimId(null)
      await reload()
      openAffair(result.data.id, result.data.title)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="web-affairs-sidebar">
      <div className="web-affairs-toolbar">
        <button type="button" onClick={() => openTab(createWebAffairDraftTab(workspaceRef))}>
          <IconPlus size={14} />
          新建事务
        </button>
      </div>

      {error ? <div className="web-affairs-error">{error}</div> : null}
      {affairs && affairs.unassignedAffairCount > 0 ? (
        <div className="web-affairs-legacy-notice">
          <strong>待归属旧事务 · {affairs.unassignedAffairCount}</strong>
          <p>不会按旧路径自动归类。只有你逐项确认后，才会归入当前项目。</p>
          <div className="web-affairs-legacy-list">
            {affairs.unassignedAffairs.map((legacy) => (
              <div key={legacy.id} className="web-affairs-legacy-item">
                <span>
                  <b>{legacy.title}</b>
                  <small>{legacy.objective}</small>
                  <small>
                    原工作空间：{workspaceRefLabel(legacy.sourceWorkspaceRef)} · 关联{' '}
                    {legacy.accountCount} 个账号
                  </small>
                </span>
                {confirmClaimId === legacy.id ? (
                  <div className="web-affairs-legacy-confirm">
                    <em>确认归入当前项目？主进程会重新校验其主体和账号。</em>
                    <div>
                      <button type="button" onClick={() => setConfirmClaimId(null)}>
                        取消
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void claimLegacyAffair(legacy.id)}
                      >
                        {saving ? '校验中…' : '确认归入'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button type="button" onClick={() => setConfirmClaimId(legacy.id)}>
                    归入当前项目
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {!affairs && !error ? <div className="web-affairs-empty">正在读取事务…</div> : null}
      {affairs && sortedAffairs.length === 0 ? (
        <div className="web-affairs-empty">还没有事务。创建后，流程和卡点会持续保存在这里。</div>
      ) : null}
      <div className="web-affairs-list">
        {sortedAffairs.map((affair) => {
          const completed = affair.flow.nodes.filter((node) => node.status === 'completed').length
          return (
            <button
              type="button"
              className="web-affair-row"
              key={affair.id}
              onClick={() => openAffair(affair.id, affair.title)}
            >
              <span className="web-affair-row-title">
                <strong>{affair.title}</strong>
                <em className={`web-affair-status ${affair.status}`}>
                  {WEB_AFFAIR_STATUS_LABELS[affair.status]}
                </em>
              </span>
              <span>{affair.objective}</span>
              <small>
                {completed}/{affair.flow.nodes.length} 个节点完成 ·{' '}
                {new Date(affair.updatedAt).toLocaleDateString()}
              </small>
            </button>
          )
        })}
      </div>
    </div>
  )
}
