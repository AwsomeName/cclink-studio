import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { WebResourceSnapshot } from '../../shared/web-resources/web-resource-types'
import { WebAffairService } from './web-affair-service'
import { WebAffairStore } from './web-affair-store'

const PRINCIPAL_ID = '11111111-1111-4111-8111-111111111111'
const WEBSITE_ID = '22222222-2222-4222-8222-222222222222'
const ACCOUNT_ID = '33333333-3333-4333-8333-333333333333'

describe('WebAffairService', () => {
  let directory: string
  let filePath: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'cclink-web-affair-'))
    filePath = join(directory, 'web-affairs.json')
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('creates a persistent linear DAG with explicit resource references', async () => {
    const service = createService(filePath)
    await service.load()
    const result = await service.createAffair(validInput())

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.flow.nodes).toHaveLength(3)
    expect(result.data.flow.edges).toHaveLength(2)
    expect(result.data.flow.nodes.map((node) => node.status)).toEqual([
      'ready',
      'blocked',
      'blocked',
    ])
    expect(result.data.websiteIds).toEqual([WEBSITE_ID])
    expect(result.data.materials[0].name).toBe('license.png')

    const reloaded = createService(filePath)
    await reloaded.load()
    expect(reloaded.getSnapshot()).toMatchObject({
      success: true,
      data: { revision: 1, affairs: [{ title: 'App 上架' }] },
    })
  })

  it('unlocks the next node and preserves completed-node history', async () => {
    const service = createService(filePath)
    await service.load()
    const created = await service.createAffair(validInput())
    if (!created.success) throw new Error(created.error.message)
    const firstNode = created.data.flow.nodes[0]

    const updated = await service.updateNode({
      affairId: created.data.id,
      nodeId: firstNode.id,
      status: 'completed',
      resultNote: '材料已经人工核对',
    })
    expect(updated).toMatchObject({
      success: true,
      data: {
        status: 'active',
        flow: { nodes: [{ status: 'completed' }, { status: 'ready' }, { status: 'blocked' }] },
      },
    })

    await expect(
      service.updateNode({
        affairId: created.data.id,
        nodeId: firstNode.id,
        status: 'ready',
      }),
    ).resolves.toMatchObject({
      success: false,
      error: { code: 'INVALID_TRANSITION' },
    })
  })

  it('rejects accounts that do not belong to the selected principal', async () => {
    const resources = resourceSnapshot()
    resources.accounts[0].principalId = '44444444-4444-4444-8444-444444444444'
    const service = new WebAffairService(() => resources, new WebAffairStore(filePath))
    await service.load()

    await expect(service.createAffair(validInput())).resolves.toMatchObject({
      success: false,
      error: { code: 'INVALID_RESOURCE_REFERENCE' },
    })
  })

  it('revises a mutable flow into a parallel DAG and locks completed history', async () => {
    const service = createService(filePath)
    await service.load()
    const created = await service.createAffair(validInput())
    if (!created.success) throw new Error(created.error.message)
    const [first, second, third] = created.data.flow.nodes
    const branchId = 'new:parallel-branch'

    const revised = await service.reviseFlow({
      affairId: created.data.id,
      expectedVersion: 1,
      nodes: [
        toRevision(first),
        toRevision(second),
        toRevision(third),
        {
          id: branchId,
          title: '并行核对账号权限',
          type: 'verification',
          executor: 'user',
          accountIds: [ACCOUNT_ID],
          materialIds: created.data.materials.map((item) => item.id),
          successCriteria: ['权限已核对'],
        },
      ],
      edges: [
        { fromNodeId: first.id, toNodeId: second.id },
        { fromNodeId: first.id, toNodeId: branchId },
        { fromNodeId: second.id, toNodeId: third.id },
        { fromNodeId: branchId, toNodeId: third.id },
      ],
    })
    expect(revised.success).toBe(true)
    if (!revised.success) return
    expect(revised.data.flow.version).toBe(2)
    expect(revised.data.flow.nodes.some((node) => node.title === '并行核对账号权限')).toBe(true)

    const completed = await service.updateNode({
      affairId: created.data.id,
      nodeId: first.id,
      status: 'completed',
      resultNote: '要求已确认',
    })
    if (!completed.success) throw new Error(completed.error.message)
    await expect(
      service.reviseFlow({
        affairId: created.data.id,
        expectedVersion: 2,
        nodes: completed.data.flow.nodes.filter((node) => node.id !== first.id).map(toRevision),
        edges: [],
      }),
    ).resolves.toMatchObject({ success: false, error: { code: 'IMMUTABLE_HISTORY' } })
  })

  it('detects changed and missing local materials instead of assuming they are usable', async () => {
    const materialPath = join(directory, 'license.png')
    await writeFile(materialPath, 'first')
    const service = createService(filePath)
    await service.load()
    const created = await service.createAffair({ ...validInput(), materialPaths: [materialPath] })
    if (!created.success) throw new Error(created.error.message)
    expect(created.data.materials[0].state).toBe('available')

    await writeFile(materialPath, 'changed-content')
    const changed = await service.inspectMaterials(created.data.id)
    expect(changed).toMatchObject({ success: true, data: { materials: [{ state: 'changed' }] } })

    await rm(materialPath)
    const missing = await service.inspectMaterials(created.data.id)
    expect(missing).toMatchObject({ success: true, data: { materials: [{ state: 'missing' }] } })
  })

  it('persists AI attempt correlation, handoff, re-observation and side-effect de-duplication', async () => {
    const materialPath = join(directory, 'license.png')
    await writeFile(materialPath, 'material')
    const service = createService(filePath)
    await service.load()
    const created = await service.createAffair({ ...validInput(), materialPaths: [materialPath] })
    if (!created.success) throw new Error(created.error.message)
    const node = created.data.flow.nodes[0]
    const started = await service.startAttempt({
      affairId: created.data.id,
      nodeId: node.id,
      accountId: ACCOUNT_ID,
    })
    if (!started.success) throw new Error(started.error.message)
    const attempt = started.data.attempts[0]
    const bound = await service.bindAttempt({
      affairId: created.data.id,
      attemptId: attempt.id,
      tabId: 'tab-affair',
      conversationId: 'conversation-affair',
      agentRunId: 'run-affair',
      browserTaskRunId: '55555555-5555-4555-8555-555555555555',
    })
    expect(bound).toMatchObject({ success: true, data: { attempts: [{ status: 'running-ai' }] } })
    const handed = await service.handoffAttempt({
      affairId: created.data.id,
      attemptId: attempt.id,
      reason: '需要验证码',
    })
    expect(handed).toMatchObject({ success: true, data: { status: 'needs-attention' } })
    const returned = await service.returnAttempt({
      affairId: created.data.id,
      attemptId: attempt.id,
      observationSummary: '验证码已完成，页面停留在预览页',
      url: 'https://appstoreconnect.apple.com/apps/preview',
    })
    expect(returned).toMatchObject({
      success: true,
      data: { attempts: [{ status: 'running-ai', evidence: [{ kind: 'observation' }] }] },
    })
    const confirmed = await service.confirmFinalAction({
      affairId: created.data.id,
      attemptId: attempt.id,
      summary: '确认提交当前表单',
    })
    if (!confirmed.success) throw new Error(confirmed.error.message)
    const failed = await service.finishAttempt({
      affairId: created.data.id,
      attemptId: attempt.id,
      outcome: 'failed',
      summary: '提交后页面超时',
    })
    if (!failed.success) throw new Error(failed.error.message)

    const retried = await service.startAttempt({
      affairId: created.data.id,
      nodeId: node.id,
      accountId: ACCOUNT_ID,
    })
    if (!retried.success) throw new Error(retried.error.message)
    const retry = retried.data.attempts[1]
    await service.bindAttempt({
      affairId: created.data.id,
      attemptId: retry.id,
      tabId: 'tab-retry',
      conversationId: 'conversation-retry',
      agentRunId: 'run-retry',
      browserTaskRunId: '66666666-6666-4666-8666-666666666666',
    })
    await expect(
      service.confirmFinalAction({
        affairId: created.data.id,
        attemptId: retry.id,
        summary: '再次提交',
      }),
    ).resolves.toMatchObject({ success: false, error: { code: 'CONFIRMATION_REQUIRED' } })
  })

  it('marks in-process attempts interrupted on restart instead of restoring a fake run', async () => {
    const materialPath = join(directory, 'license.png')
    await writeFile(materialPath, 'material')
    const service = createService(filePath)
    await service.load()
    const created = await service.createAffair({ ...validInput(), materialPaths: [materialPath] })
    if (!created.success) throw new Error(created.error.message)
    const started = await service.startAttempt({
      affairId: created.data.id,
      nodeId: created.data.flow.nodes[0].id,
      accountId: ACCOUNT_ID,
    })
    if (!started.success) throw new Error(started.error.message)
    await service.flush()

    const reloaded = createService(filePath)
    await reloaded.load()
    const snapshot = reloaded.getSnapshot()
    expect(snapshot.success).toBe(true)
    if (!snapshot.success) return
    expect(snapshot.data.affairs[0].status).toBe('needs-attention')
    expect(snapshot.data.affairs[0].attempts[0].status).toBe('interrupted')
    expect(snapshot.data.affairs[0].flow.nodes[0].status).toBe('waiting-human')
    await reloaded.flush()
  })

  it('persists missed external checks, bounded backoff and rejection correction nodes', async () => {
    const service = createService(filePath)
    await service.load()
    const created = await service.createAffair(validInput())
    if (!created.success) throw new Error(created.error.message)
    const first = created.data.flow.nodes[0]
    const completed = await service.updateNode({
      affairId: created.data.id,
      nodeId: first.id,
      status: 'completed',
      resultNote: '准备完成',
    })
    if (!completed.success) throw new Error(completed.error.message)
    const reviewNode = completed.data.flow.nodes[1]
    const scheduled = await service.scheduleCheck({
      affairId: created.data.id,
      nodeId: reviewNode.id,
      nextCheckAt: new Date(Date.now() - 60_000).toISOString(),
      intervalMinutes: 60,
      maxIntervalMinutes: 240,
      maxChecks: 3,
    })
    if (!scheduled.success) throw new Error(scheduled.error.message)
    await service.flush()

    const reloaded = createService(filePath)
    await reloaded.load()
    const snapshot = reloaded.getSnapshot()
    if (!snapshot.success) throw new Error(snapshot.error.message)
    expect(snapshot.data.affairs[0].waitPlans[0].status).toBe('missed')
    const unchanged = await reloaded.completeCheck({
      affairId: created.data.id,
      nodeId: reviewNode.id,
      outcome: 'unchanged',
      summary: '官网仍显示审核中',
    })
    expect(unchanged).toMatchObject({
      success: true,
      data: { waitPlans: [{ status: 'scheduled', checkCount: 1 }] },
    })
    const rejected = await reloaded.completeCheck({
      affairId: created.data.id,
      nodeId: reviewNode.id,
      outcome: 'rejected',
      summary: '官方要求补充主体证明',
    })
    expect(rejected.success).toBe(true)
    if (!rejected.success) return
    expect(rejected.data.flow.version).toBe(2)
    expect(
      rejected.data.flow.nodes.some(
        (node) => node.title.includes('驳回补正') && node.status === 'ready',
      ),
    ).toBe(true)
    await reloaded.flush()
  })

  it('stores an AI flow diff as a proposal and only applies it after user acceptance', async () => {
    const service = createService(filePath)
    await service.load()
    const created = await service.createAffair(validInput())
    if (!created.success) throw new Error(created.error.message)
    const proposed = await service.proposeFlowDiff({
      affairId: created.data.id,
      baseVersion: 1,
      reason: '实际网页要求先验证手机号',
      operations: [
        {
          kind: 'add-node',
          tempId: 'phone-check',
          title: '验证手机号',
          nodeType: 'human-task',
          executor: 'user',
        },
        { kind: 'add-edge', fromNodeId: created.data.flow.nodes[0].id, toNodeId: 'phone-check' },
      ],
      impacts: ['新增人工验证步骤'],
      proposedBy: 'ai',
    })
    expect(proposed).toMatchObject({
      success: true,
      data: {
        status: 'needs-attention',
        flow: { version: 1 },
        flowProposals: [{ status: 'pending' }],
      },
    })
    if (!proposed.success) return
    const accepted = await service.decideFlowProposal({
      affairId: created.data.id,
      proposalId: proposed.data.flowProposals[0].id,
      decision: 'accept',
    })
    expect(accepted.success).toBe(true)
    if (!accepted.success) return
    expect(accepted.data.flow.version).toBe(2)
    expect(accepted.data.flow.nodes.some((node) => node.title === '验证手机号')).toBe(true)
    expect(accepted.data.flowProposals[0].status).toBe('accepted')
  })
})

function createService(filePath: string): WebAffairService {
  return new WebAffairService(() => resourceSnapshot(), new WebAffairStore(filePath))
}

function validInput() {
  return {
    title: 'App 上架',
    objective: '提交审核并取得明确结果',
    principalId: PRINCIPAL_ID,
    accountIds: [ACCOUNT_ID],
    materialPaths: ['/tmp/license.png'],
    nodeTitles: ['准备材料', '提交审核', '等待结果'],
    workspaceRef: { kind: 'local' as const, path: '/tmp/workspace' },
  }
}

function resourceSnapshot(): WebResourceSnapshot {
  const now = new Date().toISOString()
  return {
    schemaVersion: 1,
    revision: 1,
    websites: [
      {
        id: WEBSITE_ID,
        name: 'App Store Connect',
        origin: 'https://appstoreconnect.apple.com',
        entryUrl: 'https://appstoreconnect.apple.com/apps',
        createdAt: now,
        updatedAt: now,
      },
    ],
    principals: [
      {
        id: PRINCIPAL_ID,
        kind: 'company',
        name: 'Example Ltd.',
        createdAt: now,
        updatedAt: now,
      },
    ],
    accounts: [
      {
        id: ACCOUNT_ID,
        websiteId: WEBSITE_ID,
        principalId: PRINCIPAL_ID,
        label: 'Release',
        browserProfileId: 'release',
        createdAt: now,
        updatedAt: now,
      },
    ],
  }
}

function toRevision(node: {
  id: string
  title: string
  description?: string
  type: 'web-task' | 'human-task' | 'wait-external' | 'verification'
  executor: 'ai' | 'user' | 'external'
  accountIds: string[]
  materialIds: string[]
  successCriteria: string[]
}) {
  return {
    id: node.id,
    title: node.title,
    description: node.description,
    type: node.type,
    executor: node.executor,
    accountIds: node.accountIds,
    materialIds: node.materialIds,
    successCriteria: node.successCriteria,
  }
}
