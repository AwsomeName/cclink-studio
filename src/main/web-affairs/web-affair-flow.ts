import { randomUUID } from 'node:crypto'
import type {
  WebAffairEdge,
  WebAffairNode,
  WebAffairNodeStatus,
  WebAffairStatus,
} from '../../shared/web-affairs/web-affair-types'

// Stateless node and flow rules; WebAffairService remains the state owner.
export const TERMINAL_NODE_STATUSES = new Set<WebAffairNodeStatus>([
  'completed',
  'skipped',
  'cancelled',
])

export const ALLOWED_TRANSITIONS: Record<WebAffairNodeStatus, ReadonlySet<WebAffairNodeStatus>> = {
  blocked: new Set(['cancelled']),
  ready: new Set([
    'running',
    'waiting-human',
    'waiting-external',
    'completed',
    'failed',
    'skipped',
    'cancelled',
  ]),
  running: new Set([
    'waiting-human',
    'waiting-external',
    'verifying',
    'completed',
    'failed',
    'cancelled',
  ]),
  'waiting-human': new Set(['ready', 'verifying', 'completed', 'failed', 'cancelled']),
  'waiting-external': new Set(['ready', 'verifying', 'completed', 'failed', 'cancelled']),
  verifying: new Set(['waiting-human', 'waiting-external', 'completed', 'failed', 'cancelled']),
  failed: new Set(['ready', 'cancelled']),
  completed: new Set(),
  skipped: new Set(),
  cancelled: new Set(),
}

export function createNode(input: {
  id?: string
  title: string
  description?: string
  type?: WebAffairNode['type']
  catalogId?: string
  status: WebAffairNodeStatus
  executor: WebAffairNode['executor']
  accountIds: string[]
  materialIds: string[]
  successCriteria?: string[]
  now: string
}): WebAffairNode {
  return {
    id: input.id ?? randomUUID(),
    type: input.type ?? 'web-task',
    catalogId: input.catalogId,
    title: input.title,
    description: input.description,
    status: input.status,
    executor: input.executor,
    accountIds: [...new Set(input.accountIds)],
    materialIds: [...new Set(input.materialIds)],
    successCriteria: input.successCriteria ?? [`“${input.title}”已有明确结果说明`],
    availableTransitions: [...ALLOWED_TRANSITIONS[input.status]],
    createdAt: input.now,
    updatedAt: input.now,
  }
}

export function normalizeNodeStates(
  nodes: WebAffairNode[],
  edges: WebAffairEdge[],
  now: string,
): WebAffairNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  return nodes.map((node) => {
    let status = node.status
    if (
      !TERMINAL_NODE_STATUSES.has(status) &&
      !['running', 'waiting-human', 'waiting-external', 'verifying', 'failed'].includes(status)
    ) {
      const dependencies = edges.filter((edge) => edge.toNodeId === node.id)
      status =
        dependencies.length === 0 ||
        dependencies.every((edge) => {
          const dependency = byId.get(edge.fromNodeId)
          return dependency?.status === 'completed' || dependency?.status === 'skipped'
        })
          ? 'ready'
          : 'blocked'
    }
    return {
      ...node,
      status,
      availableTransitions: [...ALLOWED_TRANSITIONS[status]],
      ...(status !== node.status ? { updatedAt: now } : {}),
    }
  })
}

export function deriveAffairStatus(nodes: WebAffairNode[]): WebAffairStatus {
  if (nodes.every((node) => node.status === 'cancelled')) return 'cancelled'
  if (nodes.every((node) => TERMINAL_NODE_STATUSES.has(node.status))) return 'completed'
  if (nodes.some((node) => node.status === 'waiting-human')) return 'needs-attention'
  if (nodes.some((node) => node.status === 'waiting-external')) return 'waiting-external'
  if (nodes.some((node) => node.status === 'failed')) return 'failed'
  return 'active'
}

export function hasCycle(nodes: WebAffairNode[], edges: WebAffairEdge[]): boolean {
  const incoming = new Map(nodes.map((node) => [node.id, 0]))
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]))
  for (const edge of edges) {
    incoming.set(edge.toNodeId, (incoming.get(edge.toNodeId) ?? 0) + 1)
    outgoing.get(edge.fromNodeId)?.push(edge.toNodeId)
  }
  const pending = [...incoming.entries()].filter(([, count]) => count === 0).map(([id]) => id)
  let visited = 0
  while (pending.length > 0) {
    const id = pending.pop()!
    visited += 1
    for (const target of outgoing.get(id) ?? []) {
      const count = (incoming.get(target) ?? 0) - 1
      incoming.set(target, count)
      if (count === 0) pending.push(target)
    }
  }
  return visited !== nodes.length
}
