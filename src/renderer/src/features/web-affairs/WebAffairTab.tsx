import { useCallback, useEffect, useMemo, useState } from 'react'
import type { WebAffair, WebAffairNodeStatus } from '@shared/web-affairs/web-affair-types'
import type { WebResourceSnapshot } from '@shared/web-resources/web-resource-types'
import { useTabStore, useWorkspaceStore } from '../../stores'
import {
  WEB_AFFAIR_CHANGED_EVENT,
  WEB_AFFAIR_EXECUTOR_LABELS,
  WEB_AFFAIR_NODE_STATUS_LABELS,
  WEB_AFFAIR_STATUS_LABELS,
} from './web-affair-view-model'
import { WebAffairFlowEditor } from './WebAffairFlowEditor'
import { WebAffairNodeActions } from './WebAffairNodeActions'

export function WebAffairTab({ affairId }: { affairId: string }): React.ReactElement {
  const openTab = useTabStore((state) => state.openTab)
  const workspaceRef = useWorkspaceStore((state) => state.activeWorkspaceRef)
  const [affair, setAffair] = useState<WebAffair | null>(null)
  const [resources, setResources] = useState<WebResourceSnapshot | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [nextStatus, setNextStatus] = useState<WebAffairNodeStatus | ''>('')
  const [resultNote, setResultNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    const [affairResult, resourceResult] = await Promise.all([
      window.cclinkStudio.webAffairs.getSnapshot(),
      window.cclinkStudio.webResources.getSnapshot(),
    ])
    if (!affairResult.success) throw new Error(affairResult.error.message)
    if (!resourceResult.success) throw new Error(resourceResult.error.message)
    const found = affairResult.data.affairs.find((item) => item.id === affairId)
    if (!found) throw new Error('事务不存在或已失效')
    setAffair(found)
    setResources(resourceResult.data)
    setSelectedNodeId((current) =>
      current && found.flow.nodes.some((node) => node.id === current)
        ? current
        : (found.flow.nodes.find((node) => node.status === 'ready')?.id ??
          found.flow.nodes[0]?.id ??
          null),
    )
    setError(null)
  }, [affairId])

  useEffect(() => {
    void load().catch((reason) =>
      setError(reason instanceof Error ? reason.message : String(reason)),
    )
  }, [load])

  useEffect(
    () =>
      window.cclinkStudio.webAffairs.onChanged((payload) => {
        if (payload.affairId === affairId) {
          void load().catch((reason) =>
            setError(reason instanceof Error ? reason.message : String(reason)),
          )
        }
      }),
    [affairId, load],
  )

  const selectedNode = affair?.flow.nodes.find((node) => node.id === selectedNodeId)
  const principal = resources?.principals.find((item) => item.id === affair?.principalId)
  const accounts = resources?.accounts.filter((item) => affair?.accountIds.includes(item.id)) ?? []
  const websites = resources?.websites.filter((item) => affair?.websiteIds.includes(item.id)) ?? []
  const selectedAccounts =
    accounts.filter((account) => selectedNode?.accountIds.includes(account.id)) ?? []
  const selectedMaterials =
    affair?.materials.filter((material) => selectedNode?.materialIds.includes(material.id)) ?? []

  const progress = useMemo(() => {
    if (!affair) return 0
    const completed = affair.flow.nodes.filter(
      (node) => node.status === 'completed' || node.status === 'skipped',
    ).length
    return Math.round((completed / affair.flow.nodes.length) * 100)
  }, [affair])

  const updateNode = async (): Promise<void> => {
    if (!selectedNode || !nextStatus) return
    setSaving(true)
    setError(null)
    try {
      const result = await window.cclinkStudio.webAffairs.updateNode({
        affairId,
        nodeId: selectedNode.id,
        status: nextStatus,
        resultNote,
      })
      if (!result.success) {
        setError(result.error.message)
        return
      }
      setAffair(result.data)
      setNextStatus('')
      setResultNote('')
      window.dispatchEvent(new Event(WEB_AFFAIR_CHANGED_EVENT))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSaving(false)
    }
  }

  const acceptChangedAffair = (next: WebAffair): void => {
    setAffair(next)
    setError(null)
    window.dispatchEvent(new Event(WEB_AFFAIR_CHANGED_EVENT))
  }

  const inspectMaterials = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      const result = await window.cclinkStudio.webAffairs.inspectMaterials(affairId)
      if (!result.success) {
        setError(result.error.message)
        return
      }
      acceptChangedAffair(result.data)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSaving(false)
    }
  }

  const openAccount = (accountId: string, label: string): void => {
    openTab({
      type: 'web-resource',
      title: label,
      icon: '🌐',
      webResource: { accountId },
      workspaceRef,
    })
  }

  if (error && !affair) return <div className="web-affair-tab-state error">{error}</div>
  if (!affair || !resources) return <div className="web-affair-tab-state">正在读取事务…</div>

  return (
    <div className="web-affair-tab">
      <header className="web-affair-tab-header">
        <div>
          <div className="web-affair-tab-eyebrow">个人或公司的网页事务代理人</div>
          <h1>{affair.title}</h1>
          <p>{affair.objective}</p>
        </div>
        <div className="web-affair-tab-summary">
          <strong className={`web-affair-status ${affair.status}`}>
            {WEB_AFFAIR_STATUS_LABELS[affair.status]}
          </strong>
          <span>{progress}%</span>
        </div>
      </header>

      {error ? <div className="web-affair-tab-alert">{error}</div> : null}

      <section className="web-affair-resources-panel">
        <div className="web-affair-section-heading">
          <div>
            <span>01</span>
            <h2>相关资源</h2>
          </div>
          <small>本地物料、目标网站、业务主体和登录账号</small>
          <button type="button" disabled={saving} onClick={() => void inspectMaterials()}>
            {saving ? '检查中…' : '检查材料'}
          </button>
        </div>
        <div className="web-affair-resource-grid">
          <ResourceCard title="业务主体" items={[principal?.name ?? '主体资源已失效']} />
          <ResourceCard
            title="目标网站"
            items={websites.length > 0 ? websites.map((website) => website.name) : ['暂未关联']}
          />
          <div className="web-affair-resource-card">
            <strong>账号与登录环境</strong>
            {accounts.length > 0 ? (
              accounts.map((account) => (
                <button
                  type="button"
                  key={account.id}
                  onClick={() => openAccount(account.id, account.label)}
                >
                  {account.label}
                  <small>{account.browserProfileId}</small>
                </button>
              ))
            ) : (
              <span>暂未关联</span>
            )}
          </div>
          <ResourceCard
            title="本地物料"
            items={
              affair.materials.length > 0
                ? affair.materials.map(
                    (material) =>
                      `${material.name} · ${
                        material.state === 'available'
                          ? '可用'
                          : material.state === 'missing'
                            ? '已丢失'
                            : material.state === 'changed'
                              ? '已变化，需确认'
                              : '待检查'
                      }`,
                  )
                : ['暂未关联']
            }
          />
        </div>
      </section>

      <div className="web-affair-main-grid">
        <section className="web-affair-flow-panel">
          <div className="web-affair-section-heading">
            <div>
              <span>02</span>
              <h2>整体流程</h2>
            </div>
            <small>点击节点查看办理情况</small>
            <WebAffairFlowEditor
              affair={affair}
              onSaved={acceptChangedAffair}
              onError={(message) => setError(message)}
            />
          </div>
          <div className="web-affair-flow">
            {affair.flow.nodes.map((node, index) => {
              const dependencies = affair.flow.edges
                .filter((edge) => edge.toNodeId === node.id)
                .map((edge) => affair.flow.nodes.find((item) => item.id === edge.fromNodeId)?.title)
                .filter(Boolean)
              return (
                <div className="web-affair-flow-step" key={node.id}>
                  <button
                    type="button"
                    className={`${node.status} ${selectedNodeId === node.id ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedNodeId(node.id)
                      setNextStatus('')
                      setResultNote('')
                    }}
                  >
                    <span>{index + 1}</span>
                    <strong>{node.title}</strong>
                    <em>{WEB_AFFAIR_NODE_STATUS_LABELS[node.status]}</em>
                    {dependencies.length > 0 ? (
                      <small>前置：{dependencies.join('、')}</small>
                    ) : (
                      <small>起始节点</small>
                    )}
                  </button>
                  {index < affair.flow.nodes.length - 1 ? <i aria-hidden="true">↳</i> : null}
                </div>
              )
            })}
          </div>
        </section>

        <section className="web-affair-node-panel">
          <div className="web-affair-section-heading">
            <div>
              <span>03</span>
              <h2>节点办理情况</h2>
            </div>
            <small>状态、卡点、材料、网站与结果</small>
          </div>
          {selectedNode ? (
            <div className="web-affair-node-detail">
              <h3>{selectedNode.title}</h3>
              <DetailRow
                label="当前状态"
                value={WEB_AFFAIR_NODE_STATUS_LABELS[selectedNode.status]}
              />
              <DetailRow
                label="当前责任人"
                value={WEB_AFFAIR_EXECUTOR_LABELS[selectedNode.executor]}
              />
              <DetailRow
                label="涉及账号"
                value={
                  selectedAccounts.length > 0
                    ? selectedAccounts.map((account) => account.label).join('、')
                    : '暂未关联'
                }
              />
              <DetailRow
                label="所需材料"
                value={
                  selectedMaterials.length > 0
                    ? selectedMaterials.map((material) => material.name).join('、')
                    : '暂未关联'
                }
              />
              <DetailRow label="成功判据" value={selectedNode.successCriteria.join('；')} />
              <DetailRow label="最近结果" value={selectedNode.lastResultNote ?? '尚无结果说明'} />

              <WebAffairNodeActions
                affair={affair}
                node={selectedNode}
                resources={resources}
                onChanged={acceptChangedAffair}
                onError={(message) => setError(message)}
              />

              {selectedNode.availableTransitions.length > 0 ? (
                <div className="web-affair-node-update">
                  <label>
                    更新办理状态
                    <select
                      value={nextStatus}
                      onChange={(event) =>
                        setNextStatus(event.target.value as WebAffairNodeStatus | '')
                      }
                    >
                      <option value="">请选择下一状态</option>
                      {selectedNode.availableTransitions.map((status) => (
                        <option key={status} value={status}>
                          {WEB_AFFAIR_NODE_STATUS_LABELS[status]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    结果或卡点说明{nextStatus === 'completed' ? '（完成时必填）' : ''}
                    <textarea
                      rows={4}
                      maxLength={2_000}
                      value={resultNote}
                      onChange={(event) => setResultNote(event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={
                      saving || !nextStatus || (nextStatus === 'completed' && !resultNote.trim())
                    }
                    onClick={() => void updateNode()}
                  >
                    {saving ? '保存中…' : '保存节点进度'}
                  </button>
                </div>
              ) : (
                <p className="web-affair-node-terminal">该节点已进入终态，历史不会被覆盖。</p>
              )}

              <div className="web-affair-node-history">
                <strong>事务时间线</strong>
                {[...affair.events]
                  .reverse()
                  .slice(0, 8)
                  .map((event) => (
                    <div key={event.id}>
                      <time>{new Date(event.occurredAt).toLocaleString()}</time>
                      <span>{event.summary}</span>
                    </div>
                  ))}
              </div>
            </div>
          ) : (
            <div className="web-affair-node-empty">请选择一个流程节点。</div>
          )}
        </section>
      </div>
    </div>
  )
}

function ResourceCard({ title, items }: { title: string; items: string[] }): React.ReactElement {
  return (
    <div className="web-affair-resource-card">
      <strong>{title}</strong>
      {items.map((item, index) => (
        <span key={`${item}-${index}`} title={item}>
          {item}
        </span>
      ))}
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="web-affair-detail-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}
