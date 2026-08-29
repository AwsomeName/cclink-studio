import { createHash, randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
import type {
  WebResourceLaunchDescriptor,
  WebResourceOperationResult,
  WebResourceSnapshot,
} from '../../shared/web-resources/web-resource-types'
import { WEB_AFFAIR_CATALOG } from '../../shared/web-affairs/web-affair-catalog'
import type {
  BindWebAffairAttemptInput,
  ClaimLegacyWebAffairInput,
  CompleteWebAffairCheckInput,
  ConfirmWebAffairFinalActionInput,
  CreateWebAffairInput,
  DecideWebAffairFlowProposalInput,
  FinishWebAffairAttemptInput,
  HandoffWebAffairAttemptInput,
  InspectWebAffairMaterialsInput,
  ProposeWebAffairFlowDiffInput,
  ReturnWebAffairAttemptInput,
  ReviseWebAffairFlowInput,
  ScheduleWebAffairCheckInput,
  StartWebAffairAttemptInput,
  UpdateWebAffairNodeInput,
  WebAffair,
  WebAffairAttempt,
  WebAffairCatalog,
  WebAffairEdge,
  WebAffairEvent,
  WebAffairFlowDiffOperation,
  WebAffairMaterialRef,
  WebAffairNode,
  WebAffairNodeStatus,
  WebAffairOperationResult,
  WebAffairProjectSnapshot,
  WebAffairSnapshot,
  WebAffairStatus,
} from '../../shared/web-affairs/web-affair-types'
import {
  bindWebAffairAttemptInputSchema,
  claimLegacyWebAffairInputSchema,
  completeWebAffairCheckInputSchema,
  confirmWebAffairFinalActionInputSchema,
  createWebAffairInputSchema,
  decideWebAffairFlowProposalInputSchema,
  finishWebAffairAttemptInputSchema,
  handoffWebAffairAttemptInputSchema,
  inspectWebAffairMaterialsInputSchema,
  proposeWebAffairFlowDiffInputSchema,
  returnWebAffairAttemptInputSchema,
  reviseWebAffairFlowInputSchema,
  scheduleWebAffairCheckInputSchema,
  startWebAffairAttemptInputSchema,
  updateWebAffairNodeInputSchema,
} from '../../shared/web-affairs/web-affair-schema'
import { WebAffairStore } from './web-affair-store'
import type {
  ArticlePublishingFields,
  ArticlePublishingSourcePreview,
  ArticlePublishingState,
  ReportArticlePublishingAssetInput,
  ReportArticlePublishingCheckpointInput,
} from '../../shared/article-publishing/article-publishing-types'
import { articlePublishingStateSchema } from '../../shared/article-publishing/article-publishing-schema'
import { CSDN_ARTICLE_PUBLISHING_PLAN } from '../../shared/article-publishing/article-publishing-plan'

const AFFAIR_LIMIT = 1_000
const EVENT_LIMIT = 2_000
const TERMINAL_NODE_STATUSES = new Set<WebAffairNodeStatus>(['completed', 'skipped', 'cancelled'])
const TERMINAL_ATTEMPT_STATUSES = new Set<WebAffairAttempt['status']>([
  'succeeded',
  'failed',
  'cancelled',
  'interrupted',
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
  return { success: false, error: { code: 'STORAGE_UNAVAILABLE', message: '事务数据保存失败' } }
}

export class WebAffairService {
  private snapshot: WebAffairSnapshot | null = null
  private mutationQueue: Promise<void> = Promise.resolve()
  private dueTimer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly getWebResources: () => WebResourceSnapshot | null,
    private readonly store = new WebAffairStore(),
    private readonly now: () => Date = () => new Date(),
    private readonly onChanged: (affairId: string, revision: number) => void = () => undefined,
    private readonly resolveWebResourceLaunch: (
      workspaceId: string,
      accountId: string,
    ) => WebResourceOperationResult<WebResourceLaunchDescriptor> = () => ({
      success: false,
      error: {
        code: 'AI_ACCOUNT_ACCESS_UNDECIDED',
        message: '全局账号的 AI 调用权限尚未确认；请先人工打开网页办理',
      },
    }),
  ) {}

  async load(): Promise<void> {
    this.snapshot = await this.store.load()
    this.assertIntegrity(this.snapshot)
    await this.reconcileInterruptedAttempts()
    await this.reconcileOverdueChecks(true)
    this.dueTimer = setInterval(() => void this.reconcileOverdueChecks(false), 30_000)
    this.dueTimer.unref?.()
  }

  getSnapshot(): WebAffairOperationResult<WebAffairSnapshot> {
    if (!this.snapshot) return this.unavailable()
    return { success: true, data: structuredClone(this.snapshot) }
  }

  getProjectSnapshot(workspaceId: string): WebAffairOperationResult<WebAffairProjectSnapshot> {
    const result = this.getSnapshot()
    if (!result.success) return result
    return {
      success: true,
      data: {
        schemaVersion: 4,
        revision: result.data.revision,
        workspaceId,
        affairs: result.data.affairs.filter((affair) => affair.workspaceId === workspaceId),
        unassignedAffairCount: result.data.affairs.filter((affair) => affair.workspaceId === null)
          .length,
        unassignedAffairs: result.data.affairs
          .filter((affair) => affair.workspaceId === null)
          .map((affair) => ({
            id: affair.id,
            title: affair.title,
            objective: affair.objective,
            accountCount: affair.accountIds.length,
            sourceWorkspaceRef: affair.workspaceRef,
            createdAt: affair.createdAt,
            updatedAt: affair.updatedAt,
          })),
      },
    }
  }

  getCatalog(): WebAffairOperationResult<WebAffairCatalog> {
    return { success: true, data: structuredClone(WEB_AFFAIR_CATALOG) }
  }

  createAffair(input: CreateWebAffairInput, workspaceId: string) {
    return this.enqueue(() => this.createAffairNow(input, workspaceId))
  }

  createArticlePublishingAffair(
    input: {
      preview: ArticlePublishingSourcePreview
      accountId: string
      fields: ArticlePublishingFields
      workspaceRef: CreateWebAffairInput['workspaceRef']
    },
    workspaceId: string,
  ) {
    return this.enqueue(() => this.createArticlePublishingAffairNow(input, workspaceId))
  }

  resumeArticlePublishingAttempt(affairId: string, attemptId: string, workspaceId: string) {
    return this.enqueueScoped(affairId, workspaceId, () =>
      this.resumeArticlePublishingAttemptNow(affairId, attemptId),
    )
  }

  resumeArticlePublishingAfterHandoff(affairId: string, attemptId: string, workspaceId: string) {
    return this.enqueueScoped(affairId, workspaceId, () =>
      this.resumeArticlePublishingAfterHandoffNow(affairId, attemptId),
    )
  }

  markArticlePublishingAttemptStarted(affairId: string, attemptId: string, workspaceId: string) {
    return this.enqueueScoped(affairId, workspaceId, () =>
      this.markArticlePublishingAttemptStartedNow(affairId, attemptId),
    )
  }

  interruptArticlePublishingLaunch(
    affairId: string,
    attemptId: string,
    reason: string,
    workspaceId: string,
  ) {
    return this.enqueueScoped(affairId, workspaceId, () =>
      this.interruptArticlePublishingLaunchNow(affairId, attemptId, reason),
    )
  }

  interruptArticlePublishingRuntime(
    affairId: string,
    attemptId: string,
    reason: string,
    workspaceId: string,
  ) {
    return this.enqueueScoped(affairId, workspaceId, () =>
      this.interruptArticlePublishingLaunchNow(affairId, attemptId, reason, true),
    )
  }

  reportArticlePublishingCheckpoint(
    input: ReportArticlePublishingCheckpointInput,
    workspaceId: string,
  ) {
    return this.enqueueScoped(input.affairId, workspaceId, () =>
      this.reportArticlePublishingCheckpointNow(input),
    )
  }

  reportArticlePublishingAsset(input: ReportArticlePublishingAssetInput, workspaceId: string) {
    return this.enqueueScoped(input.affairId, workspaceId, () =>
      this.reportArticlePublishingAssetNow(input),
    )
  }

  markArticlePublishingPublicationDispatched(
    affairId: string,
    attemptId: string,
    workspaceId: string,
  ) {
    return this.enqueueScoped(affairId, workspaceId, () =>
      this.markArticlePublishingPublicationDispatchedNow(affairId, attemptId),
    )
  }

  claimLegacyAffair(input: ClaimLegacyWebAffairInput, workspaceId: string) {
    return this.enqueue(() => this.claimLegacyAffairNow(input, workspaceId))
  }

  updateNode(input: UpdateWebAffairNodeInput, workspaceId: string) {
    return this.enqueueScoped(input.affairId, workspaceId, () => this.updateNodeNow(input))
  }

  reviseFlow(input: ReviseWebAffairFlowInput, workspaceId: string) {
    return this.enqueueScoped(input.affairId, workspaceId, () => this.reviseFlowNow(input))
  }

  inspectMaterials(input: InspectWebAffairMaterialsInput, workspaceId: string) {
    return this.enqueueScoped(input.affairId, workspaceId, () => this.inspectMaterialsNow(input))
  }

  startAttempt(input: StartWebAffairAttemptInput, workspaceId: string) {
    return this.enqueueScoped(input.affairId, workspaceId, () =>
      this.startAttemptNow(input, workspaceId),
    )
  }

  bindAttempt(input: BindWebAffairAttemptInput, workspaceId: string) {
    return this.enqueueScoped(input.affairId, workspaceId, () => this.bindAttemptNow(input))
  }

  handoffAttempt(input: HandoffWebAffairAttemptInput, workspaceId: string) {
    return this.enqueueScoped(input.affairId, workspaceId, () => this.handoffAttemptNow(input))
  }

  returnAttempt(input: ReturnWebAffairAttemptInput, workspaceId: string) {
    return this.enqueueScoped(input.affairId, workspaceId, () => this.returnAttemptNow(input))
  }

  confirmFinalAction(input: ConfirmWebAffairFinalActionInput, workspaceId: string) {
    return this.enqueueScoped(input.affairId, workspaceId, () => this.confirmFinalActionNow(input))
  }

  finishAttempt(input: FinishWebAffairAttemptInput, workspaceId: string) {
    return this.enqueueScoped(input.affairId, workspaceId, () => this.finishAttemptNow(input))
  }

  scheduleCheck(input: ScheduleWebAffairCheckInput, workspaceId: string) {
    return this.enqueueScoped(input.affairId, workspaceId, () => this.scheduleCheckNow(input))
  }

  completeCheck(input: CompleteWebAffairCheckInput, workspaceId: string) {
    return this.enqueueScoped(input.affairId, workspaceId, () => this.completeCheckNow(input))
  }

  proposeFlowDiff(input: ProposeWebAffairFlowDiffInput, workspaceId: string) {
    return this.enqueueScoped(input.affairId, workspaceId, () => this.proposeFlowDiffNow(input))
  }

  decideFlowProposal(input: DecideWebAffairFlowProposalInput, workspaceId: string) {
    return this.enqueueScoped(input.affairId, workspaceId, () => this.decideFlowProposalNow(input))
  }

  async flush(): Promise<void> {
    if (this.dueTimer) clearInterval(this.dueTimer)
    this.dueTimer = null
    await this.mutationQueue
    await this.store.flush()
  }

  private async createAffairNow(
    rawInput: CreateWebAffairInput,
    workspaceId: string,
  ): Promise<WebAffairOperationResult<WebAffair>> {
    if (!this.snapshot) return this.unavailable()
    const parsed = createWebAffairInputSchema.safeParse(rawInput)
    if (!parsed.success) return this.invalid('事务参数无效')
    const input = parsed.data
    if (this.snapshot.affairs.length >= AFFAIR_LIMIT) return this.limit('事务数量已达到限制')

    const resources = this.getWebResources()
    const principal = resources?.principals.find((item) => item.id === input.principalId)
    const groups = (input.accountGroupIds ?? []).map((id) =>
      resources?.accountGroups.find((item) => item.id === id && !item.archivedAt),
    )
    if (groups.some((group) => !group)) {
      return this.resourceError('所选运营矩阵不存在或已归档')
    }
    const effectiveAccountIds = [
      ...new Set([...input.accountIds, ...groups.flatMap((group) => group?.accountIds ?? [])]),
    ]
    const accounts = effectiveAccountIds.map((id) =>
      resources?.accounts.find((item) => item.id === id),
    )
    if (!resources || !principal || accounts.some((account) => !account)) {
      return this.resourceError('所选主体或账号资源已失效')
    }
    if (accounts.some((account) => account?.principalId !== principal.id)) {
      return this.resourceError('所选账号不属于当前业务主体')
    }
    if (accounts.some((account) => account?.archivedAt)) {
      return this.resourceError('所选账号已归档')
    }

    const now = this.timestamp()
    const materials = await Promise.all(
      input.materialPaths.map((path) => this.createMaterial(path, now)),
    )
    const template = input.templateRef
      ? WEB_AFFAIR_CATALOG.templates.find(
          (item) =>
            item.id === input.templateRef?.templateId && item.version === input.templateRef.version,
        )
      : undefined
    if (input.templateRef && !template) return this.invalid('所选业务模板版本不存在')
    const nodes: WebAffairNode[] = input.nodeTitles.map((title, index) => {
      const catalogId = template?.nodeCatalogIds[index]
      const definition = WEB_AFFAIR_CATALOG.atomicNodes.find((item) => item.id === catalogId)
      return this.createNode({
        title,
        description: definition?.description,
        type: definition?.nodeType,
        catalogId: definition?.id,
        status: index === 0 ? 'ready' : 'blocked',
        executor: definition?.executor ?? 'user',
        accountIds: effectiveAccountIds,
        materialIds: materials.map((material) => material.id),
        successCriteria: definition?.successCriteria,
        now,
      })
    })
    const affair: WebAffair = {
      id: randomUUID(),
      kind: 'generic',
      workspaceId,
      title: input.title,
      objective: input.objective,
      status: 'active',
      principalId: principal.id,
      websiteIds: [...new Set(accounts.flatMap((account) => (account ? [account.websiteId] : [])))],
      accountIds: effectiveAccountIds,
      accountGroupBindings: groups.flatMap((group) =>
        group
          ? [
              {
                groupId: group.id,
                groupRevision: group.revision,
                accountIds: [...group.accountIds],
              },
            ]
          : [],
      ),
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
      attempts: [],
      waitPlans: [],
      flowProposals: [],
      templateRef: input.templateRef,
      events: [this.event('created', `事务已创建，共 ${nodes.length} 个流程节点`, now)],
      workspaceRef: input.workspaceRef,
      createdAt: now,
      updatedAt: now,
    }
    return this.persistNewAffair(affair)
  }

  private async createArticlePublishingAffairNow(
    input: {
      preview: ArticlePublishingSourcePreview
      accountId: string
      fields: ArticlePublishingFields
      workspaceRef: CreateWebAffairInput['workspaceRef']
    },
    workspaceId: string,
  ): Promise<WebAffairOperationResult<WebAffair>> {
    if (!this.snapshot) return this.unavailable()
    if (this.snapshot.affairs.length >= AFFAIR_LIMIT) return this.limit('事务数量已达到限制')
    if (input.preview.blockers.length > 0) return this.invalid(input.preview.blockers.join('；'))
    const resources = this.getWebResources()
    const account = resources?.accounts.find(
      (item) => item.id === input.accountId && !item.archivedAt && !item.mergedIntoAccountId,
    )
    const website = resources?.websites.find((item) => item.id === account?.websiteId)
    if (!account || !website) return this.resourceError('所选 CSDN 账号不存在或已归档')
    let hostname = ''
    try {
      hostname = new URL(website.origin).hostname.toLowerCase()
    } catch {
      return this.resourceError('所选网站 Origin 无效')
    }
    if (hostname !== 'csdn.net' && !hostname.endsWith('.csdn.net')) {
      return this.resourceError('首版只能选择 CSDN 账号')
    }
    if (
      input.fields.coverAssetId &&
      !input.preview.assets.some(
        (asset) => asset.id === input.fields.coverAssetId && asset.kind === 'local',
      )
    ) {
      return this.invalid('所选封面已经失效，请重新选择')
    }

    const now = this.timestamp()
    const localAssets = input.preview.assets.filter((asset) => asset.kind === 'local')
    const materialPaths = [
      input.preview.source.markdownPath,
      ...localAssets.map((asset) => asset.sourcePath),
    ]
    const materials = await Promise.all(
      [...new Set(materialPaths)].map((path) => this.createMaterial(path, now)),
    )
    if (materials.some((material) => material.state !== 'available')) {
      return this.resourceError('Markdown 或正文图片已经不可用，请重新选择文章')
    }
    const scopeHash = createHash('sha256')
      .update(
        JSON.stringify({
          sourceHash: input.preview.source.contentHash,
          accountId: input.accountId,
          fields: input.fields,
          adapterId: 'csdn',
          adapterVersion: 1,
        }),
      )
      .digest('hex')
    const checkpoints: ArticlePublishingState['checkpoints'] = CSDN_ARTICLE_PUBLISHING_PLAN.map(
      ({ stepId, label, resumePolicy }) => ({
        stepId,
        label,
        inputHash: scopeHash,
        adapterVersion: 1,
        status: 'pending',
        resumePolicy,
        attemptCount: 0,
        evidence: [],
      }),
    )
    const articlePublishing = articlePublishingStateSchema.parse({
      adapterId: 'csdn',
      adapterVersion: 1,
      source: input.preview.source,
      accountId: input.accountId,
      websiteId: website.id,
      fields: input.fields,
      assets: input.preview.assets,
      checkpoints,
      execution: { status: 'draft' },
      publication: { status: 'not-started' },
    })
    const node = this.createNode({
      title: '发布文章到 CSDN',
      description: '按冻结文章、账号和平台字段执行；特殊卡点转人工。',
      type: 'web-task',
      status: 'ready',
      executor: 'ai',
      accountIds: [account.id],
      materialIds: materials.map((material) => material.id),
      successCriteria: ['全部正文图片已经后置核验', '发布结果 URL 可复核'],
      now,
    })
    const affair: WebAffair = {
      id: randomUUID(),
      kind: 'article-publishing',
      workspaceId,
      title: input.fields.title,
      objective: `将 ${input.preview.source.markdownPath} 发布到 CSDN`,
      status: 'active',
      principalId: account.principalId,
      websiteIds: [website.id],
      accountIds: [account.id],
      materials,
      flow: { version: 1, nodes: [node], edges: [] },
      attempts: [],
      waitPlans: [],
      flowProposals: [],
      articlePublishing,
      events: [this.event('created', 'CSDN 文章发布事务已创建', now)],
      workspaceRef: input.workspaceRef,
      createdAt: now,
      updatedAt: now,
    }
    return this.persistNewAffair(affair)
  }

  private async claimLegacyAffairNow(
    rawInput: ClaimLegacyWebAffairInput,
    workspaceId: string,
  ): Promise<WebAffairOperationResult<WebAffair>> {
    if (!this.snapshot) return this.unavailable()
    const parsed = claimLegacyWebAffairInputSchema.safeParse(rawInput)
    if (!parsed.success) return this.invalid('旧事务归属参数无效')
    const affair = this.findAffair(parsed.data.affairId)
    if (!affair || affair.workspaceId !== null) {
      return this.notFound('待归属旧事务不存在或已经完成归属')
    }

    const resources = this.getWebResources()
    const principal = resources?.principals.find((item) => item.id === affair.principalId)
    const accounts = affair.accountIds.map((id) =>
      resources?.accounts.find((item) => item.id === id),
    )
    if (!resources || !principal || accounts.some((account) => !account)) {
      return this.resourceError('旧事务的主体或账号已失效，请先在“网站与账号”处理')
    }
    if (accounts.some((account) => account?.archivedAt)) {
      return this.resourceError('旧事务引用的网站账号已归档')
    }
    if (accounts.some((account) => account?.principalId !== affair.principalId)) {
      return this.resourceError('旧事务的账号与业务主体不一致，不能直接归属')
    }

    const now = this.timestamp()
    return this.persistAffair({
      ...affair,
      workspaceId,
      workspaceRef: parsed.data.workspaceRef,
      events: this.appendEvent(
        affair,
        this.event('workspace-assigned', '用户已确认将旧事务归入当前项目', now),
      ),
      updatedAt: now,
    })
  }

  private async updateNodeNow(
    rawInput: UpdateWebAffairNodeInput,
  ): Promise<WebAffairOperationResult<WebAffair>> {
    if (!this.snapshot) return this.unavailable()
    const parsed = updateWebAffairNodeInputSchema.safeParse(rawInput)
    if (!parsed.success) return this.invalid('节点更新参数无效')
    const input = parsed.data
    const affair = this.findAffair(input.affairId)
    const currentNode = affair?.flow.nodes.find((node) => node.id === input.nodeId)
    if (!affair || !currentNode) return this.notFound('事务或流程节点不存在')
    if (!ALLOWED_TRANSITIONS[currentNode.status].has(input.status)) {
      return this.transitionError(`节点不能从“${currentNode.status}”变为“${input.status}”`)
    }
    const now = this.timestamp()
    const nodes = this.normalizeNodeStates(
      affair.flow.nodes.map((node) =>
        node.id === currentNode.id
          ? {
              ...node,
              status: input.status,
              lastResultNote: input.resultNote ?? node.lastResultNote,
              updatedAt: now,
            }
          : node,
      ),
      affair.flow.edges,
      now,
    )
    return this.persistAffair({
      ...affair,
      status: this.deriveAffairStatus(nodes),
      flow: { ...affair.flow, nodes },
      events: this.appendEvent(
        affair,
        this.event(
          'node-status-changed',
          input.resultNote
            ? `${currentNode.title} → ${input.status}：${input.resultNote}`
            : `${currentNode.title} → ${input.status}`,
          now,
          { nodeId: currentNode.id },
        ),
      ),
      updatedAt: now,
    })
  }

  private async reviseFlowNow(
    rawInput: ReviseWebAffairFlowInput,
  ): Promise<WebAffairOperationResult<WebAffair>> {
    if (!this.snapshot) return this.unavailable()
    const parsed = reviseWebAffairFlowInputSchema.safeParse(rawInput)
    if (!parsed.success) return this.invalid('流程修订参数无效')
    const input = parsed.data
    const affair = this.findAffair(input.affairId)
    if (!affair) return this.notFound('事务不存在')
    if (affair.flow.version !== input.expectedVersion) {
      return {
        success: false,
        error: { code: 'FLOW_VERSION_CONFLICT', message: '流程已被更新，请刷新后重试' },
      }
    }
    const nextFlow = this.buildRevisedFlow(affair, input)
    if (!nextFlow.success) return nextFlow
    const now = this.timestamp()
    const nodes = this.normalizeNodeStates(nextFlow.data.nodes, nextFlow.data.edges, now)
    return this.persistAffair({
      ...affair,
      flow: { version: affair.flow.version + 1, nodes, edges: nextFlow.data.edges },
      status: this.deriveAffairStatus(nodes),
      events: this.appendEvent(
        affair,
        this.event('flow-revised', `流程已修订为版本 ${affair.flow.version + 1}`, now),
      ),
      updatedAt: now,
    })
  }

  private async inspectMaterialsNow(
    rawInput: InspectWebAffairMaterialsInput,
  ): Promise<WebAffairOperationResult<WebAffair>> {
    const parsed = inspectWebAffairMaterialsInputSchema.safeParse(rawInput)
    if (!parsed.success) return this.invalid('材料检查参数无效')
    const affair = this.findAffair(parsed.data.affairId)
    if (!affair) return this.notFound('事务不存在')
    const now = this.timestamp()
    const materials = await Promise.all(
      affair.materials.map((material) => this.inspectMaterial(material, now)),
    )
    const unavailableCount = materials.filter((item) => item.state !== 'available').length
    return this.persistAffair({
      ...affair,
      materials,
      status: unavailableCount > 0 ? 'needs-attention' : this.deriveAffairStatus(affair.flow.nodes),
      events: this.appendEvent(
        affair,
        this.event(
          'material-checked',
          unavailableCount > 0
            ? `材料检查完成，${unavailableCount} 项需要处理`
            : '材料检查完成，全部可用',
          now,
        ),
      ),
      updatedAt: now,
    })
  }

  private async startAttemptNow(
    rawInput: StartWebAffairAttemptInput,
    workspaceId: string,
  ): Promise<WebAffairOperationResult<WebAffair>> {
    const parsed = startWebAffairAttemptInputSchema.safeParse(rawInput)
    if (!parsed.success) return this.invalid('启动参数无效')
    const input = parsed.data
    const affair = this.findAffair(input.affairId)
    const node = affair?.flow.nodes.find((item) => item.id === input.nodeId)
    if (!affair || !node) return this.notFound('事务或节点不存在')
    const waitPlan = affair.waitPlans.find((item) => item.nodeId === node.id)
    const isDueCheck =
      node.status === 'waiting-external' &&
      Boolean(waitPlan && (waitPlan.status === 'due' || waitPlan.status === 'missed'))
    if (node.status !== 'ready' && node.status !== 'failed' && !isDueCheck)
      return this.transitionError('当前节点尚不能交给 AI')
    const launch = this.resolveWebResourceLaunch(workspaceId, input.accountId)
    if (!launch.success) return this.resourceError(launch.error.message)
    const resources = this.getWebResources()
    const account = resources?.accounts.find((item) => item.id === input.accountId)
    const website = resources?.websites.find((item) => item.id === account?.websiteId)
    if (
      !account ||
      !website ||
      Boolean(account.archivedAt) ||
      account.principalId !== affair.principalId ||
      !node.accountIds.includes(account.id)
    ) {
      return this.resourceError('节点绑定的主体、网站或账号已经失效')
    }
    const checkedMaterials = await Promise.all(
      affair.materials.map((item) => this.inspectMaterial(item, this.timestamp())),
    )
    const requiredMaterials = checkedMaterials.filter((item) => node.materialIds.includes(item.id))
    if (requiredMaterials.some((item) => item.state !== 'available')) {
      return this.resourceError('节点所需材料缺失或已变化，请重新确认后再执行')
    }
    const now = this.timestamp()
    const number = affair.attempts.filter((item) => item.nodeId === node.id).length + 1
    const attempt: WebAffairAttempt = {
      id: randomUUID(),
      nodeId: node.id,
      number,
      status: 'preparing',
      profileId: launch.data.browserProfileId,
      accountId: account.id,
      entryUrl: launch.data.entryUrl,
      sideEffectKey: `${affair.id}:${node.id}:flow-${affair.flow.version}`,
      evidence: [],
      startedAt: now,
    }
    const nodes = affair.flow.nodes.map((item) =>
      item.id === node.id
        ? {
            ...item,
            status: 'running' as const,
            executor: 'ai' as const,
            updatedAt: now,
            availableTransitions: [...ALLOWED_TRANSITIONS.running],
          }
        : item,
    )
    return this.persistAffair({
      ...affair,
      materials: checkedMaterials,
      status: 'active',
      flow: { ...affair.flow, nodes },
      attempts: [...affair.attempts, attempt],
      events: this.appendEvent(
        affair,
        this.event('attempt-started', `${node.title}：已创建第 ${number} 次办理`, now, {
          nodeId: node.id,
          attemptId: attempt.id,
        }),
      ),
      updatedAt: now,
    })
  }

  private async bindAttemptNow(
    rawInput: BindWebAffairAttemptInput,
  ): Promise<WebAffairOperationResult<WebAffair>> {
    const parsed = bindWebAffairAttemptInputSchema.safeParse(rawInput)
    if (!parsed.success) return this.invalid('运行关联参数无效')
    const input = parsed.data
    const found = this.findAttempt(input.affairId, input.attemptId)
    if (!found) return this.notFound('办理 Attempt 不存在')
    if (found.attempt.status !== 'preparing') return this.transitionError('Attempt 已经绑定或结束')
    const now = this.timestamp()
    return this.persistAffair({
      ...found.affair,
      attempts: found.affair.attempts.map((item) =>
        item.id === found.attempt.id
          ? {
              ...item,
              status: 'running-ai',
              tabId: input.tabId,
              conversationId: input.conversationId,
              agentRunId: input.agentRunId,
              browserTaskRunId: input.browserTaskRunId,
            }
          : item,
      ),
      ...(found.affair.articlePublishing
        ? {
            articlePublishing: {
              ...found.affair.articlePublishing,
              execution: {
                ...found.affair.articlePublishing.execution,
                status: 'running' as const,
                currentAttemptId: found.attempt.id,
                lastAgentRunId: input.agentRunId,
                lastBrowserTaskRunId: input.browserTaskRunId,
              },
            },
          }
        : {}),
      updatedAt: now,
    })
  }

  private async handoffAttemptNow(
    rawInput: HandoffWebAffairAttemptInput,
  ): Promise<WebAffairOperationResult<WebAffair>> {
    const parsed = handoffWebAffairAttemptInputSchema.safeParse(rawInput)
    if (!parsed.success) return this.invalid('接管参数无效')
    const found = this.findAttempt(parsed.data.affairId, parsed.data.attemptId)
    if (!found) return this.notFound('办理 Attempt 不存在')
    if (!['preparing', 'running-ai', 'verifying'].includes(found.attempt.status))
      return this.transitionError('当前 Attempt 不能接管')
    const now = this.timestamp()
    const publishing = found.affair.articlePublishing
    const articlePublishing = publishing
      ? {
          ...publishing,
          checkpoints: publishing.checkpoints.map((checkpoint) =>
            checkpoint.stepId === publishing.execution.currentStepId
              ? { ...checkpoint, status: 'waiting-human' as const }
              : checkpoint,
          ),
          execution: { ...publishing.execution, status: 'waiting-human' as const },
        }
      : undefined
    return this.persistAttemptChange(found.affair, found.attempt, {
      attempt: {
        ...found.attempt,
        status: 'waiting-human',
        handoffReason: parsed.data.reason,
        handedOffAt: now,
      },
      nodeStatus: 'waiting-human',
      event: this.event('attempt-handoff', `已交给用户接管：${parsed.data.reason}`, now, {
        nodeId: found.attempt.nodeId,
        attemptId: found.attempt.id,
      }),
      now,
      articlePublishing,
    })
  }

  private async returnAttemptNow(
    rawInput: ReturnWebAffairAttemptInput,
  ): Promise<WebAffairOperationResult<WebAffair>> {
    const parsed = returnWebAffairAttemptInputSchema.safeParse(rawInput)
    if (!parsed.success) return this.invalid('交还参数无效')
    const input = parsed.data
    const found = this.findAttempt(input.affairId, input.attemptId)
    if (!found) return this.notFound('办理 Attempt 不存在')
    if (found.attempt.status !== 'waiting-human')
      return this.transitionError('只有人工接管中的 Attempt 可以交还')
    const now = this.timestamp()
    const evidence = {
      id: randomUUID(),
      kind: 'observation' as const,
      source: 'browser' as const,
      summary: input.observationSummary,
      observedAt: now,
      url: input.url,
      attemptId: found.attempt.id,
      browserTaskRunId: found.attempt.browserTaskRunId,
      agentRunId: found.attempt.agentRunId,
    }
    return this.persistAttemptChange(found.affair, found.attempt, {
      attempt: {
        ...found.attempt,
        status: 'running-ai',
        returnedAt: now,
        reobservedAt: now,
        evidence: [...found.attempt.evidence, evidence],
      },
      nodeStatus: 'running',
      event: this.event(
        'attempt-returned',
        `已交还 AI 并重新观察：${input.observationSummary}`,
        now,
        { nodeId: found.attempt.nodeId, attemptId: found.attempt.id },
      ),
      now,
    })
  }

  private async confirmFinalActionNow(
    rawInput: ConfirmWebAffairFinalActionInput,
  ): Promise<WebAffairOperationResult<WebAffair>> {
    const parsed = confirmWebAffairFinalActionInputSchema.safeParse(rawInput)
    if (!parsed.success) return this.invalid('最终确认参数无效')
    const input = parsed.data
    const found = this.findAttempt(input.affairId, input.attemptId)
    if (!found) return this.notFound('办理 Attempt 不存在')
    if (!['running-ai', 'verifying', 'waiting-human'].includes(found.attempt.status))
      return this.transitionError('当前 Attempt 不能确认提交')
    if (found.attempt.handedOffAt && !found.attempt.reobservedAt) {
      return {
        success: false,
        error: { code: 'EVIDENCE_REQUIRED', message: '人工操作后必须先重新观察页面再确认提交' },
      }
    }
    if (
      found.affair.attempts.some(
        (item) =>
          item.id !== found.attempt.id &&
          item.sideEffectKey === found.attempt.sideEffectKey &&
          item.finalActionConfirmedAt,
      )
    ) {
      return {
        success: false,
        error: {
          code: 'CONFIRMATION_REQUIRED',
          message: '同一节点和流程版本已经确认过最终动作，请先核验是否已提交',
        },
      }
    }
    const now = this.timestamp()
    const attempt = {
      ...found.attempt,
      status: 'verifying' as const,
      finalActionConfirmedAt: now,
      finalActionSummary: input.summary,
    }
    return this.persistAttemptChange(found.affair, found.attempt, {
      attempt,
      nodeStatus: 'verifying',
      event: this.event('final-action-confirmed', `用户已确认最终动作：${input.summary}`, now, {
        nodeId: found.attempt.nodeId,
        attemptId: found.attempt.id,
      }),
      now,
    })
  }

  private async finishAttemptNow(
    rawInput: FinishWebAffairAttemptInput,
  ): Promise<WebAffairOperationResult<WebAffair>> {
    const parsed = finishWebAffairAttemptInputSchema.safeParse(rawInput)
    if (!parsed.success) return this.invalid('Attempt 结果参数无效')
    const input = parsed.data
    const found = this.findAttempt(input.affairId, input.attemptId)
    if (!found) return this.notFound('办理 Attempt 不存在')
    if (TERMINAL_ATTEMPT_STATUSES.has(found.attempt.status))
      return this.transitionError('Attempt 已经结束')
    const node = found.affair.flow.nodes.find((item) => item.id === found.attempt.nodeId)!
    if (
      input.outcome === 'succeeded' &&
      node.catalogId === 'final-confirmation' &&
      !found.attempt.finalActionConfirmedAt
    ) {
      return {
        success: false,
        error: { code: 'CONFIRMATION_REQUIRED', message: '最终提交必须先由用户确认' },
      }
    }
    if (input.outcome === 'succeeded' && found.affair.articlePublishing) {
      if (!input.url) {
        return {
          success: false,
          error: { code: 'EVIDENCE_REQUIRED', message: '文章发布成功必须取得可复核 URL' },
        }
      }
      if (
        found.affair.articlePublishing.assets.some(
          (asset) => asset.kind === 'local' && asset.status !== 'uploaded',
        )
      ) {
        return {
          success: false,
          error: { code: 'EVIDENCE_REQUIRED', message: '仍有正文图片没有完成后置核验' },
        }
      }
    }
    const now = this.timestamp()
    const evidence = {
      id: randomUUID(),
      kind:
        input.evidenceKind ??
        (input.outcome === 'succeeded' ? ('page-result' as const) : ('user-note' as const)),
      source: input.url ? ('browser' as const) : ('user' as const),
      summary: input.summary,
      observedAt: now,
      url: input.url,
      attemptId: found.attempt.id,
      browserTaskRunId: found.attempt.browserTaskRunId,
      agentRunId: found.attempt.agentRunId,
    }
    const nodeStatus: WebAffairNodeStatus =
      input.outcome === 'succeeded'
        ? 'completed'
        : input.outcome === 'failed'
          ? 'failed'
          : 'cancelled'
    const attempts = found.affair.attempts.map((item) =>
      item.id === found.attempt.id
        ? {
            ...item,
            status: input.outcome,
            failureMessage: input.outcome === 'failed' ? input.summary : undefined,
            evidence: [...item.evidence, evidence],
            endedAt: now,
          }
        : item,
    )
    const nodes = this.normalizeNodeStates(
      found.affair.flow.nodes.map((item) =>
        item.id === node.id
          ? { ...item, status: nodeStatus, lastResultNote: input.summary, updatedAt: now }
          : item,
      ),
      found.affair.flow.edges,
      now,
    )
    return this.persistAffair({
      ...found.affair,
      attempts,
      flow: { ...found.affair.flow, nodes },
      status: this.deriveAffairStatus(nodes),
      ...(found.affair.articlePublishing
        ? {
            articlePublishing: {
              ...found.affair.articlePublishing,
              execution: {
                ...found.affair.articlePublishing.execution,
                status:
                  input.outcome === 'succeeded'
                    ? ('published' as const)
                    : input.outcome === 'interrupted'
                      ? ('interrupted' as const)
                      : input.outcome === 'failed'
                        ? ('failed' as const)
                        : found.affair.articlePublishing.execution.status,
              },
              publication:
                input.outcome === 'succeeded'
                  ? {
                      status: 'published' as const,
                      url: input.url,
                      observedAt: now,
                    }
                  : found.affair.articlePublishing.publication,
            },
          }
        : {}),
      events: this.appendEvent(
        found.affair,
        this.event('attempt-finished', `${node.title}：${input.outcome}，${input.summary}`, now, {
          nodeId: node.id,
          attemptId: found.attempt.id,
        }),
      ),
      updatedAt: now,
    })
  }

  private async scheduleCheckNow(
    rawInput: ScheduleWebAffairCheckInput,
  ): Promise<WebAffairOperationResult<WebAffair>> {
    const parsed = scheduleWebAffairCheckInputSchema.safeParse(rawInput)
    if (!parsed.success) return this.invalid('等待计划参数无效')
    const input = parsed.data
    const affair = this.findAffair(input.affairId)
    const node = affair?.flow.nodes.find((item) => item.id === input.nodeId)
    if (!affair || !node) return this.notFound('事务或节点不存在')
    if (TERMINAL_NODE_STATUSES.has(node.status)) return this.transitionError('终态节点不能安排检查')
    const now = this.timestamp()
    const waitPlan = {
      nodeId: node.id,
      status: 'scheduled' as const,
      nextCheckAt: input.nextCheckAt,
      intervalMinutes: input.intervalMinutes,
      maxIntervalMinutes: input.maxIntervalMinutes,
      checkCount: 0,
      maxChecks: input.maxChecks,
    }
    const nodes = affair.flow.nodes.map((item) =>
      item.id === node.id
        ? {
            ...item,
            status: 'waiting-external' as const,
            executor: 'external' as const,
            updatedAt: now,
            availableTransitions: [...ALLOWED_TRANSITIONS['waiting-external']],
          }
        : item,
    )
    const attempts = affair.attempts.map((attempt) =>
      attempt.nodeId === node.id && !TERMINAL_ATTEMPT_STATUSES.has(attempt.status)
        ? {
            ...attempt,
            status: 'succeeded' as const,
            endedAt: now,
            evidence: [
              ...attempt.evidence,
              {
                id: randomUUID(),
                kind: 'user-note' as const,
                source: 'system' as const,
                summary: `当前办理已结束，进入外部等待；下次检查 ${input.nextCheckAt}`,
                observedAt: now,
                attemptId: attempt.id,
                browserTaskRunId: attempt.browserTaskRunId,
                agentRunId: attempt.agentRunId,
              },
            ],
          }
        : attempt,
    )
    return this.persistAffair({
      ...affair,
      status: 'waiting-external',
      flow: { ...affair.flow, nodes },
      attempts,
      waitPlans: [...affair.waitPlans.filter((item) => item.nodeId !== node.id), waitPlan],
      events: this.appendEvent(
        affair,
        this.event('wait-scheduled', `${node.title}：下次检查 ${input.nextCheckAt}`, now, {
          nodeId: node.id,
        }),
      ),
      updatedAt: now,
    })
  }

  private async completeCheckNow(
    rawInput: CompleteWebAffairCheckInput,
  ): Promise<WebAffairOperationResult<WebAffair>> {
    const parsed = completeWebAffairCheckInputSchema.safeParse(rawInput)
    if (!parsed.success) return this.invalid('检查结果参数无效')
    const input = parsed.data
    const affair = this.findAffair(input.affairId)
    const node = affair?.flow.nodes.find((item) => item.id === input.nodeId)
    const plan = affair?.waitPlans.find((item) => item.nodeId === input.nodeId)
    if (!affair || !node || !plan) return this.notFound('等待节点或计划不存在')
    const now = this.timestamp()
    const checkedCount = plan.checkCount + 1
    const accountId = node.accountIds[0] ?? affair.accountIds[0]
    if (!accountId) return this.resourceError('复查节点没有绑定网站账号')
    const launch = this.resolveWebResourceLaunch(affair.workspaceId!, accountId)
    if (!launch.success) return this.resourceError(launch.error.message)
    const checkEvidence = {
      id: randomUUID(),
      kind: 'official-response' as const,
      source: input.url ? ('browser' as const) : ('user' as const),
      summary: input.summary,
      observedAt: now,
      url: input.url,
    }
    const activeAttempt = [...affair.attempts]
      .reverse()
      .find(
        (attempt) => attempt.nodeId === node.id && !TERMINAL_ATTEMPT_STATUSES.has(attempt.status),
      )
    const attempts = activeAttempt
      ? affair.attempts.map((attempt) =>
          attempt.id === activeAttempt.id
            ? {
                ...attempt,
                status: 'succeeded' as const,
                evidence: [
                  ...attempt.evidence,
                  {
                    ...checkEvidence,
                    attemptId: attempt.id,
                    browserTaskRunId: attempt.browserTaskRunId,
                    agentRunId: attempt.agentRunId,
                  },
                ],
                endedAt: now,
              }
            : attempt,
        )
      : [
          ...affair.attempts,
          {
            id: randomUUID(),
            nodeId: node.id,
            number: affair.attempts.filter((item) => item.nodeId === node.id).length + 1,
            status: 'succeeded' as const,
            profileId: launch.data.browserProfileId,
            accountId,
            entryUrl: input.url ?? launch.data.entryUrl,
            sideEffectKey: `${affair.id}:${node.id}:check-${checkedCount}`,
            evidence: [checkEvidence],
            startedAt: now,
            endedAt: now,
          },
        ]
    if (input.outcome === 'unchanged') {
      const exhausted = checkedCount >= plan.maxChecks
      const nextInterval = Math.min(
        plan.maxIntervalMinutes,
        plan.intervalMinutes * 2 ** checkedCount,
      )
      const nextCheckAt = new Date(this.now().getTime() + nextInterval * 60_000).toISOString()
      const waitPlans = affair.waitPlans.map((item) =>
        item.nodeId === node.id
          ? {
              ...item,
              status: exhausted ? ('exhausted' as const) : ('scheduled' as const),
              checkCount: checkedCount,
              lastCheckedAt: now,
              lastOutcome: input.summary,
              nextCheckAt,
            }
          : item,
      )
      const nodes = affair.flow.nodes.map((item) =>
        item.id === node.id
          ? {
              ...item,
              status: exhausted ? ('waiting-human' as const) : ('waiting-external' as const),
              lastResultNote: input.summary,
              updatedAt: now,
              availableTransitions: [
                ...ALLOWED_TRANSITIONS[exhausted ? 'waiting-human' : 'waiting-external'],
              ],
            }
          : item,
      )
      return this.persistAffair({
        ...affair,
        status: exhausted ? 'needs-attention' : 'waiting-external',
        flow: { ...affair.flow, nodes },
        attempts,
        waitPlans,
        events: this.appendEvent(
          affair,
          this.event(
            'wait-scheduled',
            exhausted
              ? `${node.title}：检查次数已达上限，需要人工处理`
              : `${node.title}：状态未变化，下次检查 ${nextCheckAt}`,
            now,
            { nodeId: node.id },
          ),
        ),
        updatedAt: now,
      })
    }

    let nodes = affair.flow.nodes.map((item) =>
      item.id === node.id
        ? { ...item, status: 'completed' as const, lastResultNote: input.summary, updatedAt: now }
        : item,
    )
    let edges = affair.flow.edges
    if (input.outcome === 'rejected') {
      const correction = this.createNode({
        title: `处理“${node.title}”驳回补正`,
        description: input.summary,
        status: 'ready',
        executor: 'user',
        type: 'human-task',
        accountIds: node.accountIds,
        materialIds: node.materialIds,
        now,
      })
      const outgoing = edges.filter((edge) => edge.fromNodeId === node.id)
      edges = [
        ...edges.filter((edge) => edge.fromNodeId !== node.id),
        { id: randomUUID(), fromNodeId: node.id, toNodeId: correction.id },
        ...outgoing.map((edge) => ({
          id: randomUUID(),
          fromNodeId: correction.id,
          toNodeId: edge.toNodeId,
        })),
      ]
      nodes = [...nodes, correction]
    }
    nodes = this.normalizeNodeStates(nodes, edges, now)
    return this.persistAffair({
      ...affair,
      flow: {
        version: input.outcome === 'rejected' ? affair.flow.version + 1 : affair.flow.version,
        nodes,
        edges,
      },
      attempts,
      waitPlans: affair.waitPlans.map((item) =>
        item.nodeId === node.id
          ? {
              ...item,
              status: 'cancelled' as const,
              checkCount: checkedCount,
              lastCheckedAt: now,
              lastOutcome: input.summary,
            }
          : item,
      ),
      status: this.deriveAffairStatus(nodes),
      events: this.appendEvent(
        affair,
        this.event('wait-due', `${node.title}：${input.outcome}，${input.summary}`, now, {
          nodeId: node.id,
        }),
      ),
      updatedAt: now,
    })
  }

  private async proposeFlowDiffNow(
    rawInput: ProposeWebAffairFlowDiffInput,
  ): Promise<WebAffairOperationResult<WebAffair>> {
    const parsed = proposeWebAffairFlowDiffInputSchema.safeParse(rawInput)
    if (!parsed.success) return this.invalid('流程变更建议无效')
    const input = parsed.data
    const affair = this.findAffair(input.affairId)
    if (!affair) return this.notFound('事务不存在')
    if (input.baseVersion !== affair.flow.version) {
      return {
        success: false,
        error: { code: 'FLOW_VERSION_CONFLICT', message: '流程版本已变化，请基于最新版本重新建议' },
      }
    }
    const now = this.timestamp()
    const touchesExisting = input.operations.some((item) => item.kind !== 'add-node')
    const proposal = {
      id: randomUUID(),
      baseVersion: input.baseVersion,
      status: 'pending' as const,
      reason: input.reason,
      operations: input.operations,
      impacts: input.impacts,
      requiresConfirmation: touchesExisting || input.impacts.length > 0,
      proposedBy: input.proposedBy,
      createdAt: now,
    }
    return this.persistAffair({
      ...affair,
      flowProposals: [
        ...affair.flowProposals.map((item) =>
          item.status === 'pending'
            ? { ...item, status: 'superseded' as const, decidedAt: now }
            : item,
        ),
        proposal,
      ],
      status: 'needs-attention',
      events: this.appendEvent(
        affair,
        this.event('flow-proposed', `收到流程变更建议：${input.reason}`, now),
      ),
      updatedAt: now,
    })
  }

  private async decideFlowProposalNow(
    rawInput: DecideWebAffairFlowProposalInput,
  ): Promise<WebAffairOperationResult<WebAffair>> {
    const parsed = decideWebAffairFlowProposalInputSchema.safeParse(rawInput)
    if (!parsed.success) return this.invalid('流程建议决定无效')
    const input = parsed.data
    const affair = this.findAffair(input.affairId)
    const proposal = affair?.flowProposals.find((item) => item.id === input.proposalId)
    if (!affair || !proposal) return this.notFound('流程建议不存在')
    if (proposal.status !== 'pending') return this.transitionError('流程建议已经处理')
    if (proposal.baseVersion !== affair.flow.version) {
      return {
        success: false,
        error: { code: 'FLOW_VERSION_CONFLICT', message: '流程已变化，该建议不能直接应用' },
      }
    }
    const now = this.timestamp()
    if (input.decision === 'reject') {
      return this.persistAffair({
        ...affair,
        flowProposals: affair.flowProposals.map((item) =>
          item.id === proposal.id ? { ...item, status: 'rejected' as const, decidedAt: now } : item,
        ),
        status: this.deriveAffairStatus(affair.flow.nodes),
        events: this.appendEvent(
          affair,
          this.event('flow-proposal-decided', `已拒绝流程建议：${proposal.reason}`, now),
        ),
        updatedAt: now,
      })
    }
    const applied = this.applyFlowDiff(affair, proposal.operations, now)
    if (!applied.success) return applied
    const nodes = this.normalizeNodeStates(applied.data.nodes, applied.data.edges, now)
    return this.persistAffair({
      ...affair,
      flow: { version: affair.flow.version + 1, nodes, edges: applied.data.edges },
      flowProposals: affair.flowProposals.map((item) =>
        item.id === proposal.id ? { ...item, status: 'accepted' as const, decidedAt: now } : item,
      ),
      status: this.deriveAffairStatus(nodes),
      events: this.appendEvent(
        affair,
        this.event(
          'flow-proposal-decided',
          `已接受流程建议并生成版本 ${affair.flow.version + 1}`,
          now,
        ),
      ),
      updatedAt: now,
    })
  }

  private buildRevisedFlow(
    affair: WebAffair,
    input: ReviseWebAffairFlowInput,
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
      if (!proposed) return this.immutable('已执行节点不能删除')
      if (
        proposed.title !== existing.title ||
        proposed.type !== existing.type ||
        proposed.executor !== existing.executor ||
        JSON.stringify(proposed.accountIds) !== JSON.stringify(existing.accountIds) ||
        JSON.stringify(proposed.materialIds) !== JSON.stringify(existing.materialIds) ||
        JSON.stringify(proposed.successCriteria) !== JSON.stringify(existing.successCriteria)
      )
        return this.immutable('已执行节点内容不能修改，只能新增补正节点')
    }
    const idMap = new Map<string, string>()
    const now = this.timestamp()
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
      return this.createNode({ ...item, id, status: 'blocked', now })
    })
    const edges = input.edges.map((edge) => ({
      id: randomUUID(),
      fromNodeId: idMap.get(edge.fromNodeId) ?? edge.fromNodeId,
      toNodeId: idMap.get(edge.toNodeId) ?? edge.toNodeId,
    }))
    const invalid = this.validateFlow(affair, nodes, edges, immutableIds)
    return invalid ?? { success: true, data: { nodes, edges } }
  }

  private applyFlowDiff(
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
          this.createNode({
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
        if (immutableIds.has(operation.nodeId)) return this.immutable('已执行节点不能修改')
        if (!nodes.some((node) => node.id === operation.nodeId))
          return this.notFound('待修改节点不存在')
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
        if (immutableIds.has(operation.nodeId)) return this.immutable('已执行节点不能删除')
        nodes = nodes.filter((node) => node.id !== operation.nodeId)
        edges = edges.filter(
          (edge) => edge.fromNodeId !== operation.nodeId && edge.toNodeId !== operation.nodeId,
        )
      } else if (operation.kind === 'remove-edge') {
        const edge = edges.find((item) => item.id === operation.edgeId)
        if (edge && (immutableIds.has(edge.fromNodeId) || immutableIds.has(edge.toNodeId)))
          return this.immutable('已执行节点的历史依赖不能删除')
        edges = edges.filter((item) => item.id !== operation.edgeId)
      } else {
        const fromNodeId = tempIds.get(operation.fromNodeId) ?? operation.fromNodeId
        const toNodeId = tempIds.get(operation.toNodeId) ?? operation.toNodeId
        edges.push({ id: randomUUID(), fromNodeId, toNodeId })
      }
    }
    const invalid = this.validateFlow(affair, nodes, edges, immutableIds)
    return invalid ?? { success: true, data: { nodes, edges } }
  }

  private validateFlow(
    affair: WebAffair,
    nodes: WebAffairNode[],
    edges: WebAffairEdge[],
    immutableIds: Set<string>,
  ): WebAffairOperationResult<never> | null {
    if (nodes.length < 1 || nodes.length > 40 || edges.length > 160)
      return this.invalid('流程规模超出限制')
    const nodeIds = new Set(nodes.map((node) => node.id))
    const materialIds = new Set(affair.materials.map((item) => item.id))
    if (nodeIds.size !== nodes.length) return this.invalid('流程包含重复节点')
    for (const node of nodes) {
      if (
        node.accountIds.some((id) => !affair.accountIds.includes(id)) ||
        node.materialIds.some((id) => !materialIds.has(id))
      ) {
        return this.resourceError('节点引用了事务范围之外的账号或材料')
      }
    }
    for (const edge of edges) {
      if (
        !nodeIds.has(edge.fromNodeId) ||
        !nodeIds.has(edge.toNodeId) ||
        edge.fromNodeId === edge.toNodeId
      )
        return this.invalid('流程依赖包含无效节点或自循环')
    }
    const oldImmutableEdges = affair.flow.edges.filter(
      (edge) => immutableIds.has(edge.fromNodeId) || immutableIds.has(edge.toNodeId),
    )
    if (
      oldImmutableEdges.some(
        (old) =>
          !edges.some(
            (edge) => edge.fromNodeId === old.fromNodeId && edge.toNodeId === old.toNodeId,
          ),
      )
    ) {
      return this.immutable('已执行节点的历史依赖不能删除')
    }
    if (this.hasCycle(nodes, edges)) return this.invalid('事务流程必须是有向无环图')
    return null
  }

  private async reconcileOverdueChecks(startup: boolean): Promise<void> {
    await this.enqueue(async () => {
      if (!this.snapshot) return this.unavailable()
      const dueAt = this.now().getTime()
      let changed = false
      const timestamp = this.timestamp()
      const affairs = this.snapshot.affairs.map((affair) => {
        const duePlans = affair.waitPlans.filter(
          (plan) => plan.status === 'scheduled' && new Date(plan.nextCheckAt).getTime() <= dueAt,
        )
        if (duePlans.length === 0) return affair
        changed = true
        const dueIds = new Set(duePlans.map((plan) => plan.nodeId))
        return {
          ...affair,
          status: 'needs-attention' as const,
          waitPlans: affair.waitPlans.map((plan) =>
            dueIds.has(plan.nodeId)
              ? { ...plan, status: startup ? ('missed' as const) : ('due' as const) }
              : plan,
          ),
          events: duePlans.reduce(
            (events, plan) =>
              this.appendEvent(
                { ...affair, events } as WebAffair,
                this.event(
                  'wait-due',
                  startup
                    ? '应用退出期间错过检查，等待用户补查'
                    : '外部检查已到期，等待创建新的检查 Attempt',
                  timestamp,
                  { nodeId: plan.nodeId },
                ),
              ),
            affair.events,
          ),
          updatedAt: timestamp,
        }
      })
      if (!changed) return { success: true, data: this.snapshot.affairs[0] ?? (null as never) }
      const next = { ...this.snapshot, revision: this.snapshot.revision + 1, affairs }
      await this.store.save(next)
      this.snapshot = next
      for (const affair of affairs) {
        if (affair.updatedAt === timestamp) this.onChanged(affair.id, next.revision)
      }
      return { success: true, data: affairs[0] ?? (null as never) }
    })
  }

  private async reconcileInterruptedAttempts(): Promise<void> {
    if (!this.snapshot) return
    const now = this.timestamp()
    let changed = false
    const affairs = this.snapshot.affairs.map((affair) => {
      const interrupted = affair.attempts.filter((attempt) =>
        ['preparing', 'running-ai', 'verifying'].includes(attempt.status),
      )
      if (interrupted.length === 0) return affair
      changed = true
      const interruptedIds = new Set(interrupted.map((attempt) => attempt.id))
      const interruptedNodeIds = new Set(interrupted.map((attempt) => attempt.nodeId))
      const attempts = affair.attempts.map((attempt) =>
        interruptedIds.has(attempt.id)
          ? {
              ...attempt,
              status: 'interrupted' as const,
              failureMessage: '应用或 Agent 运行时已结束，未恢复为假运行',
              endedAt: now,
            }
          : attempt,
      )
      const nodes = affair.flow.nodes.map((node) =>
        interruptedNodeIds.has(node.id) && !TERMINAL_NODE_STATUSES.has(node.status)
          ? {
              ...node,
              status: 'waiting-human' as const,
              lastResultNote: '上次 AI 运行已中断，请核验网页现场后重试',
              availableTransitions: [...ALLOWED_TRANSITIONS['waiting-human']],
              updatedAt: now,
            }
          : node,
      )
      return {
        ...affair,
        status: 'needs-attention' as const,
        attempts,
        flow: { ...affair.flow, nodes },
        ...(affair.articlePublishing
          ? {
              articlePublishing: {
                ...affair.articlePublishing,
                assets: affair.articlePublishing.assets.map((asset) =>
                  ['uploading', 'waiting-platform', 'verifying'].includes(asset.status)
                    ? { ...asset, status: 'reconciling' as const }
                    : asset,
                ),
                checkpoints: affair.articlePublishing.checkpoints.map((checkpoint) =>
                  ['running', 'waiting-platform', 'verifying'].includes(checkpoint.status)
                    ? { ...checkpoint, status: 'needs-reconcile' as const }
                    : checkpoint,
                ),
                execution: {
                  ...affair.articlePublishing.execution,
                  status: 'interrupted' as const,
                },
              },
            }
          : {}),
        events: interrupted.reduce(
          (events, attempt) =>
            this.appendEvent(
              { ...affair, events } as WebAffair,
              this.event(
                'attempt-finished',
                '应用重启后已将未结束 Attempt 标记为中断，未执行重复提交',
                now,
                { nodeId: attempt.nodeId, attemptId: attempt.id },
              ),
            ),
          affair.events,
        ),
        updatedAt: now,
      }
    })
    if (!changed) return
    const next = { ...this.snapshot, revision: this.snapshot.revision + 1, affairs }
    await this.store.save(next)
    this.snapshot = next
    for (const affair of affairs) {
      if (affair.updatedAt === now) this.onChanged(affair.id, next.revision)
    }
  }

  private async createMaterial(path: string, now: string): Promise<WebAffairMaterialRef> {
    try {
      const metadata = await stat(path)
      return {
        id: randomUUID(),
        path,
        name: basename(path),
        state: 'available',
        size: metadata.size,
        modifiedAt: metadata.mtime.toISOString(),
        checkedAt: now,
        addedAt: now,
      }
    } catch {
      return {
        id: randomUUID(),
        path,
        name: basename(path),
        state: 'missing',
        checkedAt: now,
        addedAt: now,
      }
    }
  }

  private async inspectMaterial(
    material: WebAffairMaterialRef,
    now: string,
  ): Promise<WebAffairMaterialRef> {
    try {
      const metadata = await stat(material.path)
      const modifiedAt = metadata.mtime.toISOString()
      const changed =
        material.size !== undefined &&
        (material.size !== metadata.size || material.modifiedAt !== modifiedAt)
      return {
        ...material,
        state: changed ? 'changed' : 'available',
        size: metadata.size,
        modifiedAt,
        checkedAt: now,
      }
    } catch {
      return { ...material, state: 'missing', checkedAt: now }
    }
  }

  private createNode(input: {
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

  private normalizeNodeStates(
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

  private deriveAffairStatus(nodes: WebAffairNode[]): WebAffairStatus {
    if (nodes.every((node) => node.status === 'cancelled')) return 'cancelled'
    if (nodes.every((node) => TERMINAL_NODE_STATUSES.has(node.status))) return 'completed'
    if (nodes.some((node) => node.status === 'waiting-human')) return 'needs-attention'
    if (nodes.some((node) => node.status === 'waiting-external')) return 'waiting-external'
    if (nodes.some((node) => node.status === 'failed')) return 'failed'
    return 'active'
  }

  private persistAttemptChange(
    affair: WebAffair,
    current: WebAffairAttempt,
    input: {
      attempt: WebAffairAttempt
      nodeStatus: WebAffairNodeStatus
      event: WebAffairEvent
      now: string
      articlePublishing?: ArticlePublishingState
    },
  ): Promise<WebAffairOperationResult<WebAffair>> {
    const nodes = affair.flow.nodes.map((node) =>
      node.id === current.nodeId
        ? {
            ...node,
            status: input.nodeStatus,
            updatedAt: input.now,
            availableTransitions: [...ALLOWED_TRANSITIONS[input.nodeStatus]],
          }
        : node,
    )
    return this.persistAffair({
      ...affair,
      status: this.deriveAffairStatus(nodes),
      flow: { ...affair.flow, nodes },
      attempts: affair.attempts.map((attempt) =>
        attempt.id === current.id ? input.attempt : attempt,
      ),
      ...(input.articlePublishing ? { articlePublishing: input.articlePublishing } : {}),
      events: this.appendEvent(affair, input.event),
      updatedAt: input.now,
    })
  }

  private async resumeArticlePublishingAfterHandoffNow(
    affairId: string,
    attemptId: string,
  ): Promise<WebAffairOperationResult<WebAffair>> {
    const found = this.findAttempt(affairId, attemptId)
    const publishing = found?.affair.articlePublishing
    if (!found || !publishing || found.affair.kind !== 'article-publishing') {
      return this.notFound('文章发布 Attempt 不存在')
    }
    if (
      publishing.execution.status !== 'waiting-human' ||
      !['waiting-human', 'running-ai'].includes(found.attempt.status)
    ) {
      return this.transitionError('只有待人工处理的文章发布 Attempt 可以交还 Agent')
    }
    const now = this.timestamp()
    const currentStepId = publishing.execution.currentStepId
    const checkpoints = publishing.checkpoints.map((checkpoint) =>
      checkpoint.stepId === currentStepId && checkpoint.status === 'waiting-human'
        ? { ...checkpoint, status: 'needs-reconcile' as const, finishedAt: undefined }
        : checkpoint,
    )
    const nodes = found.affair.flow.nodes.map((node) =>
      node.id === found.attempt.nodeId
        ? {
            ...node,
            status: 'running' as const,
            executor: 'ai' as const,
            lastResultNote: '用户已处理人工卡点，等待 Agent 重新观察',
            availableTransitions: [...ALLOWED_TRANSITIONS.running],
            updatedAt: now,
          }
        : node,
    )
    return this.persistAffair({
      ...found.affair,
      status: 'active',
      flow: { ...found.affair.flow, nodes },
      attempts: found.affair.attempts.map((attempt) =>
        attempt.id === found.attempt.id
          ? {
              ...attempt,
              status: 'preparing' as const,
              returnedAt: now,
              tabId: undefined,
              conversationId: undefined,
              agentRunId: undefined,
              browserTaskRunId: undefined,
            }
          : attempt,
      ),
      articlePublishing: {
        ...publishing,
        checkpoints,
        execution: {
          ...publishing.execution,
          status: 'running',
          lastAgentRunId: undefined,
          lastBrowserTaskRunId: undefined,
        },
      },
      events: this.appendEvent(
        found.affair,
        this.event(
          'attempt-returned',
          '用户已处理文章发布人工卡点；恢复同一 Attempt 并要求新 Agent 重新观察',
          now,
          { nodeId: found.attempt.nodeId, attemptId: found.attempt.id },
        ),
      ),
      updatedAt: now,
    })
  }

  private async resumeArticlePublishingAttemptNow(
    affairId: string,
    attemptId: string,
  ): Promise<WebAffairOperationResult<WebAffair>> {
    const found = this.findAttempt(affairId, attemptId)
    if (!found?.affair.articlePublishing || found.affair.kind !== 'article-publishing') {
      return this.notFound('文章发布 Attempt 不存在')
    }
    if (found.attempt.status !== 'interrupted') {
      return this.transitionError('只有已中断的文章发布 Attempt 可以原地恢复')
    }
    const now = this.timestamp()
    const publishing = found.affair.articlePublishing
    const checkpoints = publishing.checkpoints.map((checkpoint) =>
      ['running', 'waiting-platform', 'verifying'].includes(checkpoint.status)
        ? { ...checkpoint, status: 'needs-reconcile' as const, finishedAt: undefined }
        : checkpoint,
    )
    const currentStep = checkpoints.find((checkpoint) => checkpoint.status !== 'completed')
    const nodes = found.affair.flow.nodes.map((node) =>
      node.id === found.attempt.nodeId
        ? {
            ...node,
            status: 'running' as const,
            executor: 'ai' as const,
            lastResultNote: '正在从已确认检查点恢复',
            availableTransitions: [...ALLOWED_TRANSITIONS.running],
            updatedAt: now,
          }
        : node,
    )
    const attempts = found.affair.attempts.map((attempt) =>
      attempt.id === found.attempt.id
        ? {
            ...attempt,
            status: 'preparing' as const,
            endedAt: undefined,
            failureMessage: undefined,
            tabId: undefined,
            conversationId: undefined,
            agentRunId: undefined,
            browserTaskRunId: undefined,
          }
        : attempt,
    )
    return this.persistAffair({
      ...found.affair,
      status: 'active',
      flow: { ...found.affair.flow, nodes },
      attempts,
      articlePublishing: {
        ...publishing,
        assets: publishing.assets.map((asset) =>
          ['uploading', 'waiting-platform', 'verifying'].includes(asset.status)
            ? { ...asset, status: 'reconciling' as const }
            : asset,
        ),
        checkpoints,
        execution: {
          ...publishing.execution,
          status: 'running',
          currentAttemptId: found.attempt.id,
          currentStepId: currentStep?.stepId,
          lastAgentRunId: undefined,
          lastBrowserTaskRunId: undefined,
        },
      },
      events: this.appendEvent(
        found.affair,
        this.event(
          'attempt-returned',
          '文章发布从原 Attempt 的未完成检查点恢复；将创建新的 Agent Run 和 BrowserTask',
          now,
          { nodeId: found.attempt.nodeId, attemptId: found.attempt.id },
        ),
      ),
      updatedAt: now,
    })
  }

  private async markArticlePublishingAttemptStartedNow(
    affairId: string,
    attemptId: string,
  ): Promise<WebAffairOperationResult<WebAffair>> {
    const found = this.findAttempt(affairId, attemptId)
    if (!found?.affair.articlePublishing || found.affair.kind !== 'article-publishing') {
      return this.notFound('文章发布 Attempt 不存在')
    }
    const now = this.timestamp()
    const publishing = found.affair.articlePublishing
    const currentStep = publishing.checkpoints.find(
      (checkpoint) => checkpoint.status !== 'completed',
    )
    const checkpoints = publishing.checkpoints.map((checkpoint) =>
      checkpoint.stepId === currentStep?.stepId && checkpoint.status === 'pending'
        ? {
            ...checkpoint,
            status: 'running' as const,
            attemptCount: checkpoint.attemptCount + 1,
            startedAt: now,
          }
        : checkpoint,
    )
    return this.persistAffair({
      ...found.affair,
      articlePublishing: {
        ...publishing,
        checkpoints,
        execution: {
          ...publishing.execution,
          status: 'running',
          currentAttemptId: found.attempt.id,
          currentStepId: currentStep?.stepId,
        },
      },
      updatedAt: now,
    })
  }

  private async interruptArticlePublishingLaunchNow(
    affairId: string,
    attemptId: string,
    reason: string,
    runtimeEnded = false,
  ): Promise<WebAffairOperationResult<WebAffair>> {
    const found = this.findAttempt(affairId, attemptId)
    const publishing = found?.affair.articlePublishing
    if (!found || !publishing || found.affair.kind !== 'article-publishing') {
      return this.notFound('文章发布 Attempt 不存在')
    }
    const isCurrentAttempt = publishing.execution.currentAttemptId === attemptId
    const isTransient = ['preparing', 'running-ai', 'verifying'].includes(found.attempt.status)
    if (!isCurrentAttempt || !isTransient) {
      if (runtimeEnded) return { success: true, data: structuredClone(found.affair) }
      return this.transitionError('只有尚未成功启动 Agent 的文章发布 Attempt 可以恢复')
    }
    const now = this.timestamp()
    const currentStepId = publishing.execution.currentStepId
    const eventPrefix = runtimeEnded ? 'Agent 或浏览器运行已结束' : 'Agent 启动失败'
    return this.persistAffair({
      ...found.affair,
      status: 'needs-attention',
      flow: {
        ...found.affair.flow,
        nodes: found.affair.flow.nodes.map((node) =>
          node.id === found.attempt.nodeId
            ? {
                ...node,
                status: 'waiting-human' as const,
                lastResultNote: `${eventPrefix}，已保留现场供原 Attempt 重试`,
                availableTransitions: [...ALLOWED_TRANSITIONS['waiting-human']],
                updatedAt: now,
              }
            : node,
        ),
      },
      attempts: found.affair.attempts.map((attempt) =>
        attempt.id === attemptId
          ? {
              ...attempt,
              status: 'interrupted' as const,
              failureMessage: reason,
              endedAt: now,
            }
          : attempt,
      ),
      articlePublishing: {
        ...publishing,
        assets: publishing.assets.map((asset) =>
          ['uploading', 'waiting-platform', 'verifying'].includes(asset.status)
            ? { ...asset, status: 'reconciling' as const }
            : asset,
        ),
        checkpoints: publishing.checkpoints.map((checkpoint) =>
          checkpoint.stepId === currentStepId &&
          ['running', 'waiting-platform', 'verifying'].includes(checkpoint.status)
            ? { ...checkpoint, status: 'needs-reconcile' as const, finishedAt: undefined }
            : checkpoint,
        ),
        execution: {
          ...publishing.execution,
          status: 'interrupted',
          lastAgentRunId: undefined,
          lastBrowserTaskRunId: undefined,
        },
      },
      events: this.appendEvent(
        found.affair,
        this.event('attempt-finished', `${eventPrefix}，已恢复为可继续状态：${reason}`, now, {
          nodeId: found.attempt.nodeId,
          attemptId,
        }),
      ),
      updatedAt: now,
    })
  }

  private async reportArticlePublishingCheckpointNow(
    input: ReportArticlePublishingCheckpointInput,
  ): Promise<WebAffairOperationResult<WebAffair>> {
    const found = this.findAttempt(input.affairId, input.attemptId)
    const publishing = found?.affair.articlePublishing
    if (!found || !publishing || found.affair.kind !== 'article-publishing') {
      return this.notFound('文章发布 Attempt 不存在')
    }
    if (publishing.execution.currentAttemptId !== input.attemptId) {
      return this.transitionError('报告的 Attempt 不是当前发布事务')
    }
    const checkpoint = publishing.checkpoints.find((item) => item.stepId === input.stepId)
    if (!checkpoint) return this.notFound('文章发布检查点不存在')
    const now = this.timestamp()
    const checkpoints = publishing.checkpoints.map((item) =>
      item.stepId === input.stepId
        ? {
            ...item,
            status: input.status,
            attemptCount:
              input.status === 'running' && item.status !== 'running'
                ? item.attemptCount + 1
                : item.attemptCount,
            startedAt: input.status === 'running' ? (item.startedAt ?? now) : item.startedAt,
            finishedAt: ['completed', 'failed'].includes(input.status) ? now : undefined,
            outputRefs: input.outputRefs ?? item.outputRefs,
            evidence: input.evidence
              ? [...item.evidence, input.evidence].slice(-40)
              : item.evidence,
            error: input.error,
          }
        : item,
    )
    const nextStep = checkpoints.find((item) => item.status !== 'completed')
    const executionStatus: ArticlePublishingState['execution']['status'] =
      input.status === 'waiting-human'
        ? 'waiting-human'
        : input.status === 'result-unknown'
          ? 'result-unknown'
          : input.status === 'failed'
            ? 'failed'
            : 'running'
    return this.persistAffair({
      ...found.affair,
      status:
        executionStatus === 'waiting-human' || executionStatus === 'result-unknown'
          ? 'needs-attention'
          : executionStatus === 'failed'
            ? 'failed'
            : 'active',
      articlePublishing: {
        ...publishing,
        checkpoints,
        execution: {
          ...publishing.execution,
          status: executionStatus,
          currentStepId: nextStep?.stepId,
        },
      },
      events: this.appendEvent(
        found.affair,
        this.event(
          'node-status-changed',
          `文章发布步骤 ${checkpoint.label} → ${input.status}`,
          now,
          { nodeId: found.attempt.nodeId, attemptId: found.attempt.id },
        ),
      ),
      updatedAt: now,
    })
  }

  private async reportArticlePublishingAssetNow(
    input: ReportArticlePublishingAssetInput,
  ): Promise<WebAffairOperationResult<WebAffair>> {
    const found = this.findAttempt(input.affairId, input.attemptId)
    const publishing = found?.affair.articlePublishing
    if (!found || !publishing || found.affair.kind !== 'article-publishing') {
      return this.notFound('文章发布 Attempt 不存在')
    }
    if (publishing.execution.currentAttemptId !== input.attemptId) {
      return this.transitionError('报告的 Attempt 不是当前发布事务')
    }
    const target = publishing.assets.find((asset) => asset.id === input.assetId)
    if (!target || target.kind !== 'local') return this.notFound('正文图片不存在')
    const now = this.timestamp()
    const activeAttempt = target.uploadAttempts[target.uploadAttempts.length - 1]
    let uploadAttempts = target.uploadAttempts
    let nextStatus = input.status

    if (input.status === 'uploading') {
      if (!['pending', 'retryable-failed', 'reconciling'].includes(target.status)) {
        return this.transitionError('当前图片状态不能开始新的上传尝试')
      }
      if (target.uploadAttempts.length >= 3) {
        return this.transitionError('当前图片已达到 3 次尝试上限，需要人工处理')
      }
      uploadAttempts = [
        ...target.uploadAttempts,
        {
          number: target.uploadAttempts.length + 1,
          status: 'uploading' as const,
          startedAt: now,
          evidence: input.evidence ? [input.evidence] : [],
        },
      ]
    } else {
      if (!activeAttempt) return this.transitionError('图片尚未开始上传')
      const allowedPrevious: Partial<
        Record<typeof input.status, ArticlePublishingState['assets'][number]['status'][]>
      > = {
        'waiting-platform': ['uploading'],
        verifying: ['waiting-platform', 'reconciling'],
        uploaded: ['verifying', 'reconciling'],
        'retryable-failed': ['uploading', 'waiting-platform', 'verifying', 'reconciling'],
        'result-unknown': ['uploading', 'waiting-platform', 'verifying'],
        failed: ['uploading', 'waiting-platform', 'verifying', 'reconciling'],
      }
      const previous = allowedPrevious[input.status]
      if (previous && !previous.includes(target.status)) {
        return this.transitionError(`图片状态不能从 ${target.status} 进入 ${input.status}`)
      }
      if (input.status === 'uploaded' && (!input.platformUrl || !input.evidence)) {
        return this.transitionError('图片成功必须包含平台 URL 和页面核验证据')
      }
      if (
        input.status === 'uploaded' &&
        target.status !== 'verifying' &&
        target.status !== 'reconciling'
      ) {
        return this.transitionError('图片必须经过页面核验后才能标记成功')
      }
      if (input.status === 'retryable-failed' && activeAttempt.number >= 3) nextStatus = 'failed'
      uploadAttempts = target.uploadAttempts.map((attempt, index) =>
        index === target.uploadAttempts.length - 1
          ? {
              ...attempt,
              status:
                input.status === 'uploaded'
                  ? ('succeeded' as const)
                  : input.status === 'reconciling'
                    ? attempt.status
                    : (nextStatus as typeof attempt.status),
              finishedAt: ['uploaded', 'retryable-failed', 'result-unknown', 'failed'].includes(
                nextStatus,
              )
                ? now
                : attempt.finishedAt,
              evidence: input.evidence
                ? [...attempt.evidence, input.evidence].slice(-40)
                : attempt.evidence,
              error: input.error,
            }
          : attempt,
      )
    }
    const assets = publishing.assets.map((asset) =>
      asset.id === target.id
        ? {
            ...asset,
            status: nextStatus,
            platformUrl: input.status === 'uploaded' ? input.platformUrl : asset.platformUrl,
            verifiedAt: input.status === 'uploaded' ? now : asset.verifiedAt,
            uploadAttempts,
          }
        : asset,
    )
    return this.persistAffair({
      ...found.affair,
      articlePublishing: { ...publishing, assets },
      events: this.appendEvent(
        found.affair,
        this.event(
          'node-status-changed',
          `正文图片 ${target.displayPath} → ${nextStatus}（第 ${uploadAttempts.length}/3 次）`,
          now,
          { nodeId: found.attempt.nodeId, attemptId: found.attempt.id },
        ),
      ),
      updatedAt: now,
    })
  }

  private async markArticlePublishingPublicationDispatchedNow(
    affairId: string,
    attemptId: string,
  ): Promise<WebAffairOperationResult<WebAffair>> {
    const found = this.findAttempt(affairId, attemptId)
    const publishing = found?.affair.articlePublishing
    if (!found || !publishing || found.affair.kind !== 'article-publishing') {
      return this.notFound('文章发布 Attempt 不存在')
    }
    if (
      publishing.execution.currentAttemptId !== attemptId ||
      publishing.execution.currentStepId !== 'publish' ||
      publishing.execution.status !== 'running' ||
      found.attempt.status !== 'running-ai'
    ) {
      return this.transitionError('发布动作与当前文章发布检查点不一致')
    }
    if (publishing.publication.status !== 'not-started') {
      return this.transitionError('发布动作已经派发或结果未知，只允许重新核验')
    }
    if (publishing.assets.some((asset) => asset.kind === 'local' && asset.status !== 'uploaded')) {
      return this.transitionError('正文图片尚未全部核验，不能登记发布动作')
    }
    const now = this.timestamp()
    return this.persistAffair({
      ...found.affair,
      articlePublishing: {
        ...publishing,
        publication: { ...publishing.publication, status: 'dispatched' },
      },
      events: this.appendEvent(
        found.affair,
        this.event('node-status-changed', '常规单篇发布动作已登记派发，后续只能核验结果', now, {
          nodeId: found.attempt.nodeId,
          attemptId: found.attempt.id,
        }),
      ),
      updatedAt: now,
    })
  }

  private async persistNewAffair(affair: WebAffair): Promise<WebAffairOperationResult<WebAffair>> {
    if (!this.snapshot) return this.unavailable()
    const next = {
      ...this.snapshot,
      revision: this.snapshot.revision + 1,
      affairs: [...this.snapshot.affairs, affair],
    }
    await this.store.save(next)
    this.snapshot = next
    this.onChanged(affair.id, next.revision)
    return { success: true, data: structuredClone(affair) }
  }

  private async persistAffair(affair: WebAffair): Promise<WebAffairOperationResult<WebAffair>> {
    if (!this.snapshot) return this.unavailable()
    this.assertIntegrity({
      ...this.snapshot,
      affairs: this.snapshot.affairs.map((item) => (item.id === affair.id ? affair : item)),
    })
    const next = {
      ...this.snapshot,
      revision: this.snapshot.revision + 1,
      affairs: this.snapshot.affairs.map((item) => (item.id === affair.id ? affair : item)),
    }
    await this.store.save(next)
    this.snapshot = next
    this.onChanged(affair.id, next.revision)
    return { success: true, data: structuredClone(affair) }
  }

  private findAffair(id: string): WebAffair | undefined {
    return this.snapshot?.affairs.find((item) => item.id === id)
  }

  private findAttempt(
    affairId: string,
    attemptId: string,
  ): { affair: WebAffair; attempt: WebAffairAttempt } | null {
    const affair = this.findAffair(affairId)
    const attempt = affair?.attempts.find((item) => item.id === attemptId)
    return affair && attempt ? { affair, attempt } : null
  }

  private appendEvent(affair: WebAffair, event: WebAffairEvent): WebAffairEvent[] {
    if (affair.events.length >= EVENT_LIMIT) throw new Error('事务事件数量已达到限制')
    return [...affair.events, event]
  }

  private event(
    type: WebAffairEvent['type'],
    summary: string,
    occurredAt: string,
    refs: Pick<WebAffairEvent, 'nodeId' | 'attemptId'> = {},
  ): WebAffairEvent {
    return { id: randomUUID(), type, summary, occurredAt, ...refs }
  }

  private timestamp(): string {
    return this.now().toISOString()
  }

  private hasCycle(nodes: WebAffairNode[], edges: WebAffairEdge[]): boolean {
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

  private enqueueScoped(
    affairId: string,
    workspaceId: string,
    operation: () => Promise<WebAffairOperationResult<WebAffair>>,
  ): Promise<WebAffairOperationResult<WebAffair>> {
    return this.enqueue(async () => {
      const affair = this.findAffair(affairId)
      if (!affair || affair.workspaceId !== workspaceId) {
        return this.notFound('当前工作空间不存在该事务')
      }
      return operation()
    })
  }

  private unavailable<T>(): WebAffairOperationResult<T> {
    return { success: false, error: { code: 'SERVICE_UNAVAILABLE', message: '事务服务尚未就绪' } }
  }

  private invalid(message: string): WebAffairOperationResult<never> {
    return { success: false, error: { code: 'INVALID_INPUT', message } }
  }

  private resourceError(message: string): WebAffairOperationResult<never> {
    return { success: false, error: { code: 'INVALID_RESOURCE_REFERENCE', message } }
  }

  private transitionError(message: string): WebAffairOperationResult<never> {
    return { success: false, error: { code: 'INVALID_TRANSITION', message } }
  }

  private immutable(message: string): WebAffairOperationResult<never> {
    return { success: false, error: { code: 'IMMUTABLE_HISTORY', message } }
  }

  private notFound(message: string): WebAffairOperationResult<never> {
    return { success: false, error: { code: 'NOT_FOUND', message } }
  }

  private limit(message: string): WebAffairOperationResult<never> {
    return { success: false, error: { code: 'RESOURCE_LIMIT_REACHED', message } }
  }

  private assertIntegrity(snapshot: WebAffairSnapshot): void {
    for (const affair of snapshot.affairs) {
      const nodeIds = new Set(affair.flow.nodes.map((node) => node.id))
      const materialIds = new Set(affair.materials.map((material) => material.id))
      if (nodeIds.size !== affair.flow.nodes.length || materialIds.size !== affair.materials.length)
        throw new Error('事务流程存在重复资源 ID')
      for (const edge of affair.flow.edges) {
        if (!nodeIds.has(edge.fromNodeId) || !nodeIds.has(edge.toNodeId))
          throw new Error('事务流程存在失效节点引用')
        if (edge.fromNodeId === edge.toNodeId) throw new Error('事务流程不能包含自循环')
      }
      for (const node of affair.flow.nodes) {
        if (node.materialIds.some((id) => !materialIds.has(id)))
          throw new Error('事务流程存在失效材料引用')
      }
      if (affair.attempts.some((attempt) => !nodeIds.has(attempt.nodeId)))
        throw new Error('事务 Attempt 存在失效节点引用')
      if (affair.waitPlans.some((plan) => !nodeIds.has(plan.nodeId)))
        throw new Error('事务等待计划存在失效节点引用')
      if (this.hasCycle(affair.flow.nodes, affair.flow.edges))
        throw new Error('事务流程必须是有向无环图')
    }
  }
}
