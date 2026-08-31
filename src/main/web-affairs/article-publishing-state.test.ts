import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ArticlePublishingSourcePreview } from '../../shared/article-publishing/article-publishing-types'
import type { WebResourceSnapshot } from '../../shared/web-resources/web-resource-types'
import { WebAffairService } from './web-affair-service'
import { WebAffairStore } from './web-affair-store'

const PRINCIPAL_ID = '11111111-1111-4111-8111-111111111111'
const WEBSITE_ID = '22222222-2222-4222-8222-222222222222'
const ACCOUNT_ID = '33333333-3333-4333-8333-333333333333'
const WORKSPACE_ID = '44444444-4444-4444-8444-444444444444'

describe('article publishing persistent state', () => {
  let directory = ''
  let sourcePath = ''
  let imagePath = ''

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'cclink-article-state-'))
    sourcePath = join(directory, 'article.md')
    imagePath = join(directory, 'image.png')
    await writeFile(sourcePath, '# Article\n\n![image](./image.png)')
    await writeFile(imagePath, 'image')
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('persists a saved draft and reloads it into project history', async () => {
    const created = await createDraftTask(directory, sourcePath, imagePath)
    await created.service.flush()

    const reloaded = createService(directory)
    await reloaded.load()
    const snapshot = reloaded.getProjectSnapshot(WORKSPACE_ID)
    expect(snapshot.success).toBe(true)
    if (!snapshot.success) return
    expect(snapshot.data.affairs).toHaveLength(1)
    expect(snapshot.data.affairs[0]).toMatchObject({
      id: created.affairId,
      kind: 'article-publishing',
      title: 'Article',
      articlePublishing: { execution: { status: 'draft' } },
    })
    await reloaded.flush()
  })

  it('persists one immutable platform draft identity across a cold service reload', async () => {
    const created = await createStartedTask(directory, sourcePath, imagePath)
    const before = created.service.getProjectSnapshot(WORKSPACE_ID)
    expect(before.success).toBe(true)
    if (!before.success) return
    const attempt = before.data.affairs[0].attempts[0]
    const draftUrl = 'https://mp.csdn.net/mp_blog/creation/editor/164148817'
    const recorded = await created.service.recordArticlePublishingDraftAnchor(
      created.affairId,
      created.attemptId,
      attempt.executionGeneration,
      attempt.launchOperationId,
      `${draftUrl}?from=runtime#body`,
      WORKSPACE_ID,
      '77777777-7777-4777-8777-777777777777',
    )
    expect(recorded.success).toBe(true)
    if (!recorded.success) return
    expect(recorded.data.articlePublishing?.draft?.url).toBe(draftUrl)

    const staleOwner = await created.service.recordArticlePublishingDraftAnchor(
      created.affairId,
      created.attemptId,
      attempt.executionGeneration,
      attempt.launchOperationId,
      draftUrl,
      WORKSPACE_ID,
      '88888888-8888-4888-8888-888888888888',
    )
    expect(staleOwner).toMatchObject({
      success: false,
      error: { code: 'INVALID_TRANSITION', message: expect.stringContaining('运行代次') },
    })

    const conflicting = await created.service.recordArticlePublishingDraftAnchor(
      created.affairId,
      created.attemptId,
      attempt.executionGeneration,
      attempt.launchOperationId,
      'https://mp.csdn.net/mp_blog/creation/editor/164148818',
      WORKSPACE_ID,
      '77777777-7777-4777-8777-777777777777',
    )
    expect(conflicting).toMatchObject({
      success: false,
      error: { code: 'INVALID_TRANSITION', message: expect.stringContaining('拒绝切换') },
    })
    await created.service.flush()

    const reloaded = createService(directory)
    await reloaded.load()
    const after = reloaded.getProjectSnapshot(WORKSPACE_ID)
    expect(after.success).toBe(true)
    if (!after.success) return
    expect(after.data.affairs[0].articlePublishing?.draft).toMatchObject({ url: draftUrl })
    await reloaded.flush()
  })

  it('requires waiting and verification evidence before an image becomes uploaded', async () => {
    const { service, affairId, attemptId, assetId } = await createStartedTask(
      directory,
      sourcePath,
      imagePath,
    )
    const workspaceRef = { kind: 'local' as const, path: directory }

    await expectStatus(
      service.reportArticlePublishingAsset(
        { workspaceRef, affairId, attemptId, assetId, status: 'uploading' },
        WORKSPACE_ID,
      ),
      'uploading',
    )
    await expectStatus(
      service.reportArticlePublishingAsset(
        {
          workspaceRef,
          affairId,
          attemptId,
          assetId,
          status: 'waiting-platform',
          evidence: '文件控件已接收',
        },
        WORKSPACE_ID,
      ),
      'waiting-platform',
    )
    await expectStatus(
      service.reportArticlePublishingAsset(
        {
          workspaceRef,
          affairId,
          attemptId,
          assetId,
          status: 'verifying',
          evidence: '编辑器出现新图片节点',
        },
        WORKSPACE_ID,
      ),
      'verifying',
    )
    const missingEvidence = await service.reportArticlePublishingAsset(
      {
        workspaceRef,
        affairId,
        attemptId,
        assetId,
        status: 'uploaded',
        platformUrl: 'https://img-blog.csdnimg.cn/example.png',
      },
      WORKSPACE_ID,
    )
    expect(missingEvidence).toMatchObject({
      success: false,
      error: { code: 'INVALID_TRANSITION' },
    })
    const uploaded = await service.reportArticlePublishingAsset(
      {
        workspaceRef,
        affairId,
        attemptId,
        assetId,
        status: 'uploaded',
        platformUrl: 'https://img-blog.csdnimg.cn/example.png',
        evidence: '重新读取编辑器确认平台 URL 和插入位置',
      },
      WORKSPACE_ID,
    )
    expect(uploaded.success).toBe(true)
    if (!uploaded.success) return
    expect(uploaded.data.articlePublishing?.assets[0]).toMatchObject({
      status: 'uploaded',
      platformUrl: 'https://img-blog.csdnimg.cn/example.png',
      uploadAttempts: [{ number: 1, status: 'succeeded' }],
    })
  })

  it('caps safe image upload attempts at three', async () => {
    const { service, affairId, attemptId, assetId } = await createStartedTask(
      directory,
      sourcePath,
      imagePath,
    )
    const workspaceRef = { kind: 'local' as const, path: directory }
    for (let number = 1; number <= 3; number += 1) {
      const started = await service.reportArticlePublishingAsset(
        { workspaceRef, affairId, attemptId, assetId, status: 'uploading' },
        WORKSPACE_ID,
      )
      expect(started.success).toBe(true)
      const failed = await service.reportArticlePublishingAsset(
        {
          workspaceRef,
          affairId,
          attemptId,
          assetId,
          status: 'retryable-failed',
          error: { code: 'UPLOAD_REJECTED', message: `第 ${number} 次失败` },
        },
        WORKSPACE_ID,
      )
      expect(failed.success).toBe(true)
    }
    const fourth = await service.reportArticlePublishingAsset(
      { workspaceRef, affairId, attemptId, assetId, status: 'uploading' },
      WORKSPACE_ID,
    )
    expect(fourth).toMatchObject({
      success: false,
      error: { code: 'INVALID_TRANSITION', message: expect.stringContaining('状态不能') },
    })
  })

  it('resumes the same interrupted Attempt and moves transient state to reconciliation', async () => {
    const created = await createStartedTask(directory, sourcePath, imagePath)
    const uploading = await created.service.reportArticlePublishingAsset(
      {
        workspaceRef: { kind: 'local', path: directory },
        affairId: created.affairId,
        attemptId: created.attemptId,
        assetId: created.assetId,
        status: 'uploading',
      },
      WORKSPACE_ID,
    )
    expect(uploading.success).toBe(true)
    await created.service.flush()

    const reloaded = new WebAffairService(
      () => resources(),
      new WebAffairStore(join(directory, 'affairs.json')),
      undefined,
      undefined,
      () => ({
        success: true,
        data: {
          webResourceRef: { accountId: ACCOUNT_ID },
          title: 'CSDN',
          entryUrl: 'https://editor.csdn.net/md/',
          browserProfileId: 'csdn-profile',
        },
      }),
    )
    await reloaded.load()
    const interrupted = reloaded.getProjectSnapshot(WORKSPACE_ID)
    expect(interrupted.success).toBe(true)
    if (!interrupted.success) return
    expect(interrupted.data.affairs[0].attempts[0]).toMatchObject({
      id: created.attemptId,
      status: 'interrupted',
    })
    expect(interrupted.data.affairs[0].articlePublishing?.assets[0].status).toBe('reconciling')

    const resumed = await reloaded.resumeArticlePublishingAttempt(
      created.affairId,
      created.attemptId,
      WORKSPACE_ID,
    )
    expect(resumed.success).toBe(true)
    if (!resumed.success) return
    expect(resumed.data.articlePublishing?.execution.currentAttemptId).toBe(created.attemptId)
    expect(resumed.data.articlePublishing?.assets[0].status).toBe('reconciling')
    expect(resumed.data.attempts).toHaveLength(1)
    expect(resumed.data.attempts[0]).toMatchObject({
      id: created.attemptId,
      status: 'preparing',
    })
    await reloaded.flush()
  })

  it('returns a waiting-human article task to the same Attempt for fresh observation', async () => {
    const created = await createStartedTask(directory, sourcePath, imagePath)
    const handedOff = await created.service.handoffAttempt(
      {
        workspaceRef: { kind: 'local', path: directory },
        affairId: created.affairId,
        attemptId: created.attemptId,
        reason: '需要用户处理验证码',
      },
      WORKSPACE_ID,
    )
    expect(handedOff.success).toBe(true)
    if (!handedOff.success) return
    expect(handedOff.data.articlePublishing?.execution.status).toBe('waiting-human')
    expect(handedOff.data.attempts[0].status).toBe('waiting-human')

    const resumed = await created.service.resumeArticlePublishingAfterHandoff(
      created.affairId,
      created.attemptId,
      WORKSPACE_ID,
    )
    expect(resumed.success).toBe(true)
    if (!resumed.success) return
    expect(resumed.data.attempts).toHaveLength(1)
    expect(resumed.data.attempts[0]).toMatchObject({
      id: created.attemptId,
      status: 'preparing',
    })
    expect(resumed.data.articlePublishing?.execution).toMatchObject({
      status: 'preparing',
      currentAttemptId: created.attemptId,
    })
    expect(resumed.data.articlePublishing?.checkpoints[0].status).toBe('needs-reconcile')
  })

  it('keeps the same Attempt retryable when Agent launch fails', async () => {
    const created = await createDraftTask(directory, sourcePath, imagePath)
    const started = await created.service.startAttempt(
      {
        workspaceRef: { kind: 'local', path: directory },
        affairId: created.affairId,
        nodeId: created.nodeId,
        accountId: ACCOUNT_ID,
      },
      WORKSPACE_ID,
    )
    expect(started.success).toBe(true)
    if (!started.success) return
    const attemptId = started.data.attempts[0].id
    const marked = await created.service.markArticlePublishingAttemptStarted(
      created.affairId,
      attemptId,
      WORKSPACE_ID,
    )
    expect(marked.success).toBe(true)

    const recovered = await created.service.interruptArticlePublishingLaunch(
      created.affairId,
      attemptId,
      '发送 Agent 任务：runtime offline',
      WORKSPACE_ID,
    )
    expect(recovered.success).toBe(true)
    if (!recovered.success) return
    expect(recovered.data.articlePublishing?.execution.status).toBe('interrupted')
    expect(recovered.data.articlePublishing?.checkpoints[0].status).toBe('pending')
    expect(recovered.data.attempts).toHaveLength(1)
    expect(recovered.data.attempts[0]).toMatchObject({
      id: attemptId,
      status: 'interrupted',
      failureMessage: '发送 Agent 任务：runtime offline',
    })

    const resumed = await created.service.resumeArticlePublishingAttempt(
      created.affairId,
      attemptId,
      WORKSPACE_ID,
    )
    expect(resumed.success).toBe(true)
    if (!resumed.success) return
    expect(resumed.data.attempts).toHaveLength(1)
    expect(resumed.data.attempts[0]).toMatchObject({ id: attemptId, status: 'preparing' })
  })

  it('interrupts a live publishing Attempt when its Agent or BrowserTask ends', async () => {
    const created = await createStartedTask(directory, sourcePath, imagePath)

    const interrupted = await created.service.interruptArticlePublishingRuntime(
      created.affairId,
      created.attemptId,
      'automation unavailable',
      WORKSPACE_ID,
    )

    expect(interrupted.success).toBe(true)
    if (!interrupted.success) return
    expect(interrupted.data.articlePublishing?.execution.status).toBe('interrupted')
    expect(interrupted.data.articlePublishing?.checkpoints[0].status).toBe('needs-reconcile')
    expect(interrupted.data.attempts[0]).toMatchObject({
      id: created.attemptId,
      status: 'interrupted',
      failureMessage: 'automation unavailable',
    })

    await expect(
      created.service.interruptArticlePublishingRuntime(
        created.affairId,
        created.attemptId,
        'late duplicate terminal event',
        WORKSPACE_ID,
      ),
    ).resolves.toMatchObject({ success: true })
  })

  it('records the publication side effect before a final click can be dispatched', async () => {
    const created = await createStartedTask(directory, sourcePath, imagePath)
    const workspaceRef = { kind: 'local' as const, path: directory }
    for (const update of [
      { status: 'uploading' as const },
      { status: 'waiting-platform' as const, evidence: 'file accepted' },
      { status: 'verifying' as const, evidence: 'editor node visible' },
      {
        status: 'uploaded' as const,
        platformUrl: 'https://img-blog.csdnimg.cn/published.png',
        evidence: 'platform URL verified',
      },
    ]) {
      const updated = await created.service.reportArticlePublishingAsset(
        {
          workspaceRef,
          affairId: created.affairId,
          attemptId: created.attemptId,
          assetId: created.assetId,
          ...update,
        },
        WORKSPACE_ID,
      )
      expect(updated.success).toBe(true)
    }
    const snapshot = created.service.getProjectSnapshot(WORKSPACE_ID)
    expect(snapshot.success).toBe(true)
    if (!snapshot.success) return
    const affair = snapshot.data.affairs[0]
    for (const checkpoint of affair.articlePublishing?.checkpoints ?? []) {
      if (checkpoint.stepId === 'publish') break
      const completed = await created.service.reportArticlePublishingCheckpoint(
        {
          workspaceRef,
          affairId: created.affairId,
          attemptId: created.attemptId,
          stepId: checkpoint.stepId,
          status: 'completed',
          evidence: `${checkpoint.stepId} verified`,
        },
        WORKSPACE_ID,
      )
      expect(completed.success).toBe(true)
    }

    const current = created.service.getProjectSnapshot(WORKSPACE_ID)
    expect(current.success).toBe(true)
    if (!current.success) return
    const attempt = current.data.affairs[0].attempts[0]
    const fingerprint = 'publish-fingerprint'
    const browserTaskRunId = '77777777-7777-4777-8777-777777777777'
    const reserved = await created.service.reserveArticlePublishingSideEffect(
      created.affairId,
      created.attemptId,
      attempt.executionGeneration,
      'publish',
      'final',
      fingerprint,
      browserTaskRunId,
      WORKSPACE_ID,
    )
    expect(reserved.success).toBe(true)
    const sideEffectKey = `${created.affairId}:${created.attemptId}:g${attempt.executionGeneration}:publish:final`
    const consumed = await created.service.consumeArticlePublishingSideEffect(
      created.affairId,
      created.attemptId,
      attempt.executionGeneration,
      sideEffectKey,
      fingerprint,
      browserTaskRunId,
      WORKSPACE_ID,
    )
    expect(consumed.success).toBe(true)
    if (!consumed.success) return
    expect(consumed.data.articlePublishing?.publication.status).toBe('dispatched')

    const duplicate = await created.service.consumeArticlePublishingSideEffect(
      created.affairId,
      created.attemptId,
      attempt.executionGeneration,
      sideEffectKey,
      fingerprint,
      browserTaskRunId,
      WORKSPACE_ID,
    )
    expect(duplicate).toMatchObject({ success: false, error: { code: 'INVALID_TRANSITION' } })
  })

  it('consumes a persisted side-effect capability exactly once across restart', async () => {
    const created = await createStartedTask(directory, sourcePath, imagePath)
    const snapshot = created.service.getProjectSnapshot(WORKSPACE_ID)
    expect(snapshot.success).toBe(true)
    if (!snapshot.success) return
    const attempt = snapshot.data.affairs[0].attempts[0]
    const browserTaskRunId = '77777777-7777-4777-8777-777777777777'
    const fingerprint = 'fingerprint-save-draft'
    const reserved = await created.service.reserveArticlePublishingSideEffect(
      created.affairId,
      created.attemptId,
      attempt.executionGeneration,
      'save-draft',
      'source-a',
      fingerprint,
      browserTaskRunId,
      WORKSPACE_ID,
    )
    expect(reserved.success).toBe(true)
    const sideEffectKey = `${created.affairId}:${created.attemptId}:g${attempt.executionGeneration}:save-draft:source-a`
    const consumed = await created.service.consumeArticlePublishingSideEffect(
      created.affairId,
      created.attemptId,
      attempt.executionGeneration,
      sideEffectKey,
      fingerprint,
      browserTaskRunId,
      WORKSPACE_ID,
    )
    expect(consumed.success).toBe(true)
    if (!consumed.success) return
    expect(consumed.data.articlePublishing?.sideEffects[0].status).toBe('dispatched')
    await created.service.flush()

    const reloaded = createService(directory)
    await reloaded.load()
    const duplicate = await reloaded.consumeArticlePublishingSideEffect(
      created.affairId,
      created.attemptId,
      attempt.executionGeneration,
      sideEffectKey,
      fingerprint,
      browserTaskRunId,
      WORKSPACE_ID,
    )
    expect(duplicate).toMatchObject({ success: false, error: { code: 'INVALID_TRANSITION' } })
  })

  it('ignores stale owner identities and old execution generations', async () => {
    const created = await createDraftTask(directory, sourcePath, imagePath)
    const started = await created.service.startAttempt(
      {
        workspaceRef: { kind: 'local', path: directory },
        affairId: created.affairId,
        nodeId: created.nodeId,
        accountId: ACCOUNT_ID,
      },
      WORKSPACE_ID,
    )
    expect(started.success).toBe(true)
    if (!started.success) return
    const attempt = started.data.attempts[0]
    const now = new Date().toISOString()
    const browserTaskRunId = '77777777-7777-4777-8777-777777777777'
    const bound = await created.service.bindArticlePublishingRuntime(
      created.affairId,
      attempt.id,
      attempt.executionGeneration,
      attempt.launchOperationId,
      [
        {
          id: '88888888-8888-4888-8888-888888888881',
          kind: 'agent-run',
          attemptId: attempt.id,
          executionGeneration: attempt.executionGeneration,
          launchOperationId: attempt.launchOperationId,
          status: 'active',
          boundAt: now,
          lastObservedAt: now,
          conversationId: 'conversation-a',
          agentRunId: 'run-a',
          agentRuntimeEpoch: 10,
          agentRuntimeBindingKey: 'runtime-a',
        },
        {
          id: '88888888-8888-4888-8888-888888888882',
          kind: 'browser-tab',
          attemptId: attempt.id,
          executionGeneration: attempt.executionGeneration,
          launchOperationId: attempt.launchOperationId,
          status: 'active',
          boundAt: now,
          lastObservedAt: now,
          tabId: 'tab-a',
          browserViewRuntimeGeneration: 2,
          webContentsId: 20,
        },
        {
          id: '88888888-8888-4888-8888-888888888883',
          kind: 'browser-task',
          attemptId: attempt.id,
          executionGeneration: attempt.executionGeneration,
          launchOperationId: attempt.launchOperationId,
          status: 'active',
          boundAt: now,
          lastObservedAt: now,
          browserTaskRunId,
          tabId: 'tab-a',
          browserViewRuntimeGeneration: 2,
          webContentsId: 20,
          playwrightConnectionGeneration: 3,
          playwrightPageBindingGeneration: 4,
        },
      ],
      WORKSPACE_ID,
    )
    expect(bound.success).toBe(true)

    const rebound = await created.service.rebindArticlePublishingBrowserRuntime({
      workspaceId: WORKSPACE_ID,
      affairId: created.affairId,
      attemptId: attempt.id,
      executionGeneration: attempt.executionGeneration,
      launchOperationId: attempt.launchOperationId,
      browserTaskRunId,
      tabId: 'tab-a',
      browserViewRuntimeGeneration: 2,
      webContentsId: 20,
      previousPlaywrightConnectionGeneration: 3,
      previousPlaywrightPageBindingGeneration: 4,
      playwrightConnectionGeneration: 4,
      playwrightPageBindingGeneration: 5,
    })
    expect(rebound.success).toBe(true)
    if (!rebound.success) return
    expect(
      rebound.data.attempts[0].runtimeBindings.filter(
        (binding) => binding.kind === 'browser-task' && binding.status === 'active',
      ),
    ).toEqual([
      expect.objectContaining({
        browserTaskRunId,
        playwrightConnectionGeneration: 4,
        playwrightPageBindingGeneration: 5,
      }),
    ])
    expect(
      rebound.data.attempts[0].runtimeBindings.find(
        (binding) =>
          binding.kind === 'browser-task' && binding.playwrightConnectionGeneration === 3,
      ),
    ).toMatchObject({ status: 'lost' })

    await expect(
      created.service.rebindArticlePublishingBrowserRuntime({
        workspaceId: WORKSPACE_ID,
        affairId: created.affairId,
        attemptId: attempt.id,
        executionGeneration: attempt.executionGeneration,
        launchOperationId: attempt.launchOperationId,
        browserTaskRunId,
        tabId: 'tab-a',
        browserViewRuntimeGeneration: 2,
        webContentsId: 20,
        previousPlaywrightConnectionGeneration: 3,
        previousPlaywrightPageBindingGeneration: 4,
        playwrightConnectionGeneration: 4,
        playwrightPageBindingGeneration: 5,
      }),
    ).resolves.toMatchObject({ success: true })

    const wrongOwner = await created.service.reconcileArticlePublishingRuntime({
      eventId: 'wrong-owner',
      workspaceId: WORKSPACE_ID,
      affairId: created.affairId,
      attemptId: attempt.id,
      executionGeneration: attempt.executionGeneration,
      launchOperationId: attempt.launchOperationId,
      source: 'agent-terminal',
      observedAt: now,
      runtimeIdentity: {
        kind: 'agent-run',
        conversationId: 'conversation-a',
        agentRunId: 'run-a',
        agentRuntimeEpoch: 9,
        agentRuntimeBindingKey: 'runtime-a',
      },
      reasonCode: 'OLD_OWNER',
      reason: 'late event',
    })
    expect(wrongOwner.success && wrongOwner.data.articlePublishing?.execution.status).toBe(
      'running',
    )

    const interrupted = await created.service.reconcileArticlePublishingRuntime({
      eventId: 'user-owner-check',
      workspaceId: WORKSPACE_ID,
      affairId: created.affairId,
      attemptId: attempt.id,
      executionGeneration: attempt.executionGeneration,
      launchOperationId: attempt.launchOperationId,
      source: 'user-check',
      observedAt: now,
      observedStatus: 'owner-lost',
      reasonCode: 'OWNER_LOST',
      reason: 'owner missing',
    })
    expect(interrupted.success).toBe(true)
    if (!interrupted.success) return
    expect(interrupted.data.articlePublishing?.execution.status).toBe('interrupted')
    const resumed = await created.service.resumeArticlePublishingAttempt(
      created.affairId,
      attempt.id,
      WORKSPACE_ID,
    )
    expect(resumed.success).toBe(true)
    if (!resumed.success) return
    expect(resumed.data.attempts[0].executionGeneration).toBe(attempt.executionGeneration + 1)

    const lateOldGeneration = await created.service.reconcileArticlePublishingRuntime({
      eventId: 'late-old-generation',
      workspaceId: WORKSPACE_ID,
      affairId: created.affairId,
      attemptId: attempt.id,
      executionGeneration: attempt.executionGeneration,
      launchOperationId: attempt.launchOperationId,
      source: 'agent-terminal',
      observedAt: now,
      runtimeIdentity: {
        kind: 'agent-run',
        conversationId: 'conversation-a',
        agentRunId: 'run-a',
        agentRuntimeEpoch: 10,
        agentRuntimeBindingKey: 'runtime-a',
      },
      reasonCode: 'LATE_OLD_RUN',
      reason: 'late event',
    })
    expect(lateOldGeneration.success).toBe(true)
    if (!lateOldGeneration.success) return
    expect(lateOldGeneration.data.articlePublishing?.execution.status).toBe('preparing')
  })

  it('repairs a terminal Attempt that was persisted with a running execution projection', async () => {
    const created = await createStartedTask(directory, sourcePath, imagePath)
    await created.service.flush()
    const filePath = join(directory, 'affairs.json')
    const persisted = JSON.parse(await readFile(filePath, 'utf8'))
    const affair = persisted.affairs[0]
    affair.attempts[0].status = 'cancelled'
    affair.attempts[0].endedAt = new Date().toISOString()
    affair.articlePublishing.execution.status = 'running'
    await writeFile(filePath, JSON.stringify(persisted))

    const reloaded = createService(directory)
    await reloaded.load()
    const snapshot = reloaded.getProjectSnapshot(WORKSPACE_ID)
    expect(snapshot.success).toBe(true)
    if (!snapshot.success) return
    expect(snapshot.data.affairs[0].attempts[0].status).toBe('cancelled')
    expect(snapshot.data.affairs[0].articlePublishing?.execution.status).toBe('cancelled')
    expect(snapshot.data.affairs[0].flow.nodes[0].status).toBe('cancelled')
  })

  it('repairs a dispatched final action to result-unknown instead of allowing a retry', async () => {
    const created = await createStartedTask(directory, sourcePath, imagePath)
    await created.service.flush()
    const filePath = join(directory, 'affairs.json')
    const persisted = JSON.parse(await readFile(filePath, 'utf8'))
    const affair = persisted.affairs[0]
    const attempt = affair.attempts[0]
    const now = new Date().toISOString()
    attempt.status = 'cancelled'
    attempt.endedAt = now
    affair.articlePublishing.execution.status = 'cancelled'
    affair.articlePublishing.publication = { status: 'dispatched', observedAt: now }
    affair.articlePublishing.sideEffects.push({
      key: `${affair.id}:${attempt.id}:g${attempt.executionGeneration}:publish:final`,
      affairId: affair.id,
      attemptId: attempt.id,
      executionGeneration: attempt.executionGeneration,
      kind: 'publish',
      targetId: 'final',
      actionFingerprint: 'publish-fingerprint',
      status: 'dispatched',
      reservedAt: now,
      dispatchedAt: now,
      browserTaskRunId: attempt.browserTaskRunId,
    })
    await writeFile(filePath, JSON.stringify(persisted))

    const reloaded = createService(directory)
    await reloaded.load()
    const snapshot = reloaded.getProjectSnapshot(WORKSPACE_ID)
    expect(snapshot.success).toBe(true)
    if (!snapshot.success) return
    const repaired = snapshot.data.affairs[0]
    expect(repaired.attempts[0].status).toBe('interrupted')
    expect(repaired.articlePublishing?.execution.status).toBe('result-unknown')
    expect(repaired.articlePublishing?.publication.status).toBe('result-unknown')
    expect(repaired.articlePublishing?.sideEffects.at(-1)?.status).toBe('result-unknown')

    const verification = await reloaded.resumeArticlePublishingAttempt(
      repaired.id,
      repaired.attempts[0].id,
      WORKSPACE_ID,
    )
    expect(verification.success).toBe(true)
    if (!verification.success) return
    expect(verification.data.articlePublishing?.execution).toMatchObject({
      status: 'preparing',
      currentStepId: 'verify-publication',
    })
    expect(verification.data.articlePublishing?.publication.status).toBe('result-unknown')
    const marked = await reloaded.markArticlePublishingAttemptStarted(
      repaired.id,
      repaired.attempts[0].id,
      WORKSPACE_ID,
    )
    expect(marked.success).toBe(true)
    if (!marked.success) return
    expect(marked.data.articlePublishing?.execution.currentStepId).toBe('verify-publication')
  })

  it('keeps a non-final unknown upload on its incomplete checkpoint instead of skipping to publication verification', async () => {
    const created = await createStartedTask(directory, sourcePath, imagePath)
    const workspaceRef = { kind: 'local' as const, path: directory }
    const uploading = await created.service.reportArticlePublishingAsset(
      {
        workspaceRef,
        affairId: created.affairId,
        attemptId: created.attemptId,
        assetId: created.assetId,
        status: 'uploading',
      },
      WORKSPACE_ID,
    )
    expect(uploading.success).toBe(true)
    const unknown = await created.service.reportArticlePublishingAsset(
      {
        workspaceRef,
        affairId: created.affairId,
        attemptId: created.attemptId,
        assetId: created.assetId,
        status: 'result-unknown',
        error: { code: 'CDP_DISCONNECTED', message: '上传派发后 CDP 断开' },
      },
      WORKSPACE_ID,
    )
    expect(unknown.success).toBe(true)
    if (!unknown.success) return
    expect(unknown.data.articlePublishing?.execution.status).toBe('result-unknown')
    expect(unknown.data.articlePublishing?.publication.status).toBe('not-started')

    const resumed = await created.service.resumeArticlePublishingAttempt(
      created.affairId,
      created.attemptId,
      WORKSPACE_ID,
    )
    expect(resumed.success).toBe(true)
    if (!resumed.success) return
    expect(resumed.data.articlePublishing?.execution.currentStepId).not.toBe('verify-publication')
    expect(resumed.data.articlePublishing?.publication.status).toBe('not-started')
  })

  it('repairs v0.1.73 data that mislabeled a non-final unknown action as publication unknown', async () => {
    const created = await createStartedTask(directory, sourcePath, imagePath)
    const workspaceRef = { kind: 'local' as const, path: directory }
    await created.service.reportArticlePublishingAsset(
      {
        workspaceRef,
        affairId: created.affairId,
        attemptId: created.attemptId,
        assetId: created.assetId,
        status: 'uploading',
      },
      WORKSPACE_ID,
    )
    const unknown = await created.service.reportArticlePublishingAsset(
      {
        workspaceRef,
        affairId: created.affairId,
        attemptId: created.attemptId,
        assetId: created.assetId,
        status: 'result-unknown',
        error: { code: 'CDP_DISCONNECTED', message: '上传派发后 CDP 断开' },
      },
      WORKSPACE_ID,
    )
    expect(unknown.success).toBe(true)
    await created.service.flush()

    const filePath = join(directory, 'affairs.json')
    const persisted = JSON.parse(await readFile(filePath, 'utf8'))
    const affair = persisted.affairs[0]
    const attempt = affair.attempts[0]
    const now = new Date().toISOString()
    affair.articlePublishing.execution.currentStepId = 'upload-assets'
    affair.articlePublishing.publication = { status: 'result-unknown', observedAt: now }
    affair.articlePublishing.sideEffects.push({
      key: `${affair.id}:${attempt.id}:g${attempt.executionGeneration}:upload-asset:legacy`,
      affairId: affair.id,
      attemptId: attempt.id,
      executionGeneration: attempt.executionGeneration,
      kind: 'upload-asset',
      targetId: `${created.assetId}:attempt-1`,
      actionFingerprint: 'legacy-upload-fingerprint',
      status: 'result-unknown',
      reservedAt: now,
      dispatchedAt: now,
      observedAt: now,
      browserTaskRunId: attempt.browserTaskRunId,
    })
    await writeFile(filePath, JSON.stringify(persisted))

    const reloaded = createService(directory)
    await reloaded.load()
    const snapshot = reloaded.getProjectSnapshot(WORKSPACE_ID)
    expect(snapshot.success).toBe(true)
    if (!snapshot.success) return
    const repaired = snapshot.data.affairs[0]
    expect(repaired.articlePublishing?.execution.status).toBe('result-unknown')
    expect(repaired.articlePublishing?.publication.status).toBe('not-started')
    expect(repaired.events.at(-1)?.summary).toContain('误标为最终发布未知')
  })

  it('repairs the v0.1.74 startup crash when legacy normalization exposes a lifecycle mismatch', async () => {
    const created = await createStartedTask(directory, sourcePath, imagePath)
    const workspaceRef = { kind: 'local' as const, path: directory }
    await created.service.reportArticlePublishingAsset(
      {
        workspaceRef,
        affairId: created.affairId,
        attemptId: created.attemptId,
        assetId: created.assetId,
        status: 'uploading',
      },
      WORKSPACE_ID,
    )
    await created.service.reportArticlePublishingAsset(
      {
        workspaceRef,
        affairId: created.affairId,
        attemptId: created.attemptId,
        assetId: created.assetId,
        status: 'result-unknown',
        error: { code: 'CDP_DISCONNECTED', message: '上传派发后 CDP 断开' },
      },
      WORKSPACE_ID,
    )
    await created.service.flush()

    const filePath = join(directory, 'affairs.json')
    const persisted = JSON.parse(await readFile(filePath, 'utf8'))
    const affair = persisted.affairs[0]
    const attempt = affair.attempts[0]
    const now = new Date().toISOString()
    attempt.status = 'waiting-human'
    affair.articlePublishing.execution.currentStepId = 'upload-assets'
    affair.articlePublishing.publication = { status: 'result-unknown', observedAt: now }
    affair.articlePublishing.sideEffects.push({
      key: `${affair.id}:${attempt.id}:g${attempt.executionGeneration}:upload-asset:v0174`,
      affairId: affair.id,
      attemptId: attempt.id,
      executionGeneration: attempt.executionGeneration,
      kind: 'upload-asset',
      targetId: `${created.assetId}:v0174`,
      actionFingerprint: 'v0174-upload-fingerprint',
      status: 'result-unknown',
      reservedAt: now,
      dispatchedAt: now,
      observedAt: now,
      browserTaskRunId: attempt.browserTaskRunId,
    })
    await writeFile(filePath, JSON.stringify(persisted))

    const reloaded = createService(directory)
    await expect(reloaded.load()).resolves.toBeUndefined()
    const snapshot = reloaded.getProjectSnapshot(WORKSPACE_ID)
    expect(snapshot.success).toBe(true)
    if (!snapshot.success) return
    const repaired = snapshot.data.affairs[0]
    expect(repaired.attempts[0].status).toBe('waiting-human')
    expect(repaired.articlePublishing?.execution.status).toBe('waiting-human')
    expect(repaired.articlePublishing?.publication.status).toBe('not-started')
    const repairedRevision = snapshot.data.revision
    await reloaded.flush()

    const secondLoad = createService(directory)
    await expect(secondLoad.load()).resolves.toBeUndefined()
    const stable = secondLoad.getProjectSnapshot(WORKSPACE_ID)
    expect(stable.success).toBe(true)
    if (!stable.success) return
    expect(stable.data.revision).toBe(repairedRevision)
    expect(stable.data.affairs[0].articlePublishing?.execution.status).toBe('waiting-human')
    await secondLoad.flush()
  })

  it('converges every persisted terminal or handoff lifecycle mismatch before strict validation', async () => {
    const created = await createStartedTask(directory, sourcePath, imagePath)
    await created.service.flush()
    const persisted = JSON.parse(await readFile(join(directory, 'affairs.json'), 'utf8'))
    const executionStatuses = [
      'draft',
      'preparing',
      'running',
      'checking-runtime',
      'waiting-human',
      'interrupted',
      'cancelled',
      'failed',
      'published',
      'result-unknown',
    ] as const
    const projections = [
      { attempt: 'waiting-human', allowed: ['waiting-human'], expected: 'waiting-human' },
      {
        attempt: 'interrupted',
        allowed: ['interrupted', 'result-unknown'],
        expected: 'interrupted',
      },
      { attempt: 'cancelled', allowed: ['cancelled'], expected: 'cancelled' },
      { attempt: 'failed', allowed: ['failed'], expected: 'failed' },
      { attempt: 'succeeded', allowed: ['published'], expected: 'published' },
    ] as const

    let caseNumber = 0
    for (const projection of projections) {
      for (const executionStatus of executionStatuses) {
        if ((projection.allowed as readonly string[]).includes(executionStatus)) continue
        caseNumber += 1
        const caseDirectory = join(directory, `projection-${caseNumber}`)
        await mkdir(caseDirectory)
        const candidate = structuredClone(persisted)
        const affair = candidate.affairs[0]
        affair.attempts[0].status = projection.attempt
        affair.articlePublishing.execution.status = executionStatus
        await writeFile(join(caseDirectory, 'affairs.json'), JSON.stringify(candidate))

        const reloaded = createService(caseDirectory)
        await expect(reloaded.load()).resolves.toBeUndefined()
        const snapshot = reloaded.getProjectSnapshot(WORKSPACE_ID)
        expect(snapshot.success).toBe(true)
        if (!snapshot.success) continue
        expect(snapshot.data.affairs[0].attempts[0].status).toBe(projection.attempt)
        expect(snapshot.data.affairs[0].articlePublishing?.execution.status).toBe(
          projection.expected,
        )
        await reloaded.flush()
      }
    }
  })

  it('preserves publication unknown when legacy evidence does not prove it came from a non-final action', async () => {
    const created = await createStartedTask(directory, sourcePath, imagePath)
    const workspaceRef = { kind: 'local' as const, path: directory }
    await created.service.reportArticlePublishingAsset(
      {
        workspaceRef,
        affairId: created.affairId,
        attemptId: created.attemptId,
        assetId: created.assetId,
        status: 'uploading',
      },
      WORKSPACE_ID,
    )
    await created.service.reportArticlePublishingAsset(
      {
        workspaceRef,
        affairId: created.affairId,
        attemptId: created.attemptId,
        assetId: created.assetId,
        status: 'result-unknown',
        error: { code: 'CDP_DISCONNECTED', message: '上传派发后 CDP 断开' },
      },
      WORKSPACE_ID,
    )
    await created.service.flush()

    const filePath = join(directory, 'affairs.json')
    const persisted = JSON.parse(await readFile(filePath, 'utf8'))
    const affair = persisted.affairs[0]
    const attempt = affair.attempts[0]
    const publicationObservedAt = new Date().toISOString()
    const nonFinalObservedAt = new Date(Date.parse(publicationObservedAt) - 1_000).toISOString()
    affair.articlePublishing.execution.currentStepId = 'save-draft'
    affair.articlePublishing.publication = {
      status: 'result-unknown',
      observedAt: publicationObservedAt,
    }
    affair.articlePublishing.sideEffects.push({
      key: `${affair.id}:${attempt.id}:g${attempt.executionGeneration}:save-draft:legacy`,
      affairId: affair.id,
      attemptId: attempt.id,
      executionGeneration: attempt.executionGeneration,
      kind: 'save-draft',
      targetId: 'legacy-draft',
      actionFingerprint: 'legacy-draft-fingerprint',
      status: 'result-unknown',
      reservedAt: nonFinalObservedAt,
      dispatchedAt: nonFinalObservedAt,
      observedAt: nonFinalObservedAt,
      browserTaskRunId: attempt.browserTaskRunId,
    })
    await writeFile(filePath, JSON.stringify(persisted))

    const reloaded = createService(directory)
    await reloaded.load()
    const snapshot = reloaded.getProjectSnapshot(WORKSPACE_ID)
    expect(snapshot.success).toBe(true)
    if (!snapshot.success) return
    expect(snapshot.data.affairs[0].articlePublishing?.publication.status).toBe('result-unknown')
  })

  it('still persists startup convergence when an affair already has 2,000 events', async () => {
    const created = await createStartedTask(directory, sourcePath, imagePath)
    await created.service.flush()
    const filePath = join(directory, 'affairs.json')
    const persisted = JSON.parse(await readFile(filePath, 'utf8'))
    const now = new Date().toISOString()
    persisted.affairs[0].events = Array.from({ length: 2_000 }, (_, index) => ({
      id: randomUUID(),
      type: 'node-status-changed',
      summary: `diagnostic-${index}`,
      occurredAt: now,
    }))
    await writeFile(filePath, JSON.stringify(persisted))

    const reloaded = createService(directory)
    await reloaded.load()
    const snapshot = reloaded.getProjectSnapshot(WORKSPACE_ID)
    expect(snapshot.success).toBe(true)
    if (!snapshot.success) return
    expect(snapshot.data.affairs[0].articlePublishing?.execution.status).toBe('interrupted')
    expect(snapshot.data.affairs[0].events).toHaveLength(2_000)
    expect(snapshot.data.affairs[0].events[0].summary).toContain('已压缩')
  })

  it('compacts oversized diagnostic history below the write high-water mark', async () => {
    const created = await createDraftTask(directory, sourcePath, imagePath)
    await created.service.flush()
    const filePath = join(directory, 'affairs.json')
    const persisted = JSON.parse(await readFile(filePath, 'utf8'))
    const now = new Date().toISOString()
    const events = Array.from({ length: 2_000 }, () => ({
      id: randomUUID(),
      type: 'node-status-changed',
      summary: 'x'.repeat(2_000),
      occurredAt: now,
    }))
    persisted.revision += 1
    persisted.affairs = [
      { ...persisted.affairs[0], id: randomUUID(), events },
      { ...persisted.affairs[0], id: randomUUID(), events },
    ]

    const saved = await new WebAffairStore(filePath).save(persisted)
    expect(saved.affairs.every((affair) => affair.events.length <= 500)).toBe(true)
    expect((await stat(filePath)).size).toBeLessThan(7 * 1024 * 1024)
  })

  it('replays a newer fixed recovery journal exactly once', async () => {
    const created = await createDraftTask(directory, sourcePath, imagePath)
    await created.service.flush()
    const filePath = join(directory, 'affairs.json')
    const store = new WebAffairStore(filePath)
    const primary = JSON.parse(await readFile(filePath, 'utf8'))
    const recovery = structuredClone(primary)
    recovery.revision += 1
    recovery.affairs[0].title = 'Recovered Article'
    await writeFile(
      store.recoveryPath,
      JSON.stringify({
        journalVersion: 1,
        baseRevision: primary.revision,
        targetRevision: recovery.revision,
        targetHash: createHash('sha256')
          .update(JSON.stringify({ revision: recovery.revision, affairs: recovery.affairs }))
          .digest('hex'),
        affairs: recovery.affairs,
      }),
    )

    const recovered = await store.load()
    expect(recovered.revision).toBe(recovery.revision)
    expect(recovered.affairs[0].title).toBe('Recovered Article')
    await expect(readFile(store.recoveryPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })

    const secondLoad = await store.load()
    expect(secondLoad.revision).toBe(recovery.revision)
    expect(secondLoad.affairs[0].title).toBe('Recovered Article')
  })

  it('fails closed instead of ignoring a damaged recovery journal', async () => {
    const created = await createDraftTask(directory, sourcePath, imagePath)
    await created.service.flush()
    const filePath = join(directory, 'affairs.json')
    const store = new WebAffairStore(filePath)
    const primaryBefore = await readFile(filePath, 'utf8')
    await writeFile(store.recoveryPath, '{"journalVersion":1}')

    await expect(store.load()).rejects.toThrow('恢复日志损坏')
    expect(await readFile(filePath, 'utf8')).toBe(primaryBefore)
    expect(await readFile(store.recoveryPath, 'utf8')).toContain('journalVersion')
  })
})

async function createStartedTask(directory: string, sourcePath: string, imagePath: string) {
  const created = await createDraftTask(directory, sourcePath, imagePath)
  const started = await created.service.startAttempt(
    {
      workspaceRef: { kind: 'local', path: directory },
      affairId: created.affairId,
      nodeId: created.nodeId,
      accountId: ACCOUNT_ID,
    },
    WORKSPACE_ID,
  )
  if (!started.success) throw new Error(started.error.message)
  const attemptId = started.data.attempts[0].id
  const marked = await created.service.markArticlePublishingAttemptStarted(
    created.affairId,
    attemptId,
    WORKSPACE_ID,
  )
  if (!marked.success) throw new Error(marked.error.message)
  const bound = await created.service.bindAttempt(
    {
      workspaceRef: { kind: 'local', path: directory },
      affairId: created.affairId,
      attemptId,
      tabId: 'tab-article',
      conversationId: 'conversation-article',
      agentRunId: 'run-article',
      browserTaskRunId: '77777777-7777-4777-8777-777777777777',
    },
    WORKSPACE_ID,
  )
  if (!bound.success) throw new Error(bound.error.message)
  return {
    service: created.service,
    affairId: created.affairId,
    attemptId,
    assetId: created.assetId,
  }
}

function createService(directory: string): WebAffairService {
  return new WebAffairService(
    () => resources(),
    new WebAffairStore(join(directory, 'affairs.json')),
    undefined,
    undefined,
    () => ({
      success: true,
      data: {
        webResourceRef: { accountId: ACCOUNT_ID },
        title: 'CSDN',
        entryUrl: 'https://editor.csdn.net/md/',
        browserProfileId: 'csdn-profile',
      },
    }),
  )
}

async function createDraftTask(directory: string, sourcePath: string, imagePath: string) {
  const service = createService(directory)
  await service.load()
  const preview: ArticlePublishingSourcePreview = {
    source: {
      markdownPath: sourcePath,
      contentHash: 'a'.repeat(64),
      modifiedAt: Date.now(),
      size: 36,
    },
    title: 'Article',
    summary: 'summary',
    assets: [
      {
        id: '55555555-5555-4555-8555-555555555555',
        kind: 'local',
        sourcePath: imagePath,
        displayPath: 'image.png',
        contentHash: 'b'.repeat(64),
        mediaType: 'image/png',
        size: 5,
        occurrences: [{ start: 12, end: 23, alt: 'image' }],
        status: 'pending',
        uploadAttempts: [],
      },
    ],
    blockers: [],
    warnings: [],
  }
  const created = await service.createArticlePublishingAffair(
    {
      preview,
      accountId: ACCOUNT_ID,
      fields: { title: 'Article', summary: 'summary', tags: [], category: '' },
      workspaceRef: { kind: 'local', path: directory },
    },
    WORKSPACE_ID,
  )
  if (!created.success) throw new Error(created.error.message)
  return {
    service,
    affairId: created.data.id,
    nodeId: created.data.flow.nodes[0].id,
    assetId: preview.assets[0].id,
  }
}

async function expectStatus(
  promise: ReturnType<WebAffairService['reportArticlePublishingAsset']>,
  status: string,
) {
  const result = await promise
  expect(result.success).toBe(true)
  if (!result.success) return
  expect(result.data.articlePublishing?.assets[0].status).toBe(status)
}

function resources(): WebResourceSnapshot {
  const now = new Date().toISOString()
  return {
    schemaVersion: 3,
    revision: 1,
    websites: [
      {
        id: WEBSITE_ID,
        name: 'CSDN',
        origin: 'https://www.csdn.net',
        entryUrl: 'https://editor.csdn.net/md/',
        createdAt: now,
        updatedAt: now,
      },
    ],
    principals: [
      {
        id: PRINCIPAL_ID,
        kind: 'personal',
        name: 'Author',
        createdAt: now,
        updatedAt: now,
      },
    ],
    accounts: [
      {
        id: ACCOUNT_ID,
        websiteId: WEBSITE_ID,
        principalId: PRINCIPAL_ID,
        label: 'CSDN test',
        browserProfileId: 'csdn-profile',
        createdAt: now,
        updatedAt: now,
      },
    ],
    accountGroups: [],
  }
}
