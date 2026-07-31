import { useEffect, useState } from 'react'
import type {
  ReviseWebAffairFlowNodeInput,
  WebAffair,
  WebAffairNodeExecutor,
  WebAffairNodeType,
} from '@shared/web-affairs/web-affair-types'

interface DraftNode extends ReviseWebAffairFlowNodeInput {
  dependencies: string[]
  immutable: boolean
}

export function WebAffairFlowEditor({
  affair,
  onSaved,
  onError,
}: {
  affair: WebAffair
  onSaved: (affair: WebAffair) => void
  onError: (message: string) => void
}): React.ReactElement {
  const [editing, setEditing] = useState(false)
  const [drafts, setDrafts] = useState<DraftNode[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setDrafts(toDrafts(affair))
  }, [affair])

  const update = (id: string, patch: Partial<DraftNode>): void =>
    setDrafts((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)))

  const addNode = (): void => {
    const id = `new:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`
    setDrafts((items) => [
      ...items,
      {
        id,
        title: '新办理节点',
        type: 'web-task',
        executor: 'user',
        accountIds: [...affair.accountIds],
        materialIds: affair.materials.map((item) => item.id),
        successCriteria: ['已有明确、可验证的办理结果'],
        dependencies: items.length > 0 ? [items[items.length - 1].id] : [],
        immutable: false,
      },
    ])
  }

  const removeNode = (id: string): void =>
    setDrafts((items) =>
      items
        .filter((item) => item.id !== id)
        .map((item) => ({ ...item, dependencies: item.dependencies.filter((dep) => dep !== id) })),
    )

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      const result = await window.cclinkStudio.webAffairs.reviseFlow({
        affairId: affair.id,
        expectedVersion: affair.flow.version,
        nodes: drafts.map(
          ({ dependencies: _dependencies, immutable: _immutable, ...node }) => node,
        ),
        edges: drafts.flatMap((node) =>
          node.dependencies.map((dependencyId) => ({
            fromNodeId: dependencyId,
            toNodeId: node.id,
          })),
        ),
      })
      if (!result.success) {
        onError(result.error.message)
        return
      }
      onSaved(result.data)
      setEditing(false)
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        className="web-affair-secondary-action"
        onClick={() => setEditing(true)}
      >
        编辑未执行流程
      </button>
    )
  }

  return (
    <div className="web-affair-flow-editor">
      <div className="web-affair-flow-editor-heading">
        <strong>编辑流程 v{affair.flow.version}</strong>
        <span>已执行节点和历史依赖不可修改；多选前置节点可形成并行分支。</span>
      </div>
      {drafts.map((node, index) => (
        <div
          className={`web-affair-flow-editor-row ${node.immutable ? 'immutable' : ''}`}
          key={node.id}
        >
          <span>{index + 1}</span>
          <input
            aria-label={`节点 ${index + 1} 名称`}
            value={node.title}
            disabled={node.immutable}
            onChange={(event) => update(node.id, { title: event.target.value })}
          />
          <select
            value={node.type}
            disabled={node.immutable}
            onChange={(event) => update(node.id, { type: event.target.value as WebAffairNodeType })}
          >
            <option value="web-task">网页办理</option>
            <option value="human-task">人工步骤</option>
            <option value="wait-external">等待外部</option>
            <option value="verification">结果核验</option>
          </select>
          <select
            value={node.executor}
            disabled={node.immutable}
            onChange={(event) =>
              update(node.id, { executor: event.target.value as WebAffairNodeExecutor })
            }
          >
            <option value="user">用户</option>
            <option value="ai">AI</option>
            <option value="external">外部机构</option>
          </select>
          <label>
            前置节点
            <select
              multiple
              value={node.dependencies}
              disabled={node.immutable}
              onChange={(event) =>
                update(node.id, {
                  dependencies: Array.from(event.currentTarget.selectedOptions).map(
                    (option) => option.value,
                  ),
                })
              }
            >
              {drafts
                .filter((candidate) => candidate.id !== node.id)
                .map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.title}
                  </option>
                ))}
            </select>
          </label>
          {!node.immutable && drafts.length > 1 ? (
            <button type="button" onClick={() => removeNode(node.id)}>
              删除
            </button>
          ) : (
            <small>{node.immutable ? '历史锁定' : ''}</small>
          )}
        </div>
      ))}
      <div className="web-affair-flow-editor-actions">
        <button type="button" onClick={addNode}>
          新增节点
        </button>
        <button type="button" onClick={() => setEditing(false)}>
          取消
        </button>
        <button type="button" className="primary" disabled={saving} onClick={() => void save()}>
          {saving ? '保存中…' : '保存新版本'}
        </button>
      </div>
    </div>
  )
}

function toDrafts(affair: WebAffair): DraftNode[] {
  return affair.flow.nodes.map((node) => ({
    id: node.id,
    title: node.title,
    description: node.description,
    type: node.type,
    executor: node.executor,
    accountIds: [...node.accountIds],
    materialIds: [...node.materialIds],
    successCriteria: [...node.successCriteria],
    dependencies: affair.flow.edges
      .filter((edge) => edge.toNodeId === node.id)
      .map((edge) => edge.fromNodeId),
    immutable:
      ['completed', 'skipped', 'cancelled'].includes(node.status) ||
      affair.attempts.some((attempt) => attempt.nodeId === node.id),
  }))
}
