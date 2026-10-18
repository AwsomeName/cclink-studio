import { randomUUID } from 'node:crypto'
import type {
  ReviseWebAffairFlowInput,
  WebAffair,
  WebAffairEdge,
  WebAffairFlowDiffOperation,
  WebAffairNode,
  WebAffairOperationResult,
} from '../../shared/web-affairs/web-affair-types'
import { createNode, hasCycle, TERMINAL_NODE_STATUSES } from './web-affair-flow'

export function buildRevisedFlow(
  affair: WebAffair,
  input: ReviseWebAffairFlowInput,
  timestamp: () => string,
): WebAffairOperationResult<{ nodes: WebAffairNode[]; edges: WebAffairEdge[] }> {
  const existingById = new Map(affair.flow.nodes.map((node) => [node.id, node]))
  const immutableIds = new Set(
    affair.flow.nodes
      .filter(
        (node) =>
          TERMINAL_NODE_STATUSES.has(node.status) ||
          affair.attempts.some((attempt) => attempt.nodeId === node.id),
      )
      .map((node) => node.id),
  )
  for (const id of immutableIds) {
    const proposed = input.nodes.find((node) => node.id === id)
    const existing = existingById.get(id)!
    if (!proposed) return flowRevisionError('IMMUTABLE_HISTORY', '已执行节点不能删除')
    if (
      proposed.title !== existing.title ||
      proposed.type !== existing.type ||
      proposed.executor !== existing.executor ||
      JSON.stringify(proposed.accountIds) !== JSON.stringify(existing.accountIds) ||
      JSON.stringify(proposed.materialIds) !== JSON.stringify(existing.materialIds) ||
      JSON.stringify(proposed.successCriteria) !== JSON.stringify(existing.successCriteria)
    )
      return flowRevisionError('IMMUTABLE_HISTORY', '已执行节点内容不能修改，只能新增补正节点')
  }
  const idMap = new Map<string, string>()
  const now = timestamp()
  const nodes = input.nodes.map((item) => {
    const existing = existingById.get(item.id)
    const id = existing ? existing.id : randomUUID()
    idMap.set(item.id, id)
    if (existing) {
      return {
        ...existing,
        title: item.title,
        description: item.description,
        type: item.type,
        executor: item.executor,
        accountIds: [...new Set(item.accountIds)],
        materialIds: [...new Set(item.materialIds)],
        successCriteria: item.successCriteria,
        updatedAt: now,
      }
    }
    return createNode({ ...item, id, status: 'blocked', now })
  })
  const edges = input.edges.map((edge) => ({
    id: randomUUID(),
    fromNodeId: idMap.get(edge.fromNodeId) ?? edge.fromNodeId,
    toNodeId: idMap.get(edge.toNodeId) ?? edge.toNodeId,
  }))
  const invalid = validateFlow(affair, nodes, edges, immutableIds)
  return invalid ?? { success: true, data: { nodes, edges } }
}

export function applyFlowDiff(
  affair: WebAffair,
  operations: WebAffairFlowDiffOperation[],
  now: string,
): WebAffairOperationResult<{ nodes: WebAffairNode[]; edges: WebAffairEdge[] }> {
  let nodes = affair.flow.nodes.map((node) => ({ ...node }))
  let edges = affair.flow.edges.map((edge) => ({ ...edge }))
  const tempIds = new Map<string, string>()
  const immutableIds = new Set(
    nodes
      .filter(
        (node) =>
          TERMINAL_NODE_STATUSES.has(node.status) ||
          affair.attempts.some((attempt) => attempt.nodeId === node.id),
      )
      .map((node) => node.id),
  )
  for (const operation of operations) {
    if (operation.kind === 'add-node') {
      const id = randomUUID()
      tempIds.set(operation.tempId, id)
      nodes.push(
        createNode({
          id,
          title: operation.title,
          description: operation.description,
          type: operation.nodeType,
          catalogId: operation.catalogId,
          executor: operation.executor,
          status: 'blocked',
          accountIds: affair.accountIds,
          materialIds: affair.materials.map((item) => item.id),
          now,
        }),
      )
    } else if (operation.kind === 'update-node') {
      if (immutableIds.has(operation.nodeId))
        return flowRevisionError('IMMUTABLE_HISTORY', '已执行节点不能修改')
      if (!nodes.some((node) => node.id === operation.nodeId))
        return flowRevisionError('NOT_FOUND', '待修改节点不存在')
      nodes = nodes.map((node) =>
        node.id === operation.nodeId
          ? {
              ...node,
              title: operation.title ?? node.title,
              description: operation.description ?? node.description,
              executor: operation.executor ?? node.executor,
              updatedAt: now,
            }
          : node,
      )
    } else if (operation.kind === 'remove-node') {
      if (immutableIds.has(operation.nodeId))
        return flowRevisionError('IMMUTABLE_HISTORY', '已执行节点不能删除')
      nodes = nodes.filter((node) => node.id !== operation.nodeId)
      edges = edges.filter(
        (edge) => edge.fromNodeId !== operation.nodeId && edge.toNodeId !== operation.nodeId,
      )
    } else if (operation.kind === 'remove-edge') {
      const edge = edges.find((item) => item.id === operation.edgeId)
      if (edge && (immutableIds.has(edge.fromNodeId) || immutableIds.has(edge.toNodeId)))
        return flowRevisionError('IMMUTABLE_HISTORY', '已执行节点的历史依赖不能删除')
      edges = edges.filter((item) => item.id !== operation.edgeId)
    } else {
      const fromNodeId = tempIds.get(operation.fromNodeId) ?? operation.fromNodeId
      const toNodeId = tempIds.get(operation.toNodeId) ?? operation.toNodeId
      edges.push({ id: randomUUID(), fromNodeId, toNodeId })
    }
  }
  const invalid = validateFlow(affair, nodes, edges, immutableIds)
  return invalid ?? { success: true, data: { nodes, edges } }
}

function validateFlow(
  affair: WebAffair,
  nodes: WebAffairNode[],
  edges: WebAffairEdge[],
  immutableIds: Set<string>,
): WebAffairOperationResult<never> | null {
  if (nodes.length < 1 || nodes.length > 40 || edges.length > 160)
    return flowRevisionError('INVALID_INPUT', '流程规模超出限制')
  const nodeIds = new Set(nodes.map((node) => node.id))
  const materialIds = new Set(affair.materials.map((item) => item.id))
  if (nodeIds.size !== nodes.length) return flowRevisionError('INVALID_INPUT', '流程包含重复节点')
  for (const node of nodes) {
    if (
      node.accountIds.some((id) => !affair.accountIds.includes(id)) ||
      node.materialIds.some((id) => !materialIds.has(id))
    ) {
      return flowRevisionError('INVALID_RESOURCE_REFERENCE', '节点引用了事务范围之外的账号或材料')
    }
  }
  for (const edge of edges) {
    if (
      !nodeIds.has(edge.fromNodeId) ||
      !nodeIds.has(edge.toNodeId) ||
      edge.fromNodeId === edge.toNodeId
    )
      return flowRevisionError('INVALID_INPUT', '流程依赖包含无效节点或自循环')
  }
  const oldImmutableEdges = affair.flow.edges.filter(
    (edge) => immutableIds.has(edge.fromNodeId) || immutableIds.has(edge.toNodeId),
  )
  if (
    oldImmutableEdges.some(
      (old) =>
        !edges.some((edge) => edge.fromNodeId === old.fromNodeId && edge.toNodeId === old.toNodeId),
    )
  ) {
    return flowRevisionError('IMMUTABLE_HISTORY', '已执行节点的历史依赖不能删除')
  }
  if (hasCycle(nodes, edges)) return flowRevisionError('INVALID_INPUT', '事务流程必须是有向无环图')
  return null
}

function flowRevisionError(
  code: 'INVALID_INPUT' | 'IMMUTABLE_HISTORY' | 'NOT_FOUND' | 'INVALID_RESOURCE_REFERENCE',
  message: string,
): WebAffairOperationResult<never> {
  return { success: false, error: { code, message } }
}
