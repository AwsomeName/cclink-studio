import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import type { WebResourceSnapshot } from '../../shared/web-resources/web-resource-types'
import type {
  CreateWebAffairInput,
  UpdateWebAffairNodeInput,
  WebAffair,
  WebAffairNode,
  WebAffairNodeStatus,
  WebAffairOperationResult,
  WebAffairSnapshot,
  WebAffairStatus,
} from '../../shared/web-affairs/web-affair-types'
import {
  parseCreateWebAffairInput,
  parseUpdateWebAffairNodeInput,
} from '../../shared/web-affairs/web-affair-schema'
import { WebAffairStore } from './web-affair-store'

const AFFAIR_LIMIT = 1_000
const EVENT_LIMIT = 2_000
const TERMINAL_NODE_STATUSES = new Set<WebAffairNodeStatus>([
  'completed',
  'skipped',
  'cancelled',
])

const ALLOWED_TRANSITIONS: Record<WebAffairNodeStatus, ReadonlySet<WebAffairNodeStatus>> = {
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

function publicStorageError(error: unknown): WebAffairOperationResult<never> {
  console.error('[WebAffairService] 事务持久化失败:', error)
  return {
    success: false,
    error: { code: 'STORAGE_UNAVAILABLE', message: '事务数据保存失败' },
  }
}

export class WebAffairService {
  private snapshot: WebAffairSnapshot | null = null
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly getWebResources: () => WebResourceSnapshot | null,
    private readonly store = new WebAffairStore(),
  ) {}

  async load(): Promise<void> {
    this.snapshot = await this.store.load()
    this.assertIntegrity(this.snapshot)
  }

  getSnapshot(): WebAffairOperationResult<WebAffairSnapshot> {
    if (!this.snapshot) return this.unavailable()
    return { success: true, data: structuredClone(this.snapshot) }
  }

  createAffair(rawInput: CreateWebAffairInput): Promise<WebAffairOperationResult<WebAffair>> {
    return this.enqueue(() => this.createAffairNow(rawInput))
  }

  updateNode(rawInput: UpdateWebAffairNodeInput): Promise<WebAffairOperationResult<WebAffair>> {
    return this.enqueue(() => this.updateNodeNow(rawInput))
  }

  async flush(): Promise<void> {
    await this.mutationQueue
    await this.store.flush()
  }

  private async createAffairNow(
    rawInput: CreateWebAffairInput,
  ): Promise<WebAffairOperationResult<WebAffair>> {
    if (!this.snapshot) return this.unavailable()
    let input: CreateWebAffairInput
    try {
      input = parseCreateWebAffairInput(rawInput)
    } catch {
      return { success: false, error: { code: 'INVALID_INPUT', message: '事务参数无效' } }
    }
    if (this.snapshot.affairs.length >= AFFAIR_LIMIT) {
      return {
        success: false,
        error: { code: 'RESOURCE_LIMIT_REACHED', message: '事务数量已达到限制' },
      }
    }

    const resources = this.getWebResources()
    const principal = resources?.principals.find((item) => item.id === input.principalId)
    const accounts = input.accountIds.map((id) => resources?.accounts.find((item) => item.id === id))
    if (!resources || !principal || accounts.some((account) => !account)) {
      return {
        success: false,
        error: { code: 'INVALID_RESOURCE_REFERENCE', message: '所选主体或账号资源已失效' },
      }
    }
    if (accounts.some((account) => account?.principalId !== principal.id)) {
      return {
        success: false,
        error: { code: 'INVALID_RESOURCE_REFERENCE', message: '所选账号不属于当前业务主体' },
      }
    }

    const now = new Date().toISOString()
    const materials = input.materialPaths.map((path) => ({
      id: randomUUID(),
      path,
      name: basename(path),
      addedAt: now,
    }))
    const nodes: WebAffairNode[] = input.nodeTitles.map((title, index) => ({
      id: randomUUID(),
      type: 'web-task',
      title,
      status: index === 0 ? 'ready' : 'blocked',
      executor: 'user',
      accountIds: [...input.accountIds],
      materialIds: materials.map((material) => material.id),
      successCriteria: [`“${title}”已有明确结果说明`],
      availableTransitions: [...ALLOWED_TRANSITIONS[index === 0 ? 'ready' : 'blocked']],
      createdAt: now,
      updatedAt: now,
    }))
    const affair: WebAffair = {
      id: randomUUID(),
      title: input.title,
      objective: input.objective,
      status: 'active',
      principalId: principal.id,
      websiteIds: [
        ...new Set(accounts.flatMap((account) => (account ? [account.websiteId] : []))),
      ],
      accountIds: [...input.accountIds],
      materials,
      flow: {
        version: 1,
        nodes,
        edges: nodes.slice(1).map((node, index) => ({
          id: randomUUID(),
          fromNodeId: nodes[index].id,
          toNodeId: node.id,
        })),
      },
      events: [
        {
          id: randomUUID(),
          type: 'created',
          summary: `事务已创建，共 ${nodes.length} 个流程节点`,
          occurredAt: now,
        },
      ],
      workspaceRef: input.workspaceRef,
      createdAt: now,
      updatedAt: now,
    }
    const next = {
      ...this.snapshot,
      revision: this.snapshot.revision + 1,
      affairs: [...this.snapshot.affairs, affair],
    }
    await this.store.save(next)
    this.snapshot = next
    return { success: true, data: structuredClone(affair) }
  }

  private async updateNodeNow(
    rawInput: UpdateWebAffairNodeInput,
  ): Promise<WebAffairOperationResult<WebAffair>> {
    if (!this.snapshot) return this.unavailable()
    let input: UpdateWebAffairNodeInput
    try {
      input = parseUpdateWebAffairNodeInput(rawInput)
    } catch {
      return { success: false, error: { code: 'INVALID_INPUT', message: '节点更新参数无效' } }
    }
    const affair = this.snapshot.affairs.find((item) => item.id === input.affairId)
    const currentNode = affair?.flow.nodes.find((node) => node.id === input.nodeId)
    if (!affair || !currentNode) {
      return { success: false, error: { code: 'NOT_FOUND', message: '事务或流程节点不存在' } }
    }
    if (!ALLOWED_TRANSITIONS[currentNode.status].has(input.status)) {
      return {
        success: false,
        error: {
          code: 'INVALID_TRANSITION',
          message: `节点不能从“${currentNode.status}”变为“${input.status}”`,
        },
      }
    }
    if (affair.events.length >= EVENT_LIMIT) {
      return {
        success: false,
        error: { code: 'RESOURCE_LIMIT_REACHED', message: '事务事件数量已达到限制' },
      }
    }

    const now = new Date().toISOString()
    let nodes = affair.flow.nodes.map((node) =>
      node.id === currentNode.id
        ? {
            ...node,
            status: input.status,
            lastResultNote: input.resultNote ?? node.lastResultNote,
            updatedAt: now,
          }
        : node,
    )
    nodes = this.unlockDependents(nodes, affair.flow.edges, now).map((node) => ({
      ...node,
      availableTransitions: [...ALLOWED_TRANSITIONS[node.status]],
    }))
    const updated: WebAffair = {
      ...affair,
      status: this.deriveAffairStatus(nodes),
      flow: { ...affair.flow, nodes },
      events: [
        ...affair.events,
        {
          id: randomUUID(),
          type: 'node-status-changed',
          nodeId: currentNode.id,
          summary: input.resultNote
            ? `${currentNode.title} → ${input.status}：${input.resultNote}`
            : `${currentNode.title} → ${input.status}`,
          occurredAt: now,
        },
      ],
      updatedAt: now,
    }
    const next = {
      ...this.snapshot,
      revision: this.snapshot.revision + 1,
      affairs: this.snapshot.affairs.map((item) => (item.id === updated.id ? updated : item)),
    }
    await this.store.save(next)
    this.snapshot = next
    return { success: true, data: structuredClone(updated) }
  }

  private unlockDependents(
    nodes: WebAffairNode[],
    edges: WebAffair['flow']['edges'],
    now: string,
  ): WebAffairNode[] {
    const byId = new Map(nodes.map((node) => [node.id, node]))
    return nodes.map((node) => {
      if (node.status !== 'blocked') return node
      const dependencies = edges.filter((edge) => edge.toNodeId === node.id)
      if (
        dependencies.length > 0 &&
        dependencies.every((edge) => {
          const dependency = byId.get(edge.fromNodeId)
          return dependency?.status === 'completed' || dependency?.status === 'skipped'
        })
      ) {
        return { ...node, status: 'ready', updatedAt: now }
      }
      return node
    })
  }

  private deriveAffairStatus(nodes: WebAffairNode[]): WebAffairStatus {
    if (nodes.every((node) => node.status === 'cancelled')) return 'cancelled'
    if (nodes.every((node) => TERMINAL_NODE_STATUSES.has(node.status))) return 'completed'
    if (nodes.some((node) => node.status === 'waiting-human')) return 'needs-attention'
    if (nodes.some((node) => node.status === 'waiting-external')) return 'waiting-external'
    if (nodes.some((node) => node.status === 'failed')) return 'failed'
    return 'active'
  }

  private enqueue(
    operation: () => Promise<WebAffairOperationResult<WebAffair>>,
  ): Promise<WebAffairOperationResult<WebAffair>> {
    let resolveResult: (result: WebAffairOperationResult<WebAffair>) => void = () => undefined
    const result = new Promise<WebAffairOperationResult<WebAffair>>((resolve) => {
      resolveResult = resolve
    })
    const mutate = async (): Promise<void> => {
      try {
        resolveResult(await operation())
      } catch (error) {
        resolveResult(publicStorageError(error))
      }
    }
    this.mutationQueue = this.mutationQueue.then(mutate, mutate)
    return result
  }

  private unavailable<T>(): WebAffairOperationResult<T> {
    return {
      success: false,
      error: { code: 'SERVICE_UNAVAILABLE', message: '事务服务尚未就绪' },
    }
  }

  private assertIntegrity(snapshot: WebAffairSnapshot): void {
    for (const affair of snapshot.affairs) {
      const nodeIds = new Set(affair.flow.nodes.map((node) => node.id))
      const materialIds = new Set(affair.materials.map((material) => material.id))
      for (const edge of affair.flow.edges) {
        if (!nodeIds.has(edge.fromNodeId) || !nodeIds.has(edge.toNodeId)) {
          throw new Error('事务流程存在失效节点引用')
        }
      }
      for (const node of affair.flow.nodes) {
        if (node.materialIds.some((id) => !materialIds.has(id))) {
          throw new Error('事务流程存在失效材料引用')
        }
      }
    }
  }
}
